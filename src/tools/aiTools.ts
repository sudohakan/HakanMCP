import { z } from 'zod';
import { exec, spawn } from 'child_process';
import { processRegistry } from '../utils/processRegistry.js';
import fs from 'node:fs';
import path from 'node:path';
import util from 'util';
import { config, Config } from '../config.js';
import { PROJECT_ROOT } from '../utils/projectRoot.js';
import {
  callClaudeCodeModel,
  callCodexModel,
  callGeminiModel,
  ChatMessage,
  resolveProviderApiKey,
} from './aiProviders.js';
import {
  isInCooldown,
  setCooldownUntil,
  parseCliLimitMessage,
  CLI_LIMIT_FALLBACK_MS,
  isCliLimitError,
  isCliLimited,
  recordCliUsage,
  recordApiUsage,
  isApiLimited,
  setCooldownsBasePath,
  getProviderAvailability,
  setProviderAvailability,
} from '../services/aiProviderCooldown.js';
import {
  getWarmedCliOrder,
  getWarmedApiKey,
  recordLastSuccess,
  saveLastSuccessToDisk,
} from '../services/aiProviderWarmup.js';
import { conversationManager } from '../services/conversationHistory.js';
import { logger } from '../utils/logger.js';
import { runAgenticLoop } from '../services/agenticLoop.js';
import type { AgenticCallFn } from '../services/agenticLoop.js';
import { createClaudeCallFn, createOpenAICallFn, createGeminiCallFn } from '../services/agenticProviders.js';
import { buildAgenticToolList, createToolExecutor } from '../services/toolExecutor.js';
import { createMCPBridge } from '../services/mcpBridge.js';
import { connectionManager } from './mcpClient.js';
import type { AgenticLoopResult } from '../types/index.js';

export type ChatProviderId = 'codex' | 'claude' | 'gemini' | 'cursor';

let agenticToolsRef: Array<{
  name: string;
  description: string;
  inputSchema: { type: string; properties: Record<string, unknown>; required?: string[] };
  handler: (args: unknown) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>;
}> = [];

export function setAgenticToolsRef(tools: typeof agenticToolsRef): void {
  agenticToolsRef = tools;
}

export function getAgenticToolsRef() {
  return agenticToolsRef;
}

export interface GetChatResponseOptions {
  checkCliLimits?: boolean;
  checkApiLimits?: boolean;
  useApiKeys?: boolean;
  recordUsage?: boolean;
  basePath?: string;
  providerOrder?: ChatProviderId[];
  /** Called during provider chain with live status (e.g. for "Thinking..." indicator) */
  onProgress?: (msg: string) => void;
}

const execAsync = util.promisify(exec);

/**
 * Run a CLI command passing prompt via stdin to avoid shell escaping issues
 * with multi-line conversation history prompts.
 * If stdinData is empty, stdin is closed immediately (prompt is in args).
 */
function execViaStdin(
  command: string,
  args: string[],
  stdinData: string,
  options: {
    timeout?: number;
    idleTimeout?: number;
    startupTimeout?: number;
    maxTimeout?: number;
    maxBuffer?: number;
    cwd?: string;
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  const startupTimeoutMs = options.startupTimeout ?? options.idleTimeout ?? options.timeout ?? 30000;
  const maxTimeoutMs = options.maxTimeout ?? 300000;
  const maxBuf = options.maxBuffer ?? 16 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const fullCmd = [command, ...args].filter(Boolean).join(' ');
    const child = processRegistry.track(
      spawn(fullCmd, [], {
        cwd: options.cwd,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      }),
      `ai-${command}`,
    );

    let stdout = '';
    let stderr = '';
    let settled = false;
    let hasReceivedOutput = false;
    const startTime = Date.now();

    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };

    const cleanup = () => {
      if (aliveChecker) clearInterval(aliveChecker);
      if (maxTimer) clearTimeout(maxTimer);
    };

    const isProcessAlive = (): boolean => {
      if (!child.pid) return false;
      try {
        process.kill(child.pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    const aliveChecker = setInterval(() => {
      if (!hasReceivedOutput) {
        const elapsed = Date.now() - startTime;
        if (elapsed >= startupTimeoutMs) {
          if (!isProcessAlive()) {
            cleanup();
            settle(() => {
              const err = new Error(
                `Process exited unexpectedly (no exit event received)`,
              ) as Error & { stdout?: string; stderr?: string };
              err.stdout = stdout;
              err.stderr = stderr;
              reject(err);
            });
          }
        }
      } else {
        if (!isProcessAlive()) {
          cleanup();
          settle(() => {
            const err = new Error(
              `Process exited unexpectedly (no exit event received)`,
            ) as Error & { stdout?: string; stderr?: string };
            err.stdout = stdout;
            err.stderr = stderr;
            reject(err);
          });
        }
      }
    }, 5000);

    const maxTimer = maxTimeoutMs > 0
      ? setTimeout(() => {
          cleanup();
          child.kill();
          settle(() => {
            const err = new Error(
              `Process exceeded maximum runtime of ${Math.round(maxTimeoutMs / 1000)}s`,
            ) as Error & { stdout?: string; stderr?: string };
            err.stdout = stdout;
            err.stderr = stderr;
            reject(err);
          });
        }, maxTimeoutMs)
      : null;

    child.stdout?.on('data', (data: Buffer) => {
      hasReceivedOutput = true;
      stdout += data.toString();
      if (stdout.length > maxBuf) {
        cleanup();
        child.kill();
        settle(() => reject(new Error('maxBuffer exceeded')));
      }
    });
    child.stderr?.on('data', (data: Buffer) => {
      hasReceivedOutput = true;
      stderr += data.toString();
    });

    child.on('error', (err: Error) => {
      cleanup();
      const extended = err as Error & { stdout?: string; stderr?: string };
      extended.stdout = stdout;
      extended.stderr = stderr;
      settle(() => reject(extended));
    });

    child.on('close', (code: number | null) => {
      cleanup();
      if (code === 0) {
        settle(() => resolve({ stdout, stderr }));
      } else {
        const err = new Error(`Command failed with exit code ${code}`) as Error & {
          stdout?: string;
          stderr?: string;
        };
        err.stdout = stdout;
        err.stderr = stderr;
        settle(() => reject(err));
      }
    });

    if (stdinData) {
      child.stdin?.write(stdinData);
    }
    child.stdin?.end();
  });
}

async function _execWithOutput(
  command: string,
  options?: { timeout?: number; maxBuffer?: number; cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, options, (err, stdout, stderr) => {
      const out = (stdout ?? '').toString();
      const errOut = (stderr ?? '').toString();
      if (err) {
        (err as Error & { stdout: string; stderr: string }).stdout = out;
        (err as Error & { stdout: string; stderr: string }).stderr = errOut;
        reject(err);
      } else {
        resolve({ stdout: out, stderr: errOut });
      }
    });
  });
}

let currentConfig: Config = config;
const localModelsDisabled = () =>
  !(currentConfig.aiProviders?.localModels) ||
  process.env.DISABLE_LOCAL_MODELS === '1';

export function setOllamaConfig(newConfig: Config) {
  currentConfig = newConfig;
}

/**
 * Make request using JSON file approach
 * EXTENDED TIMEOUT to 10 hours for long-running agent operations
 */
async function ollamaRequestViaJsonFile(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const jsonFile = path.join(
    '/tmp',
    `ollama_${Date.now()}_${Math.random().toString(36).substring(7)}.json`,
  );

  try {
    await fs.promises.writeFile(jsonFile, JSON.stringify(payload, null, 2), 'utf8');
    logger.debug('Ollama temp file created', { jsonFile });

    const url = `${currentConfig.ollamaUrl}${endpoint}`;
    const curlCmd = `curl -s -X POST "${url}" -H "Content-Type: application/json" -d @${jsonFile}`;

    logger.debug('Ollama request', { endpoint, model: payload.model });

    const { stdout, stderr } = await execAsync(curlCmd, {
      timeout: currentConfig.ollamaTimeout,
      maxBuffer: 50 * 1024 * 1024,
    });

    if (stderr) {
      logger.warn('Ollama curl stderr', { stderr });
    }

    logger.debug('Ollama response received', { bytes: stdout.length });

    const response = JSON.parse(stdout);

    if (response.error) {
      throw new Error(response.error);
    }

    return response;
  } catch (error: unknown) {
    const err = error as { killed?: boolean; signal?: string };
    if (err?.killed || err?.signal === 'SIGTERM') {
      throw new Error('Request timeout - model may be loading for first time');
    }
    throw error;
  } finally {
    if (fs.existsSync(jsonFile)) {
      fs.unlinkSync(jsonFile);
      logger.debug('Ollama temp file cleaned up', { jsonFile });
    }
  }
}

/**
 * Try multiple models with PROPER fallback on timeout
 */
async function tryWithModelFallback(
  endpoint: string,
  payloadTemplate: Record<string, unknown>,
  preferredModel?: string,
): Promise<{ response: Record<string, unknown>; model: string }> {
  if (localModelsDisabled()) {
    throw new Error(
      'Local models are disabled (aiProviders.localModels=false or DISABLE_LOCAL_MODELS=1). Provide Codex/Claude CLI or API keys.',
    );
  }

  const modelsToTry = preferredModel
    ? [preferredModel, ...currentConfig.availableModels.filter((m) => m !== preferredModel)]
    : [
        currentConfig.ollamaModel,
        ...currentConfig.availableModels.filter((m) => m !== currentConfig.ollamaModel),
      ];

  logger.info('Ollama fallback chain', { chain: modelsToTry.join(' → ') });

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    let retries = currentConfig.retryCount;

    while (retries >= 0) {
      try {
        logger.debug('Ollama trying model', { index: i + 1, total: modelsToTry.length, model, retriesLeft: retries });

        const response = await ollamaRequestViaJsonFile(endpoint, {
          ...payloadTemplate,
          model,
        });

        logger.info('Ollama model succeeded', { model });
        return { response, model };
      } catch (error: unknown) {
        logger.warn('Ollama model failed', { model, error: error instanceof Error ? error.message : String(error) });
        retries--;

        if (retries < 0) {
          if (i === modelsToTry.length - 1) {
            throw new Error(
              `All ${modelsToTry.length} models failed. Last error: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
          logger.debug('Ollama trying fallback model');
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  throw new Error('No models to try');
}

async function recoverWithLocalModel(providerName: string, errorMessage: string): Promise<string> {
  try {
    const diagnosticPrompt = [
      `${providerName}An error occurred in the provider.`,
      `Hata: ${errorMessage}`,
      'Task: Predict the root cause of the error, list possible quota/access problems, and give a 3-step plan to fix it.',
      'Generate quick solution suggestions using the local model.',
    ].join('\n');

    const result = await tryWithModelFallback('/api/chat', {
      messages: [{ role: 'user', content: diagnosticPrompt }],
      stream: false,
    });

    const resp = result.response as { message?: { content?: string } };
    return resp.message?.content || JSON.stringify(result.response, null, 2);
  } catch (diagError: unknown) {
    return `Recovery request failed:${diagError instanceof Error ? diagError.message : String(diagError)}`;
  }
}

async function callCodexCli(prompt: string, model?: string): Promise<string> {
  const envArgs =
    process.env.CODEX_CLI_ARGS?.split(/\s+/).filter((arg) => arg.trim().length > 0) ?? [];
  const baseArgs = envArgs.length > 0 ? [...envArgs] : ['exec'];
  const knownSubcommands = new Set([
    'exec',
    'e',
    'review',
    'login',
    'logout',
    'mcp',
    'mcp-server',
    'app-server',
    'sandbox',
    'apply',
    'resume',
    'cloud',
    'features',
    'help',
  ]);
  const hasSubcommand = baseArgs.some((arg) => knownSubcommands.has(arg));
  if (!hasSubcommand) {
    baseArgs.unshift('exec');
  }
  const yoloEnv = process.env.CODEX_CLI_YOLO;
  const yoloEnabled =
    yoloEnv === undefined || ['1', 'true', 'yes', 'on'].includes(String(yoloEnv).toLowerCase());

  const args = [...baseArgs];
  if (yoloEnabled && !args.includes('--yolo')) {
    args.unshift('--yolo');
  }
  if (model) {
    args.push('--model', model);
  }

  const buildArgsList = (extraArgs: string[]) =>
    [...extraArgs].filter((segment) => segment && segment.trim().length > 0);

  const argSets = [buildArgsList(args)];
  if (args.includes('--yolo')) {
    argSets.push(buildArgsList(args.filter((arg) => arg !== '--yolo')));
  }

  const errors: string[] = [];
  let lastError: unknown;

  for (const argSet of argSets) {
    try {
      const { stdout } = await execViaStdin('codex', argSet, prompt, {
        startupTimeout: 30000,
        maxTimeout: 300000,
      });
      return stdout.trim();
    } catch (e: unknown) {
      lastError = e;
      errors.push(`codex ${argSet.join(' ')}: ${e instanceof Error ? e.message : 'unknown error'}`);
    }
  }

  const errorMessage = errors.length
    ? `Codex CLI failed (${errors.join(' | ')})`
    : 'Codex CLI failed';
  const err = new Error(errorMessage) as Error & { stdout?: string; stderr?: string };
  if (lastError && typeof lastError === 'object') {
    const le = lastError as { stdout?: string; stderr?: string };
    if (le.stdout) err.stdout = le.stdout;
    if (le.stderr) err.stderr = le.stderr;
  }
  throw err;
}

async function callClaudeCli(prompt: string): Promise<string> {
  try {
    const { stdout } = await execViaStdin('claude', ['-p', '--dangerously-skip-permissions'], prompt, {
      startupTimeout: 30000,
      maxTimeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (!(err as Error & { stdout?: string }).stdout)
      (err as Error & { stdout?: string }).stdout = '';
    if (!(err as Error & { stderr?: string }).stderr)
      (err as Error & { stderr?: string }).stderr = '';
    throw err;
  }
}

async function callGeminiCli(prompt: string): Promise<string> {
  try {
    const { stdout } = await execViaStdin('gemini', ['--yolo'], prompt, {
      startupTimeout: 45000,
      maxTimeout: 300000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (!(err as Error & { stdout?: string }).stdout)
      (err as Error & { stdout?: string }).stdout = '';
    if (!(err as Error & { stderr?: string }).stderr)
      (err as Error & { stderr?: string }).stderr = '';
    throw err;
  }
}

async function callCursorCli(prompt: string): Promise<string> {
  try {
    const model = process.env.CURSOR_AGENT_MODEL || '';
    const cursorArgs = ['-p', '--trust'];
    if (model) {
      cursorArgs.push('--model', model);
    }
    const cwd = PROJECT_ROOT;
    const { stdout } = await execViaStdin('agent', cursorArgs, prompt, {
      startupTimeout: 60000,
      maxTimeout: 600000,
      maxBuffer: 16 * 1024 * 1024,
      cwd,
    });
    return stdout.trim();
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (!(err as Error & { stdout?: string }).stdout)
      (err as Error & { stdout?: string }).stdout = '';
    if (!(err as Error & { stderr?: string }).stderr)
      (err as Error & { stderr?: string }).stderr = '';
    throw err;
  }
}

/**
 * Build a single prompt string that includes conversation history for CLI providers
 * that only accept a single string input (no native message array support).
 */
function buildCliPrompt(messages: ChatMessage[]): string {
  if (messages.length <= 1) {
    return messages[messages.length - 1]?.content || '';
  }
  const contextMessages = messages.slice(-20);
  const parts: string[] = [];
  for (const msg of contextMessages.slice(0, -1)) {
    if (msg.role === 'system') continue;
    parts.push(`[${msg.role.toUpperCase()}]: ${msg.content}`);
  }
  const lastMsg = contextMessages[contextMessages.length - 1];
  if (parts.length > 0) {
    return `Previous conversation:\n${parts.join('\n')}\n\n[USER]: ${lastMsg.content}`;
  }
  return lastMsg.content;
}

export async function getPreferredLLMResponse(
  messages: ChatMessage[],
  preferredModel?: string,
  priority: Array<'codex' | 'claude' | 'gemini' | 'cursor'> = ['codex', 'claude', 'gemini'],
  allowLocalFallback = true,
  options: GetChatResponseOptions = {},
): Promise<{ text: string; provider: string; diagnostics: string[] }> {
  const {
    checkCliLimits,
    checkApiLimits = true,
    useApiKeys = true,
    recordUsage = true,
    basePath,
    onProgress,
  } = options;
  if (basePath) setCooldownsBasePath(basePath);

  const defaultCliOrder: ChatProviderId[] = ['codex', 'claude', 'gemini', 'cursor'];
  const cliOrder: ChatProviderId[] = options.providerOrder ?? getWarmedCliOrder(defaultCliOrder);
  const disableLocal = localModelsDisabled();
  const diagnostics: string[] = [];
  const lastMessage = messages[messages.length - 1].content;
  const cliPrompt = buildCliPrompt(messages);

  const tryCli = async (provider: ChatProviderId): Promise<string | null> => {
    if (isInCooldown(provider)) return null;
    if (checkCliLimits && isCliLimited(provider)) return null;
    const cliAvail = getProviderAvailability(`${provider}_cli`);
    if (cliAvail.status === 'unavailable') {
      diagnostics.push(`${provider} CLI skipped (${cliAvail.reason || 'unavailable'})`);
      return null;
    }
    try {
      let result: string;
      if (provider === 'codex') result = await callCodexCli(cliPrompt);
      else if (provider === 'claude') result = await callClaudeCli(cliPrompt);
      else if (provider === 'gemini') result = await callGeminiCli(cliPrompt);
      else if (provider === 'cursor') result = await callCursorCli(cliPrompt);
      else return null;
      if (isCliLimitError(result)) {
        const untilMs = parseCliLimitMessage(result);
        if (untilMs != null) {
          setCooldownUntil(provider, untilMs, result.slice(0, 150));
        } else {
          setCooldownUntil(provider, Date.now() + CLI_LIMIT_FALLBACK_MS, 'limit (parse fallback)');
        }
        setProviderAvailability(`${provider}_cli`, 'unavailable', `limit reached: ${result.slice(0, 80)}`);
        diagnostics.push(`${provider} CLI limit reached.`);
        return null;
      }
      if (recordUsage) recordCliUsage(provider);
      setProviderAvailability(`${provider}_cli`, 'available', 'CLI responded');
      return result;
    } catch (e: unknown) {
      const ex = e as { stdout?: string; stderr?: string; message?: string };
      const combined = [ex?.stdout, ex?.stderr, ex?.message].filter(Boolean).join('\n');
      if (isCliLimitError(combined)) {
        const untilMs = parseCliLimitMessage(combined);
        if (untilMs != null) {
          setCooldownUntil(provider, untilMs, combined.slice(0, 150));
        } else {
          setCooldownUntil(provider, Date.now() + CLI_LIMIT_FALLBACK_MS, 'limit (parse fallback)');
        }
        setProviderAvailability(`${provider}_cli`, 'unavailable', `limit reached: ${combined.slice(0, 80)}`);
        diagnostics.push(`${provider} CLI limit reached: ${combined.slice(0, 120)}`);
      } else {
        setProviderAvailability(`${provider}_cli`, 'unavailable', combined.slice(0, 100));
        diagnostics.push(`${provider} CLI could not be used.`);
      }
      return null;
    }
  };

  const formatProvider = (p: ChatProviderId, suffix: string) =>
    p === 'codex'
      ? `Codex (${suffix})`
      : p === 'claude'
        ? `Claude (${suffix})`
        : p === 'gemini'
          ? `Gemini (${suffix})`
          : `Cursor (${suffix})`;

  for (const provider of cliOrder) {
    onProgress?.(`Asking ${formatProvider(provider, 'CLI')}...`);
    const text = await tryCli(provider);
    if (text) {
      recordLastSuccess(provider);
      saveLastSuccessToDisk(provider);
      return { text, provider: formatProvider(provider, 'CLI'), diagnostics };
    }
  }

  if (!useApiKeys) {
    throw new Error(
      `No CLI provider available. Tried: ${cliOrder.join(', ')}. Enable API keys or install CLI.`,
    );
  }

  onProgress?.('CLIs unavailable, trying API...');

  const codexCached = getWarmedApiKey('codex');
  const codexKey = codexCached
    ? { key: codexCached, diagnostics: [] as string[] }
    : resolveProviderApiKey(
        'Codex',
        ['CODEX_API_KEY', 'OPENAI_API_KEY'],
        currentConfig.aiProviders?.codexKeyEncrypted,
      );
  const claudeCached = getWarmedApiKey('claude');
  const claudeKey = claudeCached
    ? { key: claudeCached, diagnostics: [] as string[] }
    : resolveProviderApiKey(
        'Claude Code',
        ['CLAUDE_CODE_API_KEY', 'ANTHROPIC_API_KEY'],
        currentConfig.aiProviders?.claudeKeyEncrypted,
      );
  const geminiCached = getWarmedApiKey('gemini');
  const geminiKey = geminiCached
    ? { key: geminiCached, diagnostics: [] as string[] }
    : resolveProviderApiKey(
        'Gemini',
        ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        currentConfig.aiProviders?.geminiKeyEncrypted,
      );

  for (const provider of priority) {
    if (provider === 'codex') {
      if (isInCooldown('codex')) {
        diagnostics.push('Codex API skipped (in cooldown)');
        continue;
      }
      diagnostics.push(...codexKey.diagnostics);
      if (codexKey.key && (!checkApiLimits || !isApiLimited('codex'))) {
        const codexApiAvail = getProviderAvailability('codex_api');
        if (codexApiAvail.status === 'unavailable') {
          diagnostics.push(`Codex API skipped (${codexApiAvail.reason || 'unavailable'})`);
        } else {
          onProgress?.('Connecting to Codex API...');
          try {
            const result = await callCodexModel(messages, preferredModel, codexKey.key);
            if (recordUsage) recordApiUsage('codex');
            setProviderAvailability('codex_api', 'available', 'API responded');
            recordLastSuccess('codex');
            saveLastSuccessToDisk('codex');
            return { text: result.text, provider: `Codex (${result.model})`, diagnostics };
          } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            if (/401|403|forbidden|unauthorized|invalid.*key|invalid.*api/i.test(errMsg)) {
              setProviderAvailability('codex_api', 'unavailable', `auth error: ${errMsg.slice(0, 80)}`);
            } else if (/429|500|502|503|504|rate.?limit|quota|resource_exhausted|overloaded/i.test(errMsg)) {
              setProviderAvailability('codex_api', 'unavailable', `rate limited or server error: ${errMsg.slice(0, 80)}`);
            } else if (/timeout|ECONNREFUSED|ENOTFOUND|network/i.test(errMsg)) {
              setProviderAvailability('codex_api', 'unavailable', `connection error: ${errMsg.slice(0, 80)}`);
            }
            const recovery = await recoverWithLocalModel('Codex', errMsg);
            diagnostics.push(`Codex error:${errMsg}\nSolution suggestion:${recovery}`);
          }
        }
      }
    }

    if (provider === 'claude') {
      if (isInCooldown('claude')) {
        diagnostics.push('Claude API skipped (in cooldown)');
        continue;
      }
      diagnostics.push(...claudeKey.diagnostics);
      if (claudeKey.key && (!checkApiLimits || !isApiLimited('claude'))) {
        const claudeApiAvail = getProviderAvailability('claude_api');
        if (claudeApiAvail.status === 'unavailable') {
          diagnostics.push(`Claude API skipped (${claudeApiAvail.reason || 'unavailable'})`);
        } else {
          onProgress?.('Connecting to Claude API...');
          try {
            const result = await callClaudeCodeModel(messages, preferredModel, claudeKey.key);
            if (recordUsage) recordApiUsage('claude');
            setProviderAvailability('claude_api', 'available', 'API responded');
            recordLastSuccess('claude');
            saveLastSuccessToDisk('claude');
            return { text: result.text, provider: `Claude Code (${result.model})`, diagnostics };
          } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            if (/401|403|forbidden|unauthorized|invalid.*key|invalid.*api/i.test(errMsg)) {
              setProviderAvailability('claude_api', 'unavailable', `auth error: ${errMsg.slice(0, 80)}`);
            } else if (/429|500|502|503|504|rate.?limit|quota|resource_exhausted|overloaded/i.test(errMsg)) {
              setProviderAvailability('claude_api', 'unavailable', `rate limited or server error: ${errMsg.slice(0, 80)}`);
            } else if (/timeout|ECONNREFUSED|ENOTFOUND|network/i.test(errMsg)) {
              setProviderAvailability('claude_api', 'unavailable', `connection error: ${errMsg.slice(0, 80)}`);
            }
            const recovery = await recoverWithLocalModel('Claude Code', errMsg);
            diagnostics.push(`Claude Code error:${errMsg}\nSolution suggestion:${recovery}`);
          }
        }
      }
    }

    if (provider === 'gemini') {
      if (isInCooldown('gemini')) {
        diagnostics.push('Gemini API skipped (in cooldown)');
        continue;
      }
      diagnostics.push(...geminiKey.diagnostics);
      if (geminiKey.key && (!checkApiLimits || !isApiLimited('gemini'))) {
        const geminiApiAvail = getProviderAvailability('gemini_api');
        if (geminiApiAvail.status === 'unavailable') {
          diagnostics.push(`Gemini API skipped (${geminiApiAvail.reason || 'unavailable'})`);
        } else {
          onProgress?.('Connecting to Gemini API...');
          try {
            const result = await callGeminiModel(messages, preferredModel, geminiKey.key);
            if (recordUsage) recordApiUsage('gemini');
            setProviderAvailability('gemini_api', 'available', 'API responded');
            recordLastSuccess('gemini');
            saveLastSuccessToDisk('gemini');
            return { text: result.text, provider: `Gemini (${result.model})`, diagnostics };
          } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            if (/401|403|forbidden|unauthorized|invalid.*key|invalid.*api/i.test(errMsg)) {
              setProviderAvailability('gemini_api', 'unavailable', `auth error: ${errMsg.slice(0, 80)}`);
            } else if (/429|500|502|503|504|rate.?limit|quota|resource_exhausted|overloaded/i.test(errMsg)) {
              setProviderAvailability('gemini_api', 'unavailable', `rate limited or server error: ${errMsg.slice(0, 80)}`);
            } else if (/timeout|ECONNREFUSED|ENOTFOUND|network/i.test(errMsg)) {
              setProviderAvailability('gemini_api', 'unavailable', `connection error: ${errMsg.slice(0, 80)}`);
            }
            const recovery = await recoverWithLocalModel('Gemini', errMsg);
            diagnostics.push(`Gemini error:${errMsg}\nSolution suggestion:${recovery}`);
          }
        }
      }
    }
  }

  const cursorCliAvail = getProviderAvailability('cursor_cli');
  if (cursorCliAvail.status !== 'unavailable') {
    onProgress?.('Running Cursor agent...');
  }
  if (!isInCooldown('cursor') && cursorCliAvail.status !== 'unavailable') {
    try {
      const result = await callCursorCli(lastMessage);
      recordCliUsage('cursor');
      recordLastSuccess('cursor');
      saveLastSuccessToDisk('cursor');
      return { text: result, provider: 'Cursor (CLI)', diagnostics };
    } catch (e: unknown) {
      const ex = e as { stdout?: string; stderr?: string; message?: string };
      const combined = [ex?.stdout, ex?.stderr, ex?.message].filter(Boolean).join('\n');
      if (isCliLimitError(combined)) {
        const untilMs = parseCliLimitMessage(combined);
        if (untilMs != null) setCooldownUntil('cursor', untilMs, combined.slice(0, 150));
      }
      diagnostics.push('Cursor CLI could not be used.');
    }
  }

  onProgress?.('Trying Ollama (local)...');
  const mayUseOllama =
    allowLocalFallback === true || (!disableLocal && allowLocalFallback !== false);
  if (mayUseOllama) {
    try {
      const localResult = await tryWithModelFallback(
        '/api/chat',
        {
          messages,
          stream: false,
        },
        preferredModel,
      );

      const localResp = localResult.response as { message?: { content?: string } };
      const localResponseText =
        localResp.message?.content || JSON.stringify(localResult.response, null, 2);

      return {
        text: localResponseText,
        provider: `Ollama (${localResult.model})`,
        diagnostics,
      };
    } catch (e: unknown) {
      const errMsg = (e as Error)?.message ?? String(e);
      diagnostics.push(`Ollama failed: ${errMsg}`);
    }
  } else {
    diagnostics.push('Local model fallback disabled.');
  }

  if (isInCooldown('codex')) {
    diagnostics.push('Codex last resort skipped (in cooldown)');
  } else try {
    diagnostics.push('All providers failed — trying codex CLI with gpt-5.1-codex-mini as last resort...');
    const text = await callCodexCli(lastMessage, 'gpt-5.1-codex-mini');
    if (text) {
      if (recordUsage) recordCliUsage('codex');
      setProviderAvailability('codex_cli', 'available', 'CLI responded (last resort)');
      return { text, provider: 'Codex CLI last resort (gpt-5.1-codex-mini)', diagnostics };
    }
  } catch (e: unknown) {
    const errMsg = (e as Error)?.message ?? String(e);
    diagnostics.push(`Last resort gpt-5.1-codex-mini failed: ${errMsg}`);
  }

  throw new Error('All AI providers failed. Diagnostics: ' + diagnostics.join(' | '));
}

/**
 * Resolve the best available agentic provider using config priorities + env keys.
 * Used by missionRunner and actionExecutor to get an AgenticCallFn.
 */
export function resolveAgenticProvider(): { callFn: AgenticCallFn; label: string } {
  const apiOrder: Array<'codex' | 'claude' | 'gemini'> = ['codex', 'claude', 'gemini'];

  for (const provider of apiOrder) {
    if (provider === 'codex') {
      const key = process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY;
      if (key) {
        const model = process.env.OPENAI_MODEL || process.env.CODEX_MODEL || 'gpt-4o';
        return { callFn: createOpenAICallFn(model, key), label: `openai:${model}` };
      }
    }
    if (provider === 'claude') {
      const key = process.env.CLAUDE_CODE_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (key) {
        const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
        return { callFn: createClaudeCallFn(model, key), label: `claude:${model}` };
      }
    }
    if (provider === 'gemini') {
      const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
      if (key) {
        const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
        return { callFn: createGeminiCallFn(model, key), label: `gemini:${model}` };
      }
    }
  }

  throw new Error(
    'No AI provider available. Set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY.',
  );
}

async function handleAgenticChat(
  chatMessages: ChatMessage[],
  model: string | undefined,
  statefulMessage: string | undefined,
  maxIterations: number | undefined,
  enableMcpBridge: boolean | undefined,
) {
  if (agenticToolsRef.length === 0) {
    return {
      content: [{ type: 'text', text: 'Agentic tools not initialized. Server may not have injected tool registry.' }],
      isError: true,
    };
  }

  const agenticApiOrder: Array<'codex' | 'claude' | 'gemini'> = ['codex', 'claude', 'gemini'];
  const providers: Array<{
    id: 'codex' | 'claude' | 'gemini';
    label: string;
    envVars: string[];
    encrypted?: string;
    defaultModel: string;
    create: (m: string, k: string) => AgenticCallFn;
  }> = [
    { id: 'claude', label: 'Claude', envVars: ['CLAUDE_CODE_API_KEY', 'ANTHROPIC_API_KEY'], encrypted: currentConfig.aiProviders?.claudeKeyEncrypted, defaultModel: process.env.CLAUDE_CODE_MODEL || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6', create: createClaudeCallFn },
    { id: 'codex', label: 'OpenAI', envVars: ['CODEX_API_KEY', 'OPENAI_API_KEY'], encrypted: currentConfig.aiProviders?.codexKeyEncrypted, defaultModel: process.env.CODEX_MODEL || 'gpt-4o-mini', create: createOpenAICallFn },
    { id: 'gemini', label: 'Gemini', envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], encrypted: currentConfig.aiProviders?.geminiKeyEncrypted, defaultModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash', create: createGeminiCallFn },
  ];

  let callFn: AgenticCallFn | null = null;
  let providerLabel = '';
  let selectedProviderId: 'codex' | 'claude' | 'gemini' = 'gemini';
  let targetModel = '';
  const diagnostics: string[] = [];

  for (const providerId of agenticApiOrder) {
    const p = providers.find((pr) => pr.id === providerId);
    if (!p) continue;

    if (isInCooldown(providerId)) {
      diagnostics.push(`${p.label} skipped for agentic mode (in cooldown)`);
      continue;
    }
    const avail = getProviderAvailability(`${providerId}_api`);
    if (avail.status === 'unavailable') {
      diagnostics.push(`${p.label} skipped for agentic mode (${avail.reason || 'unavailable'})`);
      continue;
    }

    const keyRes = resolveProviderApiKey(p.label, p.envVars, p.encrypted);
    diagnostics.push(...keyRes.diagnostics);
    if (keyRes.key) {
      targetModel = model || p.defaultModel;
      callFn = p.create(targetModel, keyRes.key);
      providerLabel = p.label;
      selectedProviderId = providerId;
      break;
    }
  }

  if (!callFn) {
    throw new Error(`No API key available for agentic mode (tried Claude, OpenAI, Gemini). Falling back to standard mode.`);
  }

  const toolDefs = buildAgenticToolList(agenticToolsRef);
  const mcpBridge = enableMcpBridge ? createMCPBridge(connectionManager) : undefined;
  const executor = createToolExecutor(agenticToolsRef, mcpBridge);

  if (mcpBridge) {
    try {
      const remoteTools = await mcpBridge.getRemoteTools();
      toolDefs.push(...remoteTools);
    } catch (err) {
      logger.warn('Failed to load MCP bridge tools', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const systemMsg = chatMessages.find((m) => m.role === 'system');
  const claudeMessages = chatMessages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const loopResult: AgenticLoopResult = await runAgenticLoop(
    systemMsg?.content,
    claudeMessages,
    toolDefs,
    executor,
    callFn,
    `${providerLabel} (${targetModel})`,
    { maxIterations },
  );

  const toolSummary = loopResult.toolCalls.length > 0
    ? '\n\n**Tool calls:**\n' + loopResult.toolCalls.map((tc) =>
        `- \`${tc.name}\` (${tc.duration_ms}ms)${tc.is_error ? ' [ERROR]' : ''}`,
      ).join('\n')
    : '';

  logger.info('Agentic loop token usage', {
    provider: providerLabel,
    model: loopResult.model,
    inputTokens: loopResult.inputTokens,
    outputTokens: loopResult.outputTokens,
    toolCalls: loopResult.toolCalls.length,
  });
  recordApiUsage(selectedProviderId);
  const responseText = loopResult.text || 'No text response from agentic loop.';

  if (statefulMessage) {
    conversationManager.addMessage({
      role: 'assistant',
      content: responseText,
      provider: `${providerLabel} Agentic (${loopResult.model})`,
    });
  }

  return {
    content: [{
      type: 'text',
      text: `**Selected Model:** ${providerLabel} Agentic (${loopResult.model})\n\n${responseText}${toolSummary}`,
    }],
  };
}

const _aiLegacyTools = [
  {
    name: 'ai_chat',
    description:
      'Chat with AI with conversation history. Auto fallback: Codex, Claude, Gemini CLI/API, Cursor CLI, Ollama.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Model name (optional)' },
        message: {
          type: 'string',
          description: 'Single message to send. Automatically managed with conversation history.',
        },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant', 'system'] },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
          },
          description: 'Direct messages array (bypasses conversation history).',
        },
        allowLocalFallback: {
          type: 'boolean',
          description:
            'Turn on Local/Ollama fallback? If false, only Codex/Claude/Gemini CLI/API and Cursor CLI is used.',
        },
        agentic: {
          type: 'boolean',
          description:
            'Enable agentic tool-use loop. Claude will be able to call HakanMCP tools iteratively. Requires Claude API key.',
        },
        maxIterations: {
          type: 'number',
          description: 'Maximum agentic loop iterations (default: 10).',
        },
        enableMcpBridge: {
          type: 'boolean',
          description:
            'Enable MCP bridge for agentic mode: include tools from connected MCP servers.',
        },
      },
    },
    handler: async (args: unknown) => {
      const parsed = z
        .object({
          model: z.string().optional(),
          message: z.string().optional(),
          messages: z
            .array(
              z.object({
                role: z.enum(['user', 'assistant', 'system']),
                content: z.string(),
              }),
            )
            .optional(),
          allowLocalFallback: z.boolean().optional(),
          agentic: z.boolean().optional(),
          maxIterations: z.number().optional(),
          enableMcpBridge: z.boolean().optional(),
        })
        .parse(args);
      const { model, message, messages } = parsed;
      const allowLocalFallback =
        parsed.allowLocalFallback ?? true;

      let chatMessages: ChatMessage[];

      if (message) {
        conversationManager.addMessage({ role: 'user', content: message });
        chatMessages = conversationManager.getChatMessages();
      } else if (messages && messages.length > 0) {
        chatMessages = messages;
      } else {
        return {
          content: [
            {
              type: 'text',
              text: 'Please provide either "message" (string) or "messages" (array).',
            },
          ],
          isError: true,
        };
      }

      const agenticEnabled = parsed.agentic ?? currentConfig.aiProviders?.agenticEnabled ?? false;
      const agenticMaxIter = parsed.maxIterations ?? currentConfig.aiProviders?.agenticMaxIterations;
      if (agenticEnabled) {
        const cliPri: string[] = ['codex', 'claude', 'gemini', 'cursor'];
        const apiPri: string[] = ['codex', 'claude', 'gemini'];

        let firstApiProvider: string | null = null;
        for (const pid of apiPri) {
          const provDef = [
            { id: 'codex', envVars: ['CODEX_API_KEY', 'OPENAI_API_KEY'] },
            { id: 'claude', envVars: ['CLAUDE_CODE_API_KEY', 'ANTHROPIC_API_KEY'] },
            { id: 'gemini', envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
          ].find((p) => p.id === pid);
          if (provDef && provDef.envVars.some((v) => process.env[v])) {
            firstApiProvider = pid;
            break;
          }
        }

        const cliRank = (id: string) => { const idx = cliPri.indexOf(id); return idx === -1 ? 999 : idx; };
        const apiRank = firstApiProvider ? cliRank(firstApiProvider) : 999;
        const hasHigherCli = cliPri.some((c) => cliRank(c) < apiRank && c !== firstApiProvider);

        if (hasHigherCli) {
          logger.info('Agentic mode skipped: higher-priority CLI available', {
            firstApiProvider,
            cliOrder: cliPri,
          });
        } else {
          try {
            return await handleAgenticChat(chatMessages, model, message, agenticMaxIter, parsed.enableMcpBridge);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            logger.warn('Agentic mode failed, falling back to standard mode', { error: errMsg });
          }
        }
      }

      const basePath = PROJECT_ROOT;
      const result = await getPreferredLLMResponse(
        chatMessages,
        model,
        ['codex', 'claude', 'gemini'],
        allowLocalFallback,
        { basePath },
      );

      if (result.diagnostics.length > 0) {
        logger.info('Provider selection diagnostics', {
          provider: result.provider,
          diagnostics: result.diagnostics,
        });
      }

      const responseText = (result.text || '').trim();
      const fallbackText =
        !responseText && result.diagnostics.length > 0
          ? `No response from ${result.provider}.`
          : responseText || 'Empty response from model. Please try again.';

      if (message) {
        conversationManager.addMessage({
          role: 'assistant',
          content: fallbackText,
          provider: result.provider,
        });
      }

      return {
        content: [
          {
            type: 'text',
            text: `**Selected Model:** ${result.provider}\n\n${fallbackText}`,
          },
        ],
      };
    },
  },

  {
    name: 'ai_generate',
    description: 'Generate text with AI.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        prompt: { type: 'string' },
      },
      required: ['prompt'],
    },
    handler: async (args: unknown) => {
      const { model, prompt } = z
        .object({
          model: z.string().optional(),
          prompt: z.string(),
        })
        .parse(args);

      if (localModelsDisabled()) {
        throw new Error(
          'Local models are disabled (aiProviders.localModels=false or DISABLE_LOCAL_MODELS=1). Provide Codex/Claude CLI or API keys instead of Ollama.',
        );
      }

      const result = await tryWithModelFallback(
        '/api/generate',
        {
          prompt,
          stream: false,
        },
        model,
      );

      const responseText = result.response.response || JSON.stringify(result.response, null, 2);

      return {
        content: [
          {
            type: 'text',
            text: `**Model: ${result.model}**\n\n${responseText}`,
          },
        ],
      };
    },
  },

  {
    name: 'ai_listModels',
    description: "List available AI models (Don't be).",
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => {
      const url = `${currentConfig.ollamaUrl}/api/tags`;

      const { stdout } = await execAsync(`curl -s "${url}"`, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });

      const data = JSON.parse(stdout);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    },
  },

  {
    name: 'ai_history',
    description: "Manage AI conversation history. action='get' retrieves conversation history, action='clear' clears it.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get', 'clear'],
          description: "Action to perform: 'get' retrieves conversation history, 'clear' clears it.",
        },
        limit: {
          type: 'number',
          description: 'Maximum number of messages to return (default: all). Only used when action=get.',
        },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action, limit } = z
        .object({
          action: z.enum(['get', 'clear']),
          limit: z.number().optional(),
        })
        .parse(args);

      if (action === 'clear') {
        const count = conversationManager.getMessageCount();
        conversationManager.clear();

        return {
          content: [
            {
              type: 'text',
              text: `Conversation history cleared. ${count} messages removed.`,
            },
          ],
        };
      }

      const messages = conversationManager.getMessages();
      const limited = limit ? messages.slice(-limit) : messages;

      if (limited.length === 0) {
        return {
          content: [{ type: 'text', text: 'No conversation history.' }],
        };
      }

      const formatted = limited
        .map(
          (m) =>
            `**[${m.role}]** (${new Date(m.timestamp).toLocaleString()}${m.provider ? `, ${m.provider}` : ''}):\n${m.content}`,
        )
        .join('\n\n---\n\n');

      return {
        content: [
          {
            type: 'text',
            text: `# Conversation History (${limited.length}/${conversationManager.getMessageCount()} messages)\n\n${formatted}`,
          },
        ],
      };
    },
  },
];

// ── Consolidated action-dispatched export ───────────────────────────────────

function _findAiLegacyHandler(name: string) {
  const tool = _aiLegacyTools.find((t) => t.name === name);
  if (!tool) throw new Error(`Internal error: legacy ai tool not found: ${name}`);
  return tool.handler;
}

export const aiTools = [
  {
    name: 'ai',
    description:
      'AI operations. Actions: chat, generate, listModels, getHistory, clearHistory.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['chat', 'generate', 'listModels', 'getHistory', 'clearHistory'],
          description: 'Operation to perform',
        },
        model: { type: 'string', description: 'Model name (optional)' },
        message: { type: 'string', description: 'Single message to send (chat action)' },
        messages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', enum: ['user', 'assistant', 'system'] },
              content: { type: 'string' },
            },
            required: ['role', 'content'],
          },
          description: 'Direct messages array (chat action)',
        },
        allowLocalFallback: { type: 'boolean', description: 'Enable Local/Ollama fallback (chat action)' },
        agentic: { type: 'boolean', description: 'Enable agentic tool-use loop (chat action)' },
        maxIterations: { type: 'number', description: 'Max agentic loop iterations (chat action)' },
        enableMcpBridge: { type: 'boolean', description: 'Enable MCP bridge for agentic mode (chat action)' },
        prompt: { type: 'string', description: 'Text prompt (generate action)' },
        limit: { type: 'number', description: 'Max messages to return (getHistory action)' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const { action } = z.object({ action: z.enum(['chat', 'generate', 'listModels', 'getHistory', 'clearHistory']) }).parse(args);
      switch (action) {
        case 'chat': return _findAiLegacyHandler('ai_chat')(args);
        case 'generate': return _findAiLegacyHandler('ai_generate')(args);
        case 'listModels': return _findAiLegacyHandler('ai_listModels')(args);
        case 'getHistory': return _findAiLegacyHandler('ai_history')({ ...(args as object), action: 'get' });
        case 'clearHistory': return _findAiLegacyHandler('ai_history')({ ...(args as object), action: 'clear' });
      }
    },
  },
];

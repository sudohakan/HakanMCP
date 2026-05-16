import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { jsonResultTruncated } from './_httpShared.js';

const execFileAsync = promisify(execFile);

const HERMES_BIN = process.env.HERMES_BIN ?? '/home/hakan/.local/bin/hermes';
const DEFAULT_TIMEOUT_MS = 180_000;

const schema = z.object({
  task: z.string().min(1).max(4000),
  timeout_ms: z.number().int().min(5000).max(600_000).default(DEFAULT_TIMEOUT_MS),
  yolo: z.boolean().default(true),
  model_override: z.string().optional(),
});

export const hermesDelegateTools = [
  {
    name: 'hermesDelegate',
    description: 'Delegate a task to Hermes Agent (local qwen2.5:14b via Windows host Ollama). Hermes can spawn sub-agents (depth-2), use 79 skills, and run shell commands. Use for: long-running autonomous tasks, multi-step shell workflows, tasks that benefit from Hermes skill library (research, social, mlops, etc.). Runs hermes in --yolo mode (no confirmation prompts). Returns the final agent response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        task: { type: 'string', description: 'Task description to send to Hermes agent (natural language)' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 180000 = 3 min, max 600000 = 10 min)' },
        yolo: { type: 'boolean', description: 'Skip dangerous command confirmations (default: true)' },
        model_override: { type: 'string', description: 'Override Hermes model for this call only (optional, uses config default if not set)' },
      },
      required: ['task'],
    },
    handler: async (args: unknown) => {
      const parsed = schema.parse(args);

      const hermesArgs = ['chat', '-q', parsed.task];
      if (parsed.yolo) hermesArgs.splice(1, 0, '--yolo');

      const env: NodeJS.ProcessEnv = { ...process.env };
      if (parsed.model_override) {
        env.HERMES_MODEL_OVERRIDE = parsed.model_override;
      }

      const startMs = Date.now();
      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      try {
        const result = await execFileAsync(HERMES_BIN, hermesArgs, {
          timeout: parsed.timeout_ms,
          env,
          maxBuffer: 10 * 1024 * 1024,
        });
        stdout = result.stdout;
        stderr = result.stderr;
      } catch (err: unknown) {
        const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; signal?: string };
        stdout = e.stdout ?? '';
        stderr = e.stderr ?? '';
        exitCode = e.code ?? 1;

        if (e.killed || e.signal === 'SIGTERM') {
          return jsonResultTruncated({
            ok: false,
            error: `Hermes task timed out after ${parsed.timeout_ms}ms`,
            partial_output: extractHermesResponse(stdout),
            duration_ms: Date.now() - startMs,
          });
        }
      }

      const response = extractHermesResponse(stdout);
      const duration = Date.now() - startMs;

      return jsonResultTruncated({
        ok: exitCode === 0,
        response,
        raw_stdout: stdout.length > 5000 ? stdout.slice(-5000) : stdout,
        stderr: stderr.slice(0, 1000) || null,
        duration_ms: duration,
        exit_code: exitCode,
      });
    },
  },
  {
    name: 'hermesStatus',
    description: 'Check if Hermes agent binary is available and return version info.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: async (_args: unknown) => {
      try {
        const { stdout } = await execFileAsync(HERMES_BIN, ['--version'], { timeout: 5000 });
        return jsonResultTruncated({ ok: true, version: stdout.trim(), bin: HERMES_BIN });
      } catch (err) {
        const e = err as { message?: string; code?: string };
        return jsonResultTruncated({
          ok: false,
          error: e.message ?? String(err),
          bin: HERMES_BIN,
          hint: e.code === 'ENOENT' ? `Hermes binary not found at ${HERMES_BIN}. Set HERMES_BIN env var to override.` : null,
        });
      }
    },
  },
];

// Extract the final Hermes response box from stdout (strips TUI decorations)
function extractHermesResponse(stdout: string): string {
  // Hermes wraps final response in ╭─ ⚕ Hermes ─╮ ... ╰──╯ box
  const boxMatch = stdout.match(/╭─ ⚕ Hermes[─\s]*╮([\s\S]*?)╰[─]+╯/);
  if (boxMatch) {
    return boxMatch[1].trim().replace(/^\s+│\s?/gm, '').trim();
  }
  // Fallback: last non-empty lines after "────" separator
  const lines = stdout.split('\n');
  const sepIdx = lines.map((l, i) => ({ l, i })).filter(({ l }) => /^─{10,}/.test(l)).pop()?.i ?? -1;
  if (sepIdx >= 0) {
    return lines.slice(sepIdx + 1).filter(l => l.trim()).join('\n').trim();
  }
  return stdout.trim().slice(-2000);
}

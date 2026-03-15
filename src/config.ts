/**
 * Configuration management for MCP server
 * Supports YAML file and environment variable overrides
 */

import fs from 'node:fs';
import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { PROJECT_ROOT } from './utils/projectRoot.js';

// Load .env before any env access; .env overrides Windows/system env when key exists
// Plan §2: .env missing → create from .env.example
const envPath = path.join(PROJECT_ROOT, '.env');
const envExamplePath = path.join(PROJECT_ROOT, '.env.example');
if (!fs.existsSync(envPath) && fs.existsSync(envExamplePath)) {
  fs.copyFileSync(envExamplePath, envPath);
}
if (fs.existsSync(envPath)) {
  dotenvConfig({ path: envPath, override: true, quiet: true });
}
import yaml from 'js-yaml';
import { z } from 'zod';
import { logger, LogLevel } from './utils/logger.js';
import { deepMerge, atomicWriteFileSync } from './utils/common.js';

// Auto-create config.yaml from config.yaml.example if missing
const configYamlPath = path.join(PROJECT_ROOT, 'config.yaml');
const configExamplePath = path.join(PROJECT_ROOT, 'config.yaml.example');
if (!fs.existsSync(configYamlPath) && fs.existsSync(configExamplePath)) {
  fs.copyFileSync(configExamplePath, configYamlPath);
}

const envSchema = z
  .object({
    GITHUB_TOKEN: z
      .string()
      .min(1, 'GITHUB_TOKEN is required when GitHub tools are enabled')
      .optional(),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'none']).optional(),
    HAKANMCP_LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'none']).optional(),
    CACHE_TTL: z.string().optional(),
    HAKANMCP_CACHE_TTL: z.string().optional(),
    GITBOOK_URL: z.string().optional(),
    LOG_DIR: z.string().optional(),
    CODEX_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    CLAUDE_CODE_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
  })
  .passthrough();

const configSchema = z.object({
  serverName: z.string().min(1, 'serverName cannot be empty'),
  gitbookUrl: z.string().url('gitbookUrl must be a valid URL'),
  postmanDir: z.string().min(1, 'postmanDir cannot be empty'),
  cacheTtl: z
    .number()
    .int()
    .min(0, 'cacheTtl must be a positive integer')
    .max(86400, 'cacheTtl should not exceed 86400 seconds'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'none']),
  ollamaUrl: z.string().url('ollamaUrl must be a valid URL'),
  ollamaModel: z.string().min(1, 'ollamaModel cannot be empty'),
  ollamaTimeout: z.number().int().positive('ollamaTimeout must be positive'),
  ollamaUpgradeTolerance: z.number().min(0).max(1).default(0.15),
  retryCount: z.number().int().min(0, 'retryCount must be non-negative'),
  mongoDbUrl: z.string().url('mongoDbUrl must be a valid URL').optional(),
  availableModels: z.array(z.string()),
  github: z
    .object({
      enabled: z.boolean(),
      owner: z.string(),
      repo: z.string(),
      branch: z.string(),
      token: z.string().optional(),
      private: z.boolean(),
    })
    .optional(),
  monitoring: z
    .object({
      enabled: z.boolean(),
      peerInstance: z.string().optional(),
      checkInterval: z.number().int().min(0),
      healthCheckEndpoints: z
        .array(
          z.object({
            type: z.string(),
            path: z.string().optional(),
            description: z.string(),
          }),
        )
        .optional(),
    })
    .optional(),
  selfImprovement: z
    .object({
      enabled: z.boolean(),
      autoCommit: z.boolean().default(false),
      requireApproval: z.boolean().default(true),
      maxChangesPerDay: z.number().int().min(1).max(100).default(10),
      allowedOperations: z.array(z.string()),
      restrictedPaths: z.array(z.string()),
    })
    .optional(),
  backup: z
    .object({
      enabled: z.boolean(),
      localPath: z.string(),
      maxBackups: z.number().int().min(1).max(10000).optional(),
      retentionHours: z.number().int().min(1).optional(),
      compressionEnabled: z.boolean(),
      includeNodeModules: z.boolean(),
      intervalHours: z.number().int().min(1).optional(),
      /** Glob patterns to exclude from backups (plan §11 F). Merged with defaults: .env, *.key, *.pem, logs/* */
      excludes: z.array(z.string()).optional(),
    })
    .optional(),
  aiProviders: z
    .object({
      codexKeyEncrypted: z.string().optional(),
      claudeKeyEncrypted: z.string().optional(),
      geminiKeyEncrypted: z.string().optional(),
      encryptionPasswordEnv: z.string().optional(),
      localModels: z.boolean().optional(),
      /** Enable agentic tool-use loop for ai_chat by default. When true, ai_chat uses Claude API with tool calling. */
      agenticEnabled: z.boolean().optional(),
      /** Default max iterations for agentic loop (default: 10). */
      agenticMaxIterations: z.number().int().min(1).max(50).optional(),
    })
    .optional(),
  scheduler: z
    .object({
      enabled: z.boolean(),
      maxConcurrentTasks: z.number().int().min(1),
      taskHistoryRetentionDays: z.number().int().min(1),
      persistencePath: z.string(),
    })
    .optional(),
  system: z
    .object({
      /** Path allowlist for fs_* and sys_runCommand. When set, paths must resolve under one of these. Empty = allow all. */
      allowedPaths: z.array(z.string()).optional(),
      /** Default handler timeout in seconds (plan §11 G). */
      commandTimeout: z.number().int().min(5).max(3600).optional(),
    })
    .optional(),
  consciousness: z.object({
    enabled: z.boolean(),
    maxJournalEntries: z.number().int().min(10).max(10000),
    reflection: z.object({
      maxLength: z.number().int().min(50).max(1000).default(200),
      maxEntriesInPrompt: z.number().int().min(1).max(10).default(3),
      style: z.enum(['auto', 'emotional', 'mixed', 'minimal']).default('auto'),
    }).optional(),
  }).optional(),
  watch: z.object({
    enabled: z.boolean(),
    paths: z.array(z.string()).optional(),
    debounceMs: z.number().int().positive().optional(),
  }).optional(),
  reactive: z.object({
    enabled: z.boolean(),
  }).optional(),
});

export type Config = z.infer<typeof configSchema>;
export type GitHubConfig = Config['github'];
export type MonitoringConfig = Config['monitoring'];
export type SelfImprovementConfig = Config['selfImprovement'];
export type BackupConfig = Config['backup'];
export type AIProviderSecretConfig = Config['aiProviders'];
export type SchedulerConfig = Config['scheduler'];
export type ConsciousnessConfig = Config['consciousness'];

const DEFAULT_CONFIG: Config = {
  serverName: 'hakan-mcp',
  gitbookUrl: process.env.GITBOOK_URL || 'https://example.com/api-docs',
  postmanDir: 'postman',
  cacheTtl: 300,
  logLevel: 'info',
  // Provide a reachable default to keep validation happy in dev; override in config.yaml for real deployments.
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  ollamaTimeout: 36000000, // 10 hours default
  ollamaUpgradeTolerance: 0.15, // ±15% param size tolerance for model upgrades
  retryCount: 3,
  availableModels: [],
  aiProviders: {
    encryptionPasswordEnv: 'AI_KEY_PASSWORD',
    localModels: false,
    agenticEnabled: true,
    agenticMaxIterations: 15,
  },
  backup: {
    enabled: false,
    localPath: './backups',
    retentionHours: 48,
    compressionEnabled: true,
    includeNodeModules: false,
    intervalHours: 1,
  },
};

/**
 * Resolves config file path relative to project root
 */
function getConfigPath(): string {
  // Try multiple locations
  const locations = [
    path.join(PROJECT_ROOT, 'config.yaml'),
    path.join(PROJECT_ROOT, '..', 'config.yaml'),
  ];

  for (const location of locations) {
    if (fs.existsSync(location)) {
      return location;
    }
  }

  return locations[0]; // Default to cwd
}

function formatZodIssues(issues: z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${path}: ${issue.message}`;
  });
}

function checkSecretFilePermissions(targetPath: string): void {
  try {
    if (!fs.existsSync(targetPath)) return;
    // Windows ACLs and Docker bind mounts can report permissive mode bits.
    // Skip mode-based checks in these environments to avoid false positives.
    if (process.platform === 'win32' || process.env.DOCKER_CONTAINER === 'true') return;

    const stat = fs.statSync(targetPath);
    const mode = stat.mode & 0o777;
    const worldPermissions = mode & 0o077;
    if (worldPermissions !== 0) {
      logger.warn('Secret file has permissive permissions', {
        file: targetPath,
        mode: mode.toString(8),
      });
    }
  } catch (error) {
    logger.warn('Could not inspect secret file permissions', {
      file: targetPath,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}

/**
 * Loads configuration from YAML file
 */
function loadConfigFile(configPath: string): Partial<Config> {
  if (!fs.existsSync(configPath)) {
    logger.info(`No config.yaml found at ${configPath}, using defaults`);
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(content);

    if (!parsed || typeof parsed !== 'object') {
      logger.warn('Config file is empty or invalid, using defaults');
      return {};
    }

    logger.info(`Loaded config from ${configPath}`);
    return parsed as Partial<Config>;
  } catch (error) {
    logger.error('Failed to load config.yaml', error);
    return {};
  }
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function normalizeSchedulerConfig(fileConfig: Partial<Config>): SchedulerConfig | undefined {
  if (!fileConfig.scheduler) {
    return undefined;
  }

  return {
    enabled: fileConfig.scheduler.enabled ?? true,
    maxConcurrentTasks: fileConfig.scheduler.maxConcurrentTasks ?? 5,
    taskHistoryRetentionDays: fileConfig.scheduler.taskHistoryRetentionDays ?? 30,
    persistencePath: fileConfig.scheduler.persistencePath || './scheduler-state.json',
  };
}

function applyRuntimeEnvOverrides(
  baseConfig: Config,
  envValues: Record<string, string | undefined>,
): Config {
  const cfg: Config = {
    ...baseConfig,
    monitoring: baseConfig.monitoring ? { ...baseConfig.monitoring } : baseConfig.monitoring,
    scheduler: baseConfig.scheduler ? { ...baseConfig.scheduler } : baseConfig.scheduler,
    selfImprovement: baseConfig.selfImprovement
      ? { ...baseConfig.selfImprovement }
      : baseConfig.selfImprovement,
  };

  const peerOverride = envValues.MONITORING_PEER_INSTANCE?.trim();
  if (peerOverride && cfg.monitoring) {
    cfg.monitoring.peerInstance = peerOverride;
  }

  // Resolve peerInstance relative to PROJECT_ROOT so it stays fixed regardless of cwd
  if (cfg.monitoring?.peerInstance && !path.isAbsolute(cfg.monitoring.peerInstance)) {
    cfg.monitoring.peerInstance = path.resolve(PROJECT_ROOT, cfg.monitoring.peerInstance);
  }

  const schedulerEnabledOverride = parseBooleanEnv(envValues.SCHEDULER_ENABLED);
  if (schedulerEnabledOverride !== undefined && cfg.scheduler) {
    cfg.scheduler.enabled = schedulerEnabledOverride;
  }

  const selfImprovementEnabledOverride = parseBooleanEnv(envValues.SELF_IMPROVEMENT_ENABLED);
  if (selfImprovementEnabledOverride !== undefined && cfg.selfImprovement) {
    cfg.selfImprovement.enabled = selfImprovementEnabledOverride;
  }

  // Plan §2: Env overrides for config.yaml (LOG_LEVEL, CACHE_TTL, GITBOOK_URL)
  const logLevelEnv = envValues.HAKANMCP_LOG_LEVEL || envValues.LOG_LEVEL;
  if (
    logLevelEnv &&
    ['debug', 'info', 'warn', 'error', 'none'].includes(logLevelEnv.toLowerCase())
  ) {
    cfg.logLevel = logLevelEnv.toLowerCase() as Config['logLevel'];
  }
  const cacheTtlEnv = Number.parseInt(
    envValues.HAKANMCP_CACHE_TTL || envValues.CACHE_TTL || '',
    10,
  );
  if (!Number.isNaN(cacheTtlEnv) && cacheTtlEnv >= 0 && cacheTtlEnv <= 86400) {
    cfg.cacheTtl = cacheTtlEnv;
  }
  const gitbookUrlEnv = envValues.GITBOOK_URL?.trim();
  if (gitbookUrlEnv) {
    try {
      new URL(gitbookUrlEnv);
      cfg.gitbookUrl = gitbookUrlEnv;
    } catch {
      // Invalid URL, skip override
    }
  }

  return cfg;
}

function loadEnvironment(
  options: ConfigValidationOptions = { strict: true, warnOnly: false },
): Record<string, string | undefined> {
  const envResult = envSchema.safeParse(process.env);
  if (!envResult.success) {
    const messages = formatZodIssues(envResult.error.issues);
    const formatted = `Environment validation failed:\n${messages.map((m) => `  - ${m}`).join('\n')}`;

    if (options.strict) {
      throw new Error(formatted);
    }

    logger.warn(formatted);
    return { ...process.env } as Record<string, string | undefined>;
  }

  const envObject: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(envResult.data)) {
    envObject[key] = typeof value === 'string' ? value : undefined;
  }

  checkSecretFilePermissions(path.join(PROJECT_ROOT, '.env'));

  return envObject;
}

function validateEnvironmentRequirements(
  cfg: Config,
  env: Record<string, string | undefined>,
  options: ConfigValidationOptions = { strict: false, warnOnly: false },
): string[] {
  const errors: string[] = [];

  if (cfg.github?.enabled) {
    const token = cfg.github.token?.trim() || env.GITHUB_TOKEN?.trim();
    if (!token) {
      errors.push(
        'GitHub tools are enabled but no token provided. Set config.github.token or GITHUB_TOKEN in the environment.',
      );
    }
  }

  const hasEncryptedKey =
    Boolean(cfg.aiProviders?.codexKeyEncrypted) ||
    Boolean(cfg.aiProviders?.claudeKeyEncrypted) ||
    Boolean(cfg.aiProviders?.geminiKeyEncrypted);
  const passwordEnv = cfg.aiProviders?.encryptionPasswordEnv || 'AI_KEY_PASSWORD';

  if (hasEncryptedKey) {
    if (!env[passwordEnv]) {
      errors.push(
        `Encrypted AI keys detected but ${passwordEnv} is missing. Define ${passwordEnv} in your environment to decrypt secrets.`,
      );
    }
  }

  if (errors.length > 0) {
    if (options.strict) {
      const errorMessage = `Environment validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
      throw new Error(errorMessage);
    } else if (!options.warnOnly) {
      logger.warn('Environment validation warnings', { errors });
    } else {
      logger.warn('Environment validation warnings', { errors });
    }
  }

  return errors;
}

/**
 * Loads configuration from YAML file ONLY
 * process.env is NOT used for application configuration (except secrets)
 */
function loadConfig(envValues: Record<string, string | undefined>): Config {
  const configPath = getConfigPath();
  const fileConfig = loadConfigFile(configPath);

  const normalizedConfig = {
    ...fileConfig,
    scheduler: normalizeSchedulerConfig(fileConfig),
  };

  const merged = deepMerge(
    { ...DEFAULT_CONFIG },
    normalizedConfig as Record<string, unknown>,
  ) as Config;
  const mergedWithOverrides = applyRuntimeEnvOverrides(merged, envValues);

  const parseResult = configSchema.safeParse(mergedWithOverrides);
  if (!parseResult.success) {
    const messages = formatZodIssues(parseResult.error.issues);
    throw new Error(
      `config.yaml validation failed:\n${messages.map((m) => `  - ${m}`).join('\n')}`,
    );
  }

  const validatedConfig = parseResult.data;
  const strictEnvValidation = process.env.NODE_ENV === 'production';
  validateEnvironmentRequirements(validatedConfig, envValues, {
    strict: strictEnvValidation,
    warnOnly: !strictEnvValidation,
  });

  return validatedConfig;
}

// Initialize config with fail-fast validation
const envValues = loadEnvironment();
export const config = loadConfig(envValues);

/**
 * Updates configuration and persists to file
 * Uses deep merge to preserve nested values
 */
export function updateConfig(updates: Partial<Config>): void {
  const configPath = getConfigPath();

  try {
    const current = fs.existsSync(configPath) ? loadConfigFile(configPath) : { ...DEFAULT_CONFIG };

    const baseConfig = deepMerge(
      { ...DEFAULT_CONFIG } as Record<string, unknown>,
      current as Record<string, unknown>,
    );

    const newConfig = deepMerge(
      baseConfig as Record<string, unknown>,
      updates as Record<string, unknown>,
    ) as Config;

    const validation = configSchema.safeParse(newConfig);
    if (!validation.success) {
      const messages = formatZodIssues(validation.error.issues);
      throw new Error(`Updated config is invalid:\n${messages.map((m) => `  - ${m}`).join('\n')}`);
    }

    const normalized = {
      ...validation.data,
      scheduler: normalizeSchedulerConfig(validation.data) || validation.data.scheduler,
    };

    const strictEnvValidation = process.env.NODE_ENV === 'production';
    const env = loadEnvironment({ strict: strictEnvValidation, warnOnly: !strictEnvValidation });
    const runtimeConfig = applyRuntimeEnvOverrides(normalized, env);
    validateEnvironmentRequirements(runtimeConfig, env, {
      strict: strictEnvValidation,
      warnOnly: !strictEnvValidation,
    });

    atomicWriteFileSync(configPath, yaml.dump(normalized), { createBackup: true });
    logger.info('Config updated', { keys: Object.keys(updates) });

    Object.assign(config, runtimeConfig);
  } catch (error) {
    logger.error('Failed to update config.yaml', error);
    throw new Error(
      `Configuration update failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

export interface ConfigValidationOptions {
  strict?: boolean; // Throw on validation error
  warnOnly?: boolean; // Only log warnings
  /** When provided, validates env requirements (GITHUB_TOKEN, AI_KEY_PASSWORD) */
  env?: Record<string, string | undefined>;
}

export interface ConfigValidationResult {
  errors: string[];
  critical: string[];
  suggestions: string[];
}

/** Plan §2: Dangerous value checks with auto-fix suggestions */
function validateDangerousValues(cfg: Config): ConfigValidationResult {
  const critical: string[] = [];
  const suggestions: string[] = [];

  if (cfg.monitoring?.enabled && cfg.monitoring.checkInterval < 10) {
    suggestions.push(
      `monitoring.checkInterval=${cfg.monitoring.checkInterval} is too low; suggest 10 or higher to avoid excessive health checks.`,
    );
  }
  if (cfg.monitoring?.checkInterval !== undefined && cfg.monitoring.checkInterval > 3600) {
    suggestions.push(
      `monitoring.checkInterval=${cfg.monitoring.checkInterval} is high; consider 300–600 for typical use.`,
    );
  }
  if (cfg.cacheTtl < 0) {
    critical.push('cacheTtl cannot be negative.');
    suggestions.push('Set cacheTtl to 0 or a positive value.');
  }
  if (cfg.cacheTtl > 86400) {
    suggestions.push('cacheTtl exceeds 24h; consider 300–3600 for typical use.');
  }

  return { errors: [], critical, suggestions };
}

/**
 * Validates configuration values (Plan §2: extended with critical keys, dangerous values, auto-fix)
 */
export function validateConfig(
  cfg: Config,
  options: ConfigValidationOptions = { strict: false, warnOnly: false },
): string[] {
  const validation = configSchema.safeParse(cfg);
  const schemaErrors = validation.success ? [] : formatZodIssues(validation.error.issues);

  const dangerous = validateDangerousValues(cfg);
  const envErrors =
    options.env !== undefined
      ? validateEnvironmentRequirements(cfg, options.env, { strict: false, warnOnly: true })
      : [];

  const critical = dangerous.critical;
  const allErrors = [
    ...schemaErrors,
    ...critical.map((e) => `CRITICAL: ${e}`),
    ...envErrors.map((e) => `CRITICAL: ${e}`),
  ];
  const allSuggestions = dangerous.suggestions;

  if (allSuggestions.length > 0) {
    logger.warn('Config suggestions', { suggestions: allSuggestions });
  }

  if (allErrors.length > 0) {
    if (options.strict) {
      const errorMessage = `Configuration validation failed:\n${allErrors.map((e) => `  - ${e}`).join('\n')}`;
      logger.error(errorMessage);
      throw new Error(errorMessage);
    } else if (options.warnOnly) {
      logger.warn('Configuration validation warnings', { errors: allErrors });
    } else {
      logger.warn('Configuration validation warnings', { errors: allErrors });
    }
  }

  return allErrors;
}

/**
 * Validates and returns safe configuration
 * If validation fails in strict mode, returns DEFAULT_CONFIG
 */
export function getSafeConfig(cfg: Config): Config {
  try {
    validateConfig(cfg, { strict: true });
    return cfg;
  } catch (error) {
    logger.error('Configuration validation failed, using defaults', error);
    return { ...DEFAULT_CONFIG };
  }
}

export function validateEnvironmentConfig(
  cfg: Config,
  options: ConfigValidationOptions = { strict: false, warnOnly: false },
): string[] {
  const env = loadEnvironment(options);
  return validateEnvironmentRequirements(cfg, env, options);
}

// Validate config on load with environment requirements
try {
  validateConfig(config, {
    strict: true,
  });

  validateEnvironmentRequirements(config, envValues, {
    strict: process.env.NODE_ENV === 'production',
    warnOnly: process.env.NODE_ENV !== 'production',
  });
} catch (error) {
  logger.error('Config validation error', error);
  throw error;
}

logger.info('Configuration loaded', {
  serverName: config.serverName,
  gitbookUrl: config.gitbookUrl,
  ollamaUrl: config.ollamaUrl,
  cacheTtl: config.cacheTtl,
});

// Apply log level from config if no environment override
if (!process.env.LOG_LEVEL && config.logLevel) {
  const desiredLevel = config.logLevel.toUpperCase();
  if (desiredLevel in LogLevel) {
    logger.setLevel(LogLevel[desiredLevel as keyof typeof LogLevel]);
    logger.info('Log level set from config', { logLevel: desiredLevel });
  } else {
    logger.warn('Invalid log level in config, using default', { logLevel: config.logLevel });
  }
}

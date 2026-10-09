import fs from 'node:fs';
import path from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { PROJECT_ROOT } from './utils/projectRoot.js';

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
    GITBOOK_TOKEN: z.string().optional(),
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
  gitbookToken: z.string().optional(),
  cacheTtl: z
    .number()
    .int()
    .min(0, 'cacheTtl must be a positive integer')
    .max(86400, 'cacheTtl should not exceed 86400 seconds'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error', 'none']),
  retryCount: z.number().int().min(0, 'retryCount must be non-negative'),
  mongoDbUrl: z.string().url('mongoDbUrl must be a valid URL').optional(),
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
  backup: z
    .object({
      enabled: z.boolean(),
      localPath: z.string(),
      maxBackups: z.number().int().min(1).max(10000).optional(),
      retentionHours: z.number().int().min(1).optional(),
      compressionEnabled: z.boolean(),
      includeNodeModules: z.boolean(),
      intervalHours: z.number().int().min(1).optional(),
      excludes: z.array(z.string()).optional(),
    })
    .optional(),
  system: z
    .object({
      allowedPaths: z.array(z.string()).optional(),
      commandTimeout: z.number().int().min(5).max(3600).optional(),
    })
    .optional(),
});

export type Config = z.infer<typeof configSchema>;
export type GitHubConfig = Config['github'];
export type MonitoringConfig = Config['monitoring'];
export type BackupConfig = Config['backup'];

const DEFAULT_CONFIG: Config = {
  serverName: 'hakan-mcp',
  gitbookToken: process.env.GITBOOK_TOKEN || undefined,
  cacheTtl: 300,
  logLevel: 'info',
  retryCount: 3,
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
  const locations = [
    path.join(PROJECT_ROOT, 'config.yaml'),
    path.join(PROJECT_ROOT, '..', 'config.yaml'),
  ];

  for (const location of locations) {
    if (fs.existsSync(location)) {
      return location;
    }
  }

  return locations[0];
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

function applyRuntimeEnvOverrides(
  baseConfig: Config,
  envValues: Record<string, string | undefined>,
): Config {
  const cfg: Config = {
    ...baseConfig,
    monitoring: baseConfig.monitoring ? { ...baseConfig.monitoring } : baseConfig.monitoring,
  };

  const peerOverride = envValues.MONITORING_PEER_INSTANCE?.trim();
  if (peerOverride && cfg.monitoring) {
    cfg.monitoring.peerInstance = peerOverride;
  }

  if (cfg.monitoring?.peerInstance && !path.isAbsolute(cfg.monitoring.peerInstance)) {
    cfg.monitoring.peerInstance = path.resolve(PROJECT_ROOT, cfg.monitoring.peerInstance);
  }

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
  const gitbookTokenEnv = envValues.GITBOOK_TOKEN?.trim();
  if (gitbookTokenEnv) {
    cfg.gitbookToken = gitbookTokenEnv;
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

  const merged = deepMerge(
    { ...DEFAULT_CONFIG },
    fileConfig as Record<string, unknown>,
  ) as Config;
  const mergedWithOverrides = applyRuntimeEnvOverrides(merged, envValues);

  const parseResult = configSchema.safeParse(mergedWithOverrides);
  if (!parseResult.success) {
    const messages = formatZodIssues(parseResult.error.issues);
    const formatted = `config.yaml validation failed:\n${messages.map((m) => `  - ${m}`).join('\n')}`;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(formatted);
    }
    logger.warn(formatted);
    return DEFAULT_CONFIG as Config;
  }

  const validatedConfig = parseResult.data;
  const strictEnvValidation = process.env.NODE_ENV === 'production';
  validateEnvironmentRequirements(validatedConfig, envValues, {
    strict: strictEnvValidation,
    warnOnly: !strictEnvValidation,
  });

  return validatedConfig;
}

const strictEnv = process.env.NODE_ENV === 'production';
const envValues = loadEnvironment({ strict: strictEnv, warnOnly: !strictEnv });
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

    const normalized = validation.data;

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
  strict?: boolean;
  warnOnly?: boolean;
  /** When provided, validates env requirements (GITHUB_TOKEN, AI_KEY_PASSWORD) */
  env?: Record<string, string | undefined>;
}

export interface ConfigValidationResult {
  errors: string[];
  critical: string[];
  suggestions: string[];
}

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
 * Validates configuration values.
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
  gitbookToken: config.gitbookToken ? '***' : 'not set',
  cacheTtl: config.cacheTtl,
});

if (!process.env.LOG_LEVEL && config.logLevel) {
  const desiredLevel = config.logLevel.toUpperCase();
  if (desiredLevel in LogLevel) {
    logger.setLevel(LogLevel[desiredLevel as keyof typeof LogLevel]);
    logger.info('Log level set from config', { logLevel: desiredLevel });
  } else {
    logger.warn('Invalid log level in config, using default', { logLevel: config.logLevel });
  }
}

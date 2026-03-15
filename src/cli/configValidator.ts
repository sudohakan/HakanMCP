/**
 * Workspace config validation for hakanmcp.config.yaml
 * Uses Zod schema to validate user workspace configuration.
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { z } from 'zod';

// --- Workspace Entry Schema ---

export const WorkspaceEntrySchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
  primary: z.string().min(1),
  secondary: z.string().optional(),
});

export type WorkspaceEntry = z.infer<typeof WorkspaceEntrySchema>;

// --- Workspace Config Schema ---

export const WorkspaceConfigSchema = z.object({
  version: z.string().default('1'),
  mission: z.object({
    primary: z.string(),
    secondary: z.string().optional(),
  }),
  agent: z
    .object({
      provider: z.enum(['claude', 'openai', 'gemini', 'ollama']).default('claude'),
      maxIterationsPerStep: z.number().int().min(1).max(100).default(10),
      stepTimeoutMs: z.number().int().min(1000).default(120_000),
      continueOnFailure: z.boolean().default(false),
    })
    .default({
      provider: 'claude' as const,
      maxIterationsPerStep: 10,
      stepTimeoutMs: 120_000,
      continueOnFailure: false,
    }),
  watch: z
    .object({
      enabled: z.boolean().default(false),
      paths: z.array(z.string()).default([]),
      debounceMs: z.number().int().min(100).default(1000),
    })
    .optional(),
  schedule: z
    .object({
      enabled: z.boolean().default(false),
      cron: z.string().optional(),
      interval: z.string().optional(),
    })
    .optional(),
  assistant: z
    .object({
      enabled: z.boolean().default(true),
      includeTargets: z.boolean().default(true),
      maxTargetSize: z.number().default(8192),
    })
    .optional(),
  reactive: z
    .object({
      enabled: z.boolean().default(false),
      modes: z.array(z.enum(['watch', 'scheduled', 'assistant'])).default(['watch', 'scheduled']),
    })
    .optional(),
  workspaces: z.array(WorkspaceEntrySchema).optional(),
});

export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

const CONFIG_FILENAME = 'hakanmcp.config.yaml';

/**
 * Loads and validates workspace config from the given directory.
 * Throws descriptive error if file is missing or validation fails.
 */
export function loadWorkspaceConfig(dir: string): WorkspaceConfig {
  const configPath = path.join(dir, CONFIG_FILENAME);

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Workspace config not found: ${configPath}\nRun "hakanmcp init" to create one.`,
    );
  }

  const content = fs.readFileSync(configPath, 'utf8');
  let parsed: unknown;

  try {
    parsed = yaml.load(content);
  } catch (err) {
    throw new Error(
      `Invalid YAML in ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Config file is empty or not an object: ${configPath}`);
  }

  try {
    const config = WorkspaceConfigSchema.parse(parsed);

    // Validate workspace name uniqueness
    if (config.workspaces && config.workspaces.length > 0) {
      const names = config.workspaces.map((w) => w.name);
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      if (dupes.length > 0) {
        throw new Error(`Duplicate workspace names: ${[...new Set(dupes)].join(', ')}`);
      }
    }

    return config;
  } catch (err) {
    if (err instanceof z.ZodError) {
      const messages = err.issues.map((issue) => {
        const fieldPath = issue.path.length > 0 ? issue.path.join('.') : 'root';
        return `  - ${fieldPath}: ${issue.message}`;
      });
      throw new Error(
        `Config validation failed (${configPath}):\n${messages.join('\n')}`,
      );
    }
    throw err;
  }
}

/**
 * Validates workspace config without throwing.
 * Returns structured result with valid flag and error messages.
 */
export function validateWorkspaceConfig(
  dir: string,
): { valid: boolean; errors?: string[] } {
  const configPath = path.join(dir, CONFIG_FILENAME);

  if (!fs.existsSync(configPath)) {
    return { valid: false, errors: [`Config file not found: ${configPath}`] };
  }

  let content: string;
  try {
    content = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    return {
      valid: false,
      errors: [`Cannot read config: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(content);
  } catch (err) {
    return {
      valid: false,
      errors: [`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  const result = WorkspaceConfigSchema.safeParse(parsed);

  if (result.success) {
    // Validate workspace name uniqueness
    if (result.data.workspaces && result.data.workspaces.length > 0) {
      const names = result.data.workspaces.map((w) => w.name);
      const dupes = names.filter((n, i) => names.indexOf(n) !== i);
      if (dupes.length > 0) {
        return { valid: false, errors: [`Duplicate workspace names: ${[...new Set(dupes)].join(', ')}`] };
      }
    }
    return { valid: true };
  }

  const errors = result.error.issues.map((issue) => {
    const fieldPath = issue.path.length > 0 ? issue.path.join('.') : 'root';
    return `${fieldPath}: ${issue.message}`;
  });

  return { valid: false, errors };
}

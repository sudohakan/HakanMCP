/**
 * MissionStateManager — CRUD for .hakanmcp/ state files.
 * Handles state.json, history.json, and learned.json with atomic writes
 * and Zod schema validation for crash-safe persistence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { atomicWriteFileSync } from '../utils/common.js';
import {
  MissionStateSchema,
  HistoryEntrySchema,
  LearnedPatternSchema,
} from './schemas/stateSchemas.js';
import type { MissionState, HistoryEntry, LearnedPattern } from './types.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'missionState' });

const MAX_HISTORY = 1000;

export class MissionStateManager {
  private stateDir: string;

  constructor(workspaceDir: string, workspaceName?: string) {
    this.stateDir = workspaceName
      ? path.join(workspaceDir, '.hakanmcp', 'workspaces', workspaceName)
      : path.join(workspaceDir, '.hakanmcp');
  }

  /** Ensure .hakanmcp/ directory exists. */
  async ensureDir(): Promise<void> {
    await fs.promises.mkdir(this.stateDir, { recursive: true });
  }

  /**
   * Read and validate a JSON file from stateDir.
   * Returns null on ENOENT or validation failure.
   */
  private readJsonSync<T>(filename: string, schema: z.ZodType<T>): T | null {
    const filePath = path.join(this.stateDir, filename);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      const result = schema.safeParse(data);
      if (result.success) {
        return result.data;
      }
      log.warn('Schema validation failed for state file', {
        filename,
        errors: result.error.issues,
      });
      return null;
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      log.warn('Failed to read state file', { filename, error: err });
      return null;
    }
  }

  /** Write JSON atomically with backup. */
  private writeJsonSync(filename: string, data: unknown): void {
    const filePath = path.join(this.stateDir, filename);
    atomicWriteFileSync(filePath, JSON.stringify(data, null, 2), {
      createBackup: true,
    });
  }

  /** Get current mission state, or null if none exists. */
  getState(): MissionState | null {
    return this.readJsonSync('state.json', MissionStateSchema);
  }

  /** Save mission state with updated timestamp. Validates before write. */
  saveState(state: MissionState): void {
    state.updatedAt = Date.now();
    const validated = MissionStateSchema.parse(state);
    this.writeJsonSync('state.json', validated);
  }

  /** Append a history entry, keeping at most MAX_HISTORY entries (drop oldest). */
  appendHistory(entry: HistoryEntry): void {
    const schema = z.array(HistoryEntrySchema);
    const existing = this.readJsonSync('history.json', schema) ?? [];
    existing.push(entry);
    const bounded =
      existing.length > MAX_HISTORY
        ? existing.slice(existing.length - MAX_HISTORY)
        : existing;
    this.writeJsonSync('history.json', bounded);
  }

  /** Get all history entries, or empty array if none. */
  getHistory(): HistoryEntry[] {
    const schema = z.array(HistoryEntrySchema);
    return this.readJsonSync('history.json', schema) ?? [];
  }

  /**
   * Add or update a learned pattern.
   * If a pattern with the same `pattern` string exists, increment usageCount
   * and update lastUsed. Otherwise append as new entry.
   */
  addLearnedPattern(pattern: LearnedPattern): void {
    const schema = z.array(LearnedPatternSchema);
    const existing = this.readJsonSync('learned.json', schema) ?? [];

    const idx = existing.findIndex((p) => p.pattern === pattern.pattern);
    if (idx >= 0) {
      existing[idx].usageCount += 1;
      existing[idx].lastUsed = Date.now();
    } else {
      existing.push(pattern);
    }

    this.writeJsonSync('learned.json', existing);
  }

  /** Get all learned patterns, or empty array if none. */
  getLearnedPatterns(): LearnedPattern[] {
    const schema = z.array(LearnedPatternSchema);
    return this.readJsonSync('learned.json', schema) ?? [];
  }
}

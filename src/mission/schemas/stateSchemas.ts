/**
 * Zod schemas for mission system state files.
 * All new fields use .default() or .optional() for schema evolution safety.
 */
import { z } from 'zod';

// --- Frontmatter Schemas ---

export const MissionScheduleSchema = z.object({
  mode: z.enum(['watch', 'scheduled', 'manual']).default('manual'),
  interval: z.string().optional(),
  cron: z.string().optional(),
});

export const MissionFrontmatterSchema = z.object({
  title: z.string().min(1).default('Untitled Mission'),
  priority: z.enum(['primary', 'secondary']).default('primary'),
  version: z.number().int().positive().default(1),
  targets: z.array(z.string()).default([]),
  schedule: MissionScheduleSchema.optional(),
  tags: z.array(z.string()).default([]),
});

// --- Step State Schema ---

export const MissionStepStateSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z
    .enum(['pending', 'running', 'evaluating', 'completed', 'failed', 'skipped'])
    .default('pending'),
  result: z.string().optional(),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  retryCount: z.number().default(0),
  error: z.string().optional(),
});

// --- Mission State Schema ---

export const MissionStateSchema = z.object({
  missionId: z.string(),
  filePath: z.string(),
  title: z.string().default('Untitled Mission'),
  status: z
    .enum(['idle', 'running', 'completed', 'failed', 'paused'])
    .default('idle'),
  currentStepIndex: z.number().default(0),
  steps: z.array(MissionStepStateSchema).default([]),
  startedAt: z.number().default(0),
  updatedAt: z.number().default(0),
  provider: z.string().optional(),
});

// --- History Entry Schema ---

export const HistoryEntrySchema = z.object({
  missionId: z.string(),
  title: z.string(),
  status: z.string(),
  startedAt: z.number(),
  completedAt: z.number(),
  stepsTotal: z.number().default(0),
  stepsCompleted: z.number().default(0),
  stepsFailed: z.number().default(0),
  provider: z.string().default('unknown'),
});

// --- Learned Pattern Schema ---

export const LearnedPatternSchema = z.object({
  id: z.string(),
  pattern: z.string(),
  context: z.string().default(''),
  usageCount: z.number().default(1),
  lastUsed: z.number().default(0),
  createdAt: z.number().default(0),
});

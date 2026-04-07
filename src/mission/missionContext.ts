import { loadAllMissions } from './missionLoader.js';
import { MissionStateManager } from './missionState.js';
import type { ParsedMission } from './types.js';

const MAX_PENDING_TASKS = 5;
const MAX_DESCRIPTION_LENGTH = 300;

/**
 * Format a single parsed mission into a concise chat-friendly text block.
 * Includes title, goal, targets, tags, progress, and next pending tasks.
 */
export function formatMissionForChat(mission: ParsedMission): string {
  const lines: string[] = [];

  lines.push(`Mission: ${mission.frontmatter.title}`);

  if (mission.description) {
    const desc =
      mission.description.length > MAX_DESCRIPTION_LENGTH
        ? mission.description.slice(0, MAX_DESCRIPTION_LENGTH) + '...'
        : mission.description;
    lines.push(`Goal: ${desc}`);
  }

  if (mission.frontmatter.targets && mission.frontmatter.targets.length > 0) {
    lines.push(`Targets: ${mission.frontmatter.targets.join(', ')}`);
  }

  if (mission.frontmatter.tags && mission.frontmatter.tags.length > 0) {
    lines.push(`Tags: ${mission.frontmatter.tags.join(', ')}`);
  }

  const completed = mission.tasks.filter((t) => t.completed).length;
  const total = mission.tasks.length;
  lines.push(`Progress: ${completed}/${total} tasks completed`);

  const pending = mission.tasks
    .filter((t) => !t.completed)
    .slice(0, MAX_PENDING_TASKS);
  if (pending.length > 0) {
    lines.push('Next tasks:');
    for (const task of pending) {
      lines.push(`  - ${task.description}`);
    }
  }

  return lines.join('\n');
}

/**
 * Build a complete mission context block for system prompt injection.
 * Loads all missions from workspace, formats the primary mission,
 * and optionally includes mission state if available.
 *
 * Returns empty string if no mission files are found.
 * Never throws -- all errors are caught and result in empty/partial output.
 */
export function buildMissionContextBlock(workspacePath: string): string {
  let missions: ParsedMission[];
  try {
    missions = loadAllMissions(workspacePath);
  } catch {
    return '';
  }

  if (missions.length === 0) {
    return '';
  }

  const primary = missions[0];
  const formatted = formatMissionForChat(primary);

  let stateLine = '';
  try {
    const stateManager = new MissionStateManager(workspacePath);
    const state = stateManager.getState();
    if (state) {
      stateLine = `\nStatus: ${state.status}`;
    }
  } catch { /* empty */
  }

  return formatted + stateLine;
}

/**
 * Mission file parser and loader.
 * Parses PRIMARY_MISSION.md and SECONDARY_MISSION.md into structured task lists.
 * Handles YAML frontmatter extraction, section parsing, and checklist task extraction.
 */
import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MissionFrontmatterSchema } from './schemas/stateSchemas.js';
import type { MissionTask, MissionSection, ParsedMission } from './types.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ component: 'missionLoader' });

// --- Helpers ---

/**
 * Strip UTF-8 BOM and normalize CRLF to LF.
 */
function normalizeContent(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

/**
 * Generate a deterministic task ID from description using content-hash.
 * Same text always produces the same ID, surviving file reorder and reload.
 */
function generateTaskId(description: string): string {
  return crypto
    .createHash('sha256')
    .update(description.trim().toLowerCase())
    .digest('hex')
    .slice(0, 12);
}

// --- Core Parser ---

/**
 * Parse raw mission markdown content into a structured ParsedMission object.
 * - Extracts and validates YAML frontmatter with Zod (falls back to defaults on invalid input)
 * - Extracts description (first non-heading, non-list paragraph)
 * - Extracts sections (## and ### headings)
 * - Extracts checklist tasks (- [ ] / - [x]) with content-hash IDs
 */
export function parseMissionContent(raw: string, filePath: string): ParsedMission {
  const normalized = normalizeContent(raw);
  const { data, content } = matter(normalized);

  // Validate frontmatter — use defaults on failure
  const parseResult = MissionFrontmatterSchema.safeParse(data);
  let frontmatter;
  if (parseResult.success) {
    frontmatter = parseResult.data;
  } else {
    log.warn('Mission frontmatter validation failed, using defaults', {
      filePath,
      errors: parseResult.error.issues,
    });
    frontmatter = MissionFrontmatterSchema.parse({});
  }

  // Extract description: first non-heading, non-list paragraph from content
  const descMatch = content.match(/^([^#\n][^\n]*(?:\n[^#\n\-][^\n]*)*)/);
  const description = descMatch ? descMatch[1].trim() : '';

  // Extract sections: split on ## or ### headings
  const sections: MissionSection[] = [];
  const sectionParts = content.split(/^(#{2,3}\s+.+)$/m);
  for (let i = 1; i < sectionParts.length; i += 2) {
    sections.push({
      heading: sectionParts[i].replace(/^#{2,3}\s+/, '').trim(),
      content: (sectionParts[i + 1] || '').trim(),
    });
  }

  // Extract tasks: match - [ ] text and - [x] text patterns
  const tasks: MissionTask[] = [];
  let currentSection = 'general';
  for (const line of content.split('\n')) {
    const headingMatch = line.match(/^#{2,3}\s+(.+)/);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      continue;
    }
    const taskMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)/);
    if (taskMatch) {
      tasks.push({
        id: generateTaskId(taskMatch[2]),
        description: taskMatch[2].trim(),
        completed: taskMatch[1].toLowerCase() === 'x',
        section: currentSection,
      });
    }
  }

  return { filePath, frontmatter, description, tasks, sections, raw: normalized };
}

// --- File Loader ---

/**
 * Load and parse a single mission file.
 * Returns null if file doesn't exist or parsing fails.
 */
export function loadMission(filePath: string): ParsedMission | null {
  if (!fs.existsSync(filePath)) {
    log.info('Mission file not found', { filePath });
    return null;
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return parseMissionContent(raw, filePath);
  } catch (error) {
    log.error('Failed to load mission file', { filePath, error });
    return null;
  }
}

/**
 * Load all mission files from a workspace directory.
 * Looks for PRIMARY_MISSION.md and SECONDARY_MISSION.md.
 * Returns missions sorted with primary first. Empty array if none found.
 */
export function loadAllMissions(workspacePath: string): ParsedMission[] {
  const files = ['PRIMARY_MISSION.md', 'SECONDARY_MISSION.md'];
  const missions: ParsedMission[] = [];
  for (const file of files) {
    const mission = loadMission(path.join(workspacePath, file));
    if (mission) missions.push(mission);
  }
  return missions.sort((a, b) => {
    if (a.frontmatter.priority === 'primary') return -1;
    if (b.frontmatter.priority === 'primary') return 1;
    return 0;
  });
}

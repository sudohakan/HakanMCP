import path from 'node:path';
import fs from 'node:fs';
import { exec, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  isSupported,
  isWSL,
  toWindowsPath,
  loadCatalog,
  parseCsvToJson,
  createTempFile,
} from '../services/nirsoft/index.js';
import type { NirsoftCatalog, NirsoftTool } from '../services/nirsoft/index.js';
import { createJsonResponse, createErrorResponse } from '../utils/common.js';
import { PROJECT_ROOT } from '../utils/projectRoot.js';
import type { ToolDefinition, ToolResponse } from '../types/index.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const BIN_DIR = path.join(PROJECT_ROOT, 'data', 'nirsoft', 'bin');
const CATALOG_PATH = path.join(PROJECT_ROOT, 'data', 'nirsoft', 'catalog.json');

let _catalog: NirsoftCatalog | null = null;

function getCatalog(): NirsoftCatalog {
  if (!_catalog) {
    _catalog = loadCatalog(CATALOG_PATH);
  }
  return _catalog;
}

const NirsoftArgsSchema = z.object({
  action: z.enum(['list', 'info', 'run', 'setup']),
  category: z.string().optional(),
  id: z.string().optional(),
  tool: z.string().optional(),
  args: z.array(z.string()).optional(),
  format: z.enum(['json', 'csv', 'raw']).optional(),
  dependency: z.string().optional(),
}).transform((data) => ({
  ...data,
  id: data.id ?? data.tool,
}));

type NirsoftArgs = z.infer<typeof NirsoftArgsSchema>;

async function handleList(parsed: NirsoftArgs): Promise<unknown> {
  const catalog = getCatalog();
  const tools = parsed.category
    ? catalog.tools.filter((t) => t.category === parsed.category)
    : catalog.tools;

  return {
    total: tools.length,
    categories: catalog.categories,
    tools: tools.map((t) => ({
      id: t.id,
      name: t.name,
      category: t.category,
      description: t.description,
      adminRequired: t.adminRequired,
      cli: t.cli,
    })),
  };
}

function findTool(id: string): NirsoftTool {
  const catalog = getCatalog();
  const tool = catalog.tools.find((t) => t.id === id);
  if (!tool) {
    throw new Error(`Tool not found: ${id}`);
  }
  return tool;
}

async function handleInfo(parsed: NirsoftArgs): Promise<unknown> {
  if (!parsed.id) throw new Error('id required for info');
  return findTool(parsed.id);
}

async function handleRun(parsed: NirsoftArgs): Promise<unknown> {
  if (!parsed.id) throw new Error('id required for run');

  const tool = findTool(parsed.id);
  const format = parsed.format ?? 'json';
  const extraArgs = parsed.args ?? [];

  if (!tool.cli) {
    throw new Error(`Tool ${tool.id} does not support CLI mode`);
  }

  if (tool.specialDeps) {
    throw new Error(
      `Tool ${tool.id} requires special dependency: ${tool.specialDeps}. Run setup action first.`,
    );
  }

  const tempFile = createTempFile();

  try {
    const exePath = path.join(BIN_DIR, tool.exe);
    const runArgs = ['/scomma', tempFile.winPath, ...extraArgs];

    if (tool.adminRequired) {
      // Check if we have an interactive session by attempting runas
      const psArgs = [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Start-Process -FilePath '${exePath}' -ArgumentList '${runArgs.map((a) => a.replace(/'/g, "''")).join("','")}' -Verb RunAs -Wait`,
      ];
      await execFileAsync('powershell.exe', psArgs, { timeout: tool.timeout });
    } else if (isWSL()) {
      const winExePath = await toWindowsPath(exePath);
      const cmdLine = [winExePath, ...runArgs].map((a) => `"${a.replace(/"/g, '\\"')}"`).join(' ');
      await execAsync(`cmd.exe /C ${cmdLine}`, { timeout: tool.timeout });
    } else {
      await execFileAsync(exePath, runArgs, { timeout: tool.timeout });
    }

    let csvContent = '';
    try {
      csvContent = fs.readFileSync(tempFile.linuxPath, 'utf8');
    } catch {
      csvContent = '';
    }

    if (format === 'raw') {
      return { raw: csvContent };
    }

    if (format === 'csv') {
      return { csv: csvContent };
    }

    // json format
    const parsed2 = parseCsvToJson(csvContent, tool.outputColumns);
    if (typeof parsed2 === 'string') {
      // outputColumns was null — raw fallback
      return { raw: parsed2 };
    }
    return { rows: parsed2, count: parsed2.length };
  } finally {
    try {
      fs.unlinkSync(tempFile.linuxPath);
    } catch {
      // ignore cleanup failure
    }
  }
}

async function handleSetup(parsed: NirsoftArgs): Promise<unknown> {
  const results: Record<string, string> = {};

  // Check npcap
  try {
    if (isWSL() || process.platform === 'win32') {
      const { stdout } = await execAsync(
        'powershell.exe -NoProfile -NonInteractive -Command "Get-Service npcap -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status"',
      );
      const status = stdout.trim();
      if (status === 'Running') {
        results['npcap'] = 'installed and running';
      } else if (status) {
        results['npcap'] = `installed but status: ${status}`;
      } else {
        results['npcap'] = 'not installed — download from https://npcap.com/';
      }
    } else {
      results['npcap'] = 'not applicable (non-Windows)';
    }
  } catch {
    results['npcap'] = 'check failed';
  }

  // Check bin dir
  const binExists = fs.existsSync(BIN_DIR);
  results['binDir'] = binExists
    ? `exists: ${BIN_DIR}`
    : `missing: ${BIN_DIR} — place NirSoft executables here`;

  // Check catalog
  const catalogExists = fs.existsSync(CATALOG_PATH);
  results['catalog'] = catalogExists ? `exists: ${CATALOG_PATH}` : `missing: ${CATALOG_PATH}`;

  if (catalogExists) {
    try {
      const catalog = getCatalog();
      results['catalogTools'] = `${catalog.tools.length} tools loaded`;
    } catch (err) {
      results['catalogTools'] = `load error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return results;
}

async function handleNirsoftAction(parsed: NirsoftArgs): Promise<unknown> {
  switch (parsed.action) {
    case 'list':
      return handleList(parsed);
    case 'info':
      return handleInfo(parsed);
    case 'run':
      return handleRun(parsed);
    case 'setup':
      return handleSetup(parsed);
    default:
      throw new Error(`Unknown action: ${parsed.action}`);
  }
}

export const nirsoftTools: ToolDefinition[] = isSupported()
  ? [
      {
        name: 'nirsoft',
        description:
          'Run NirSoft Windows utilities: list available tools, get tool info, execute tools and return parsed output. Supports 200+ system diagnostic and forensics tools.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'info', 'run', 'setup'],
              description:
                'list: browse catalog; info: tool details; run: execute tool; setup: check dependencies',
            },
            category: {
              type: 'string',
              description: 'Filter by category (list action only)',
            },
            id: {
              type: 'string',
              description: 'Tool id from catalog (info and run actions)',
            },
            args: {
              type: 'array',
              items: { type: 'string' },
              description: 'Extra CLI arguments passed to the tool (run action)',
            },
            format: {
              type: 'string',
              enum: ['json', 'csv', 'raw'],
              description: 'Output format for run action (default: json)',
            },
          },
          required: ['action'],
        },
        handler: async (args: unknown): Promise<ToolResponse> => {
          try {
            const parsed = NirsoftArgsSchema.parse(args);
            const result = await handleNirsoftAction(parsed);
            return createJsonResponse(result);
          } catch (error) {
            return createErrorResponse(error instanceof Error ? error : new Error(String(error)));
          }
        },
      },
    ]
  : [];

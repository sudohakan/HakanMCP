import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import * as path from 'node:path';
import { jsonResultTruncated } from './_httpShared.js';

const execFileAsync = promisify(execFile);
const CLI = process.env.TEAMS_BROWSER_CLI
  ?? path.join(os.homedir(), '.claude', 'skills', 'teams-browser', 'scripts', 'teams_browser.py');
const TIMEOUT_MS = 120_000;
const MAX_BUFFER = 20 * 1024 * 1024;

const ACTIONS = ['unread', 'chat', 'mentions', 'asks', 'recent', 'digest', 'calendar', 'calls', 'files', 'spaces', 'doctor'] as const;

const schema = z.object({
  action: z.enum(ACTIONS),
  name: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  since: z.string().optional(),
  after: z.string().optional(),
  download: z.string().optional(),
  sender: z.string().optional(),
  type: z.string().optional(),
});

export function buildArgs(parsed: z.infer<typeof schema>): string[] {
  const args: string[] = [parsed.action];
  if (parsed.action === 'chat') {
    if (!parsed.name) throw new Error('chat needs a name');
    args.push(parsed.name);
    if (parsed.limit) args.push('-n', String(parsed.limit));
  }
  const flags: Array<[string, string | undefined]> = [
    ['--from', parsed.from], ['--to', parsed.to], ['--since', parsed.since], ['--after', parsed.after],
    ['--download', parsed.download], ['--sender', parsed.sender], ['--type', parsed.type],
  ];
  for (const [flag, value] of flags) if (value) args.push(flag, value);
  args.push('--json');
  return args;
}

export const teamsTools = [
  {
    name: 'teams',
    description: "Work with the user's own Microsoft Teams (unread, chat, mentions, asks, recent, digest, calendar, calls, files, spaces) for any date range through the teams-browser CLI. Exit codes come back as the error text.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: [...ACTIONS], description: 'Which command to run' },
        name: { type: 'string', description: 'chat: part of the chat name' },
        limit: { type: 'number', description: 'chat: number of messages (default 20)' },
        from: { type: 'string', description: 'YYYY-MM-DD range start (chat, calendar, calls)' },
        to: { type: 'string', description: 'YYYY-MM-DD range end' },
        since: { type: 'string', description: 'Duration such as 90m, 12h, 3d, 2w (recent, mentions, asks, digest, unread, files)' },
        after: { type: 'string', description: 'unread: cursor returned by the previous call' },
        download: { type: 'string', description: 'files: file name part or share address; saved into Downloads' },
        sender: { type: 'string', description: 'files: only files shared by this person' },
        type: { type: 'string', description: 'files: file type such as pdf' },
      },
      required: ['action'],
    },
    handler: async (args: unknown) => {
      const parsed = schema.parse(args);
      try {
        const { stdout } = await execFileAsync('python3', [CLI, ...buildArgs(parsed)], { timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER });
        return jsonResultTruncated(JSON.parse(stdout));
      } catch (err) {
        const e = err as { code?: number | string; stderr?: string; message: string };
        throw new Error(`teams exit ${e.code ?? '?'}: ${(e.stderr || e.message).trim()}`);
      }
    },
  },
];

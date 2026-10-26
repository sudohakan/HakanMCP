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

// Per action: positional fields (in CLI order) and the flags it accepts as [field, flag].
type Spec = { pos: string[]; flags: Array<[string, string]>; write?: true };
const RANGE: Array<[string, string]> = [['from', '--from'], ['to', '--to']];
const EVENT_WHEN: Array<[string, string]> = [['subject', '--subject'], ['start', '--start'], ['end', '--end'], ['body', '--body'], ['location', '--location']];
const SPECS: Record<string, Spec> = {
  unread: { pos: [], flags: [['since', '--since'], ['after', '--after']] },
  chat: { pos: ['name'], flags: [['limit', '-n'], ...RANGE] },
  mentions: { pos: [], flags: [['since', '--since']] },
  asks: { pos: [], flags: [['since', '--since']] },
  recent: { pos: [], flags: [['since', '--since']] },
  digest: { pos: [], flags: [['since', '--since']] },
  calendar: { pos: [], flags: RANGE },
  calls: { pos: [], flags: RANGE },
  files: { pos: [], flags: [['since', '--since'], ['download', '--download'], ['type', '--type'], ['sender', '--sender']] },
  spaces: { pos: [], flags: [] },
  doctor: { pos: [], flags: [] },
  presence: { pos: ['person'], flags: [] },
  search: { pos: ['query'], flags: [['size', '--size']] },
  people: { pos: ['name'], flags: [] },
  channels: { pos: ['team'], flags: [] },
  activity: { pos: [], flags: [['since', '--since']] },
  todo: { pos: [], flags: [['list', '--list']] },
  'event-show': { pos: ['event'], flags: [['on', '--on']] },
  send: { pos: ['chat', 'text'], flags: [['mention', '--mention'], ['subject', '--subject']], write: true },
  edit: { pos: ['chat', 'message_id', 'text'], flags: [], write: true },
  delete: { pos: ['chat', 'message_id'], flags: [], write: true },
  react: { pos: ['chat', 'message_id', 'key'], flags: [['remove', '--remove']], write: true },
  'mark-read': { pos: ['chat'], flags: [], write: true },
  'mark-unread': { pos: ['chat'], flags: [], write: true },
  'chat-new': { pos: ['title'], flags: [['members', '--members']], write: true },
  'chat-rename': { pos: ['chat', 'title'], flags: [], write: true },
  'chat-delete': { pos: ['chat'], flags: [], write: true },
  'chat-add': { pos: ['chat'], flags: [['members', '--members']], write: true },
  'chat-remove': { pos: ['chat', 'person'], flags: [], write: true },
  'channel-post': { pos: ['team', 'channel', 'text'], flags: [], write: true },
  'event-new': { pos: ['subject'], flags: [['start', '--start'], ['end', '--end'], ['minutes', '--minutes'], ['attendees', '--attendees'], ['online', '--online'], ['body', '--body'], ['location', '--location']], write: true },
  'event-edit': { pos: ['event'], flags: [['on', '--on'], ...EVENT_WHEN], write: true },
  'event-delete': { pos: ['event'], flags: [['on', '--on']], write: true },
  'event-respond': { pos: ['event', 'answer'], flags: [['on', '--on'], ['comment', '--comment']], write: true },
  'presence-set': { pos: ['status'], flags: [['note', '--note']], write: true },
  upload: { pos: ['path'], flags: [['send_to', '--to']], write: true },
  'file-delete': { pos: ['file_name'], flags: [], write: true },
  'todo-add': { pos: ['title'], flags: [['due', '--due'], ['list', '--list']], write: true },
  'todo-done': { pos: ['task'], flags: [['list', '--list']], write: true },
  'todo-delete': { pos: ['task'], flags: [['list', '--list']], write: true },
};
const OPTIONAL_POS = new Set(['presence:person', 'presence-set:status', 'channels:team']);   // action:field
const BOOLEAN_FIELDS = new Set(['remove', 'online']);
const LIST_FIELDS = new Set(['members', 'attendees']);          // one flag, many values
const REPEAT_FIELDS = new Set(['mention']);                      // one flag per value
const ACTIONS = Object.keys(SPECS) as [string, ...string[]];

const text = z.string();
const schema = z.object({
  action: z.enum(ACTIONS),
  confirm: z.boolean().optional(),
  name: text.optional(), chat: text.optional(), message_id: text.optional(), text: text.optional(), key: text.optional(),
  title: text.optional(), channel: text.optional(), event: text.optional(), answer: text.optional(), status: text.optional(), person: text.optional(),
  path: text.optional(), file_name: text.optional(), query: text.optional(), team: text.optional(), task: text.optional(),
  limit: z.number().int().positive().max(500).optional(),
  size: z.number().int().positive().max(200).optional(),
  minutes: z.number().int().positive().max(1440).optional(),
  from: text.optional(), to: text.optional(), since: text.optional(), after: text.optional(), download: text.optional(),
  sender: text.optional(), type: text.optional(), subject: text.optional(), start: text.optional(), end: text.optional(),
  body: text.optional(), location: text.optional(), on: text.optional(), comment: text.optional(), note: text.optional(),
  send_to: text.optional(), due: text.optional(), list: text.optional(),
  remove: z.boolean().optional(), online: z.boolean().optional(),
  mention: z.array(text).optional(), members: z.array(text).optional(), attendees: z.array(text).optional(),
});
type Parsed = z.infer<typeof schema>;

export function buildArgs(parsed: Parsed): string[] {
  const spec = SPECS[parsed.action];
  const value = (field: string) => (parsed as Record<string, unknown>)[field];
  const args: string[] = [parsed.action];
  for (const [field, flag] of spec.flags) {
    const v = value(field);
    if (v === undefined || v === false || v === '') continue;
    if (BOOLEAN_FIELDS.has(field)) args.push(flag);
    else if (LIST_FIELDS.has(field)) args.push(flag, ...(v as string[]));
    else if (REPEAT_FIELDS.has(field)) for (const item of v as string[]) args.push(flag, item);
    else args.push(flag, String(v));
  }
  if (spec.write && parsed.confirm === true) args.push('--yes');
  args.push('--json');
  const positionals: string[] = [];
  for (const field of spec.pos) {
    const v = value(field);
    if (v === undefined || v === '') {
      if (OPTIONAL_POS.has(`${parsed.action}:${field}`)) continue;
      throw new Error(`${parsed.action} needs ${field}`);
    }
    positionals.push(String(v));
  }
  // Positionals follow `--` so free text can never be read as a flag (a message body of "--yes" must not lift the draft gate).
  if (positionals.length) args.push('--', ...positionals);
  return args;
}

export const teamsTools = [
  {
    name: 'teams',
    description: "Work with the user's own Microsoft Teams through the teams-browser CLI: read (unread, chat, mentions, asks, recent, digest, calendar, calls, files, spaces, search, people, channels, activity, presence, todo, event-show) and manage (send, edit, delete, react, mark-read, mark-unread, chat-new, chat-rename, chat-delete, chat-add, chat-remove, channel-post, event-new, event-edit, event-delete, event-respond, presence-set, upload, file-delete, todo-add, todo-done, todo-delete). Every manage action returns a draft until confirm is true. Exit codes come back as the error text.",
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ACTIONS, description: 'Which command to run' },
        confirm: { type: 'boolean', description: 'Manage actions: true runs the change, otherwise only a draft comes back' },
        name: { type: 'string', description: 'chat/people: part of the chat or person name' },
        chat: { type: 'string', description: 'Manage actions: chat name part, 19:/48: id, or "notlar" for the notes chat' },
        message_id: { type: 'string', description: 'edit/delete/react: message id shown as #id in chat output' },
        text: { type: 'string', description: 'send/edit: message text' },
        key: { type: 'string', description: 'react: like, heart, laugh, surprised, sad or angry' },
        channel: { type: 'string', description: 'channel-post: channel name part (team goes in `team`)' },
        title: { type: 'string', description: 'chat-new/chat-rename/todo-add: title' },
        event: { type: 'string', description: 'event-*: subject part or full event id' },
        answer: { type: 'string', description: 'event-respond: accept, decline or tentative' },
        status: { type: 'string', description: 'presence-set: Available, Busy, DoNotDisturb, BeRightBack or Away' },
        person: { type: 'string', description: 'presence: person name (default: the user); chat-remove: member to remove' },
        path: { type: 'string', description: 'upload: local file path (up to 250 MB)' },
        file_name: { type: 'string', description: 'file-delete: exact file name in the drive root' },
        query: { type: 'string', description: 'search: words to look for' },
        team: { type: 'string', description: 'channels: team name part (omit to list teams); channel-post: team name part' },
        task: { type: 'string', description: 'todo-done/todo-delete: task title part' },
        limit: { type: 'number', description: 'chat: number of messages (default 20)' },
        size: { type: 'number', description: 'search: number of results (default 25)' },
        minutes: { type: 'number', description: 'event-new: length when end is omitted (default 30)' },
        from: { type: 'string', description: 'YYYY-MM-DD range start (chat, calendar, calls)' },
        to: { type: 'string', description: 'YYYY-MM-DD range end' },
        since: { type: 'string', description: 'Duration such as 90m, 12h, 3d, 2w (recent, mentions, asks, digest, unread, files, activity)' },
        after: { type: 'string', description: 'unread: cursor returned by the previous call' },
        download: { type: 'string', description: 'files: file name part or share address; saved into Downloads' },
        sender: { type: 'string', description: 'files: only files shared by this person' },
        type: { type: 'string', description: 'files: file type such as pdf' },
        subject: { type: 'string', description: 'event-new/event-edit: subject; send: message subject line' },
        start: { type: 'string', description: 'event-new/event-edit: local time YYYY-MM-DD HH:MM' },
        end: { type: 'string', description: 'event-new/event-edit: local time YYYY-MM-DD HH:MM' },
        body: { type: 'string', description: 'event-new/event-edit: description' },
        location: { type: 'string', description: 'event-new/event-edit: location' },
        on: { type: 'string', description: 'event-*: day (YYYY-MM-DD) to look for the event on' },
        comment: { type: 'string', description: 'event-respond: note sent with the answer' },
        note: { type: 'string', description: 'presence-set: status note' },
        send_to: { type: 'string', description: 'upload: chat that also receives the link' },
        due: { type: 'string', description: 'todo-add: due day YYYY-MM-DD' },
        list: { type: 'string', description: 'todo*: list name part (default: first list)' },
        remove: { type: 'boolean', description: 'react: take the reaction back' },
        online: { type: 'boolean', description: 'event-new: add a Teams meeting link' },
        mention: { type: 'array', items: { type: 'string' }, description: 'send: people to tag; each name must appear in the text' },
        members: { type: 'array', items: { type: 'string' }, description: 'chat-new/chat-add: people to add besides the user' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'event-new: people to invite' },
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

import type { ToolDefinition } from './types/index.js';

export type ToolList = ToolDefinition[];

// Tool modules. The loaders are static imports, not import(variable): a
// computed specifier is unresolvable at bundle time, and esbuild would leave it
// as a runtime import that finds nothing next to the bundle's chunks — the
// server would start with zero tools and only a warning. Adding a tool module
// means adding a line here; scripts/bundle.mjs reads this list to embed each
// module's tool metadata, so the module itself loads only on its first call.
export const TOOL_MODULES: Array<{ name: string; load: () => Promise<ToolList> }> = [
  { name: 'health', load: async () => (await import('./tools/health.js')).healthTools as ToolList },
  { name: 'gitbook', load: async () => (await import('./tools/gitbook.js')).gitbookTools as ToolList },
  { name: 'http', load: async () => (await import('./tools/http.js')).httpTools as ToolList },
  { name: 'backup', load: async () => (await import('./tools/backup.js')).backupTools as ToolList },
  { name: 'mcpClient', load: async () => (await import('./tools/mcpClient.js')).mcpClientTools as ToolList },
  { name: 'disk', load: async () => (await import('./tools/disk.js')).diskTools as ToolList },
  { name: 'sysint', load: async () => (await import('./tools/sysint.js')).sysintTools as ToolList },
  { name: 'cfbypass', load: async () => (await import('./tools/cfbypass.js')).cfbypassTools as ToolList },
  { name: 'chromeDevtools', load: async () => (await import('./tools/chromeDevtools.js')).chromeDevtoolsTools as ToolList },
  { name: 'exaSearch', load: async () => (await import('./tools/exaSearch.js')).exaTools as ToolList },
  { name: 'ollamaChat', load: async () => (await import('./tools/ollamaChat.js')).ollamaChatTools as ToolList },
  { name: 'transcribeLocal', load: async () => (await import('./tools/transcribeLocal.js')).transcribeLocalTools as ToolList },
  { name: 'teams', load: async () => (await import('./tools/teams.js')).teamsTools as ToolList },
];

// Feature modules (native drivers) keyed by their FEATURE_TOOL_MAP prefix. Static
// for the same reason: the registry's modulePath import resolves relative to the
// chunk it runs from, which is not where tsc puts the tool modules.
export const FEATURE_LOADERS: Record<string, () => Promise<ToolList>> = {
  db: async () => (await import('./tools/db.js')).dbTools as ToolList,
  mongo: async () => (await import('./tools/mongodb.js')).mongoTools as ToolList,
};

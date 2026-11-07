import { FEATURE_TOOL_METADATA, ToolRegistry } from '../src/toolRegistry';
import { TOOL_ANNOTATIONS, annotationsFor } from '../src/toolAnnotations';
import type { ToolDefinition } from '../src/types/index';

// Every tool the server registers. A new tool must be added here and in TOOL_ANNOTATIONS.
const EXPECTED_TOOLS = [
  'db', 'mongo', 'health', 'gitbook', 'http', 'backup', 'mcp', 'browser', 'disk', 'sysint', 'cfbypass',
  'chrome_click', 'chrome_close_page', 'chrome_drag', 'chrome_emulate', 'chrome_evaluate_script',
  'chrome_fill', 'chrome_fill_form', 'chrome_get_console_message', 'chrome_get_css_styles',
  'chrome_get_network_request', 'chrome_handle_dialog', 'chrome_hover', 'chrome_lighthouse_audit',
  'chrome_list_console_messages', 'chrome_list_network_requests', 'chrome_list_pages',
  'chrome_navigate_page', 'chrome_new_page', 'chrome_performance_analyze_insight',
  'chrome_performance_start_trace', 'chrome_performance_stop_trace', 'chrome_press_key',
  'chrome_resize_page', 'chrome_select_page', 'chrome_take_heapsnapshot', 'chrome_take_screenshot',
  'chrome_take_snapshot', 'chrome_type_text', 'chrome_upload_file', 'chrome_wait_for',
  'exaSearch', 'exaFindSimilar', 'exaGetContents', 'ollamaChat', 'ollamaListModels',
  'transcribeLocal', 'teams',
];

const HINTS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const;

async function buildRegistry(): Promise<ToolRegistry> {
  const registry = new ToolRegistry();
  // Sequential on purpose: parallel dynamic imports race zod's ESM linking under jest.
  const loaders: Array<() => Promise<unknown[]>> = [
    async () => (await import('../src/tools/health')).healthTools,
    async () => (await import('../src/tools/gitbook')).gitbookTools,
    async () => (await import('../src/tools/http')).httpTools,
    async () => (await import('../src/tools/backup')).backupTools,
    async () => (await import('../src/tools/mcpClient')).mcpClientTools,
    async () => (await import('../src/tools/disk')).diskTools,
    async () => (await import('../src/tools/sysint')).sysintTools,
    async () => (await import('../src/tools/cfbypass')).cfbypassTools,
    async () => (await import('../src/tools/chromeDevtools')).chromeDevtoolsTools,
    async () => (await import('../src/tools/exaSearch')).exaTools,
    async () => (await import('../src/tools/ollamaChat')).ollamaChatTools,
    async () => (await import('../src/tools/transcribeLocal')).transcribeLocalTools,
    async () => (await import('../src/tools/teams')).teamsTools,
  ];
  const modules: unknown[][] = [];
  for (const load of loaders) modules.push(await load());
  for (const tools of modules) {
    for (const tool of tools) registry.registerTool(tool as unknown as ToolDefinition, null);
  }
  for (const [prefix, metas] of Object.entries(FEATURE_TOOL_METADATA)) {
    for (const meta of metas) registry.registerPlaceholder(meta.name, meta.description, meta.inputSchema, prefix);
  }
  return registry;
}

describe('tool annotations', () => {
  let listed: ReturnType<ToolRegistry['listTools']>;

  beforeAll(async () => {
    listed = (await buildRegistry()).listTools();
  });

  it('registers exactly the expected tools', () => {
    expect(listed.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('gives every listed tool an explicit row with four boolean hints', () => {
    for (const tool of listed) {
      expect({ tool: tool.name, explicit: tool.name in TOOL_ANNOTATIONS }).toEqual({ tool: tool.name, explicit: true });
      for (const hint of HINTS) {
        expect({ tool: tool.name, hint, type: typeof tool.annotations[hint] }).toEqual({ tool: tool.name, hint, type: 'boolean' });
      }
    }
  });

  it('has no row for a tool that is not registered', () => {
    expect(Object.keys(TOOL_ANNOTATIONS).filter((name) => !EXPECTED_TOOLS.includes(name))).toEqual([]);
  });

  it('never marks a read-only tool destructive', () => {
    for (const [name, hints] of Object.entries(TOOL_ANNOTATIONS)) {
      expect({ name, bad: hints.readOnlyHint && hints.destructiveHint }).toEqual({ name, bad: false });
    }
  });

  it('reflects the handlers that write or delete', () => {
    for (const name of ['db', 'mongo', 'http', 'backup', 'disk', 'mcp', 'browser', 'teams']) {
      expect({ name, ...annotationsFor(name) }).toMatchObject({ name, readOnlyHint: false, destructiveHint: true });
    }
    for (const name of ['exaSearch', 'exaFindSimilar', 'exaGetContents', 'health', 'ollamaListModels', 'chrome_list_pages']) {
      expect({ name, ...annotationsFor(name) }).toMatchObject({ name, readOnlyHint: true, destructiveHint: false });
    }
  });

  it('falls back to the cautious reading for an unlisted tool', () => {
    expect(annotationsFor('not_a_tool')).toEqual({
      readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true,
    });
  });
});

/**
 * MCP tool annotation hints, one explicit row per registered tool.
 *
 * Values follow the handler's real behaviour; for action-multiplexed tools the
 * most dangerous action decides (any write/delete flips readOnly and destructive).
 *  - readOnlyHint: no change to the environment (files, remote state, processes)
 *  - destructiveHint: may delete or overwrite data (only meaningful when not read-only)
 *  - idempotentHint: repeating the same call has no further effect
 *  - openWorldHint: talks to something outside this machine (web, remote DB, cloud)
 */
export interface ToolAnnotationHints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const h = (
  readOnlyHint: boolean,
  destructiveHint: boolean,
  idempotentHint: boolean,
  openWorldHint: boolean,
): ToolAnnotationHints => ({ readOnlyHint, destructiveHint, idempotentHint, openWorldHint });

// A page interaction can submit a form or navigate away: not read-only, destructive.
const PAGE_ACTION = h(false, true, false, true);
// Pure page reads.
const PAGE_READ = h(true, false, true, true);
// Page setup that changes browser state but loses no data.
const PAGE_SETUP = h(false, false, true, true);

export const TOOL_ANNOTATIONS: Record<string, ToolAnnotationHints> = {
  // Read-only unless allowWrite; restore/backup write files and databases.
  db: h(false, true, false, true),
  // insert/update/delete actions.
  mongo: h(false, true, false, true),
  // Probes local CDP and FlareSolverr endpoints.
  health: h(true, false, true, false),
  // updatePage opens a change request, never merges it: writes, destroys nothing.
  gitbook: h(false, false, false, true),
  // Any HTTP method; downloadFile writes (overwrites) a local file.
  http: h(false, true, false, true),
  // create/restore/deleteOld/start/stop.
  backup: h(false, true, false, false),
  // Spawns servers and forwards arbitrary tool calls.
  mcp: h(false, true, false, true),
  // click/fill/evaluate against live pages.
  browser: h(false, true, false, true),
  // delete/move/cleanup/archive.
  disk: h(false, true, false, false),
  // Catalog run: wake-on-lan, audio-volume set, snapshot writers; no deletions.
  sysint: h(false, false, false, true),
  // GET or POST through FlareSolverr.
  cfbypass: h(false, false, false, true),

  chrome_click: PAGE_ACTION,
  chrome_close_page: h(false, true, false, false),
  chrome_drag: PAGE_ACTION,
  chrome_emulate: PAGE_SETUP,
  chrome_evaluate_script: PAGE_ACTION,
  chrome_fill: PAGE_ACTION,
  chrome_fill_form: PAGE_ACTION,
  chrome_get_console_message: PAGE_READ,
  chrome_get_css_styles: PAGE_READ,
  chrome_get_network_request: PAGE_READ,
  chrome_handle_dialog: PAGE_ACTION,
  chrome_hover: PAGE_SETUP,
  chrome_lighthouse_audit: PAGE_READ,
  chrome_list_console_messages: PAGE_READ,
  chrome_list_network_requests: PAGE_READ,
  chrome_list_pages: h(true, false, true, false),
  chrome_navigate_page: PAGE_SETUP,
  chrome_new_page: h(false, false, false, true),
  chrome_performance_analyze_insight: PAGE_READ,
  chrome_performance_start_trace: PAGE_SETUP,
  chrome_performance_stop_trace: h(false, false, true, false),
  chrome_press_key: PAGE_ACTION,
  chrome_resize_page: h(false, false, true, false),
  chrome_select_page: h(false, false, true, false),
  chrome_take_heapsnapshot: h(false, false, false, false),
  chrome_take_screenshot: PAGE_READ,
  chrome_take_snapshot: PAGE_READ,
  chrome_type_text: PAGE_ACTION,
  chrome_upload_file: PAGE_ACTION,
  chrome_wait_for: PAGE_READ,

  exaSearch: h(true, false, true, true),
  exaFindSimilar: h(true, false, true, true),
  exaGetContents: h(true, false, true, true),
  // Generation is not repeatable; local or cloud endpoint.
  ollamaChat: h(true, false, false, true),
  ollamaListModels: h(true, false, true, false),
  // Writes a temp script, reads the audio file, prints text.
  transcribeLocal: h(true, false, true, false),
  // send/edit/delete/chat-delete on the user's own Teams (draft until confirm).
  teams: h(false, true, false, true),
};

// Unlisted tools get the most cautious reading, never a missing hint.
const CAUTIOUS = h(false, true, false, true);

export function annotationsFor(toolName: string): ToolAnnotationHints {
  return TOOL_ANNOTATIONS[toolName] ?? CAUTIOUS;
}

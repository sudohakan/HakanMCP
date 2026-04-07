/**
 * Shared type definitions for MCP server
 */

export interface ToolResponse {
  content: ToolContent[];
  isError?: boolean;
  meta?: Record<string, unknown>;
}

export interface ToolContent {
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;
  mimeType?: string;
}

export type ToolHandler<T = unknown> = (args: T) => Promise<ToolResponse>;

export interface ToolDefinition<T = unknown> {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  handler: ToolHandler<T>;
}

export interface HttpHeaders {
  [key: string]: string;
}

export interface HttpRequestOptions {
  method: string;
  headers?: HttpHeaders;
  body?: string;
  timeout?: number;
  retries?: number;
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: HttpHeaders;
  body: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export interface QueryResult {
  rowCount: number;
  rows: unknown[];
}

export interface TableSchema {
  table: string;
  columns: ColumnInfo[];
}

export interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

export interface GitStatus {
  current: string;
  tracking: string | null;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

export interface GitFileStatus {
  path: string;
  index: string;
  working_dir: string;
}

export interface GitCommitInfo {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export interface FileInfo {
  name: string;
  type: 'file' | 'dir' | 'unknown';
  size: number;
  modified: string;
  error?: string;
}

export interface DirectoryListing {
  path: string;
  count: number;
  files: FileInfo[];
}

export interface PostmanCollection {
  info: {
    name: string;
    schema: string;
  };
  item: PostmanItem[];
}

export interface PostmanItem {
  name: string;
  request?: PostmanRequest;
  response?: PostmanResponse[];
  item?: PostmanItem[];
}

export interface PostmanRequest {
  method: string;
  header: Array<{ key: string; value: string }>;
  body?: {
    mode?: string;
    raw?: string;
    urlencoded?: Array<{ key: string; value: string }>;
    graphql?: unknown;
  };
  url: string | PostmanUrl;
}

export interface PostmanUrl {
  raw: string;
  protocol?: string;
  host?: string[];
  path?: string[];
  query?: Array<{ key: string; value?: string }>;
  variable?: Array<{ key: string; value?: string }>;
}

export interface PostmanResponse {
  name: string;
  code: number;
  body: string;
}

export interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface OllamaGenerateResponse {
  model: string;
  response: string;
  done: boolean;
}

export interface OllamaChatResponse {
  model: string;
  message: {
    role: string;
    content: string;
  };
  done: boolean;
}

export interface SystemInfo {
  platform: string;
  arch: string;
  cpus: number;
  totalMemory: number;
  freeMemory: number;
  uptime: number;
  hostname: string;
}

export interface ProcessInfo {
  pid: string;
  name: string;
  user?: string;
  memory?: number;
}

export interface ParsedData {
  [key: string]: unknown;
}

export interface GitBookHeading {
  level: number;
  text: string;
  id?: string;
}

export interface GitBookMetadata {
  title: string;
  description: string;
  keywords: string;
  author: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
}

export interface GitBookSearchResult {
  lineNumber: number;
  matchedLine: string;
  context: string[];
  contextRange: string;
}

export interface ClaudeTextBlock {
  type: 'text';
  text: string;
}

export interface ClaudeToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ClaudeContentBlock = ClaudeTextBlock | ClaudeToolUseBlock | ClaudeToolResultBlock;

export interface ClaudeToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ClaudeContentBlock[];
}

export interface ClaudeApiResponse {
  id: string;
  type: string;
  role: string;
  content: ClaudeContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | null;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface AgenticToolCall {
  name: string;
  input: Record<string, unknown>;
  result: string;
  is_error: boolean;
  duration_ms: number;
}

export interface AgenticLoopResult {
  text: string;
  model: string;
  toolCalls: AgenticToolCall[];
  iterations: number;
  inputTokens: number;
  outputTokens: number;
}

export class ToolError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ToolError';
  }
}

export class ValidationError extends ToolError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class DatabaseError extends ToolError {
  constructor(message: string, details?: unknown) {
    super(message, 'DATABASE_ERROR', details);
    this.name = 'DatabaseError';
  }
}

export class NetworkError extends ToolError {
  constructor(message: string, details?: unknown) {
    super(message, 'NETWORK_ERROR', details);
    this.name = 'NetworkError';
  }
}

export class FileSystemError extends ToolError {
  constructor(message: string, details?: unknown) {
    super(message, 'FILESYSTEM_ERROR', details);
    this.name = 'FileSystemError';
  }
}

/**
 * SysInt output formatter.
 * Builds standardized success/error response objects and CSV output.
 */

export type SysIntPlatform = 'win32' | 'linux' | 'wsl';
export type SysIntErrorCode = 'PLATFORM_UNSUPPORTED' | 'PRIVILEGE_REQUIRED' | 'NOT_FOUND' | 'EXEC_FAILED';

export interface SysIntSuccess {
  rows: unknown[];
  count: number;
  timestamp: string;
  platform: SysIntPlatform;
  tool: string;
}

export interface SysIntError {
  error: string;
  code: SysIntErrorCode;
  tool: string;
}

export type SysIntResult = SysIntSuccess | SysIntError;

export function buildSuccess(
  rows: unknown[],
  toolId: string,
  platform: SysIntPlatform,
): SysIntSuccess {
  return {
    rows,
    count: rows.length,
    timestamp: new Date().toISOString(),
    platform,
    tool: toolId,
  };
}

export function buildError(
  message: string,
  code: SysIntErrorCode,
  toolId: string,
): SysIntError {
  return {
    error: message,
    code,
    tool: toolId,
  };
}

export function isError(result: SysIntResult): result is SysIntError {
  return 'error' in result;
}

/**
 * Convert an array of flat objects to CSV string.
 * Headers from first row, values quoted if needed.
 */
export function toCSV(rows: unknown[]): string {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const lines: string[] = [headers.join(',')];

  for (const row of rows) {
    const values = headers.map((h) => {
      const v = (row as Record<string, unknown>)[h];
      if (v == null) return '';
      // Normalize CRLF before quoting
      const s = String(v).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      // Quote if contains comma, double quote, newline, or CRLF
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
}

/**
 * Write guard for the db and mongo tools: reads run freely, anything that can
 * change data or schema needs an explicit `allowWrite: true` from the caller.
 * Detection is keyword based on purpose — a false "write" only costs one extra
 * flag, a missed write can change a production database.
 */
import { z } from 'zod';

const SQL_WRITE_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|DENY|EXEC|EXECUTE|CALL|RESTORE|BACKUP|DBCC|COPY|VACUUM|REINDEX|CLUSTER|REPLACE|UPSERT|ATTACH|DETACH|PRAGMA|SHUTDOWN|KILL|sp_\w+|xp_\w+)\b/i;
const SELECT_INTO_TABLE = /\bSELECT\b[\s\S]*?\bINTO\b\s+(?!@)[#\w[\]."]+/i;

/**
 * One left-to-right pass over comments, string literals and quoted identifiers,
 * so a `--` inside a string cannot swallow the statement after it.
 */
const NON_CODE =
  /\/\*[\s\S]*?(?:\*\/|$)|--[^\n]*|'[^']*(?:''[^']*)*(?:'|$)|\[[^\]]*(?:\]|$)|"[^"]*(?:""[^"]*)*(?:"|$)|`[^`]*(?:`|$)/g;

/** JSON-schema property both tools expose; one wording, one default. */
export const ALLOW_WRITE_PROPERTY = {
  allowWrite: {
    type: 'boolean',
    description: 'Permit a call that changes data or schema. Default false: such calls are rejected.',
  },
} as const;

export const allowWriteSchema = z.object({ allowWrite: z.boolean().optional() });

/** Returns the first write keyword found in the SQL text, or null for a read. */
export function findSqlWrite(sql: string): string | null {
  const code = sql.replace(NON_CODE, ' ');
  const keyword = code.match(SQL_WRITE_KEYWORD);
  if (keyword) return keyword[0].toUpperCase();
  if (/\bINTO\b/i.test(code) && SELECT_INTO_TABLE.test(code)) return 'SELECT ... INTO';
  return null;
}

/** Returns the writing stage of a mongo aggregation pipeline ($out, $merge), or null. */
export function findPipelineWrite(pipeline: ReadonlyArray<Record<string, unknown>>): string | null {
  for (const stage of pipeline) {
    if ('$out' in stage) return '$out';
    if ('$merge' in stage) return '$merge';
  }
  return null;
}

/** Throws unless the caller opted into writes for this call. */
export function assertWriteAllowed(operation: string, allowWrite: boolean | undefined): void {
  if (allowWrite === true) return;
  throw new Error(
    `Write blocked (${operation}): this tool is read-only by default. ` +
      'Re-run with allowWrite: true once the change is intended.',
  );
}

/** Throws when the SQL writes and the caller did not opt in. */
export function assertSqlAllowed(sql: string, allowWrite: boolean | undefined): void {
  const write = findSqlWrite(sql);
  if (write) assertWriteAllowed(write, allowWrite);
}

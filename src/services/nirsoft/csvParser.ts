import { parse as csvParse } from 'csv-parse/sync';

export function parseCsvToJson(
  csv: string,
  columns: string[] | null,
): Record<string, string>[] | string {
  if (!columns) {
    return csv;
  }

  if (!csv.trim()) {
    return [];
  }

  return csvParse(csv, {
    columns: columns,
    skip_empty_lines: true,
    relax_column_count: true,
  });
}

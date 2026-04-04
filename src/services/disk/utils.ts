export const VALID_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function assertValidName(name: string, entity: string): void {
  if (!VALID_NAME_RE.test(name)) {
    throw new Error(`Invalid ${entity} name: "${name}". Only alphanumeric, underscore, and hyphen allowed (max 64 chars).`);
  }
}

export function parseBytes(size: string | number | undefined): number {
  if (size === undefined) return 0;
  if (typeof size === 'number') return size;
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB|TB)$/i);
  if (!match) return Number(size) || 0;
  const val = Number(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = { KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return val * (multipliers[unit] || 1);
}

export function extractJsonArray(text: string): string {
  const match = text.match(/\[[\s\S]*\]/);
  return match ? match[0] : '[]';
}

export function extractJsonObject(text: string): string {
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : '{}';
}

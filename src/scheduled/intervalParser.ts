/**
 * Interval string to cron expression converter.
 * Supports human-readable intervals like "every 30m", "every 2h", "every 1d".
 * Lossy intervals (e.g., "every 45m") set useCron = false so callers
 * can fall back to setInterval for accurate timing.
 */

/** Result of parsing an interval string */
export interface ParsedInterval {
  cronExpression: string;
  originalInput: string;
  intervalMs: number;
  useCron: boolean;
}

const INTERVAL_REGEX = /^every\s+(\d+)\s*(m|min|minutes?|h|hours?|d|days?)$/i;

const UNIT_TO_MS: Record<string, number> = {
  m: 60_000,
  min: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

/**
 * Parse a human-readable interval string into a cron expression.
 *
 * @param input - e.g., "every 30m", "every 2h", "every 1d"
 * @returns ParsedInterval with cronExpression, intervalMs, and useCron flag
 * @throws Error for invalid input, out-of-range values, or unsupported units
 */
export function parseInterval(input: string): ParsedInterval {
  const trimmed = input.trim();
  const match = trimmed.match(INTERVAL_REGEX);

  if (!match) {
    throw new Error(
      `Invalid interval format: "${trimmed}". Expected format: "every <number> <unit>" where unit is m/min/minutes/h/hours/d/days.`,
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();

  if (value <= 0) {
    throw new Error(`Interval value must be positive, got ${value}.`);
  }

  const isMinutes = ['m', 'min', 'minute', 'minutes'].includes(unit);
  const isHours = ['h', 'hour', 'hours'].includes(unit);
  const isDays = ['d', 'day', 'days'].includes(unit);

  const msPerUnit = UNIT_TO_MS[unit];
  if (!msPerUnit) {
    throw new Error(`Unsupported interval unit: "${unit}".`);
  }

  const intervalMs = value * msPerUnit;

  if (isMinutes) {
    if (value > 59) {
      throw new Error(
        `Minute interval must be between 1 and 59, got ${value}. Use hours for larger intervals.`,
      );
    }
    const useCron = 60 % value === 0;
    return {
      cronExpression: `*/${value} * * * *`,
      originalInput: trimmed,
      intervalMs,
      useCron,
    };
  }

  if (isHours) {
    if (value > 23) {
      throw new Error(
        `Hour interval must be between 1 and 23, got ${value}. Use days for larger intervals.`,
      );
    }
    return {
      cronExpression: `0 */${value} * * *`,
      originalInput: trimmed,
      intervalMs,
      useCron: true,
    };
  }

  if (isDays) {
    if (value !== 1) {
      throw new Error(
        `Day interval only supports "every 1 day". Multi-day intervals are not supported via cron; use a cron expression directly.`,
      );
    }
    return {
      cronExpression: '0 0 * * *',
      originalInput: trimmed,
      intervalMs,
      useCron: true,
    };
  }

  throw new Error(`Unsupported interval unit: "${unit}".`);
}

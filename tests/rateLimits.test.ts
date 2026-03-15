/**
 * Rate limit cooldown parsing tests.
 * Consolidated from scripts-hakan/test_rate_limits.js and test_rate_limits_fix.js.
 */

// Inline the parsing logic for isolated testing
function parseTime(timeStr: string, ampm?: string): number {
  const now = Date.now();
  const [hoursStr, minsStr] = timeStr.split(':');
  let hours = parseInt(hoursStr, 10);
  const minutes = minsStr ? parseInt(minsStr, 10) : 0;

  if (ampm) {
    if (hours === 12) hours = 0;
    if (ampm.toLowerCase() === 'pm') hours += 12;
  }

  const target = new Date();
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now - 60000) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
}

function parseCooldownUntil(message: string): number {
  const now = Date.now();

  const stripAnsi = (str: string) =>
    // eslint-disable-next-line no-control-regex
    str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
  const cleanRaw = stripAnsi(message);
  const normalized = cleanRaw.toLowerCase();

  // Relative time: "try again in 20s"
  const relativeMatch = normalized.match(
    /(?:try again in|retry in|in)\s+(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i,
  );
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    if (!Number.isNaN(amount) && amount > 0) {
      let multiplier = 1000;
      if (unit.startsWith('m')) multiplier = 60_000;
      if (unit.startsWith('h')) multiplier = 3_600_000;
      return now + amount * multiplier;
    }
  }

  // Gemini: "reset after 4h58m24s"
  const resetAfterMatch = normalized.match(
    /reset after\s+(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/i,
  );
  if (resetAfterMatch) {
    const hours = parseInt(resetAfterMatch[1] || '0', 10);
    const minutes = parseInt(resetAfterMatch[2] || '0', 10);
    const seconds = parseInt(resetAfterMatch[3] || '0', 10);
    if (hours > 0 || minutes > 0 || seconds > 0) {
      return now + hours * 3600000 + minutes * 60000 + seconds * 1000;
    }
  }

  const cleanMsg = normalized.replace(/\u00A0/g, ' ');

  // Codex/OpenAI: "Access resets on Feb 24th, 2026 5:28 PM"
  const resetsOnMatch = cleanMsg.match(
    /resets on\s+([A-Za-z]{3}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)/i,
  );
  if (resetsOnMatch) {
    let cleanDate = resetsOnMatch[1].replace(/(\d+)(st|nd|rd|th)/, '$1');
    cleanDate = cleanDate.replace(/\b([a-z]{3})\b/g, (m) => m.charAt(0).toUpperCase() + m.slice(1));
    const ts = new Date(cleanDate).getTime();
    if (!isNaN(ts)) return ts;
  }

  // Claude: "resets Feb 23, 3pm"
  const claudeDateMatch = cleanMsg.match(
    /resets\s+([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)?/i,
  );
  if (claudeDateMatch) {
    let month = claudeDateMatch[1];
    month = month.charAt(0).toUpperCase() + month.slice(1);
    const day = parseInt(claudeDateMatch[2], 10);
    const timeStr = claudeDateMatch[3];
    const ampm = claudeDateMatch[4];
    const [h, m] = timeStr.split(':');
    const normalizedTime = `${h}:${m || '00'}`;
    const year = new Date().getFullYear();
    const dateString = `${month} ${day}, ${year} ${normalizedTime} ${ampm || ''}`;
    const ts = Date.parse(dateString);
    if (!isNaN(ts)) return ts;
  }

  // Generic: "resets at 2pm"
  const timeResetsMatch = cleanMsg.match(
    /resets(?:\s+at)?\s+(\d{1,2}(?::\d{2})?)\s*(am|pm)?/i,
  );
  if (timeResetsMatch) {
    return parseTime(timeResetsMatch[1], timeResetsMatch[2]);
  }

  // Default 15m
  return now + 15 * 60_000;
}

describe('parseCooldownUntil', () => {
  it('parses relative seconds: "try again in 20s"', () => {
    const before = Date.now();
    const result = parseCooldownUntil('Rate limited, try again in 20s');
    expect(result).toBeGreaterThanOrEqual(before + 19_000);
    expect(result).toBeLessThanOrEqual(before + 21_000);
  });

  it('parses relative minutes: "retry in 5 minutes"', () => {
    const before = Date.now();
    const result = parseCooldownUntil('retry in 5 minutes');
    expect(result).toBeGreaterThanOrEqual(before + 4 * 60_000);
    expect(result).toBeLessThanOrEqual(before + 6 * 60_000);
  });

  it('parses relative hours: "try again in 2h"', () => {
    const before = Date.now();
    const result = parseCooldownUntil('try again in 2h');
    expect(result).toBeGreaterThanOrEqual(before + 1.9 * 3_600_000);
    expect(result).toBeLessThanOrEqual(before + 2.1 * 3_600_000);
  });

  it('parses Gemini "reset after" format', () => {
    const before = Date.now();
    const result = parseCooldownUntil('Your quota will reset after 4h58m24s.');
    const expected = 4 * 3600000 + 58 * 60000 + 24 * 1000;
    expect(result).toBeGreaterThanOrEqual(before + expected - 1000);
    expect(result).toBeLessThanOrEqual(before + expected + 1000);
  });

  it('parses Codex "resets on" format', () => {
    const result = parseCooldownUntil(
      "Access resets on Feb 24th, 2026 5:28 PM.",
    );
    const expected = new Date('Feb 24, 2026 5:28 PM').getTime();
    expect(result).toBe(expected);
  });

  it('parses Claude "resets [Month] [Day], [Time]" format', () => {
    const result = parseCooldownUntil("resets Feb 23, 3pm (Europe/Istanbul)");
    const expected = new Date(`Feb 23, ${new Date().getFullYear()} 3:00 pm`).getTime();
    expect(result).toBe(expected);
  });

  it('parses generic "resets at 4:16 PM" format', () => {
    const result = parseCooldownUntil('Gemini limit: Access resets at 4:16 PM GMT+3.');
    const target = new Date();
    target.setHours(16, 16, 0, 0);
    if (target.getTime() <= Date.now() - 60000) {
      target.setDate(target.getDate() + 1);
    }
    expect(result).toBe(target.getTime());
  });

  it('falls back to 15 minutes for unknown formats', () => {
    const before = Date.now();
    const result = parseCooldownUntil('Something went wrong');
    expect(result).toBeGreaterThanOrEqual(before + 14 * 60_000);
    expect(result).toBeLessThanOrEqual(before + 16 * 60_000);
  });

  it('strips ANSI codes before parsing', () => {
    const before = Date.now();
    const result = parseCooldownUntil('\u001b[31mtry again in 30s\u001b[0m');
    expect(result).toBeGreaterThanOrEqual(before + 29_000);
    expect(result).toBeLessThanOrEqual(before + 31_000);
  });
});

/**
 * Tests for AI provider cooldown service, including CLI limit message parsing.
 */

import {
  parseCliLimitMessage,
  isCliLimitError,
  setCooldownUntil,
  isInCooldown,
  setCooldownsBasePath,
  resetCooldowns,
} from '../src/services/aiProviderCooldown.js';
import path from 'node:path';

describe('aiProviderCooldown', () => {
  const testDir = path.join(process.cwd(), 'test-cooldown-output');

  beforeAll(() => {
    setCooldownsBasePath(testDir);
  });

  afterAll(() => {
    resetCooldowns();
  });

  describe('parseCliLimitMessage', () => {
    it('parses Codex-style "resets on" message', () => {
      // Use a date far in the future to avoid test expiry
      const msg = "Codex: You've hit your usage limit. Access resets on Dec 24th, 2030 5:28 PM.";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      expect(until).toBeGreaterThan(Date.now());
      const d = new Date(until!);
      expect(d.getFullYear()).toBe(2030);
      expect(d.getMonth()).toBe(11); // Dec = 11
      expect(d.getDate()).toBe(24);
    });

    it('parses Gemini-style "resets at" message', () => {
      const msg = 'Gemini limit: Access resets at 4:16 PM GMT+3.';
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
    });

    it('parses relative "try again in 5 minutes"', () => {
      const msg = 'Rate limit exceeded. Try again in 5 minutes.';
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const diff = until! - Date.now();
      expect(diff).toBeGreaterThanOrEqual(4 * 60 * 1000);
      expect(diff).toBeLessThanOrEqual(6 * 60 * 1000);
    });

    it('parses Claude CLI "hit your limit · resets" message', () => {
      const msg = "You've hit your limit · resets 4pm (Asia/Kuala_Lumpur)";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      expect(until).toBeGreaterThan(Date.now());
    });

    it('parses Claude "resets 3pm (Europe/Istanbul)" format', () => {
      const msg = "You've hit your limit · resets 3pm (Europe/Istanbul)";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      expect(until).toBeGreaterThan(Date.now());
      const d = new Date(until!);
      expect(d.getHours()).toBe(15); // 3pm = 15
    });

    it('parses bare "resets 4:30 PM" (Claude CLI stderr)', () => {
      const msg = 'Rate limit. Resets 4:30 PM';
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
    });

    it('parses Claude "resets Feb 23, 3pm (Europe/Istanbul)" format', () => {
      const msg = "You've hit your limit · resets Feb 23, 3pm (Europe/Istanbul)";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const d = new Date(until!);
      expect(d.getMonth()).toBe(1);
      expect(d.getDate()).toBe(23);
    });

    it('parses Claude "resets Feb 20 at 12am (America/New_York)" format', () => {
      const msg = "You've hit your limit · resets Feb 20 at 12am (America/New_York)";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const d = new Date(until!);
      expect(d.getMonth()).toBe(1);
      expect(d.getDate()).toBe(20);
      expect(d.getHours()).toBe(0);
    });

    it('parses Claude "resets Feb 20, 5pm (Africa/Libreville)" format', () => {
      const msg = "You've hit your limit · resets Feb 20, 5pm (Africa/Libreville)";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const d = new Date(until!);
      expect(d.getMonth()).toBe(1);
      expect(d.getDate()).toBe(20);
      expect(d.getHours()).toBe(17);
    });

    it('parses Gemini "reset after 4h58m24s" format', () => {
      const msg = 'Your quota will reset after 4h58m24s';
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const diff = until! - Date.now();
      expect(diff).toBeGreaterThan(4 * 3600 * 1000);
      expect(diff).toBeLessThan(6 * 3600 * 1000);
    });

    it('parses Claude "resets in 2 hours" format', () => {
      const msg = "You've hit your limit · resets in 2 hours";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const diff = until! - Date.now();
      expect(diff).toBeGreaterThan(1.9 * 3600 * 1000);
      expect(diff).toBeLessThan(2.1 * 3600 * 1000);
    });

    it('parses Claude "resets February 23, 3pm" full month format', () => {
      const msg = "You've hit your limit · resets February 23, 3pm (Europe/Istanbul)";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const d = new Date(until!);
      expect(d.getMonth()).toBe(1);
      expect(d.getDate()).toBe(23);
      expect(d.getHours()).toBe(15);
    });

    it('parses Claude 24h "resets 15:00" format', () => {
      const msg = 'Limit reached. Resets 15:00 (Europe/Istanbul)';
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const d = new Date(until!);
      expect(d.getHours()).toBe(15);
      expect(d.getMinutes()).toBe(0);
    });

    it('parses Claude "Resets: 3pm" colon format', () => {
      const msg = "You've hit your limit. Resets: 3pm (Europe/Istanbul)";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const d = new Date(until!);
      expect(d.getHours()).toBe(15);
    });

    it('prefers explicit "resets 3pm" over "try again in 15 minutes"', () => {
      const msg = "You've hit your limit · resets 3pm (Europe/Istanbul). Try again in 15 minutes.";
      const until = parseCliLimitMessage(msg);
      expect(until).not.toBeNull();
      const d = new Date(until!);
      expect(d.getHours()).toBe(15);
      expect(until).toBeGreaterThan(Date.now());
    });

    it('returns null for non-limit messages', () => {
      expect(parseCliLimitMessage('Hello world')).toBeNull();
      expect(parseCliLimitMessage('')).toBeNull();
    });
  });

  describe('isCliLimitError', () => {
    it('detects limit-related errors', () => {
      expect(isCliLimitError("You've hit your usage limit")).toBe(true);
      expect(isCliLimitError('Access resets at 4:16 PM')).toBe(true);
      expect(isCliLimitError('rate limit exceeded')).toBe(true);
      expect(isCliLimitError('Try again in 5 minutes')).toBe(true);
      expect(isCliLimitError('No capacity available for model gemini-3-pro-preview')).toBe(true);
      expect(isCliLimitError('status 429 RESOURCE_EXHAUSTED')).toBe(true);
      expect(isCliLimitError('Your quota will reset after 4h58m24s')).toBe(true);
    });

    it('rejects non-limit errors', () => {
      expect(isCliLimitError('Connection refused')).toBe(false);
      expect(isCliLimitError('Invalid API key')).toBe(false);
    });

    it('detects API rate_limit_error and overloaded_error', () => {
      expect(isCliLimitError('rate_limit_error')).toBe(true);
      expect(isCliLimitError('overloaded_error')).toBe(true);
      expect(isCliLimitError('overloaded')).toBe(true);
    });
  });

  describe('setCooldownUntil and isInCooldown', () => {
    it('sets cooldown and respects it', () => {
      resetCooldowns();
      const until = Date.now() + 60_000; // 1 min from now
      setCooldownUntil('codex', until);
      expect(isInCooldown('codex')).toBe(true);
    });

    it('skips providers in cooldown', () => {
      resetCooldowns();
      expect(isInCooldown('codex')).toBe(false);
    });
  });
});

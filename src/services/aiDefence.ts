import { performance } from 'node:perf_hooks';

export type ThreatType = 'prompt_injection' | 'pii' | 'jailbreak' | 'command_injection' | 'path_traversal';
export type Severity = 'low' | 'medium' | 'high' | 'critical';

export interface Threat {
  type: ThreatType;
  severity: Severity;
  description: string;
  match?: string;
}

export interface ThreatScanResult {
  safe: boolean;
  threats: Threat[];
  scanTimeMs: number;
}

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules)/i,
  /you\s+are\s+now/i,
  /system\s*:/i,
  /OVERRIDE/,
  /forget\s+(everything|all|your)/i,
];

const PII_PATTERNS: Record<string, RegExp> = {
  EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  PHONE_TR: /(?:\+90\s?|0)5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g,
  PHONE_INTL: /\b(\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  TC_KIMLIK: /\b[1-9]\d{10}\b/g,
  CREDIT_CARD: /\b[45]\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
  IBAN: /\bTR\d{2}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{2}\b/g,
};

const JAILBREAK_KEYWORDS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /do anything now/i, weight: 0.3 },
  { pattern: /\bDAN\b/, weight: 0.3 },
  { pattern: /ignore all restrictions/i, weight: 0.25 },
  { pattern: /bypass safety/i, weight: 0.25 },
  { pattern: /pretend you/i, weight: 0.15 },
  { pattern: /act as/i, weight: 0.1 },
];

const COMMAND_INJECTION_PATTERN = /[;|&`$]|\$\(/;
const PATH_TRAVERSAL_PATTERN = /\.\.\//;

export class AIDefence {
  scan(input: string): ThreatScanResult {
    const start = performance.now();
    const threats: Threat[] = [];

    for (const pat of INJECTION_PATTERNS) {
      const match = input.match(pat);
      if (match) {
        threats.push({
          type: 'prompt_injection',
          severity: 'critical',
          description: 'Prompt injection detected',
          match: match[0],
        });
        break;
      }
    }

    for (const [type, regex] of Object.entries(PII_PATTERNS)) {
      const re = new RegExp(regex.source, regex.flags);
      const match = input.match(re);
      if (match) {
        threats.push({
          type: 'pii',
          severity: 'high',
          description: `PII detected: ${type}`,
          match: match[0],
        });
      }
    }

    const jailbreakScore = this.detectJailbreak(input);
    if (jailbreakScore > 0.3) {
      threats.push({
        type: 'jailbreak',
        severity: jailbreakScore > 0.5 ? 'high' : 'medium',
        description: `Jailbreak attempt (score: ${jailbreakScore.toFixed(2)})`,
      });
    }

    if (COMMAND_INJECTION_PATTERN.test(input)) {
      threats.push({
        type: 'command_injection',
        severity: 'critical',
        description: 'Command injection characters detected',
      });
    }

    if (PATH_TRAVERSAL_PATTERN.test(input)) {
      threats.push({
        type: 'path_traversal',
        severity: 'high',
        description: 'Path traversal pattern detected',
      });
    }

    const scanTimeMs = performance.now() - start;

    return {
      safe: threats.length === 0,
      threats,
      scanTimeMs,
    };
  }

  hasPii(text: string): boolean {
    for (const regex of Object.values(PII_PATTERNS)) {
      const re = new RegExp(regex.source, regex.flags);
      if (re.test(text)) {
        return true;
      }
    }
    return false;
  }

  redactPii(text: string): string {
    let result = text;
    result = result.replace(new RegExp(PII_PATTERNS.IBAN.source, PII_PATTERNS.IBAN.flags), '[IBAN]');
    result = result.replace(new RegExp(PII_PATTERNS.CREDIT_CARD.source, PII_PATTERNS.CREDIT_CARD.flags), '[CREDIT_CARD]');
    result = result.replace(new RegExp(PII_PATTERNS.EMAIL.source, PII_PATTERNS.EMAIL.flags), '[EMAIL]');
    result = result.replace(new RegExp(PII_PATTERNS.PHONE_TR.source, PII_PATTERNS.PHONE_TR.flags), '[PHONE]');
    result = result.replace(new RegExp(PII_PATTERNS.PHONE_INTL.source, PII_PATTERNS.PHONE_INTL.flags), '[PHONE]');
    result = result.replace(new RegExp(PII_PATTERNS.TC_KIMLIK.source, PII_PATTERNS.TC_KIMLIK.flags), '[TC_KIMLIK]');
    return result;
  }

  detectInjection(prompt: string): boolean {
    return INJECTION_PATTERNS.some((pat) => pat.test(prompt));
  }

  detectJailbreak(prompt: string): number {
    let score = 0;
    for (const { pattern, weight } of JAILBREAK_KEYWORDS) {
      if (pattern.test(prompt)) {
        score += weight;
      }
    }
    return Math.min(score, 1);
  }
}

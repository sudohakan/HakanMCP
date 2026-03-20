import crypto from 'node:crypto';

export interface PolicyRule {
  id: string;
  category: 'destructive' | 'tool_allowlist' | 'diff_limit' | 'secrets';
  condition: string;
  action: 'block' | 'warn' | 'allow';
  priority: number;
}

export interface AuditEntry {
  timestamp: number;
  ruleId: string;
  action: string;
  result: 'allowed' | 'blocked' | 'warned';
  context: Record<string, unknown>;
  hash: string;
}

export interface EnforceResult {
  allowed: boolean;
  reason?: string;
  ruleId?: string;
}

const HMAC_KEY = 'hakanmcp-guidance';

const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /rm\s+-rf/i, label: 'rm -rf' },
  { pattern: /git\s+push\s+--force/i, label: 'git push --force' },
  { pattern: /git\s+reset\s+--hard/i, label: 'git reset --hard' },
  { pattern: /DROP\s+TABLE/i, label: 'DROP TABLE' },
  { pattern: /DROP\s+DATABASE/i, label: 'DROP DATABASE' },
  { pattern: /format\s+drive/i, label: 'format drive' },
  { pattern: /\bmkfs\b/i, label: 'mkfs' },
];

const SECRET_PATTERNS: RegExp[] = [
  /\.env/i,
  /api_key/i,
  /\bsecret\b/i,
  /\bpassword\b/i,
  /\btoken\b/i,
];

const POLICY_KEYWORDS: Array<{ pattern: RegExp; category: PolicyRule['category']; action: PolicyRule['action']; priority: number }> = [
  { pattern: /\brm\b/i, category: 'destructive', action: 'block', priority: 100 },
  { pattern: /\bforce\b/i, category: 'destructive', action: 'block', priority: 100 },
  { pattern: /\bdrop\b/i, category: 'destructive', action: 'block', priority: 100 },
  { pattern: /\bdelete\b/i, category: 'destructive', action: 'warn', priority: 80 },
  { pattern: /\.env/i, category: 'secrets', action: 'block', priority: 90 },
  { pattern: /api_key/i, category: 'secrets', action: 'block', priority: 90 },
  { pattern: /\bsecret\b/i, category: 'secrets', action: 'block', priority: 90 },
  { pattern: /\bpassword\b/i, category: 'secrets', action: 'block', priority: 90 },
  { pattern: /\btoken\b/i, category: 'secrets', action: 'warn', priority: 70 },
];

export class GuidanceEngine {
  private rules: PolicyRule[] = [];
  private auditTrail: AuditEntry[] = [];
  private lastHash: string = '0';

  compilePolicy(content: string): PolicyRule[] {
    const rules: PolicyRule[] = [];

    for (const dp of DESTRUCTIVE_PATTERNS) {
      rules.push({
        id: crypto.randomUUID(),
        category: 'destructive',
        condition: dp.label,
        action: 'block',
        priority: 100,
      });
    }

    for (const kw of POLICY_KEYWORDS) {
      if (kw.pattern.test(content)) {
        rules.push({
          id: crypto.randomUUID(),
          category: kw.category,
          condition: kw.pattern.source,
          action: kw.action,
          priority: kw.priority,
        });
      }
    }

    this.rules = rules;
    return rules;
  }

  enforce(action: string, context: Record<string, unknown> = {}): EnforceResult {
    for (const dp of DESTRUCTIVE_PATTERNS) {
      if (dp.pattern.test(action)) {
        const ruleId = this.rules.find((r) => r.condition === dp.label)?.id ?? 'builtin-destructive';
        const entry = this.recordAudit(ruleId, action, 'blocked', context);
        return {
          allowed: false,
          reason: `Destructive action blocked: ${dp.label}`,
          ruleId: entry.ruleId,
        };
      }
    }

    const files = context.files;
    if (Array.isArray(files)) {
      for (const file of files) {
        if (typeof file === 'string') {
          for (const sp of SECRET_PATTERNS) {
            if (sp.test(file)) {
              const ruleId = this.rules.find((r) => r.category === 'secrets')?.id ?? 'builtin-secrets';
              const entry = this.recordAudit(ruleId, action, 'blocked', context);
              return {
                allowed: false,
                reason: `Secret file access blocked: ${file}`,
                ruleId: entry.ruleId,
              };
            }
          }
        }
      }
    }

    this.recordAudit('none', action, 'allowed', context);
    return { allowed: true };
  }

  getActiveRules(): PolicyRule[] {
    return [...this.rules];
  }

  getAuditTrail(): AuditEntry[] {
    return [...this.auditTrail];
  }

  private recordAudit(
    ruleId: string,
    action: string,
    result: AuditEntry['result'],
    context: Record<string, unknown>,
  ): AuditEntry {
    const timestamp = Date.now();
    const data = `${this.lastHash}${timestamp}${result}`;
    const hash = crypto.createHmac('sha256', HMAC_KEY).update(data).digest('hex');

    const entry: AuditEntry = {
      timestamp,
      ruleId,
      action,
      result,
      context,
      hash,
    };

    this.auditTrail.push(entry);
    this.lastHash = hash;
    return entry;
  }
}

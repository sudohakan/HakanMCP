/**
 * SessionTracker — accumulates session events for structured journal entries.
 *
 * Lives for the duration of a chat session. Collects file changes, decisions,
 * errors, and milestones. Provides context for AI-generated journal entries.
 */

export interface SessionEvent {
  type: 'file_change' | 'decision' | 'error' | 'milestone' | 'message';
  detail: string;
  timestamp: string;
}

export interface SessionContext {
  filesChanged: string[];
  decisions: string[];
  errors: Array<{ error: string; resolution?: string }>;
  milestones: string[];
  messageCount: number;
  errorCount: number;
  language: string;
  startTime: string;
}

export class SessionTracker {
  private events: SessionEvent[] = [];
  private _language = 'en';
  private _startTime: string;
  private _lastCheckpointAt = 0;

  constructor() {
    this._startTime = new Date().toISOString();
  }

  trackFileChange(file: string): void {
    this.addEvent('file_change', file);
  }

  trackDecision(decision: string): void {
    this.addEvent('decision', decision);
  }

  trackError(error: string, resolution?: string): void {
    this.addEvent('error', resolution ? `${error} → ${resolution}` : error);
  }

  trackMilestone(name: string): void {
    this.addEvent('milestone', name);
  }

  trackMessage(): void {
    this.addEvent('message', '');
  }

  setLanguage(lang: string): void {
    this._language = lang;
  }

  /** Auto-detect language from user text (simple heuristic) */
  detectLanguage(text: string): void {
    if (/[çğıöşüÇĞİÖŞÜ]/.test(text)) {
      this._language = 'tr';
    } else if (this._language === 'en') {
      this._language = 'en';
    }
  }

  /**
   * Check if activity checkpoint should fire.
   * Returns true every 25 messages since last checkpoint (or session start).
   */
  shouldCheckpoint(): boolean {
    const msgCount = this.events.filter((e) => e.type === 'message').length;
    if (msgCount > 0 && msgCount % 25 === 0 && msgCount !== this._lastCheckpointAt) {
      this._lastCheckpointAt = msgCount;
      return true;
    }
    return false;
  }

  getContext(): SessionContext {
    const filesChanged = [...new Set(
      this.events.filter((e) => e.type === 'file_change').map((e) => e.detail)
    )];
    const decisions = this.events
      .filter((e) => e.type === 'decision')
      .map((e) => e.detail);
    const errors = this.events
      .filter((e) => e.type === 'error')
      .map((e) => {
        const parts = e.detail.split(' → ');
        return { error: parts[0], resolution: parts[1] };
      });
    const milestones = this.events
      .filter((e) => e.type === 'milestone')
      .map((e) => e.detail);
    const messageCount = this.events.filter((e) => e.type === 'message').length;

    return {
      filesChanged,
      decisions,
      errors,
      milestones,
      messageCount,
      errorCount: errors.length,
      language: this._language,
      startTime: this._startTime,
    };
  }

  reset(): void {
    this.events = [];
    this._language = 'en';
    this._startTime = new Date().toISOString();
    this._lastCheckpointAt = 0;
  }

  private addEvent(type: SessionEvent['type'], detail: string): void {
    this.events.push({ type, detail, timestamp: new Date().toISOString() });
  }
}

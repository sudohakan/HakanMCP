import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { PROJECT_ROOT } from '../utils/projectRoot.js';

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp: string;
  provider?: string;
}

export class ConversationManager {
  private messages: ConversationMessage[] = [];
  private storagePath: string;
  private maxMessages: number;
  private persistOnEveryMessage: boolean;

  constructor() {
    const convConfig = (config as Record<string, unknown>).conversations as
      | { storagePath?: string; maxMessages?: number; persistOnEveryMessage?: boolean }
      | undefined;
    const baseDir = convConfig?.storagePath || path.join(PROJECT_ROOT, '.hakanmcp', 'conversations');
    this.storagePath = path.isAbsolute(baseDir) ? path.join(baseDir, 'default.json') : path.join(PROJECT_ROOT, baseDir, 'default.json');
    this.maxMessages = convConfig?.maxMessages || 100;
    this.persistOnEveryMessage = convConfig?.persistOnEveryMessage || false;
  }

  addMessage(msg: Omit<ConversationMessage, 'timestamp'>): void {
    const fullMsg: ConversationMessage = {
      ...msg,
      timestamp: new Date().toISOString(),
    };
    this.messages.push(fullMsg);

    if (this.messages.length > this.maxMessages) {
      this.messages = this.messages.slice(-this.maxMessages);
    }

    if (this.persistOnEveryMessage) {
      this.saveToDisk();
    }
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  /** Return messages in ChatMessage format (role + content only) for provider calls */
  getChatMessages(): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    return this.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  getMessageCount(): number {
    return this.messages.length;
  }

  clear(): void {
    this.messages = [];
    this.saveToDisk();
  }

  saveToDisk(): void {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(this.messages, null, 2), 'utf8');
    } catch (error: unknown) {
      logger.warn('Failed to save conversation history', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  loadFromDisk(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf8');
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) {
          this.messages = parsed.slice(-this.maxMessages);
          logger.info('Conversation history loaded', { messageCount: this.messages.length });
        }
      }
    } catch (error: unknown) {
      logger.warn('Failed to load conversation history', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  shutdown(): void {
    this.saveToDisk();
  }
}

export const conversationManager = new ConversationManager();

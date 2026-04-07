/**
 * Typed EventBus singleton wrapping node:events EventEmitter.
 * Provides type-safe emit/on/off/once for reactive mode cross-mode communication.
 */

import { EventEmitter } from 'node:events';
import type { EventMap } from './types.js';

type EventHandler<T> = (payload: T) => void;

export class EventBus {
  private emitter: EventEmitter;

  constructor() {
    this.emitter = new EventEmitter();
    this.emitter.setMaxListeners(50);
  }

  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): this {
    this.emitter.on(event as string, handler as (...args: unknown[]) => void);
    return this;
  }

  once<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): this {
    this.emitter.once(event as string, handler as (...args: unknown[]) => void);
    return this;
  }

  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): this {
    this.emitter.off(event as string, handler as (...args: unknown[]) => void);
    return this;
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): boolean {
    return this.emitter.emit(event as string, payload);
  }

  removeAllListeners(): this {
    this.emitter.removeAllListeners();
    return this;
  }
}

/** Module-scoped singleton */
let _instance: EventBus | null = null;

/** Get or create the EventBus singleton */
export function getEventBus(): EventBus {
  if (!_instance) {
    _instance = new EventBus();
  }
  return _instance;
}

/** Reset the singleton — removes all listeners and destroys the instance */
export function resetEventBus(): void {
  if (_instance) {
    _instance.removeAllListeners();
    _instance = null;
  }
}

import { randomUUID } from 'node:crypto';
import type { ServerEvent, ServerEventType } from '../modules/event/types.js';

export class EventBus {
  private readonly events: ServerEvent[] = [];

  emit<T>(type: ServerEventType, payload: T): ServerEvent<T> {
    const event: ServerEvent<T> = {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      payload
    };
    this.events.push(event);
    return event;
  }

  recent(limit = 50): ServerEvent[] {
    return this.events.slice(-limit);
  }
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export type NotificationKind = 'agent' | 'device' | 'provider' | 'chat' | 'file' | 'system' | 'warning';
export type NotificationTone = 'blue' | 'green' | 'purple' | 'orange' | 'red' | 'gray' | 'pink';

export interface ReikaNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  source: string;
  tone: NotificationTone;
  unread: boolean;
  createdAt: string;
  readAt?: string;
  data?: Record<string, unknown>;
}

interface PersistedNotificationStore {
  version: 1;
  updatedAt: string;
  notifications: ReikaNotification[];
}

export interface NotificationStoreSnapshot {
  path: string;
  loaded: boolean;
  count: number;
  unreadCount: number;
  lastSavedAt?: string;
  lastError?: string;
}

const defaultStorePath = join(homedir(), '.local', 'share', 'project-reika', 'notifications.json');

function storagePath() {
  return process.env.REIKA_NOTIFICATION_STORE_PATH || defaultStorePath;
}

function isNotification(value: unknown): value is ReikaNotification {
  const maybe = value as Partial<ReikaNotification>;
  return Boolean(
    maybe &&
    typeof maybe.id === 'string' &&
    typeof maybe.kind === 'string' &&
    typeof maybe.title === 'string' &&
    typeof maybe.body === 'string' &&
    typeof maybe.source === 'string' &&
    typeof maybe.createdAt === 'string'
  );
}

export class NotificationStore {
  private readonly path = storagePath();
  private readonly notifications = new Map<string, ReikaNotification>();
  private loaded = false;
  private lastSavedAt?: string;
  private lastError?: string;
  private saveQueue: Promise<void> = Promise.resolve();

  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<PersistedNotificationStore>;
      this.notifications.clear();
      for (const notification of parsed.notifications || []) {
        if (isNotification(notification)) this.notifications.set(notification.id, notification);
      }
      this.loaded = true;
      this.lastError = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.loaded = true;
        this.lastError = undefined;
        return;
      }
      this.loaded = false;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  snapshot(): NotificationStoreSnapshot {
    const list = this.list();
    return {
      path: this.path,
      loaded: this.loaded,
      count: list.length,
      unreadCount: list.filter((item) => item.unread).length,
      lastSavedAt: this.lastSavedAt,
      lastError: this.lastError
    };
  }

  list(input: { unreadOnly?: boolean; limit?: number } = {}) {
    const sorted = Array.from(this.notifications.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const filtered = input.unreadOnly ? sorted.filter((item) => item.unread) : sorted;
    return filtered.slice(0, input.limit ?? 100);
  }

  add(input: {
    kind: NotificationKind;
    title: string;
    body: string;
    source?: string;
    tone?: NotificationTone;
    data?: Record<string, unknown>;
  }) {
    const notification: ReikaNotification = {
      id: randomUUID(),
      kind: input.kind,
      title: input.title,
      body: input.body,
      source: input.source || 'Project Reika',
      tone: input.tone || 'blue',
      unread: true,
      createdAt: new Date().toISOString(),
      data: input.data
    };
    this.notifications.set(notification.id, notification);
    this.trim();
    this.queueSave();
    return notification;
  }

  markRead(id: string) {
    const notification = this.notifications.get(id);
    if (!notification) return undefined;
    if (!notification.unread) return notification;
    const next = { ...notification, unread: false, readAt: new Date().toISOString() };
    this.notifications.set(id, next);
    this.queueSave();
    return next;
  }

  markAllRead() {
    const now = new Date().toISOString();
    let changed = 0;
    for (const notification of this.notifications.values()) {
      if (!notification.unread) continue;
      this.notifications.set(notification.id, { ...notification, unread: false, readAt: now });
      changed += 1;
    }
    if (changed > 0) this.queueSave();
    return changed;
  }

  delete(id: string) {
    const deleted = this.notifications.delete(id);
    if (deleted) this.queueSave();
    return deleted;
  }

  async flush() {
    await this.saveQueue;
  }

  private trim() {
    const keep = this.list({ limit: 200 });
    this.notifications.clear();
    for (const notification of keep) this.notifications.set(notification.id, notification);
  }

  private queueSave() {
    this.saveQueue = this.saveQueue.then(() => this.save()).catch((error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(`Failed to save Project Reika notifications: ${this.lastError}`);
    });
  }

  private async save() {
    const now = new Date().toISOString();
    const payload: PersistedNotificationStore = {
      version: 1,
      updatedAt: now,
      notifications: this.list({ limit: 200 })
    };
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tmp, this.path);
    this.lastSavedAt = now;
    this.lastError = undefined;
  }
}

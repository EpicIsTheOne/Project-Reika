import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  meta?: Record<string, unknown>;
}

export interface ChatSessionRecord {
  id: string;
  providerId: string;
  agent: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessageRecord[];
  metadata: Record<string, unknown>;
}

interface PersistedSessionStore {
  version: 1;
  updatedAt: string;
  sessions: ChatSessionRecord[];
}

export interface SessionStoreSnapshot {
  path: string;
  loaded: boolean;
  sessionCount: number;
  lastSavedAt?: string;
  lastError?: string;
}

const defaultStorePath = join(homedir(), '.local', 'share', 'project-reika', 'sessions.json');

function storagePath() {
  return process.env.REIKA_SESSION_STORE_PATH || defaultStorePath;
}

function isSessionRecord(value: unknown): value is ChatSessionRecord {
  const maybe = value as Partial<ChatSessionRecord>;
  return Boolean(
    maybe &&
    typeof maybe.id === 'string' &&
    typeof maybe.providerId === 'string' &&
    typeof maybe.agent === 'string' &&
    typeof maybe.title === 'string' &&
    typeof maybe.createdAt === 'string' &&
    typeof maybe.updatedAt === 'string' &&
    Array.isArray(maybe.messages) &&
    typeof maybe.metadata === 'object' &&
    maybe.metadata !== null
  );
}

export class SessionStore {
  private readonly path = storagePath();
  private readonly sessions = new Map<string, ChatSessionRecord>();
  private loaded = false;
  private lastSavedAt?: string;
  private lastError?: string;
  private saveQueue: Promise<void> = Promise.resolve();

  async load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as Partial<PersistedSessionStore>;
      this.sessions.clear();
      for (const session of parsed.sessions || []) {
        if (isSessionRecord(session)) this.sessions.set(session.id, session);
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

  snapshot(): SessionStoreSnapshot {
    return {
      path: this.path,
      loaded: this.loaded,
      sessionCount: this.sessions.size,
      lastSavedAt: this.lastSavedAt,
      lastError: this.lastError
    };
  }

  list() {
    return Array.from(this.sessions.values());
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  set(session: ChatSessionRecord) {
    this.sessions.set(session.id, session);
    this.queueSave();
  }

  touch(session: ChatSessionRecord) {
    this.sessions.set(session.id, session);
    this.queueSave();
  }

  async flush() {
    await this.saveQueue;
  }

  private queueSave() {
    this.saveQueue = this.saveQueue.then(() => this.save()).catch((error) => {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error(`Failed to save Project Reika sessions: ${this.lastError}`);
    });
  }

  private async save() {
    const now = new Date().toISOString();
    const payload: PersistedSessionStore = {
      version: 1,
      updatedAt: now,
      sessions: this.list().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    };
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tmp, this.path);
    this.lastSavedAt = now;
    this.lastError = undefined;
  }
}

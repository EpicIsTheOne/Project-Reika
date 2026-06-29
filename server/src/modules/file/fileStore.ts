import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ChatFileRecord {
  id: string;
  kind: 'file' | 'link';
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  path: string;
  ext: string;
  sourceUrl?: string;
  notes?: string;
}

export interface PublicChatFileRecord {
  id: string;
  kind: 'file' | 'link';
  name: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: number;
  sourceUrl?: string;
  notes?: string;
}

interface FileStoreSnapshot {
  items: ChatFileRecord[];
}

function defaultDataDir() {
  return process.env.XDG_DATA_HOME || `${process.env.HOME || process.cwd()}/.local/share`;
}

function safeName(value: string) {
  const cleaned = basename(value || 'upload').replace(/[^a-zA-Z0-9._ -]+/g, '_').trim();
  return cleaned || 'upload';
}

export function publicFile(item: ChatFileRecord): PublicChatFileRecord {
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    originalName: item.originalName,
    mimeType: item.mimeType,
    size: item.size,
    createdAt: item.createdAt,
    sourceUrl: item.sourceUrl,
    notes: item.notes
  };
}

export class FileStore {
  readonly dir = process.env.REIKA_FILE_STORE_DIR || join(defaultDataDir(), 'project-reika', 'files');
  readonly manifestPath = process.env.REIKA_FILE_MANIFEST_PATH || join(this.dir, 'manifest.json');
  private items = new Map<string, ChatFileRecord>();
  private loaded = false;

  async load() {
    await mkdir(this.dir, { recursive: true });
    try {
      const raw = await readFile(this.manifestPath, 'utf8');
      const parsed = JSON.parse(raw.replace(/^\uFEFF/, '')) as FileStoreSnapshot;
      this.items = new Map((Array.isArray(parsed.items) ? parsed.items : []).filter((item) => item && item.id).map((item) => [item.id, item]));
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT') throw error;
      this.items = new Map();
    }
    this.loaded = true;
  }

  snapshot() {
    return { path: this.manifestPath, dir: this.dir, loaded: this.loaded, count: this.items.size };
  }

  list() {
    return [...this.items.values()].sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  get(id: string) {
    return this.items.get(id);
  }

  resolve(ids: unknown) {
    const requested = Array.isArray(ids) ? ids.map(String) : [];
    return requested.map((id) => this.items.get(id)).filter(Boolean) as ChatFileRecord[];
  }

  async link(input: { url: string; name?: string; notes?: string }) {
    const now = Date.now();
    const name = safeName(input.name || input.url).slice(0, 180);
    const item: ChatFileRecord = {
      id: randomUUID(),
      kind: 'link',
      name,
      originalName: name,
      mimeType: 'text/uri-list',
      size: 0,
      createdAt: now,
      path: '',
      ext: '',
      sourceUrl: input.url,
      notes: input.notes || ''
    };
    this.items.set(item.id, item);
    await this.save();
    return item;
  }

  async upload(input: { name: string; buffer: Buffer; mimeType?: string }) {
    await mkdir(this.dir, { recursive: true });
    const now = Date.now();
    const id = randomUUID();
    const originalName = safeName(input.name || `upload-${id}`);
    const ext = extname(originalName);
    const savedPath = join(this.dir, `${id}${ext}`);
    await writeFile(savedPath, input.buffer);
    const item: ChatFileRecord = {
      id,
      kind: 'file',
      name: originalName,
      originalName,
      mimeType: input.mimeType || 'application/octet-stream',
      size: input.buffer.length,
      createdAt: now,
      path: savedPath,
      ext
    };
    this.items.set(item.id, item);
    await this.save();
    return item;
  }

  stream(item: ChatFileRecord) {
    return createReadStream(item.path);
  }

  private async save() {
    await mkdir(this.dir, { recursive: true });
    const tmp = `${this.manifestPath}.tmp`;
    await writeFile(tmp, JSON.stringify({ items: this.list() }, null, 2));
    await rename(tmp, this.manifestPath);
  }
}

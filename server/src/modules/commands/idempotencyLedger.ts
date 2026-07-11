import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AgentHubEnvelope } from '../../shared/protocol/envelope.js';
import type { DeliveryState } from '../../shared/protocol/messages.js';

export interface IdempotencyRecord {
  key: string;
  requestId: string;
  deviceId: string;
  sessionId: string;
  state: DeliveryState;
  legacy: boolean;
  createdAt: string;
  updatedAt: string;
  responses?: AgentHubEnvelope[];
  error?: string;
}

interface PersistedLedger {
  version: 1;
  updatedAt: string;
  records: IdempotencyRecord[];
}

const defaultPath = join(homedir(), '.local', 'share', 'project-reika', 'idempotency-ledger.json');

export class IdempotencyLedger {
  private readonly path = process.env.REIKA_IDEMPOTENCY_STORE_PATH || defaultPath;
  private readonly records = new Map<string, IdempotencyRecord>();
  private readonly maxRecords = Math.max(100, Number(process.env.REIKA_IDEMPOTENCY_MAX_RECORDS || 10_000));

  constructor() {
    this.load();
  }

  scopeKey(requestId: string, deviceId: string, sessionId = '') {
    return [deviceId.trim(), sessionId.trim(), requestId.trim()].join('::');
  }

  get(requestId: string, deviceId: string, sessionId = '') {
    return this.records.get(this.scopeKey(requestId, deviceId, sessionId));
  }

  begin(requestId: string, deviceId: string, sessionId: string, legacy: boolean) {
    const now = new Date().toISOString();
    const record: IdempotencyRecord = {
      key: this.scopeKey(requestId, deviceId, sessionId),
      requestId,
      deviceId,
      sessionId,
      state: 'delivered',
      legacy,
      createdAt: now,
      updatedAt: now
    };
    this.records.set(record.key, record);
    this.save();
    return record;
  }

  update(record: IdempotencyRecord, state: DeliveryState, responses?: AgentHubEnvelope[], error?: string) {
    record.state = state;
    record.updatedAt = new Date().toISOString();
    record.responses = responses;
    record.error = error;
    this.records.set(record.key, record);
    this.save();
  }

  private load() {
    if (!existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8').replace(/^\uFEFF/, '')) as Partial<PersistedLedger>;
      for (const record of parsed.records || []) {
        if (record?.key && record.requestId && record.deviceId) this.records.set(record.key, record);
      }
    } catch (error) {
      console.warn(`Could not load Project Reika idempotency ledger: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private save() {
    const records = Array.from(this.records.values())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, this.maxRecords);
    this.records.clear();
    for (const record of records) this.records.set(record.key, record);
    const payload: PersistedLedger = { version: 1, updatedAt: new Date().toISOString(), records };
    mkdirSync(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    const backupPath = `${this.path}.bak`;
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    if (existsSync(this.path)) copyFileSync(this.path, backupPath);
    renameSync(temporaryPath, this.path);
  }
}

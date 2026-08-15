/**
 * 앱 데이터 DB (app.sqlite). 설정·템플릿·예배순서가 들어간다.
 * 성경 DB 와 달리 쓰기가 있으므로 연결을 분리한다.
 *
 * Phase 2 는 settings 만 쓴다. templates·service_plans 는 Phase 3·5 에서 추가.
 */

import { DatabaseSync } from 'node:sqlite';

import { ensureDataDirs, paths } from '../paths.ts';

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

let db: DatabaseSync | null = null;

export function initAppDb(): void {
  if (db) return;
  ensureDataDirs();
  db = new DatabaseSync(paths.appDb);
  db.exec(SCHEMA);
}

export function closeAppDb(): void {
  db?.close();
  db = null;
}

function conn(): DatabaseSync {
  if (!db) initAppDb();
  return db!;
}

/** 같은 연결을 쓰는 다른 저장소 모듈(templates 등)을 위한 접근자 */
export function getConnection(): DatabaseSync {
  return conn();
}

export function getSetting(key: string): string | undefined {
  const row = conn().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  conn()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

/**
 * JSON 설정 읽기. 저장된 값이 깨져 있어도 앱이 죽지 않아야 한다 —
 * 예배 직전 기동 실패는 치명적이므로 기본값으로 넘어간다.
 */
export function getJsonSetting<T>(key: string, fallback: T): { value: T; corrupt: boolean } {
  const raw = getSetting(key);
  if (raw === undefined) return { value: fallback, corrupt: false };
  try {
    return { value: JSON.parse(raw) as T, corrupt: false };
  } catch {
    return { value: fallback, corrupt: true };
  }
}

export function setJsonSetting(key: string, value: unknown): void {
  setSetting(key, JSON.stringify(value));
}

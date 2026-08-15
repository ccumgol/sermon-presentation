/**
 * 곡집(시리즈) 저장소.
 *
 * 설계 요점
 *  - 시리즈를 **행**으로 다룬다. 컬럼(hymnal, hymn_number, hymn_number_old)으로 두면
 *    시리즈가 늘 때마다 스키마를 고쳐야 하고, 한 곡이 여러 시리즈에 실린 경우를
 *    표현할 수 없다 (복음성가는 흔하다 — 같은 곡이 많은물소리 42번이자 찬미2000 118번).
 *  - 찬송가의 '장'과 복음성가의 '번호'를 하나의 `number` 로 통일한다.
 *  - '기타' 곡집은 `numbered=0` 이라 번호 없이 넣을 수 있다.
 *  - 가져오기 재실행은 `songbook_id` 범위로 지우고 다시 넣는다 → 개별·일괄 갱신이 같은 방식.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { Songbook } from '../../shared/types.ts';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS songbooks (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  short_label  TEXT NOT NULL,      -- 바로가기 버튼용 대표 한 글자
  numbered     INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL,
  is_builtin   INTEGER NOT NULL DEFAULT 0,
  quick_slot   INTEGER,            -- 1~4, NULL = 드롭다운에서만
  source_note  TEXT,
  imported_at  TEXT,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS song_entries (
  song_id     INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  songbook_id TEXT NOT NULL REFERENCES songbooks(id) ON DELETE CASCADE,
  number      INTEGER,             -- NULL = 번호 없는 수록곡
  PRIMARY KEY (song_id, songbook_id)
);

CREATE INDEX IF NOT EXISTS idx_entries_book_number ON song_entries(songbook_id, number);
CREATE INDEX IF NOT EXISTS idx_entries_number ON song_entries(number);

-- 가사가 다른 대응곡 (새찬송가 305장 ↔ 통일찬송가 405장).
-- 교차 매핑 428쌍 중 91%가 가사가 달라 한 곡으로 합칠 수 없다.
CREATE TABLE IF NOT EXISTS song_links (
  song_id   INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  linked_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  PRIMARY KEY (song_id, linked_id)
);
`;

/** 내장 곡집 — 코드가 유일한 출처이며 지울 수 없다 */
export const BUILTIN_SONGBOOKS: ReadonlyArray<Omit<Songbook, 'songCount'>> = [
  { id: 'hymn_new', name: '새찬송가', shortLabel: '새', numbered: true, sortOrder: 10, isBuiltin: true, quickSlot: 1 },
  { id: 'hymn_old', name: '통일찬송가', shortLabel: '통', numbered: true, sortOrder: 20, isBuiltin: true, quickSlot: 2 },
  // 시리즈에 속하지 않는 곡을 담는 곳. 번호가 없어도 된다.
  { id: 'misc', name: '기타', shortLabel: '기', numbered: false, sortOrder: 900, isBuiltin: true, quickSlot: 4 },
];

/** 바로가기 버튼 개수 */
export const QUICK_SLOT_COUNT = 4;

interface SongbookRow {
  id: string;
  name: string;
  short_label: string;
  numbered: number;
  sort_order: number;
  is_builtin: number;
  quick_slot: number | null;
  source_note: string | null;
  imported_at: string | null;
}

function toSongbook(row: SongbookRow, songCount: number): Songbook {
  return {
    id: row.id,
    name: row.name,
    shortLabel: row.short_label,
    numbered: row.numbered === 1,
    sortOrder: row.sort_order,
    isBuiltin: row.is_builtin === 1,
    ...(row.quick_slot !== null ? { quickSlot: row.quick_slot } : {}),
    ...(row.source_note ? { sourceNote: row.source_note } : {}),
    ...(row.imported_at ? { importedAt: row.imported_at } : {}),
    songCount,
  };
}

/**
 * 기존 스키마(hymnal / hymn_number / hymn_number_old)를 곡집 구조로 옮긴다.
 *
 * 재가져오기로 해결할 수도 있지만, 사용자가 직접 넣은 영어 가사나 손본 곡이 있을 수 있어
 * 제자리에서 옮긴다. 컬럼이 이미 없으면 아무 일도 하지 않는다.
 */
export function migrateFromHymnalColumns(db: DatabaseSync): { entries: number; links: number } | null {
  const columns = db.prepare("SELECT name FROM pragma_table_info('songs')").all() as unknown as Array<{
    name: string;
  }>;
  const names = new Set(columns.map((c) => c.name));
  if (!names.has('hymnal')) return null;

  let entries = 0;
  let links = 0;

  db.exec('BEGIN');
  try {
    // 1) hymnal + hymn_number → song_entries
    const songs = db
      .prepare('SELECT id, hymnal, hymn_number, hymn_number_old FROM songs WHERE hymnal IS NOT NULL')
      .all() as unknown as Array<{
      id: number;
      hymnal: string;
      hymn_number: number | null;
      hymn_number_old: number | null;
    }>;

    const insertEntry = db.prepare(
      'INSERT OR IGNORE INTO song_entries (song_id, songbook_id, number) VALUES (?, ?, ?)',
    );
    for (const song of songs) {
      const songbookId = song.hymnal === 'new' ? 'hymn_new' : song.hymnal === 'old' ? 'hymn_old' : null;
      if (!songbookId) continue;
      insertEntry.run(song.id, songbookId, song.hymn_number);
      entries++;
    }

    // 2) hymn_number_old → song_links (양방향)
    const insertLink = db.prepare('INSERT OR IGNORE INTO song_links (song_id, linked_id) VALUES (?, ?)');
    for (const song of songs) {
      if (song.hymnal !== 'new' || song.hymn_number_old === null) continue;
      const counterpart = db
        .prepare("SELECT id FROM songs WHERE hymnal = 'old' AND hymn_number = ?")
        .get(song.hymn_number_old) as { id: number } | undefined;
      if (!counterpart) continue;
      insertLink.run(song.id, counterpart.id);
      insertLink.run(counterpart.id, song.id);
      links += 2;
    }

    // 3) 곡집에 속하지 않은 곡은 '기타'로
    db.prepare(
      `INSERT OR IGNORE INTO song_entries (song_id, songbook_id, number)
       SELECT id, 'misc', NULL FROM songs
       WHERE id NOT IN (SELECT song_id FROM song_entries)`,
    ).run();

    // 4) 옛 컬럼을 참조하는 인덱스를 먼저 지운다.
    //    SQLite 는 인덱스가 걸린 컬럼을 DROP COLUMN 하지 못한다
    //    ('error in index ... after drop column: no such column: hymnal').
    const legacyColumns = ['hymnal', 'hymn_number', 'hymn_number_old'];
    const indexes = db
      .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'songs' AND sql IS NOT NULL")
      .all() as unknown as Array<{ name: string; sql: string }>;

    for (const index of indexes) {
      if (legacyColumns.some((column) => index.sql.includes(column))) {
        db.exec(`DROP INDEX IF EXISTS ${index.name}`);
      }
    }

    // 5) 옛 컬럼 제거
    for (const column of legacyColumns) {
      if (names.has(column)) db.exec(`ALTER TABLE songs DROP COLUMN ${column}`);
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { entries, links };
}

/** 내장 곡집을 주입한다. 사용자가 바꾼 quick_slot·이름은 덮지 않는다. */
export function seedBuiltinSongbooks(db: DatabaseSync): void {
  const now = new Date().toISOString();
  const insert = db.prepare(
    `INSERT INTO songbooks (id, name, short_label, numbered, sort_order, is_builtin, quick_slot, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  for (const book of BUILTIN_SONGBOOKS) {
    insert.run(book.id, book.name, book.shortLabel, book.numbered ? 1 : 0, book.sortOrder, book.quickSlot ?? null, now);
  }
}

export function listSongbooks(db: DatabaseSync): Songbook[] {
  const rows = db
    .prepare('SELECT * FROM songbooks ORDER BY sort_order, name')
    .all() as unknown as SongbookRow[];

  const counts = new Map<string, number>(
    (
      db.prepare('SELECT songbook_id, count(*) AS c FROM song_entries GROUP BY songbook_id').all() as unknown as Array<{
        songbook_id: string;
        c: number;
      }>
    ).map((r) => [r.songbook_id, r.c]),
  );

  return rows.map((row) => toSongbook(row, counts.get(row.id) ?? 0));
}

export function getSongbook(db: DatabaseSync, id: string): Songbook | undefined {
  const row = db.prepare('SELECT * FROM songbooks WHERE id = ?').get(id) as SongbookRow | undefined;
  if (!row) return undefined;
  const count = (
    db.prepare('SELECT count(*) AS c FROM song_entries WHERE songbook_id = ?').get(id) as { c: number }
  ).c;
  return toSongbook(row, count);
}

export interface SongbookInput {
  id?: string;
  name: string;
  shortLabel?: string;
  numbered?: boolean;
  quickSlot?: number | null;
  sourceNote?: string;
}

export class SongbookError extends Error {}

/** id 를 이름에서 만든다 — 한글은 유지할 수 없어 타임스탬프 대신 순번을 쓴다 */
function makeId(db: DatabaseSync, name: string): string {
  const ascii = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const base = ascii.length > 0 ? ascii : 'book';

  let candidate = base;
  let suffix = 2;
  while (db.prepare('SELECT 1 FROM songbooks WHERE id = ?').get(candidate) !== undefined) {
    candidate = `${base}-${suffix}`;
    suffix++;
  }
  return candidate;
}

export function createSongbook(db: DatabaseSync, input: SongbookInput): Songbook {
  const name = input.name.trim();
  if (name.length === 0) throw new SongbookError('곡집 이름이 필요합니다');

  if (input.id && db.prepare('SELECT 1 FROM songbooks WHERE id = ?').get(input.id) !== undefined) {
    throw new SongbookError(`이미 있는 곡집 id 입니다: ${input.id}`);
  }

  const id = input.id ?? makeId(db, name);
  // 대표 글자를 안 주면 이름 첫 글자를 쓴다
  const shortLabel = (input.shortLabel?.trim() || name.slice(0, 1)).slice(0, 2);
  const maxOrder = (
    db.prepare('SELECT coalesce(max(sort_order), 0) AS m FROM songbooks WHERE is_builtin = 0').get() as { m: number }
  ).m;

  db.prepare(
    `INSERT INTO songbooks (id, name, short_label, numbered, sort_order, is_builtin, quick_slot, source_note, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  ).run(
    id,
    name,
    shortLabel,
    input.numbered === false ? 0 : 1,
    Math.max(maxOrder + 10, 100),
    normalizeQuickSlot(input.quickSlot),
    input.sourceNote ?? null,
    new Date().toISOString(),
  );

  return getSongbook(db, id)!;
}

function normalizeQuickSlot(slot: number | null | undefined): number | null {
  if (slot === null || slot === undefined) return null;
  return Number.isInteger(slot) && slot >= 1 && slot <= QUICK_SLOT_COUNT ? slot : null;
}

export function updateSongbook(db: DatabaseSync, id: string, patch: Partial<SongbookInput>): Songbook {
  const existing = getSongbook(db, id);
  if (!existing) throw new SongbookError(`곡집을 찾을 수 없습니다: ${id}`);

  const name = patch.name?.trim() || existing.name;
  const shortLabel = (patch.shortLabel?.trim() || existing.shortLabel).slice(0, 2);
  // 내장 곡집의 번호 체계는 바꾸지 않는다 — 찬송가에서 번호를 빼면 검색이 무너진다
  const numbered = existing.isBuiltin ? existing.numbered : (patch.numbered ?? existing.numbered);
  const quickSlot =
    patch.quickSlot === undefined ? (existing.quickSlot ?? null) : normalizeQuickSlot(patch.quickSlot);

  // 바로가기 슬롯은 하나만 차지한다 — 다른 곡집이 쓰고 있으면 비운다
  if (quickSlot !== null) {
    db.prepare('UPDATE songbooks SET quick_slot = NULL WHERE quick_slot = ? AND id <> ?').run(quickSlot, id);
  }

  db.prepare('UPDATE songbooks SET name = ?, short_label = ?, numbered = ?, quick_slot = ? WHERE id = ?').run(
    name,
    shortLabel,
    numbered ? 1 : 0,
    quickSlot,
    id,
  );

  return getSongbook(db, id)!;
}

/** 곡집을 지운다. 수록곡은 '기타'로 옮겨 본문이 사라지지 않게 한다. */
export function deleteSongbook(db: DatabaseSync, id: string): { movedToMisc: number } {
  const existing = getSongbook(db, id);
  if (!existing) throw new SongbookError(`곡집을 찾을 수 없습니다: ${id}`);
  if (existing.isBuiltin) throw new SongbookError('내장 곡집은 지울 수 없습니다');

  db.exec('BEGIN');
  try {
    // 다른 곡집에 실려 있지 않은 곡만 '기타'로 옮긴다
    const orphans = db
      .prepare(
        `SELECT song_id FROM song_entries WHERE songbook_id = ?
           AND song_id NOT IN (SELECT song_id FROM song_entries WHERE songbook_id <> ?)`,
      )
      .all(id, id) as unknown as Array<{ song_id: number }>;

    const insert = db.prepare(
      "INSERT OR IGNORE INTO song_entries (song_id, songbook_id, number) VALUES (?, 'misc', NULL)",
    );
    for (const row of orphans) insert.run(row.song_id);

    db.prepare('DELETE FROM songbooks WHERE id = ?').run(id);
    db.exec('COMMIT');
    return { movedToMisc: orphans.length };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function markImported(db: DatabaseSync, id: string, sourceNote?: string): void {
  db.prepare('UPDATE songbooks SET imported_at = ?, source_note = coalesce(?, source_note) WHERE id = ?').run(
    new Date().toISOString(),
    sourceNote ?? null,
    id,
  );
}

/**
 * 곡집에서 빠진 번호를 찾는다.
 * 가져오기가 일부만 됐는지 눈으로 확인할 수 있어야 한다.
 */
export function findGaps(db: DatabaseSync, id: string): { missing: number[]; max: number } {
  const numbers = (
    db
      .prepare('SELECT number FROM song_entries WHERE songbook_id = ? AND number IS NOT NULL ORDER BY number')
      .all(id) as unknown as Array<{ number: number }>
  ).map((r) => r.number);

  if (numbers.length === 0) return { missing: [], max: 0 };

  const present = new Set(numbers);
  const max = numbers[numbers.length - 1]!;
  const missing: number[] = [];
  for (let n = 1; n <= max; n++) if (!present.has(n)) missing.push(n);

  return { missing, max };
}

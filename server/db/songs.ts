/**
 * 찬양 저장소 (songs.sqlite).
 *
 * 가사를 **줄 단위**로 저장하는 것이 핵심이다. 통짜 텍스트로 두면
 * '한국어 3번째 줄 ↔ 영어 3번째 줄'을 짝지을 방법이 없다 (계획서 §3.2).
 *
 * 곡집(시리즈)은 `song_entries` 다대다로 붙는다 — server/db/songbooks.ts 참고.
 *
 * 검색은 성경과 같은 전략을 쓴다 — 한국어는 LIKE 부분일치.
 * FTS5 unicode61 은 어절 단위라 '은혜'로 '은혜로운'을 못 찾는다.
 */

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import type {
  LangCode,
  ReviewItem,
  ReviewQueue,
  Song,
  SongEntry,
  SongLine,
  SongSearchHit,
  SongSearchResult,
  SongSection,
} from '../../shared/types.ts';
import { ensureDataDirs, paths } from '../paths.ts';
import * as songbooks from './songbooks.ts';

const SONG_SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS songs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  title_norm      TEXT NOT NULL,          -- 공백 제거본 (검색용)
  title_alt       TEXT,
  author          TEXT,
  composer        TEXT,
  copyright       TEXT,
  ccli_number     TEXT,
  tags            TEXT NOT NULL DEFAULT '[]',
  has_amen        INTEGER NOT NULL DEFAULT 0,
  source          TEXT,
  default_template_id INTEGER,
  -- 사용 기록. 예배에 반복되는 곡은 20~30곡 남짓이라, 최근·자주 쓴 곡을
  -- 바로 꺼낼 수 있으면 검색 단계 자체가 없어진다.
  --
  -- 순서는 last_used_at 이 아니라 used_seq(단조 증가)로 잡는다. 시각은 밀리초
  -- 정밀도라 같은 밀리초에 두 곡을 보내면 순서가 불확정이고, 시스템 시계가
  -- 뒤로 가면 아예 뒤집힌다. last_used_at 은 화면 표시용으로만 쓴다.
  last_used_at    TEXT,
  used_seq        INTEGER NOT NULL DEFAULT 0,
  use_count       INTEGER NOT NULL DEFAULT 0,
  -- 즐겨찾기. 사용 기록(자주 쓴 곡)과 다르다 — 예배마다 반드시 쓰는 송영·봉헌송
  -- 같은 곡은 사람이 직접 지정해야 목록이 흔들리지 않는다.
  is_favorite     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS song_sections (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id  INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  kind     TEXT NOT NULL,
  label    TEXT NOT NULL,
  position INTEGER NOT NULL,
  -- 이 줄나눔이 어디서 왔는지. 'auto' 만 재계산 대상이다.
  --
  -- 사람이 손본 가사를 알고리즘 개선 때마다 덮어쓰면 작업이 매번 날아간다.
  -- 원본에 줄바꿈이 있어 그대로 가져온 것('imported')도 건드리지 않는다 —
  -- 자료 제공자의 줄나눔이 추정보다 정확하다.
  lines_source TEXT NOT NULL DEFAULT 'auto'
);

CREATE TABLE IF NOT EXISTS song_lines (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  section_id INTEGER NOT NULL REFERENCES song_sections(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,            -- 같은 값 = 같은 줄로 페어링
  lang       TEXT NOT NULL,
  text       TEXT NOT NULL,
  UNIQUE(section_id, line_index, lang)
);

CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title_norm);
-- idx_songs_recent 는 addUsageColumns 가 만든다.
-- 여기 두면 컬럼이 없는 기존 DB 에서 ALTER 보다 먼저 실행돼 실패한다.
CREATE INDEX IF NOT EXISTS idx_sections_song ON song_sections(song_id, position);
CREATE INDEX IF NOT EXISTS idx_lines_section ON song_lines(section_id, line_index);
`;

let db: DatabaseSync | null = null;

export function initSongsDb(): void {
  if (db) return;
  ensureDataDirs();
  db = new DatabaseSync(paths.songsDb);
  db.exec(SONG_SCHEMA);
  db.exec(songbooks.SCHEMA);
  addUsageColumns(db);
  addLinesSourceColumn(db);
  // 기존 hymnal/hymn_number 컬럼이 있으면 곡집 구조로 옮긴다 (한 번만 동작)
  songbooks.seedBuiltinSongbooks(db);
  songbooks.migrateFromHymnalColumns(db);
}

/**
 * 기존 DB 에 줄나눔 출처 컬럼을 붙인다.
 *
 * 기본값 'auto' 가 맞다 — 지금까지의 모든 줄나눔은 가져오기 때 폭 기준으로
 * 자동 생성된 것이다. 사람이 손본 것과 구별할 방법이 그동안 없었다.
 */
function addLinesSourceColumn(target: DatabaseSync): void {
  const names = new Set(
    (target.prepare("SELECT name FROM pragma_table_info('song_sections')").all() as unknown as Array<{
      name: string;
    }>).map((column) => column.name),
  );
  if (!names.has('lines_source')) {
    target.exec("ALTER TABLE song_sections ADD COLUMN lines_source TEXT NOT NULL DEFAULT 'auto'");
  }
}

/** 기존 DB 에 사용 기록 컬럼을 붙인다 (이미 있으면 아무 일도 하지 않는다) */
function addUsageColumns(target: DatabaseSync): void {
  const names = new Set(
    (target.prepare("SELECT name FROM pragma_table_info('songs')").all() as unknown as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  if (!names.has('last_used_at')) target.exec('ALTER TABLE songs ADD COLUMN last_used_at TEXT');
  if (!names.has('used_seq')) target.exec('ALTER TABLE songs ADD COLUMN used_seq INTEGER NOT NULL DEFAULT 0');
  if (!names.has('use_count')) target.exec('ALTER TABLE songs ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0');
  if (!names.has('is_favorite')) {
    target.exec('ALTER TABLE songs ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0');
  }
  target.exec('CREATE INDEX IF NOT EXISTS idx_songs_recent ON songs(used_seq DESC)');
  target.exec('CREATE INDEX IF NOT EXISTS idx_songs_favorite ON songs(is_favorite)');
}

export function closeSongsDb(): void {
  db?.close();
  db = null;
}

export function conn(): DatabaseSync {
  if (!db) initSongsDb();
  return db!;
}

export function songsDbExists(): boolean {
  return existsSync(paths.songsDb);
}

/** 검색용 제목 정규화 — 공백·구두점 제거 */
export function normalizeTitle(title: string): string {
  return title.replace(/[\s.,!?'"·~\-—()[\]]/g, '').toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// 읽기
// ─────────────────────────────────────────────────────────────

interface SongRow {
  id: number;
  title: string;
  title_alt: string | null;
  author: string | null;
  composer: string | null;
  copyright: string | null;
  ccli_number: string | null;
  tags: string;
  has_amen: number;
  source: string | null;
  default_template_id: number | null;
  last_used_at: string | null;
  used_seq: number;
  use_count: number;
  is_favorite: number;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** 곡의 수록 곡집·번호. 곡집 정렬 순서를 따른다 (새찬송가가 앞). */
export function getEntries(songId: number): SongEntry[] {
  const rows = conn()
    .prepare(
      `SELECT e.songbook_id, e.number, b.name, b.short_label
       FROM song_entries e JOIN songbooks b ON b.id = e.songbook_id
       WHERE e.song_id = ? ORDER BY b.sort_order, b.name`,
    )
    .all(songId) as unknown as Array<{
    songbook_id: string;
    number: number | null;
    name: string;
    short_label: string;
  }>;

  return rows.map((r) => ({
    songbookId: r.songbook_id,
    songbookName: r.name,
    songbookShortLabel: r.short_label,
    ...(r.number !== null ? { number: r.number } : {}),
  }));
}

function toSongMeta(row: SongRow): Omit<Song, 'sections' | 'langs' | 'entries'> {
  return {
    id: row.id,
    title: row.title,
    ...(row.title_alt ? { titleAlt: row.title_alt } : {}),
    ...(row.author ? { author: row.author } : {}),
    ...(row.composer ? { composer: row.composer } : {}),
    ...(row.copyright ? { copyright: row.copyright } : {}),
    ...(row.ccli_number ? { ccliNumber: row.ccli_number } : {}),
    tags: parseTags(row.tags),
    hasAmen: row.has_amen === 1,
    ...(row.source ? { source: row.source } : {}),
    ...(row.default_template_id !== null ? { defaultTemplateId: row.default_template_id } : {}),
    ...(row.is_favorite === 1 ? { isFavorite: true } : {}),
  };
}

export function getSong(id: number): Song | undefined {
  const row = conn().prepare('SELECT * FROM songs WHERE id = ?').get(id) as SongRow | undefined;
  if (!row) return undefined;

  const sectionRows = conn()
    .prepare(
      'SELECT id, kind, label, position, lines_source FROM song_sections WHERE song_id = ? ORDER BY position',
    )
    .all(id) as unknown as Array<{
    id: number;
    kind: string;
    label: string;
    position: number;
    lines_source: string;
  }>;

  const sections: SongSection[] = sectionRows.map((s) => {
    const lines = conn()
      .prepare('SELECT line_index, lang, text FROM song_lines WHERE section_id = ? ORDER BY line_index, lang')
      .all(s.id) as unknown as Array<{ line_index: number; lang: string; text: string }>;

    return {
      id: s.id,
      kind: s.kind as SongSection['kind'],
      label: s.label,
      position: s.position,
      lines: lines.map((l) => ({ lineIndex: l.line_index, lang: l.lang, text: l.text })),
    };
  });

  // 대응곡 (가사가 달라 별도 곡이지만 서로 참조)
  const linkRows = conn()
    .prepare('SELECT s.id, s.title FROM song_links l JOIN songs s ON s.id = l.linked_id WHERE l.song_id = ?')
    .all(id) as unknown as Array<{ id: number; title: string }>;

  const langs = [...new Set(sections.flatMap((s) => s.lines.map((l) => l.lang)))];

  // 모든 섹션이 사람 손을 거쳤으면 확인된 곡이다 (자동 갱신 대상에서 빠진다)
  const confirmed = sectionRows.length > 0 && sectionRows.every((s) => s.lines_source !== 'auto');

  return {
    ...toSongMeta(row),
    entries: getEntries(id),
    ...(linkRows.length > 0
      ? { links: linkRows.map((l) => ({ id: l.id, title: l.title, entries: getEntries(l.id) })) }
      : {}),
    sections,
    langs,
    ...(confirmed ? { confirmed: true } : {}),
  };
}

const SEARCH_LIMIT = 60;

/** 검색 결과 한 건을 만든다 (수록 정보·언어·섹션 수 포함) */
function toHit(row: SongRow, matchedOn: SongSearchHit['matchedOn'], snippet?: string): SongSearchHit {
  const counts = conn()
    .prepare(
      `SELECT (SELECT count(*) FROM song_sections WHERE song_id = ?) AS sections,
              (SELECT group_concat(DISTINCT l.lang) FROM song_lines l
                 JOIN song_sections ss ON ss.id = l.section_id WHERE ss.song_id = ?) AS langs,
              (SELECT count(*) FROM song_sections
                WHERE song_id = ? AND lines_source = 'auto') AS pending`,
    )
    .get(row.id, row.id, row.id) as { sections: number; langs: string | null; pending: number };

  return {
    id: row.id,
    title: row.title,
    ...(row.title_alt ? { titleAlt: row.title_alt } : {}),
    entries: getEntries(row.id),
    langs: (counts.langs ?? '').split(',').filter((x) => x.length > 0) as LangCode[],
    sectionCount: counts.sections,
    matchedOn,
    ...(snippet ? { snippet } : {}),
    ...(counts.sections > 0 && counts.pending === 0 ? { confirmed: true } : {}),
  };
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface SearchOptions {
  /** 특정 곡집으로 범위를 좁힌다. 없으면 전체 통합 검색. */
  songbookId?: string;
  limit?: number;
}

/**
 * 통합 검색 — 번호 · 제목 · 가사를 한 번에 본다.
 *
 * 오퍼레이터는 번호로 찾는 경우가 압도적이라 숫자를 먼저 처리한다.
 * '새 305' · '통 405' 처럼 곡집을 지정할 수도 있다 (대표 글자 또는 이름 앞부분).
 *
 * 검색어가 없으면 목록을 돌려준다 — 곡집을 고르면 그 곡집의 번호 순 목록,
 * 아무것도 고르지 않으면 전체 목록.
 */
export function searchSongs(query: string, options: SearchOptions = {}): SongSearchResult {
  const trimmed = query.trim();
  const limit = options.limit ?? SEARCH_LIMIT;
  const scope: SongSearchResult['scope'] = options.songbookId ? 'songbook' : 'all';

  const base = (hits: SongSearchHit[], total: number): SongSearchResult => ({
    scope,
    ...(options.songbookId ? { songbookId: options.songbookId } : {}),
    query: trimmed,
    total,
    truncated: total > hits.length,
    hits,
  });

  // 검색어 없음 → 목록
  if (trimmed.length === 0) return base(listSongs(limit, 0, options.songbookId), countSongs(options.songbookId));

  const hits: SongSearchHit[] = [];
  const seen = new Set<number>();
  const push = (row: SongRow, matchedOn: SongSearchHit['matchedOn'], snippet?: string): void => {
    if (seen.has(row.id) || hits.length >= limit) return;
    seen.add(row.id);
    hits.push(toHit(row, matchedOn, snippet));
  };

  // 1) 곡집 지정 + 번호 — '새 305', '통 405', '물 42'
  const scoped = /^(\S+?)\s*(\d{1,4})$/.exec(trimmed);
  if (scoped) {
    const label = scoped[1]!;
    const number = Number(scoped[2]);
    const books = conn()
      .prepare(
        `SELECT id FROM songbooks
         WHERE short_label = ? OR name LIKE ? ESCAPE '\\' OR id = ?`,
      )
      .all(label, `${escapeLike(label)}%`, label) as unknown as Array<{ id: string }>;

    for (const book of books) {
      const rows = conn()
        .prepare(
          `SELECT s.* FROM songs s JOIN song_entries e ON e.song_id = s.id
           WHERE e.songbook_id = ? AND e.number = ? LIMIT ?`,
        )
        .all(book.id, number, limit) as unknown as SongRow[];
      for (const row of rows) push(row, 'number');
    }
    if (hits.length > 0) return base(hits, hits.length);
  }

  // 2) 번호만 — 모든 곡집에서 찾는다 (곡집 정렬 순서대로)
  if (/^\d{1,4}$/.test(trimmed)) {
    const number = Number(trimmed);
    const rows = options.songbookId
      ? (conn()
          .prepare(
            `SELECT s.* FROM songs s
               JOIN song_entries e ON e.song_id = s.id
               JOIN songbooks b ON b.id = e.songbook_id
             WHERE e.number = ? AND e.songbook_id = ?
             ORDER BY b.sort_order, b.name LIMIT ?`,
          )
          .all(number, options.songbookId, limit) as unknown as SongRow[])
      : (conn()
          .prepare(
            `SELECT s.* FROM songs s
               JOIN song_entries e ON e.song_id = s.id
               JOIN songbooks b ON b.id = e.songbook_id
             WHERE e.number = ?
             ORDER BY b.sort_order, b.name LIMIT ?`,
          )
          .all(number, limit) as unknown as SongRow[]);

    for (const row of rows) push(row, 'number');
    if (hits.length > 0) return base(hits, hits.length);
  }

  // 3) 제목 (공백 무시)
  const titleKey = `%${escapeLike(normalizeTitle(trimmed))}%`;
  const titleRows = options.songbookId
    ? (conn()
        .prepare(
          `SELECT DISTINCT s.* FROM songs s JOIN song_entries e ON e.song_id = s.id
           WHERE s.title_norm LIKE ? ESCAPE '\\' AND e.songbook_id = ?
           ORDER BY e.number, s.title LIMIT ?`,
        )
        .all(titleKey, options.songbookId, limit) as unknown as SongRow[])
    : (conn()
        .prepare(`SELECT s.* FROM songs s WHERE s.title_norm LIKE ? ESCAPE '\\' ORDER BY s.title LIMIT ?`)
        .all(titleKey, limit) as unknown as SongRow[]);
  for (const row of titleRows) push(row, 'title');

  // 4) 가사 부분일치 (한국어라 LIKE 를 쓴다)
  if (hits.length < limit) {
    const lyricKey = `%${escapeLike(trimmed)}%`;
    const remaining = limit - hits.length;
    const lyricRows = options.songbookId
      ? (conn()
          .prepare(
            `SELECT DISTINCT s.*, l.text AS snippet FROM songs s
               JOIN song_sections ss ON ss.song_id = s.id
               JOIN song_lines l ON l.section_id = ss.id
               JOIN song_entries e ON e.song_id = s.id
             WHERE l.text LIKE ? ESCAPE '\\' AND e.songbook_id = ?
             ORDER BY s.title LIMIT ?`,
          )
          .all(lyricKey, options.songbookId, remaining) as unknown as Array<SongRow & { snippet: string }>)
      : (conn()
          .prepare(
            `SELECT DISTINCT s.*, l.text AS snippet FROM songs s
               JOIN song_sections ss ON ss.song_id = s.id
               JOIN song_lines l ON l.section_id = ss.id
             WHERE l.text LIKE ? ESCAPE '\\'
             ORDER BY s.title LIMIT ?`,
          )
          .all(lyricKey, remaining) as unknown as Array<SongRow & { snippet: string }>);

    for (const row of lyricRows) push(row, 'lyrics', row.snippet);
  }

  return base(hits, hits.length);
}

export function countSongs(songbookId?: string): number {
  if (songbookId) {
    return (
      conn().prepare('SELECT count(*) AS c FROM song_entries WHERE songbook_id = ?').get(songbookId) as { c: number }
    ).c;
  }
  return (conn().prepare('SELECT count(*) AS c FROM songs').get() as { c: number }).c;
}

/** 목록 — 곡집을 고르면 번호 순, 전체면 곡집 순서 → 번호 순 */
export function listSongs(limit = 100, offset = 0, songbookId?: string): SongSearchHit[] {
  const rows = songbookId
    ? (conn()
        .prepare(
          `SELECT s.* FROM songs s JOIN song_entries e ON e.song_id = s.id
           WHERE e.songbook_id = ?
           ORDER BY (e.number IS NULL), e.number, s.title LIMIT ? OFFSET ?`,
        )
        .all(songbookId, limit, offset) as unknown as SongRow[])
    : (conn()
        .prepare(
          `SELECT s.*, min(b.sort_order) AS book_order, min(e.number) AS first_number
           FROM songs s
             LEFT JOIN song_entries e ON e.song_id = s.id
             LEFT JOIN songbooks b ON b.id = e.songbook_id
           GROUP BY s.id
           ORDER BY book_order, first_number, s.title LIMIT ? OFFSET ?`,
        )
        .all(limit, offset) as unknown as SongRow[]);

  return rows.map((row) => toHit(row, 'title'));
}

// ─────────────────────────────────────────────────────────────
// 쓰기
// ─────────────────────────────────────────────────────────────

export interface SongEntryInput {
  songbookId: string;
  number?: number | null;
}

export interface SongInput {
  title: string;
  titleAlt?: string;
  author?: string;
  composer?: string;
  copyright?: string;
  ccliNumber?: string;
  tags?: string[];
  hasAmen?: boolean;
  source?: string;
  defaultTemplateId?: number;
  /** 수록 곡집·번호. 비우면 '기타' 곡집에 번호 없이 들어간다. */
  entries?: SongEntryInput[];
  sections: Array<{ kind: SongSection['kind']; label: string; lines: SongLine[] }>;
  /** 줄나눔 출처. 원본의 줄바꿈을 그대로 쓴 경우 'imported' 로 표시한다. */
  linesSource?: LinesSource;
}

export function createSong(input: SongInput): number {
  const now = new Date().toISOString();
  const target = conn();

  const result = target
    .prepare(
      `INSERT INTO songs
        (title, title_norm, title_alt, author, composer, copyright, ccli_number, tags,
         has_amen, source, default_template_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.title,
      normalizeTitle(input.title),
      input.titleAlt ?? null,
      input.author ?? null,
      input.composer ?? null,
      input.copyright ?? null,
      input.ccliNumber ?? null,
      JSON.stringify(input.tags ?? []),
      input.hasAmen ? 1 : 0,
      input.source ?? 'manual',
      input.defaultTemplateId ?? null,
      now,
      now,
    );

  const songId = Number(result.lastInsertRowid);
  writeSections(songId, input.sections, input.linesSource ?? 'auto');
  setEntries(songId, input.entries ?? [{ songbookId: 'misc' }]);
  return songId;
}

/** 수록 정보를 통째로 교체한다 */
export function setEntries(songId: number, entries: readonly SongEntryInput[]): void {
  const target = conn();
  target.prepare('DELETE FROM song_entries WHERE song_id = ?').run(songId);

  const insert = target.prepare(
    'INSERT OR REPLACE INTO song_entries (song_id, songbook_id, number) VALUES (?, ?, ?)',
  );

  // 곡집의 번호 체계를 미리 읽어 둔다 (반복 조회를 피한다)
  const numbered = new Map<string, boolean>(
    (
      target.prepare('SELECT id, numbered FROM songbooks').all() as unknown as Array<{
        id: string;
        numbered: number;
      }>
    ).map((r) => [r.id, r.numbered === 1]),
  );

  let inserted = 0;
  for (const entry of entries) {
    // 없는 곡집은 조용히 버리지 않고 아래에서 '기타'로 떨어뜨린다
    if (!numbered.has(entry.songbookId)) continue;

    // 번호 체계가 없는 곡집은 번호를 저장하지 않는다
    const number = numbered.get(entry.songbookId) ? (entry.number ?? null) : null;
    insert.run(songId, entry.songbookId, number);
    inserted++;
  }

  if (inserted === 0) insert.run(songId, 'misc', null);
}

/** 줄나눔이 어디서 왔는지 — 'auto' 만 재정렬 대상이다 */
export type LinesSource = 'auto' | 'manual' | 'imported';

function writeSections(
  songId: number,
  sections: SongInput['sections'],
  linesSource: LinesSource = 'auto',
): void {
  const target = conn();
  const insertSection = target.prepare(
    'INSERT INTO song_sections (song_id, kind, label, position, lines_source) VALUES (?, ?, ?, ?, ?)',
  );
  const insertLine = target.prepare(
    'INSERT INTO song_lines (section_id, line_index, lang, text) VALUES (?, ?, ?, ?)',
  );

  for (const [position, section] of sections.entries()) {
    const sectionId = Number(
      insertSection.run(songId, section.kind, section.label, position, linesSource).lastInsertRowid,
    );
    for (const line of section.lines) {
      insertLine.run(sectionId, line.lineIndex, line.lang, line.text);
    }
  }
}

/**
 * 가사 구조를 통째로 교체한다 (부분 수정보다 단순하고 페어링이 깨지지 않는다).
 *
 * 기본값이 'manual' 인 것이 중요하다 — 이 경로는 사람이 편집 UI 에서 저장할 때
 * 쓰인다. 자동 재정렬이 나중에 이 곡을 다시 건드리면 사람의 작업이 사라진다.
 */
export function replaceSections(
  songId: number,
  sections: SongInput['sections'],
  linesSource: LinesSource = 'manual',
): void {
  const target = conn();
  target.exec('BEGIN');
  try {
    target.prepare('DELETE FROM song_sections WHERE song_id = ?').run(songId);
    writeSections(songId, sections, linesSource);
    target.prepare('UPDATE songs SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), songId);
    target.exec('COMMIT');
  } catch (err) {
    target.exec('ROLLBACK');
    throw err;
  }
}

/**
 * 한 섹션의 줄만 교체한다 (재정렬 전용).
 *
 * 곡 전체를 다시 쓰지 않는 이유는 **사람이 손본 섹션을 건드리지 않기 위해서**다.
 * 같은 곡 안에서도 1절만 수동으로 고쳤을 수 있다.
 *
 * `lines_source` 는 그대로 둔다 — 재정렬 결과도 여전히 자동이므로 나중에
 * 알고리즘이 개선되면 다시 계산할 수 있어야 한다.
 */
export function replaceSectionLines(sectionId: number, lines: readonly SongLine[]): void {
  const target = conn();
  target.exec('BEGIN');
  try {
    target.prepare('DELETE FROM song_lines WHERE section_id = ?').run(sectionId);
    const insert = target.prepare(
      'INSERT INTO song_lines (section_id, line_index, lang, text) VALUES (?, ?, ?, ?)',
    );
    for (const line of lines) insert.run(sectionId, line.lineIndex, line.lang, line.text);
    target.exec('COMMIT');
  } catch (err) {
    target.exec('ROLLBACK');
    throw err;
  }
}

/**
 * 섹션 하나를 지운다 (후렴 병합 전용).
 *
 * 줄은 ON DELETE CASCADE 로 함께 지워진다. 남은 섹션의 position 은 다시 매긴다 —
 * 구멍이 남으면 진행 순서가 어긋난다.
 */
export function deleteSection(sectionId: number): void {
  const target = conn();
  const row = target.prepare('SELECT song_id FROM song_sections WHERE id = ?').get(sectionId) as
    | { song_id: number }
    | undefined;
  if (!row) return;

  target.exec('BEGIN');
  try {
    target.prepare('DELETE FROM song_sections WHERE id = ?').run(sectionId);
    const remaining = target
      .prepare('SELECT id FROM song_sections WHERE song_id = ? ORDER BY position')
      .all(row.song_id) as unknown as Array<{ id: number }>;
    const renumber = target.prepare('UPDATE song_sections SET position = ? WHERE id = ?');
    remaining.forEach((section, position) => renumber.run(position, section.id));
    target.exec('COMMIT');
  } catch (err) {
    target.exec('ROLLBACK');
    throw err;
  }
}

/**
 * 곡의 줄나눔을 '확인 완료'로 표시한다.
 *
 * 확인한 곡은 이후 어떤 자동 작업도 건드리지 않는다 — 재정렬·후렴 병합 모두
 * `lines_source = 'auto'` 인 섹션만 대상으로 한다.
 */
export function confirmLines(songId: number): boolean {
  const result = conn()
    .prepare("UPDATE song_sections SET lines_source = 'manual' WHERE song_id = ?")
    .run(songId);
  return Number(result.changes) > 0;
}

/** 확인 표시를 되돌린다 (잘못 눌렀을 때 — 다시 자동 작업 대상이 된다) */
export function unconfirmLines(songId: number): boolean {
  const result = conn()
    .prepare("UPDATE song_sections SET lines_source = 'auto' WHERE song_id = ?")
    .run(songId);
  return Number(result.changes) > 0;
}

/**
 * 검토 대기열.
 *
 * 정렬을 고를 수 있게 한 이유는 두 가지 쓰임이 다르기 때문이다 — 전체를 훑을
 * 때는 곡집·번호 순이 예측 가능하고, 시간이 없을 때는 자주 쓰는 곡부터가 낫다.
 */
export function reviewQueue(options: {
  sort?: 'number' | 'usage' | 'attention';
  pendingOnly?: boolean;
  songbookId?: string;
  limit?: number;
  offset?: number;
} = {}): ReviewQueue {
  const target = conn();
  const { sort = 'number', pendingOnly = false, songbookId, limit = 50, offset = 0 } = options;

  const where: string[] = [];
  const params: string[] = [];
  if (songbookId) {
    where.push('EXISTS (SELECT 1 FROM song_entries e WHERE e.song_id = s.id AND e.songbook_id = ?)');
    params.push(songbookId);
  }
  const filter = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const rows = target
    .prepare(
      `SELECT s.id, s.title, s.use_count,
              (SELECT count(*) FROM song_sections sec WHERE sec.song_id = s.id) AS section_count,
              (SELECT count(*) FROM song_lines l
                 JOIN song_sections sec ON sec.id = l.section_id
                WHERE sec.song_id = s.id) AS line_count,
              (SELECT count(*) FROM song_sections sec
                WHERE sec.song_id = s.id AND sec.lines_source = 'auto') AS pending_sections,
              (SELECT count(*) FROM song_sections sec
                WHERE sec.song_id = s.id AND sec.kind = 'verse') AS verse_count,
              (SELECT count(*) FROM (
                  SELECT sec.id FROM song_sections sec
                    JOIN song_lines l ON l.section_id = sec.id
                   WHERE sec.song_id = s.id
                   GROUP BY sec.id
                  HAVING count(*) % 2 = 1
               )) AS odd_sections
         FROM songs s
         ${filter}`,
    )
    .all(...params) as unknown as Array<{
    id: number;
    title: string;
    use_count: number;
    section_count: number;
    line_count: number;
    pending_sections: number;
    verse_count: number;
    odd_sections: number;
  }>;

  const all: ReviewItem[] = rows.map((row) => {
    // 절이 하나뿐이면 절 간 정렬을 못 했다 — 초안이 아니라 원본 줄나눔이다
    const reasons: string[] = [];
    if (row.verse_count < 2) reasons.push('절이 하나뿐 — 자동 정렬 못 함');
    if (row.odd_sections > 0) reasons.push(`홀수 행 ${row.odd_sections}개 절`);

    return {
      id: row.id,
      title: row.title,
      reference: '',
      confirmed: row.pending_sections === 0 && row.section_count > 0,
      sectionCount: row.section_count,
      lineCount: row.line_count,
      needsAttention: reasons.length > 0,
      attentionReasons: reasons,
      useCount: row.use_count,
    };
  });

  const filtered = pendingOnly ? all.filter((item) => !item.confirmed) : all;

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'usage') return b.useCount - a.useCount || a.id - b.id;
    if (sort === 'attention') return Number(b.needsAttention) - Number(a.needsAttention) || a.id - b.id;
    return a.id - b.id;
  });

  // 수록 정보는 필요한 만큼만 읽는다 (전체 곡에 대해 읽으면 느리다)
  const page = sorted.slice(offset, offset + limit).map((item) => {
    const entries = getEntries(item.id);
    const numbered = entries.find((entry) => entry.number !== undefined);
    return {
      ...item,
      reference: numbered ? `${numbered.songbookShortLabel}${numbered.number}` : '',
    };
  });

  return {
    total: filtered.length,
    confirmed: all.filter((item) => item.confirmed).length,
    items: page,
  };
}

/** 섹션의 줄나눔 출처를 바꾼다 (사람이 확인했다는 표시) */
export function markSectionLinesSource(sectionId: number, source: LinesSource): void {
  conn().prepare('UPDATE song_sections SET lines_source = ? WHERE id = ?').run(source, sectionId);
}

/** 재정렬 대상 곡 id 목록 (곡집으로 좁힐 수 있다) */
export function listSongIds(songbookId?: string): number[] {
  const rows = songbookId
    ? conn()
        .prepare('SELECT DISTINCT song_id AS id FROM song_entries WHERE songbook_id = ? ORDER BY song_id')
        .all(songbookId)
    : conn().prepare('SELECT id FROM songs ORDER BY id').all();
  return (rows as unknown as Array<{ id: number }>).map((row) => row.id);
}

/** 섹션을 줄나눔 출처와 함께 읽는다 (재정렬 판단에 필요하다) */
export function listSectionRows(songId: number): Array<{
  id: number;
  kind: string;
  label: string;
  linesSource: string;
  lines: SongLine[];
}> {
  const sections = conn()
    .prepare('SELECT id, kind, label, lines_source FROM song_sections WHERE song_id = ? ORDER BY position')
    .all(songId) as unknown as Array<{ id: number; kind: string; label: string; lines_source: string }>;

  const readLines = conn().prepare(
    'SELECT line_index, lang, text FROM song_lines WHERE section_id = ? ORDER BY line_index',
  );

  return sections.map((section) => ({
    id: section.id,
    kind: section.kind,
    label: section.label,
    linesSource: section.lines_source,
    lines: (readLines.all(section.id) as unknown as Array<{ line_index: number; lang: string; text: string }>).map(
      (row) => ({ lineIndex: row.line_index, lang: row.lang as SongLine['lang'], text: row.text }),
    ),
  }));
}

export function updateSongMeta(songId: number, patch: Partial<SongInput>): void {
  const existing = getSong(songId);
  if (!existing) throw new Error(`곡을 찾을 수 없습니다: ${songId}`);

  const next = { ...existing, ...patch };
  conn()
    .prepare(
      `UPDATE songs SET title = ?, title_norm = ?, title_alt = ?, author = ?, composer = ?,
        copyright = ?, ccli_number = ?, tags = ?, has_amen = ?, default_template_id = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(
      next.title,
      normalizeTitle(next.title),
      next.titleAlt ?? null,
      next.author ?? null,
      next.composer ?? null,
      next.copyright ?? null,
      next.ccliNumber ?? null,
      JSON.stringify(next.tags ?? []),
      next.hasAmen ? 1 : 0,
      next.defaultTemplateId ?? null,
      new Date().toISOString(),
      songId,
    );

  if (patch.entries) setEntries(songId, patch.entries);
}

export function deleteSong(songId: number): void {
  conn().prepare('DELETE FROM songs WHERE id = ?').run(songId);
}

/** 가져오기 스크립트가 재실행될 때 같은 출처를 지우고 다시 넣기 위한 용도 */
export function deleteBySource(source: string): number {
  const before = countSongs();
  conn().prepare('DELETE FROM songs WHERE source = ?').run(source);
  return before - countSongs();
}

/** 곡집 단위로 지운다 — 개별·일괄 갱신이 같은 방식으로 동작한다 */
export function deleteBySongbook(songbookId: string): number {
  const target = conn();
  // 다른 곡집에도 실려 있는 곡은 수록만 떼고 곡 자체는 남긴다
  const soleMembers = target
    .prepare(
      `SELECT song_id FROM song_entries WHERE songbook_id = ?
         AND song_id NOT IN (SELECT song_id FROM song_entries WHERE songbook_id <> ?)`,
    )
    .all(songbookId, songbookId) as unknown as Array<{ song_id: number }>;

  target.exec('BEGIN');
  try {
    target.prepare('DELETE FROM song_entries WHERE songbook_id = ?').run(songbookId);
    const remove = target.prepare('DELETE FROM songs WHERE id = ?');
    for (const row of soleMembers) remove.run(row.song_id);
    target.exec('COMMIT');
  } catch (err) {
    target.exec('ROLLBACK');
    throw err;
  }

  return soleMembers.length;
}

// ─────────────────────────────────────────────────────────────
// 사용 기록
// ─────────────────────────────────────────────────────────────

/**
 * 곡을 송출했음을 기록한다.
 *
 * 기록이 실패해도 송출을 막지 않는다 — 편의 기능이 예배를 방해해서는 안 된다.
 */
export function markUsed(songId: number): void {
  try {
    conn()
      .prepare(
        `UPDATE songs
         SET last_used_at = ?,
             used_seq = (SELECT coalesce(max(used_seq), 0) + 1 FROM songs),
             use_count = use_count + 1
         WHERE id = ?`,
      )
      .run(new Date().toISOString(), songId);
  } catch {
    // 무시
  }
}

/** 최근 송출한 곡 — 검색 없이 바로 꺼내는 경로 */
/** 즐겨찾기에 넣거나 뺀다. 바뀐 뒤 상태를 돌려준다. */
export function toggleFavorite(songId: number, next?: boolean): boolean | null {
  const row = conn().prepare('SELECT is_favorite FROM songs WHERE id = ?').get(songId) as
    | { is_favorite: number }
    | undefined;
  if (!row) return null;

  const value = next ?? row.is_favorite === 0;
  conn().prepare('UPDATE songs SET is_favorite = ? WHERE id = ?').run(value ? 1 : 0, songId);
  return value;
}

/**
 * 즐겨찾기 목록.
 *
 * 자주 쓴 곡 순으로 준다 — 즐겨찾기 안에서도 손이 먼저 가는 곡이 앞에 오는 편이
 * 낫다. 지정한 곡이 없으면 빈 배열이고, 그때 무엇을 보여줄지는 화면이 정한다.
 */
export function listFavorites(limit = 5): SongSearchHit[] {
  const rows = conn()
    .prepare('SELECT * FROM songs WHERE is_favorite = 1 ORDER BY use_count DESC, title LIMIT ?')
    .all(limit) as unknown as SongRow[];
  return rows.map((row) => toHit(row, 'title'));
}

export function listRecent(limit = 12): SongSearchHit[] {
  const rows = conn()
    .prepare('SELECT * FROM songs WHERE used_seq > 0 ORDER BY used_seq DESC LIMIT ?')
    .all(limit) as unknown as SongRow[];
  return rows.map((row) => toHit(row, 'title'));
}

/** 자주 송출한 곡 */
export function listFrequent(limit = 12): SongSearchHit[] {
  const rows = conn()
    .prepare('SELECT * FROM songs WHERE use_count > 0 ORDER BY use_count DESC, used_seq DESC LIMIT ?')
    .all(limit) as unknown as SongRow[];
  return rows.map((row) => toHit(row, 'title'));
}

// ─────────────────────────────────────────────────────────────
// 데이터 점검
// ─────────────────────────────────────────────────────────────

export type IncompleteReason = 'no_sections' | 'no_lines' | 'too_few_lines';

export interface IncompleteSong {
  id: number;
  title: string;
  entries: SongEntry[];
  sectionCount: number;
  lineCount: number;
  reason: IncompleteReason;
}

/**
 * 가사가 비었거나 지나치게 짧은 곡을 찾는다.
 *
 * 가져오기가 일부만 됐거나 제목만 들어온 곡을 **예배 전에** 발견하기 위한 것이다.
 * 한 줄짜리 곡은 정상일 수도 있어(짧은 경배송) 판단은 사람에게 맡기고 목록만 준다.
 */
export function listIncomplete(songbookId?: string, limit = 200): IncompleteSong[] {
  const rows = (
    songbookId
      ? conn()
          .prepare(
            `SELECT s.id, s.title,
                    (SELECT count(*) FROM song_sections WHERE song_id = s.id) AS sections,
                    (SELECT count(*) FROM song_lines l JOIN song_sections ss ON ss.id = l.section_id
                       WHERE ss.song_id = s.id AND trim(l.text) <> '') AS lines
             FROM songs s JOIN song_entries e ON e.song_id = s.id
             WHERE e.songbook_id = ?
             GROUP BY s.id HAVING sections = 0 OR lines <= 1
             ORDER BY lines, s.title LIMIT ?`,
          )
          .all(songbookId, limit)
      : conn()
          .prepare(
            `SELECT s.id, s.title,
                    (SELECT count(*) FROM song_sections WHERE song_id = s.id) AS sections,
                    (SELECT count(*) FROM song_lines l JOIN song_sections ss ON ss.id = l.section_id
                       WHERE ss.song_id = s.id AND trim(l.text) <> '') AS lines
             FROM songs s
             GROUP BY s.id HAVING sections = 0 OR lines <= 1
             ORDER BY lines, s.title LIMIT ?`,
          )
          .all(limit)
  ) as unknown as Array<{ id: number; title: string; sections: number; lines: number }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    entries: getEntries(row.id),
    sectionCount: row.sections,
    lineCount: row.lines,
    reason: row.sections === 0 ? 'no_sections' : row.lines === 0 ? 'no_lines' : 'too_few_lines',
  }));
}

/** 대응곡 링크 (양방향) */
export function linkSongs(aId: number, bId: number): void {
  if (aId === bId) return;
  const insert = conn().prepare('INSERT OR IGNORE INTO song_links (song_id, linked_id) VALUES (?, ?)');
  insert.run(aId, bId);
  insert.run(bId, aId);
}

export function unlinkSongs(aId: number, bId: number): void {
  conn().prepare('DELETE FROM song_links WHERE (song_id = ? AND linked_id = ?) OR (song_id = ? AND linked_id = ?)').run(
    aId,
    bId,
    bId,
    aId,
  );
}

/**
 * 제목이 같은 곡을 곡집 사이에서 자동으로 이어 준다.
 * 새찬송가 305장 ↔ 통일찬송가 405장 처럼 가사는 달라도 같은 찬송인 경우다.
 */
export function autoLinkByTitle(fromSongbookId: string, toSongbookId: string): number {
  const pairs = conn()
    .prepare(
      `SELECT a.id AS aId, b.id AS bId FROM songs a
         JOIN song_entries ea ON ea.song_id = a.id AND ea.songbook_id = ?
         JOIN songs b ON b.title_norm = a.title_norm AND b.id <> a.id
         JOIN song_entries eb ON eb.song_id = b.id AND eb.songbook_id = ?`,
    )
    .all(fromSongbookId, toSongbookId) as unknown as Array<{ aId: number; bId: number }>;

  for (const pair of pairs) linkSongs(pair.aId, pair.bId);
  return pairs.length;
}

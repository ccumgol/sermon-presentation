/**
 * 성경 DB 접근 계층. **읽기 전용**으로만 연다.
 *
 * 검색 전략이 언어별로 다르다 (docs/KNOWN-DATA-ISSUES.md §5):
 *  - 한국어 → LIKE 부분일치. FTS5 는 어절 단위라 '사랑'이 '사랑하사'를 못 찾는다
 *  - 영어·헬라어·히브리어 → FTS5 어절 검색 (빠르고 랭킹 지원)
 */

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { bibleMissingMessage } from '../../lib/bible-missing.ts';
import { formatRanges } from '../../lib/reference-parser.ts';
import type {
  BookMeta,
  Passage,
  PassageBlock,
  PassageQuery,
  SearchResult,
  Testament,
  Translation,
  Verse,
  VerseRange,
} from '../../shared/types.ts';
import { paths } from '../paths.ts';

/** 절 번호 상한 sentinel. 시편 119편(176절)보다 충분히 크다. */
const VERSE_MAX = 1_000_000;

/** 검색 결과 최대 반환 수 — UI 가 감당할 수 있는 양으로 자른다 */
const SEARCH_LIMIT = 300;

let db: DatabaseSync | null = null;

export class BibleDbMissingError extends Error {
  constructor(dbPath: string) {
    super(
      bibleMissingMessage(dbPath),
    );
    this.name = 'BibleDbMissingError';
  }
}

export function initBibleDb(): void {
  if (db) return;
  if (!existsSync(paths.bibleDb)) throw new BibleDbMissingError(paths.bibleDb);
  db = new DatabaseSync(paths.bibleDb, { readOnly: true });
}

export function closeBibleDb(): void {
  db?.close();
  db = null;
}

function conn(): DatabaseSync {
  if (!db) initBibleDb();
  return db!;
}

// ─────────────────────────────────────────────────────────────
// 메타데이터 (기동 시 한 번 읽어 캐시)
// ─────────────────────────────────────────────────────────────

interface TranslationRow {
  id: string;
  name: string;
  short_name: string;
  lang: string;
  direction: string;
  coverage: string;
  verse_count: number;
  sort_order: number;
}

let translationCache: Translation[] | null = null;

export function listTranslations(): Translation[] {
  if (translationCache) return translationCache;

  const rows = conn()
    .prepare('SELECT * FROM translations ORDER BY sort_order')
    .all() as unknown as TranslationRow[];

  translationCache = rows.map((r) => ({
    id: r.id,
    name: r.name,
    shortName: r.short_name,
    lang: r.lang,
    direction: r.direction === 'rtl' ? 'rtl' : 'ltr',
    coverage: JSON.parse(r.coverage) as Testament[],
    sortOrder: r.sort_order,
  }));
  return translationCache;
}

export function getTranslation(id: string): Translation | undefined {
  return listTranslations().find((t) => t.id === id);
}

interface BookRow {
  code: number;
  name_ko: string;
  abbr_ko: string;
  name_en: string;
  abbr_en: string;
  chapter_count: number;
  max_chapter_count: number;
  testament: string;
}

let bookCache: BookMeta[] | null = null;

export function listBooks(): BookMeta[] {
  if (bookCache) return bookCache;

  const rows = conn().prepare('SELECT * FROM books ORDER BY code').all() as unknown as BookRow[];
  bookCache = rows.map((r) => ({
    code: r.code,
    nameKo: r.name_ko,
    abbrKo: r.abbr_ko,
    nameEn: r.name_en,
    abbrEn: r.abbr_en,
    chapters: r.chapter_count,
    maxChapters: r.max_chapter_count,
    testament: r.testament === 'OT' ? 'OT' : 'NT',
  }));
  return bookCache;
}

/** 역본별 실제 장 수. 없으면 그 역본에 해당 책이 없다는 뜻. */
export function getChapterCount(translationId: string, book: number): number | null {
  const row = conn()
    .prepare('SELECT chapter_count AS c FROM translation_chapters WHERE translation_id = ? AND book = ?')
    .get(translationId, book) as { c: number } | undefined;
  return row?.c ?? null;
}

// ─────────────────────────────────────────────────────────────
// 본문 조회
// ─────────────────────────────────────────────────────────────

/**
 * 한 구간의 절을 가져온다. 장을 넘는 범위(요 3:16-4:2)도 한 번의 질의로 처리한다.
 * startVerse/endVerse 가 null 이면 장 전체를 뜻한다.
 */
function selectRange(translationId: string, range: VerseRange): Verse[] {
  const startVerse = range.startVerse ?? 1;
  const endVerse = range.endVerse ?? VERSE_MAX;

  const rows = conn()
    .prepare(
      `SELECT book, chapter, verse, text FROM verses
       WHERE translation_id = ? AND book = ?
         AND (chapter > ? OR (chapter = ? AND verse >= ?))
         AND (chapter < ? OR (chapter = ? AND verse <= ?))
       ORDER BY chapter, verse`,
    )
    .all(
      translationId,
      range.book,
      range.startChapter,
      range.startChapter,
      startVerse,
      range.endChapter,
      range.endChapter,
      endVerse,
    ) as unknown as Verse[];

  return rows;
}

/** 구간의 첫 절을 덮는 소제목 */
function selectHeading(translationId: string, range: VerseRange): string | undefined {
  const verse = range.startVerse ?? 1;
  const row = conn()
    .prepare(
      `SELECT text FROM headings
       WHERE translation_id = ? AND book = ? AND chapter = ?
         AND start_verse <= ? AND (end_verse IS NULL OR end_verse >= ?)
       ORDER BY start_verse DESC LIMIT 1`,
    )
    .get(translationId, range.book, range.startChapter, verse, verse) as { text: string } | undefined;
  return row?.text;
}

/**
 * 이 역본이 해당 구간을 담고 있는지.
 * 헬라어로 창세기를 조회하는 경우처럼 '없는 본문'을 조용히 구분한다.
 */
function coversRange(translation: Translation, range: VerseRange): boolean {
  const testament: Testament = range.book <= 39 ? 'OT' : 'NT';
  if (!translation.coverage.includes(testament)) return false;

  const chapters = getChapterCount(translation.id, range.book);
  if (chapters === null) return false;
  return range.startChapter <= chapters;
}

export function getPassage(query: PassageQuery): Passage {
  const { ranges, translationIds } = query;
  const blocks: PassageBlock[] = [];

  for (const translationId of translationIds) {
    const translation = getTranslation(translationId);
    if (!translation) continue;

    const verses: Verse[] = [];
    let covered = false;

    for (const range of ranges) {
      if (!coversRange(translation, range)) continue;
      covered = true;
      verses.push(...selectRange(translationId, range));
    }

    blocks.push({
      translationId: translation.id,
      translationName: translation.name,
      lang: translation.lang,
      direction: translation.direction,
      verses,
      // 범위 자체가 없는 역본과, 있지만 절이 안 나온 경우를 함께 표시한다
      ...(covered && verses.length > 0 ? {} : { unavailable: true }),
    });
  }

  const firstRange = ranges[0];
  const primaryId = translationIds[0];
  const heading =
    query.includeHeading && firstRange && primaryId ? selectHeading(primaryId, firstRange) : undefined;

  return {
    reference: formatRanges(ranges, 'full'),
    referenceAbbr: formatRanges(ranges, 'abbr'),
    referenceEn: formatRanges(ranges, 'en'),
    ranges,
    blocks,
    ...(heading ? { heading } : {}),
  };
}

// ─────────────────────────────────────────────────────────────
// 검색
// ─────────────────────────────────────────────────────────────

export interface SearchOptions {
  translationId: string;
  /** 'OT' | 'NT' | undefined(전체) */
  testament?: Testament;
  limit?: number;
}

interface HitRow {
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

function referenceOf(book: number, chapter: number, verse: number): string {
  const meta = listBooks().find((b) => b.code === book);
  return `${meta?.abbrKo ?? book} ${chapter}:${verse}`;
}

/**
 * 한국어 역본은 LIKE 부분일치를 쓴다.
 * FTS5 unicode61 은 어절 단위라 '사랑'으로 '사랑하사'를 찾지 못한다 (26건 vs 557건).
 */
function searchLike(term: string, options: SearchOptions): { rows: HitRow[]; total: number } {
  const limit = options.limit ?? SEARCH_LIMIT;
  const testamentFilter = options.testament === 'OT' ? 'AND book <= 39' : options.testament === 'NT' ? 'AND book >= 40' : '';

  // LIKE 의 와일드카드 문자를 이스케이프한다 — 사용자가 '%' 를 검색어로 넣을 수 있다
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
  const pattern = `%${escaped}%`;

  const total = (
    conn()
      .prepare(
        `SELECT count(*) AS c FROM verses
         WHERE translation_id = ? AND text LIKE ? ESCAPE '\\' ${testamentFilter}`,
      )
      .get(options.translationId, pattern) as { c: number }
  ).c;

  const rows = conn()
    .prepare(
      `SELECT book, chapter, verse, text FROM verses
       WHERE translation_id = ? AND text LIKE ? ESCAPE '\\' ${testamentFilter}
       ORDER BY book, chapter, verse LIMIT ?`,
    )
    .all(options.translationId, pattern, limit) as unknown as HitRow[];

  return { rows, total };
}

/** 영어·원어는 FTS5 어절 검색. 히브리어·헬라어는 NFC 정규화가 필수다. */
function searchFts(term: string, options: SearchOptions): { rows: HitRow[]; total: number } {
  const limit = options.limit ?? SEARCH_LIMIT;
  const testamentFilter = options.testament === 'OT' ? 'AND v.book <= 39' : options.testament === 'NT' ? 'AND v.book >= 40' : '';

  // FTS5 질의 문법 문자를 제거해 구문 오류와 의도치 않은 연산자 해석을 막는다
  const sanitized = term.replace(/["*():^-]/g, ' ').trim().normalize('NFC');
  if (sanitized.length === 0) return { rows: [], total: 0 };
  const match = sanitized
    .split(/\s+/)
    .map((word) => `"${word}"`)
    .join(' ');

  const total = (
    conn()
      .prepare(
        `SELECT count(*) AS c FROM verses_fts f JOIN verses v ON v.id = f.rowid
         WHERE f.text MATCH ? AND v.translation_id = ? ${testamentFilter}`,
      )
      .get(match, options.translationId) as { c: number }
  ).c;

  const rows = conn()
    .prepare(
      `SELECT v.book, v.chapter, v.verse, v.text FROM verses_fts f JOIN verses v ON v.id = f.rowid
       WHERE f.text MATCH ? AND v.translation_id = ? ${testamentFilter}
       ORDER BY v.book, v.chapter, v.verse LIMIT ?`,
    )
    .all(match, options.translationId, limit) as unknown as HitRow[];

  return { rows, total };
}

export function search(term: string, options: SearchOptions): SearchResult {
  const trimmed = term.trim();
  const translation = getTranslation(options.translationId);
  const strategy: 'like' | 'fts' = translation?.lang === 'ko' ? 'like' : 'fts';

  if (trimmed.length === 0) {
    return { term: trimmed, strategy, total: 0, truncated: false, hits: [] };
  }

  const { rows, total } = strategy === 'like' ? searchLike(trimmed, options) : searchFts(trimmed, options);
  const limit = options.limit ?? SEARCH_LIMIT;

  return {
    term: trimmed,
    strategy,
    total,
    truncated: total > rows.length,
    hits: rows.map((r) => ({
      translationId: options.translationId,
      book: r.book,
      chapter: r.chapter,
      verse: r.verse,
      text: r.text,
      reference: referenceOf(r.book, r.chapter, r.verse),
    })),
  };
}

/** 빌드 정보 — 컨트롤 패널에서 DB 상태를 보여줄 때 쓴다 */
export function getBuildInfo(): Record<string, string> {
  const rows = conn().prepare('SELECT key, value FROM build_info').all() as unknown as Array<{
    key: string;
    value: string;
  }>;
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

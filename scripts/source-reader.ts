/**
 * 원본 성경 소스 읽기. 빌드와 검증이 **같은 코드로** 읽어야 원문 대조가 의미를 갖는다.
 *
 * 지원 형식
 *  - `android` : 안드로이드 성경앱 SQLite — bible(bibleCode, Jang, Jul, Cont)
 *  - `flat`    : 다른 SQLite 배치       — bible(book, chapter, verse, content)
 *  - `json`    : 책 배열 JSON          — [{ book: 'Genesis', chapters: [{ '1': { '1': '본문' } }] }]
 *
 * 원본은 어떤 경우에도 읽기 전용으로만 연다.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { lookupBook } from '../lib/books.ts';
import type { SourceSchema, SourceVariant } from './bible-sources.ts';

export interface RawVerse {
  book: number;
  chapter: number;
  verse: number;
  text: string | null;
}

export interface RawHeading {
  book: number;
  chapter: number;
  startVerse: number | null;
  /** 원본에 NULL 이 있다 — '이 절부터 장 끝까지'를 뜻한다 */
  endVerse: number | null;
  text: string;
}

export interface SourceData {
  verses: RawVerse[];
  headings: RawHeading[];
}

/** SQLite 스키마별 절 조회 SQL */
const SELECT_VERSES: Record<'android' | 'flat', string> = {
  android: 'SELECT bibleCode AS book, Jang AS chapter, Jul AS verse, Cont AS text FROM bible ORDER BY 1, 2, 3',
  flat: 'SELECT book, chapter, verse, content AS text FROM bible ORDER BY 1, 2, 3',
};

/** 소제목 조회 — android 스키마 전용 */
const SELECT_HEADINGS = `
  SELECT DISTINCT b.bibleCode AS book, b.Jang AS chapter,
         t.StartJul AS startVerse, t.EndJul AS endVerse, t.Cont AS text
  FROM bible b
  JOIN bible_theme t ON t.ThemeCd = b.ThemeCd
  WHERE t.Cont IS NOT NULL AND trim(t.Cont) <> ''
  ORDER BY 1, 2, 3
`;

export class SourceReadError extends Error {}

function hasTable(db: DatabaseSync, name: string): boolean {
  return db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name=?").get(name) !== undefined;
}

function readSqlite(filePath: string, schema: 'android' | 'flat'): SourceData {
  const db = new DatabaseSync(filePath, { readOnly: true });
  try {
    const verses = db.prepare(SELECT_VERSES[schema]).all() as unknown as RawVerse[];

    // flat 스키마에는 소제목 테이블이 없다
    const headings =
      schema === 'android' && hasTable(db, 'bible_theme')
        ? (db.prepare(SELECT_HEADINGS).all() as unknown as RawHeading[])
        : [];

    return { verses, headings };
  } finally {
    db.close();
  }
}

/** JSON 원본의 한 책 */
interface JsonBook {
  /** 영문 책 이름 — 'Genesis', '1 Chronicles' */
  book: string;
  /** [{ '<장>': { '<절>': '본문' } }, …] */
  chapters: Array<Record<string, Record<string, string>>>;
}

/**
 * 책 배열 JSON 을 읽는다.
 *
 * 책 이름은 영문 문자열이므로 `lib/books.ts` 의 별칭 테이블로 해석한다
 * (배열 순서를 신뢰하지 않는다 — 순서가 어긋난 파일이 와도 이름으로 맞춘다).
 * 해석하지 못하는 이름이 있으면 조용히 건너뛰지 않고 실패시킨다.
 */
export function readJsonBible(filePath: string): SourceData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new SourceReadError(`JSON 을 읽을 수 없습니다 (${path.basename(filePath)}): ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new SourceReadError(`JSON 최상위가 배열이 아닙니다 (${path.basename(filePath)})`);
  }

  const verses: RawVerse[] = [];
  const unresolved: string[] = [];

  for (const entry of parsed as JsonBook[]) {
    if (typeof entry?.book !== 'string' || !Array.isArray(entry.chapters)) {
      throw new SourceReadError(`JSON 항목 형식이 올바르지 않습니다 (${path.basename(filePath)})`);
    }

    const lookup = lookupBook(entry.book);
    if (lookup.code === undefined) {
      unresolved.push(entry.book);
      continue;
    }

    for (const chapterEntry of entry.chapters) {
      for (const [chapterKey, verseMap] of Object.entries(chapterEntry)) {
        const chapter = Number(chapterKey);
        if (!Number.isInteger(chapter)) {
          throw new SourceReadError(`장 번호가 정수가 아닙니다: ${entry.book} '${chapterKey}'`);
        }

        for (const [verseKey, text] of Object.entries(verseMap)) {
          const verse = Number(verseKey);
          if (!Number.isInteger(verse)) {
            throw new SourceReadError(`절 번호가 정수가 아닙니다: ${entry.book} ${chapter}:'${verseKey}'`);
          }
          verses.push({ book: lookup.code, chapter, verse, text });
        }
      }
    }
  }

  if (unresolved.length > 0) {
    throw new SourceReadError(
      `해석하지 못한 책 이름이 있습니다 (${path.basename(filePath)}): ${unresolved.join(', ')}\n` +
        `lib/books.ts 의 별칭 테이블에 추가하세요.`,
    );
  }

  // JSON 객체의 키 순서를 신뢰하지 않는다 — SQLite 경로와 같은 순서를 보장한다
  verses.sort((a, b) => a.book - b.book || a.chapter - b.chapter || a.verse - b.verse);

  return { verses, headings: [] };
}

const READERS: Record<SourceSchema, (filePath: string) => SourceData> = {
  android: (filePath) => readSqlite(filePath, 'android'),
  flat: (filePath) => readSqlite(filePath, 'flat'),
  json: readJsonBible,
};

/** 원본 폴더에서 한 역본의 절·소제목을 읽는다. */
export function readSource(sourceDir: string, variant: SourceVariant): SourceData {
  return READERS[variant.schema](path.join(sourceDir, variant.file));
}

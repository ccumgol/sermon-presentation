/**
 * 성경 참조 파서. 오퍼레이터 입력 속도를 좌우하는 핵심 모듈.
 *
 * 지원 형태
 *   요 3:16 · 요3:16 · 요한복음 3장 16절 · John 3:16 · 1요 2:1 · I Samuel 3:1
 *   시 23 · 시편 23편 · 창 1-2 · 요 3:16-17 · 요 3:16-4:2 · 마 5:3-12; 6:9-13
 *   ㅇㅎ 3:16 (초성)
 *
 * 원칙: 확정하지 못하면 임의로 고르지 않고 후보 목록을 돌려준다.
 */

import type { BookCandidate, ParseErrorCode, ParseResult, VerseRange } from '../shared/types.ts';
import { getBook, lookupBook } from './books.ts';

/**
 * 책 이름 부분과 숫자 부분을 분리한다. 그룹 1은 입력 원문을 그대로 보존한다
 * (예: 'Isaiah' 가 로마숫자 I + saiah 로 망가지지 않도록).
 *
 * 한글 쪽은 '요한1서', '고린도2서' 처럼 이름 중간에 숫자가 끼는 표기를 허용한다.
 */
const SEGMENT_RE =
  /^((?:[1-3]|I{1,3})?\s*(?:[ㄱ-ㅎ가-힣]+(?:\d[ㄱ-ㅎ가-힣]+)?|[A-Za-z]+(?:\s+[A-Za-z]+)*))\s*(.*)$/;

/** N[:V][-[N:]V] */
const RANGE_RE = /^(\d+)(?::(\d+))?(?:-(?:(\d+):)?(\d+))?$/;

/** 콤마로 이어붙인 후속 구간 — 앞 구간의 책·장을 물려받는다 */
const CONTINUATION_RE = /^(\d+)(?:-(\d+))?$/;

/**
 * 입력을 정규화한다.
 * 한글 표기(장/절/편)를 콜론 형태로 바꾸고, 각종 전각·유사 기호를 통일한다.
 */
export function normalizeInput(raw: string): string {
  return raw
    .replace(/[：]/g, ':')
    .replace(/[～~–—−]/g, '-')
    .replace(/[，、]/g, ',')
    .replace(/[；]/g, ';')
    // '요 3.16' 처럼 마침표를 장:절 구분자로 쓰는 표기 — 남은 마침표 제거보다 먼저 처리한다
    .replace(/(\d)\s*\.\s*(\d)/g, '$1:$2')
    // 'Gen. 1:1' 의 약어 마침표
    .replace(/\./g, '')
    .replace(/(\d)\s*장/g, '$1:')
    .replace(/(\d)\s*절/g, '$1')
    .replace(/(\d)\s*편/g, '$1')
    .replace(/\s*:\s*/g, ':')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s*;\s*/g, ';')
    .replace(/:\s*$/, ':') // '3장' → '3:' 형태 유지
    .replace(/\s+/g, ' ')
    .trim();
}

/** 실패 변종만 가리키는 별칭. 내부 헬퍼들이 성공 결과를 반환할 수 없게 좁혀 둔다. */
type ParseFailure = Extract<ParseResult, { ok: false }>;

function fail(error: ParseErrorCode, message: string, candidates: BookCandidate[] = []): ParseFailure {
  return { ok: false, error, message, candidates };
}

function toCandidates(items: Array<{ code: number; matched: string }>): BookCandidate[] {
  return items.flatMap((item) => {
    const book = getBook(item.code);
    if (!book) return [];
    return [{ code: book.code, nameKo: book.nameKo, nameEn: book.nameEn, matched: item.matched }];
  });
}

export function parseReference(input: string): ParseResult {
  const normalized = normalizeInput(input ?? '');
  if (normalized.length === 0) return fail('EMPTY', '참조를 입력하세요');

  const ranges: VerseRange[] = [];
  let currentBook: number | null = null;

  for (const rawSegment of normalized.split(';')) {
    const segment = rawSegment.trim();
    if (segment.length === 0) continue;

    const match = SEGMENT_RE.exec(segment);
    let bookCode: number;
    let tail: string;

    if (match) {
      const bookText = match[1]!.trim();
      tail = (match[2] ?? '').trim();

      const lookup = lookupBook(bookText);
      if (lookup.code === undefined) {
        const candidates = toCandidates(lookup.candidates);
        return candidates.length > 0
          ? fail('BOOK_AMBIGUOUS', `'${bookText}' 에 해당하는 책이 여럿입니다`, candidates)
          : fail('BOOK_NOT_FOUND', `'${bookText}' 라는 성경책을 찾지 못했습니다`);
      }
      bookCode = lookup.code;
    } else {
      // 책 이름 없이 숫자만 온 구간 — 앞 구간의 책을 물려받는다 (마 5:3; 6:9)
      if (currentBook === null) {
        return fail('SYNTAX', `'${segment}' 를 해석할 수 없습니다`);
      }
      bookCode = currentBook;
      tail = segment;
    }

    currentBook = bookCode;

    const parsed = parseTail(bookCode, tail);
    if (!parsed.ok) return parsed;
    ranges.push(...parsed.ranges);
  }

  if (ranges.length === 0) return fail('SYNTAX', '해석할 수 있는 구간이 없습니다');

  return {
    ok: true,
    ranges,
    reference: formatRanges(ranges, 'full'),
    referenceAbbr: formatRanges(ranges, 'abbr'),
    referenceEn: formatRanges(ranges, 'en'),
  };
}

type TailResult = { ok: true; ranges: VerseRange[] } | ParseFailure;

function parseTail(bookCode: number, tail: string): TailResult {
  const book = getBook(bookCode)!;

  // 숫자가 전혀 없는 경우
  if (tail.length === 0) {
    if (book.chapters === 1) {
      return { ok: true, ranges: [{ book: bookCode, startChapter: 1, startVerse: null, endChapter: 1, endVerse: null }] };
    }
    return fail('CHAPTER_REQUIRED', `${book.nameKo} 는 ${book.chapters}장까지 있습니다 — 장 번호를 입력하세요`);
  }

  // '3:' (3장 전체)
  const cleaned = tail.endsWith(':') ? tail.slice(0, -1) : tail;

  const parts = cleaned.split(',').map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) return fail('SYNTAX', `'${tail}' 를 해석할 수 없습니다`);

  const out: VerseRange[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    const previous = out[out.length - 1];

    const range =
      i === 0 || part.includes(':')
        ? parseFullPart(bookCode, part)
        : parseContinuation(bookCode, part, previous);

    if (!range.ok) return range;

    const validation = validate(bookCode, range.range);
    if (validation) return validation;

    out.push(range.range);
  }

  return { ok: true, ranges: out };
}

type PartResult = { ok: true; range: VerseRange } | ParseFailure;

function parseFullPart(bookCode: number, part: string): PartResult {
  const m = RANGE_RE.exec(part);
  if (!m) return fail('SYNTAX', `'${part}' 형식을 알 수 없습니다`);

  const startChapter = Number(m[1]);
  const startVerse = m[2] !== undefined ? Number(m[2]) : null;
  const dashChapter = m[3] !== undefined ? Number(m[3]) : null;
  const dashNumber = m[4] !== undefined ? Number(m[4]) : null;

  let endChapter = startChapter;
  let endVerse = startVerse;

  if (dashNumber !== null) {
    if (dashChapter !== null) {
      // '3:16-4:2'
      endChapter = dashChapter;
      endVerse = dashNumber;
    } else if (startVerse === null) {
      // '3-4' → 장 범위
      endChapter = dashNumber;
      endVerse = null;
    } else {
      // '3:16-17' → 같은 장 안의 절 범위
      endChapter = startChapter;
      endVerse = dashNumber;
    }
  }

  return { ok: true, range: { book: bookCode, startChapter, startVerse, endChapter, endVerse } };
}

function parseContinuation(bookCode: number, part: string, previous: VerseRange | undefined): PartResult {
  if (!previous || previous.startVerse === null) {
    // 앞 구간이 장 단위였다면 후속 숫자도 장으로 본다
    return parseFullPart(bookCode, part);
  }

  const m = CONTINUATION_RE.exec(part);
  if (!m) return fail('SYNTAX', `'${part}' 형식을 알 수 없습니다`);

  const startVerse = Number(m[1]);
  const endVerse = m[2] !== undefined ? Number(m[2]) : startVerse;
  const chapter = previous.endChapter;

  return {
    ok: true,
    range: { book: bookCode, startChapter: chapter, startVerse, endChapter: chapter, endVerse },
  };
}

function validate(bookCode: number, range: VerseRange): ParseFailure | null {
  const book = getBook(bookCode)!;

  // 검증 상한은 maxChapters — 요엘 4장(마소라)·다니엘 14장(공동번역)처럼
  // 역본마다 장 구분이 다르므로, 파싱은 허용하고 그 장이 없는 역본은
  // 본문 조회 단계에서 '이 역본에 없는 본문'으로 처리한다.
  for (const chapter of [range.startChapter, range.endChapter]) {
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > book.maxChapters) {
      const hint =
        book.maxChapters === book.chapters ? `1-${book.chapters}장` : `1-${book.chapters}장, 일부 역본 ${book.maxChapters}장`;
      return fail('CHAPTER_OUT_OF_RANGE', `${book.nameKo} ${chapter}장은 없습니다 (${hint})`);
    }
  }

  for (const verse of [range.startVerse, range.endVerse]) {
    if (verse !== null && (!Number.isInteger(verse) || verse < 1)) {
      return fail('VERSE_INVALID', `절 번호가 올바르지 않습니다: ${verse}`);
    }
  }

  if (range.endChapter < range.startChapter) {
    return fail('RANGE_REVERSED', '끝 장이 시작 장보다 앞입니다');
  }
  if (
    range.endChapter === range.startChapter &&
    range.startVerse !== null &&
    range.endVerse !== null &&
    range.endVerse < range.startVerse
  ) {
    return fail('RANGE_REVERSED', '끝 절이 시작 절보다 앞입니다');
  }

  return null;
}

// ─────────────────────────────────────────────────────────────
// 참조 문자열 포맷
// ─────────────────────────────────────────────────────────────

export type ReferenceStyle = 'full' | 'abbr' | 'en';

function bookLabel(bookCode: number, style: ReferenceStyle): string {
  const book = getBook(bookCode)!;
  if (style === 'en') return book.nameEn;
  if (style === 'abbr') return book.abbrKo;
  return book.nameKo;
}

function numericLabel(range: VerseRange, style: ReferenceStyle): string {
  const korean = style !== 'en';
  const { startChapter, startVerse, endChapter, endVerse } = range;

  if (startVerse === null) {
    const body = startChapter === endChapter ? `${startChapter}` : `${startChapter}-${endChapter}`;
    return korean ? `${body}장` : body;
  }

  if (startChapter === endChapter) {
    if (endVerse === null) return `${startChapter}:${startVerse}-`;
    if (endVerse === startVerse) return `${startChapter}:${startVerse}`;
    return `${startChapter}:${startVerse}-${endVerse}`;
  }

  const tail = endVerse === null ? (korean ? `${endChapter}장` : `${endChapter}`) : `${endChapter}:${endVerse}`;
  return `${startChapter}:${startVerse}-${tail}`;
}

/** 참조 배열을 사람이 읽는 문자열로. 같은 책이 이어지면 책 이름을 반복하지 않는다. */
export function formatRanges(ranges: VerseRange[], style: ReferenceStyle): string {
  const chunks: string[] = [];
  let previousBook: number | null = null;

  for (const range of ranges) {
    const numeric = numericLabel(range, style);
    if (range.book === previousBook) {
      chunks.push(numeric);
    } else {
      chunks.push(`${bookLabel(range.book, style)} ${numeric}`);
      previousBook = range.book;
    }
  }

  return chunks.join('; ');
}

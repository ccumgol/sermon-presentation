/**
 * 검색 결과에서 **검색어가 걸린 자리**를 표시한다.
 *
 * 왜 필요한가: 성경 검색은 절 전체를 돌려준다. `여호와` 로 찾으면 5,912절이 나오는데,
 * 한 절이 두세 줄이라 어디가 걸린 자리인지 눈으로 훑어야 한다. 강조가 있으면 목록을
 * 위에서 아래로 **읽지 않고 지나갈** 수 있다.
 *
 * 방식이 둘인 이유는 **서버가 두 가지로 찾기 때문**이다 (`server/db/bible.ts`).
 * 한국어는 부분일치(LIKE), 그 밖은 어절 검색(FTS5). 강조도 그에 맞춰야 실제로 걸린
 * 자리와 어긋나지 않는다 — 어절 검색인데 부분일치로 칠하면 `love` 를 찾았을 때
 * `beloved` 의 가운데가 칠해져, 걸리지도 않은 절이 걸린 것처럼 보인다.
 *
 * **강조가 빠지는 경우가 있다.** FTS 토크나이저가 `remove_diacritics 2` 라
 * `agape` 로 `ágape` 를 찾는다 — 이쪽은 글자가 달라 칠하지 못한다. 강조는 눈을
 * 돕는 표시일 뿐이고 **없다고 결과가 틀린 것은 아니므로** 그대로 둔다.
 */

export interface HighlightPart {
  text: string;
  /** 검색어가 걸린 자리인가 */
  hit: boolean;
}

/** 서버가 실제로 쓴 검색 방식 (`SearchResult.strategy`) */
export type SearchStrategy = 'like' | 'fts';

/** 정규식 특수문자를 그대로의 글자로 만든다 — `요 3:16?` 같은 검색어가 깨지지 않게 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * FTS5 에서 낱말로 볼 수 있는 글자.
 *
 * `unicode61` 토크나이저는 글자·숫자가 아닌 것에서 낱말을 끊는다. 그래서 `love` 는
 * `love,` `“love”` 에는 걸리지만 `beloved` 안에는 걸리지 않는다. 같은 기준으로 본다.
 */
function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

interface Range {
  start: number;
  end: number;
}

/**
 * 겹치거나 **사이에 공백밖에 없는** 구간을 하나로 합친다.
 *
 * 공백까지 넘어가는 이유: `love your` 로 찾으면 어절 검색은 두 낱말에 따로 걸린다.
 * 그대로 칠하면 `[love] [your]` 처럼 가운데가 끊겨, 한 구를 찾은 것이 아니라
 * 두 낱말이 우연히 붙은 것처럼 보인다. 넘어가는 것이 공백뿐이라 글자를 삼킬 일은 없다.
 */
function mergeRanges(ranges: Range[], text: string): Range[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    const gapIsBlank = last !== undefined && text.slice(last.end, range.start).trim().length === 0;
    if (last && range.start <= last.end) {
      if (range.end > last.end) merged[merged.length - 1] = { start: last.start, end: range.end };
    } else if (last && gapIsBlank) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function findAll(text: string, needle: string, wholeWord: boolean): Range[] {
  if (needle.length === 0) return [];
  const found: Range[] = [];
  const re = new RegExp(escapeRegExp(needle), 'giu');
  for (const m of text.matchAll(re)) {
    const start = m.index;
    const end = start + m[0].length;
    if (wholeWord && (isWordChar(text[start - 1]) || isWordChar(text[end]))) continue;
    found.push({ start, end });
  }
  return found;
}

/**
 * 검색어가 걸린 자리를 잘라 돌려준다. 이어 붙이면 원문 그대로다.
 *
 * 걸린 자리가 없으면 `[{ text, hit: false }]` 하나 — 부르는 쪽이 결과가 없는 경우를
 * 따로 다루지 않아도 된다.
 */
export function highlightParts(text: string, term: string, strategy: SearchStrategy): HighlightPart[] {
  const whole = [{ text, hit: false }];
  const trimmed = term.trim();
  if (text.length === 0 || trimmed.length === 0) return whole;

  const ranges =
    strategy === 'like'
      ? findAll(text, trimmed, false)
      : // 어절 검색은 낱말마다 따로 걸린다 — 서버가 FTS 질의를 만들 때 쓰는 것과 같은
        // 글자를 떼어 내고(`["*():^-]`) 공백으로 나눈다
        trimmed
          .replace(/["*():^-]/g, ' ')
          .split(/\s+/)
          .filter((word) => word.length > 0)
          .flatMap((word) => findAll(text, word, true));

  const merged = mergeRanges(ranges, text);
  if (merged.length === 0) return whole;

  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) parts.push({ text: text.slice(cursor, range.start), hit: false });
    parts.push({ text: text.slice(range.start, range.end), hit: true });
    cursor = range.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}

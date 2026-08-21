/**
 * 인용구 — 성경 본문을 **절 단위 낱개 항목**으로 쪼갠다.
 *
 * ## 성경 항목과 무엇이 다른가
 *
 * 성경 항목은 '창 1:1-6' **하나**다. 순서표에서 머리 줄 한 개로 접히고, 펼치면 6장이
 * 나온다. 그것이 본문 낭독에는 맞다 — 한 덩이로 다루는 것이 옳다.
 *
 * 설교 중 인용은 다르다. 절이 설교 흐름에 **흩어져** 놓이므로 하나로 묶이면 사이사이에
 * 끼워 넣을 수 없고, 절 하나만 순서를 바꾸는 것도 안 된다. 그래서 인용구는 절마다
 * 독립된 항목이 되고, 묶는 머리 줄('카테고리')을 만들지 않는다 (사용자 요청 2026-08-20).
 *
 * ## 미리보기는 **라벨일 뿐이다**
 *
 * 순서표 목록에 `창 1:1 태초에 하나님이 천지를 창조하시니라` 처럼 본문을 함께 보여
 * 달라는 요청이 있었다. 그런데 컨트롤 패널은 **펼친 항목 하나만** 본문을 조회한다
 * (`resolveItem`). 여섯 줄의 본문을 조회 없이 그리려면 항목이 담고 있어야 한다.
 *
 * `songTitle`·`readingTitle` 을 항목에 담는 것과 같은 이유다. 그리고 같은 원칙이
 * 그대로 적용된다 — **화면에 나가는 본문은 언제나 DB 에서 다시 읽는다.** 여기 담는
 * 것은 목록에 보일 짧은 글자이고, 그래서 잘라도 된다.
 */

import { getBook } from './books.ts';
import { formatRanges } from './reference-parser.ts';
import type { Verse } from '../shared/types.ts';

/** 목록 한 줄에 들어갈 만큼. 넘으면 잘라서 … 를 붙인다 */
export const PREVIEW_MAX = 44;

export interface VerseQuote {
  /** 절 하나를 가리키는 참조 — '창 1:1' */
  ref: string;
  /** 목록 줄에 보일 본문. 잘렸을 수 있다 (`PREVIEW_MAX`) */
  preview: string;
}

function shorten(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > PREVIEW_MAX ? `${trimmed.slice(0, PREVIEW_MAX)}…` : trimmed;
}

/**
 * 절 목록을 인용구 항목의 재료로 바꾼다.
 *
 * **합치지 않는다.** 같은 절이 두 번 와도 두 개를 만든다 — 여러 역본을 한꺼번에
 * 넘기는 실수를 여기서 감추면 항목이 조용히 사라져, 예배 중에 알게 된다.
 * 부르는 쪽이 주 역본 하나만 넘기는 것이 맞다.
 */
export function verseQuotes(verses: readonly Verse[]): VerseQuote[] {
  return verses.map((verse) => ({ ref: verseRef(verse), preview: shorten(verse.text) }));
}

/**
 * 절 하나의 참조 — '창 1:1'.
 *
 * `formatRanges` 는 **올바른 책 번호를 전제한다**(공유 함수이고 파서가 이미 검증한
 * 값을 받는다). 여기서는 서버 응답을 그대로 받으므로 모르는 번호가 올 수 있다.
 * 공유 함수를 고치는 대신 이쪽에서 막는다 — 그때도 장·절은 살려서 사람이 무엇이
 * 잘못됐는지 볼 수 있게 한다. 항목을 조용히 버리지 않는다.
 */
function verseRef(verse: Verse): string {
  if (!getBook(verse.book)) return `?${verse.book} ${verse.chapter}:${verse.verse}`;
  return formatRanges(
    [
      {
        book: verse.book,
        startChapter: verse.chapter,
        startVerse: verse.verse,
        endChapter: verse.chapter,
        endVerse: verse.verse,
      },
    ],
    'abbr',
  );
}

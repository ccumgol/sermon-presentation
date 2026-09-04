/**
 * 검색어 강조 — 서버가 실제로 찾은 자리와 어긋나면 안 된다.
 *
 * 서버는 두 가지로 찾는다(`server/db/bible.ts`): 한국어는 부분일치(LIKE),
 * 그 밖은 어절 검색(FTS5). 강조가 이 둘을 구분하지 않으면 `love` 를 찾았을 때
 * `beloved` 의 가운데가 칠해져, **걸리지도 않은 절이 걸린 것처럼** 보인다.
 */

import { describe, expect, it } from 'vitest';

import { highlightParts, type HighlightPart } from '../../lib/search-highlight.ts';

/** 잘라 놓은 조각을 이어 붙이면 원문 그대로여야 한다 — 강조가 글자를 잃으면 안 된다 */
function joined(parts: readonly HighlightPart[]): string {
  return parts.map((p) => p.text).join('');
}

function hits(parts: readonly HighlightPart[]): string[] {
  return parts.filter((p) => p.hit).map((p) => p.text);
}

describe('한국어 — 부분일치', () => {
  it('검색어가 그대로 있는 자리를 칠한다', () => {
    const text = '네 아들 네 사랑하는 독자 이삭을 데리고';
    const parts = highlightParts(text, '사랑', 'like');
    expect(hits(parts)).toEqual(['사랑']);
    expect(joined(parts)).toBe(text);
  });

  it('한 절에 여러 번 나오면 모두 칠한다', () => {
    const parts = highlightParts('사랑은 오래 참고 사랑은 온유하며', '사랑', 'like');
    expect(hits(parts)).toEqual(['사랑', '사랑']);
  });

  it('낱말 가운데도 칠한다 — 한국어에는 낱말 경계가 없다', () => {
    // '은혜로우신' 은 '은혜' 로 찾으면 실제로 걸린다. 안 칠하면 왜 나왔는지 알 수 없다
    const parts = highlightParts('은혜로우신 하나님', '은혜', 'like');
    expect(hits(parts)).toEqual(['은혜']);
  });

  it('띄어쓰기까지 그대로여야 걸린다 (서버 LIKE 와 같은 규칙)', () => {
    expect(hits(highlightParts('주의 은혜를 아네', '주의은혜', 'like'))).toEqual([]);
    expect(hits(highlightParts('주의 은혜를 아네', '주의 은혜', 'like'))).toEqual(['주의 은혜']);
  });
});

describe('영어·원어 — 어절 검색', () => {
  it('낱말로 걸린 자리만 칠한다', () => {
    const parts = highlightParts('This is my Son, whom I love', 'love', 'fts');
    expect(hits(parts)).toEqual(['love']);
  });

  it('긴 낱말 **안**은 칠하지 않는다 — FTS 는 거기에 걸리지 않는다', () => {
    expect(hits(highlightParts('my beloved son', 'love', 'fts'))).toEqual([]);
  });

  it('구두점에 붙어 있어도 낱말이다', () => {
    expect(hits(highlightParts('“Love,” he said.', 'love', 'fts'))).toEqual(['Love']);
  });

  it('대소문자를 가리지 않는다', () => {
    expect(hits(highlightParts('LOVE and Love and love', 'love', 'fts'))).toEqual(['LOVE', 'Love', 'love']);
  });

  it('여러 낱말은 낱말마다 따로 칠한다 (붙어 있지 않아도 된다)', () => {
    const parts = highlightParts('Love your neighbor as yourself', 'love neighbor', 'fts');
    expect(hits(parts)).toEqual(['Love', 'neighbor']);
  });

  it('사이가 공백뿐이면 한 덩어리로 칠한다 — 구를 찾은 것이 보이게', () => {
    const parts = highlightParts('love your neighbor', 'love your', 'fts');
    expect(hits(parts)).toEqual(['love your']);
  });

  it('사이에 글자가 있으면 따로 칠한다 — 없는 구를 있는 것처럼 보이면 안 된다', () => {
    const parts = highlightParts('love and honor your king', 'love your', 'fts');
    expect(hits(parts)).toEqual(['love', 'your']);
  });

  it('FTS 질의 문자는 떼고 본다 (서버가 떼는 것과 같다)', () => {
    expect(hits(highlightParts('a righteous man', '"righteous"', 'fts'))).toEqual(['righteous']);
  });
});

describe('망가뜨리지 않는다', () => {
  it('정규식 특수문자가 든 검색어도 글자 그대로 찾는다', () => {
    expect(hits(highlightParts('보라 (그가) 오신다', '(그가)', 'like'))).toEqual(['(그가)']);
  });

  it('검색어가 비면 통째로 하나', () => {
    const parts = highlightParts('아무 글', '   ', 'like');
    expect(parts).toEqual([{ text: '아무 글', hit: false }]);
  });

  it('본문이 비면 통째로 하나', () => {
    expect(highlightParts('', '사랑', 'like')).toEqual([{ text: '', hit: false }]);
  });

  it('걸린 자리가 없으면 통째로 하나 — 부르는 쪽이 따로 처리하지 않게', () => {
    expect(highlightParts('은혜와 평강', '사랑', 'like')).toEqual([{ text: '은혜와 평강', hit: false }]);
  });

  it('무엇을 넣어도 이어 붙이면 원문이다', () => {
    const text = 'Love, love — LOVED and beloved (love).';
    for (const strategy of ['like', 'fts'] as const) {
      for (const term of ['love', 'Love', 'love beloved', '', '(love)']) {
        expect(joined(highlightParts(text, term, strategy))).toBe(text);
      }
    }
  });
});

/**
 * 인용구 — 성경 본문을 **절 단위 낱개 항목**으로 쪼갠다.
 *
 * 성경 항목은 '창 1:1-6' 하나가 머리 줄이 되고 펼치면 6장이 나온다. 인용구는 그
 * 머리 줄('카테고리')이 없어야 한다 — 설교 중 인용은 순서 사이에 흩어 놓는 것이라
 * 하나로 묶이면 옮길 수 없다 (사용자 요청 2026-08-20).
 */

import { describe, expect, it } from 'vitest';

import { itemTitle } from '../../lib/item-title.ts';
import { describeItem, isExpandable } from '../../lib/plan-deck.ts';
import { PREVIEW_MAX, verseQuotes } from '../../lib/verse-quotes.ts';
import type { Verse } from '../../shared/types.ts';

const GEN = (verse: number, text: string): Verse => ({ book: 1, chapter: 1, verse, text });

describe('절마다 하나씩', () => {
  it('여섯 절이면 여섯 개가 된다', () => {
    const out = verseQuotes([GEN(1, '태초에'), GEN(2, '땅이'), GEN(3, '빛이')]);
    expect(out).toHaveLength(3);
  });

  it('참조는 절 하나를 가리킨다', () => {
    const out = verseQuotes([GEN(1, '태초에'), GEN(2, '땅이')]);
    expect(out.map((q) => q.ref)).toEqual(['창 1:1', '창 1:2']);
  });

  it('본문을 미리보기로 담는다 — 목록 줄에 쓴다', () => {
    const out = verseQuotes([GEN(1, '태초에 하나님이 천지를 창조하시니라')]);
    expect(out[0]?.preview).toBe('태초에 하나님이 천지를 창조하시니라');
  });

  it('장이 넘어가도 참조가 맞는다', () => {
    const out = verseQuotes([
      { book: 1, chapter: 1, verse: 31, text: '보시기에' },
      { book: 1, chapter: 2, verse: 1, text: '천지와' },
    ]);
    expect(out.map((q) => q.ref)).toEqual(['창 1:31', '창 2:1']);
  });

  it('다른 책도 맞는다', () => {
    const out = verseQuotes([{ book: 43, chapter: 3, verse: 16, text: '하나님이' }]);
    expect(out[0]?.ref).toBe('요 3:16');
  });
});

describe('미리보기는 라벨이다 — 짧게 자른다', () => {
  it(`${PREVIEW_MAX}자를 넘으면 줄이고 … 를 붙인다`, () => {
    const long = '가'.repeat(PREVIEW_MAX + 20);
    const preview = verseQuotes([GEN(1, long)])[0]?.preview ?? '';
    expect(preview.length).toBe(PREVIEW_MAX + 1);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('짧으면 그대로 둔다 — 굳이 자르지 않는다', () => {
    const preview = verseQuotes([GEN(1, '짧다')])[0]?.preview;
    expect(preview).toBe('짧다');
  });

  it('앞뒤 공백을 다듬는다', () => {
    expect(verseQuotes([GEN(1, '  태초에  ')])[0]?.preview).toBe('태초에');
  });

  it('본문이 비어 있어도 항목은 만든다 — 참조는 살아 있다', () => {
    const out = verseQuotes([GEN(1, '   ')]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ ref: '창 1:1', preview: '' });
  });
});

describe('경계', () => {
  it('빈 목록이면 빈 목록', () => {
    expect(verseQuotes([])).toEqual([]);
  });

  it('같은 절이 두 번 오면 두 번 만든다 — 조용히 합치지 않는다', () => {
    // 여러 역본을 한꺼번에 넘기는 실수를 감추면 항목이 조용히 사라진다
    const out = verseQuotes([GEN(1, '개역개정'), GEN(1, '다른 역본')]);
    expect(out).toHaveLength(2);
  });

  it('알 수 없는 책 번호는 버리지 않고 알 수 있게 둔다', () => {
    const out = verseQuotes([{ book: 999, chapter: 1, verse: 1, text: '?' }]);
    expect(out).toHaveLength(1);
    expect(out[0]?.ref).toContain('1:1');
  });
});

// ─────────────────────────────────────────────────────────────
// 인용구가 순서표에서 어떻게 다루어지는가
// ─────────────────────────────────────────────────────────────

describe('인용구 항목의 성격', () => {
  const quote = {
    id: 'q1',
    type: 'bible' as const,
    ref: '창 1:1',
    primary: 'nkrv',
    secondary: [],
    quote: true as const,
    preview: '태초에 하나님이 천지를 창조하시니라',
  };
  const passage = { id: 'b1', type: 'bible' as const, ref: '창 1:1-6', primary: 'nkrv', secondary: [] };

  it('펼칠 수 없다 — 절 하나 = 화면 하나이므로 한 번 클릭으로 송출된다', () => {
    expect(isExpandable(quote)).toBe(false);
    expect(isExpandable(passage), '본문 낭독은 펼쳐서 골라야 한다').toBe(true);
  });

  it('제목 슬라이드를 띄우지 않는다 — 요청이 "타이틀 없이" 였다', () => {
    expect(itemTitle(quote)).toBeUndefined();
    expect(itemTitle(passage), '본문 낭독은 제목을 띄운다').toBe('창 1:1-6');
  });

  it('목록 줄에 본문이 함께 보인다', () => {
    expect(describeItem(quote)).toBe('창 1:1 태초에 하나님이 천지를 창조하시니라');
  });

  it('미리보기가 없으면 참조만 보인다 — 없어도 망가지지 않는다', () => {
    const { preview: _drop, ...noPreview } = quote;
    expect(describeItem(noPreview)).toBe('창 1:1');
  });

  it('본문 낭독 항목의 줄은 그대로 참조다', () => {
    expect(describeItem(passage)).toBe('창 1:1-6');
  });
});

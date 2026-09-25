/**
 * **다시 올릴 때 보던 자리로 돌아가기** (`resumeIndex`).
 *
 * ## 왜 검사하는가
 *
 * 이 셈이 틀리면 **예배 중에 엉뚱한 슬라이드가 회중 화면에 나간다.** 그것도
 * 사람이 '올리기' 를 누른 직후라, 누른 사람은 자기가 그렇게 시킨 줄 안다.
 *
 * | 지키는 것 | 왜 |
 * |---|---|
 * | 항목 id 로 짝짓는다 | 못 푼 항목은 경계에서 빠져 **자리 번호가 밀린다** |
 * | 장이 줄면 그 항목의 마지막 장 | 넘치면 다음 항목이 나간다 — 아직 안 할 것이 튀어나온다 |
 * | 항목이 사라지면 **뒤로** 물러난다 | 앞으로 밀면 안 지나온 것이 나간다. 뒤는 이미 지나왔다 |
 * | 짚을 데가 없으면 첫 장 | 모를 때는 처음이 안전하다 |
 */

import { describe, expect, it } from 'vitest';

import { resumeIndex } from '../../lib/plan-deck.ts';
import type { Deck, DeckGroup, SlidePayload } from '../../shared/types.ts';

/** 내용은 상관없다 — 셈은 번호만 본다 */
const slide = (): SlidePayload => ({ kind: 'text', text: 'x' }) as unknown as SlidePayload;

function deckOf(groups: Array<{ itemId: string; start: number }>, total: number): Deck {
  return {
    reference: '주일예배',
    slides: Array.from({ length: total }, slide),
    labels: Array.from({ length: total }, () => ''),
    index: 0,
    groups: groups.map(({ itemId, start }): DeckGroup => ({ label: itemId, startIndex: start, itemId })),
  };
}

/** 기도(0-1) · 찬양(2-5) · 성경(6-9) */
const before = deckOf([
  { itemId: 'pray', start: 0 },
  { itemId: 'song', start: 2 },
  { itemId: 'bible', start: 6 },
], 10);

describe('resumeIndex', () => {
  it('올라간 것이 없으면 첫 장', () => {
    expect(resumeIndex(before, null)).toBe(0);
  });

  it('보던 항목이 그대로면 같은 장으로 돌아간다', () => {
    // 찬양의 세 번째 장(index 4)을 보고 있었다
    expect(resumeIndex(before, { groups: before.groups, index: 4 })).toBe(4);
  });

  it('앞 항목의 장 수가 늘어도 보던 항목의 같은 자리를 찾는다', () => {
    // 기도가 2장 → 5장이 되어 뒤가 전부 밀렸다. 찬양의 세 번째 장은 이제 7 이다
    const next = deckOf([
      { itemId: 'pray', start: 0 },
      { itemId: 'song', start: 5 },
      { itemId: 'bible', start: 9 },
    ], 13);
    expect(resumeIndex(next, { groups: before.groups, index: 4 })).toBe(7);
  });

  it('보던 항목의 장이 줄면 그 항목의 마지막 장으로 잡는다', () => {
    // 찬양이 4장 → 2장. 세 번째 장은 없으니 다음 항목으로 넘어가면 안 된다
    const next = deckOf([
      { itemId: 'pray', start: 0 },
      { itemId: 'song', start: 2 },
      { itemId: 'bible', start: 4 },
    ], 8);
    expect(resumeIndex(next, { groups: before.groups, index: 5 })).toBe(3);
  });

  it('보던 항목이 사라지면 그 앞의 항목으로 물러난다', () => {
    // 찬양을 지웠다 → 기도의 첫 장으로. 성경(뒤)으로 가지 않는다
    const next = deckOf([
      { itemId: 'pray', start: 0 },
      { itemId: 'bible', start: 2 },
    ], 6);
    expect(resumeIndex(next, { groups: before.groups, index: 4 })).toBe(0);
  });

  it('앞이 통째로 사라지면 첫 장', () => {
    const next = deckOf([{ itemId: 'later', start: 0 }], 3);
    expect(resumeIndex(next, { groups: before.groups, index: 4 })).toBe(0);
  });

  it('다른 순서표에서 넘어온 것이면 첫 장', () => {
    // id 가 하나도 안 맞는다
    const next = deckOf([
      { itemId: 'other-a', start: 0 },
      { itemId: 'other-b', start: 3 },
    ], 6);
    expect(resumeIndex(next, { groups: before.groups, index: 4 })).toBe(0);
  });

  it('마지막 항목의 마지막 장도 덱 밖으로 넘지 않는다', () => {
    const next = deckOf([
      { itemId: 'pray', start: 0 },
      { itemId: 'song', start: 2 },
      { itemId: 'bible', start: 4 },
    ], 5);
    // 성경의 네 번째 장(index 9)을 보고 있었는데 이제 한 장뿐이다
    expect(resumeIndex(next, { groups: before.groups, index: 9 })).toBe(4);
  });

  it('경계가 없는 묶음(성경 조회 등)에서 넘어오면 첫 장', () => {
    expect(resumeIndex(before, { index: 3 })).toBe(0);
  });

  it('새 묶음에 경계가 없으면 첫 장', () => {
    const next: Deck = { reference: 'x', slides: [slide()], labels: [''], index: 0 };
    expect(resumeIndex(next, { groups: before.groups, index: 4 })).toBe(0);
  });

  it('옛 묶음에 항목 id 가 없으면(옛 판) 첫 장', () => {
    // itemId 를 넣기 전에 올린 덱이 상태에 남아 있을 수 있다
    const old = { groups: before.groups!.map(({ itemId, ...rest }) => rest), index: 4 };
    expect(resumeIndex(before, old)).toBe(0);
  });

  it('빈 묶음이면 첫 장', () => {
    const empty: Deck = { reference: 'x', slides: [], labels: [], index: 0, groups: [] };
    expect(resumeIndex(empty, { groups: before.groups, index: 4 })).toBe(0);
  });

  it('첫 항목의 첫 장에 있었으면 그대로 0', () => {
    expect(resumeIndex(before, { groups: before.groups, index: 0 })).toBe(0);
  });
});

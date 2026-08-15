/**
 * 예배 순서 항목 단위 이동 (PgDn/PgUp) 테스트.
 *
 * 예배 중 "다음 순서로" 는 슬라이드 하나가 아니라 항목 하나를 넘기는 동작이다.
 * 경계에서 순환하지 않는 것이 중요하다 — 마지막에서 처음으로 돌아가면 사고다.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as state from '../../server/state.ts';
import type { Deck, SlidePayload } from '../../shared/types.ts';

function slide(text: string): SlidePayload {
  return { kind: 'text', lines: [text] };
}

/** 항목 3개 (2장 + 3장 + 1장 = 6슬라이드) */
function planDeck(): Deck {
  return {
    reference: '주일 1부',
    slides: Array.from({ length: 6 }, (_, i) => slide(`s${i}`)),
    labels: ['1', '2', '1', '2', '3', '1'],
    index: 0,
    groups: [
      { label: '찬송 1', startIndex: 0 },
      { label: '요 3:16', startIndex: 2 },
      { label: '광고', startIndex: 5 },
    ],
  };
}

beforeEach(() => {
  state.resetStateForTest();
});

describe('gotoGroup — 다음 항목', () => {
  it('다음 항목의 첫 슬라이드로 간다', () => {
    state.loadDeck(planDeck());
    expect(state.gotoGroup(1)).toBe(true);
    expect(state.getDeck()?.index).toBe(2);
    expect(state.gotoGroup(1)).toBe(true);
    expect(state.getDeck()?.index).toBe(5);
  });

  it('항목 중간에서도 다음 항목의 시작으로 간다', () => {
    state.loadDeck(planDeck());
    state.goto(3); // 두 번째 항목의 2번째 슬라이드
    expect(state.gotoGroup(1)).toBe(true);
    expect(state.getDeck()?.index).toBe(5);
  });

  it('마지막 항목에서는 넘어가지 않는다 (순환 금지)', () => {
    state.loadDeck(planDeck());
    state.goto(5);
    expect(state.gotoGroup(1)).toBe(false);
    expect(state.getDeck()?.index).toBe(5);
  });
});

describe('gotoGroup — 이전 항목', () => {
  it('항목 중간에서는 그 항목의 처음으로 간다', () => {
    state.loadDeck(planDeck());
    state.goto(3);
    expect(state.gotoGroup(-1)).toBe(true);
    expect(state.getDeck()?.index).toBe(2);
  });

  it('항목 처음에서는 이전 항목의 처음으로 간다', () => {
    state.loadDeck(planDeck());
    state.goto(2);
    expect(state.gotoGroup(-1)).toBe(true);
    expect(state.getDeck()?.index).toBe(0);
  });

  it('첫 항목에서는 더 가지 않는다', () => {
    state.loadDeck(planDeck());
    expect(state.gotoGroup(-1)).toBe(false);
    expect(state.getDeck()?.index).toBe(0);
  });
});

describe('gotoGroup — 항목 경계가 없는 덱', () => {
  it('처음/끝으로 간다 (아무 일도 안 하는 것보다 예측 가능하다)', () => {
    state.loadDeck({
      reference: '요 3:16-18',
      slides: [slide('a'), slide('b'), slide('c')],
      labels: ['1', '2', '3'],
      index: 0,
    });

    expect(state.gotoGroup(1)).toBe(true);
    expect(state.getDeck()?.index).toBe(2);
    expect(state.gotoGroup(-1)).toBe(true);
    expect(state.getDeck()?.index).toBe(0);
  });

  it('덱이 없으면 아무 일도 하지 않는다', () => {
    expect(state.gotoGroup(1)).toBe(false);
    expect(state.gotoGroup(-1)).toBe(false);
  });
});

describe('currentGroup', () => {
  it('현재 위치의 항목을 알려준다', () => {
    state.loadDeck(planDeck());
    expect(state.currentGroup()).toEqual({ index: 0, total: 3, label: '찬송 1' });

    state.goto(3);
    expect(state.currentGroup()).toEqual({ index: 1, total: 3, label: '요 3:16' });

    state.goto(5);
    expect(state.currentGroup()).toEqual({ index: 2, total: 3, label: '광고' });
  });

  it('항목 경계가 없으면 null', () => {
    state.loadDeck({ reference: 'x', slides: [slide('a')], labels: ['1'], index: 0 });
    expect(state.currentGroup()).toBeNull();
  });
});

describe('항목 이동도 revision 을 올린다', () => {
  it('출력 페이지가 순서를 판별할 수 있어야 한다', () => {
    state.loadDeck(planDeck());
    const before = state.getState().revision;
    state.gotoGroup(1);
    expect(state.getState().revision).toBeGreaterThan(before);
  });

  it('이동하지 못했으면 revision 을 올리지 않는다', () => {
    state.loadDeck(planDeck());
    const before = state.getState().revision;
    state.gotoGroup(-1); // 첫 항목이라 실패
    expect(state.getState().revision).toBe(before);
  });
});

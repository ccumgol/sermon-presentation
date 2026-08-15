/**
 * 송출 상태 저장소 테스트.
 *
 * 여기서 지키는 성질이 예배 안정성의 근거다:
 *  - revision 단조 증가 (연타 시 순서 뒤바뀜 방어)
 *  - 묶음 경계에서 넘어가지 않음
 *  - 블랙은 내용을 잃지 않음
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { Deck, SlidePayload } from '../../shared/types.ts';
import * as state from '../../server/state.ts';

function slide(text: string): SlidePayload {
  return {
    kind: 'bible',
    reference: '요 3:16',
    blocks: [
      {
        translationId: 'nkrv',
        translationName: '개역개정',
        lang: 'ko',
        direction: 'ltr',
        verses: [{ book: 43, chapter: 3, verse: 16, text }],
      },
    ],
  };
}

function deck(count: number): Deck {
  return {
    reference: '요 3:16-18',
    slides: Array.from({ length: count }, (_, i) => slide(`절 ${i + 1}`)),
    labels: Array.from({ length: count }, (_, i) => `3:${16 + i}`),
    index: 0,
  };
}

beforeEach(() => {
  state.resetStateForTest();
});

describe('revision', () => {
  it('변경마다 단조 증가한다', () => {
    const start = state.getState().revision;
    state.show(slide('가'));
    state.show(slide('나'));
    state.setBlank(true);
    state.setBlank(false);
    expect(state.getState().revision).toBe(start + 4);
  });

  it('변화 없는 조작은 revision 을 올리지 않는다', () => {
    state.setBlank(false); // 이미 false
    expect(state.getState().revision).toBe(0);

    state.loadDeck(deck(2));
    const after = state.getState().revision;
    state.prev(); // 이미 첫 슬라이드
    expect(state.getState().revision).toBe(after);
  });
});

describe('loadDeck', () => {
  it('묶음을 올리고 첫 슬라이드를 송출한다', () => {
    state.loadDeck(deck(3));
    expect(state.getDeck()?.slides).toHaveLength(3);
    expect(state.getDeck()?.index).toBe(0);
    expect(state.getState().slide).toEqual(slide('절 1'));
    expect(state.getState().blank).toBe(false);
  });

  it('범위를 벗어난 index 를 안전하게 보정한다', () => {
    state.loadDeck({ ...deck(3), index: 99 });
    expect(state.getDeck()?.index).toBe(2);

    state.loadDeck({ ...deck(3), index: -5 });
    expect(state.getDeck()?.index).toBe(0);

    state.loadDeck({ ...deck(3), index: 1.5 });
    expect(state.getDeck()?.index).toBe(0);
  });

  it('빈 묶음은 화면을 비운다', () => {
    state.loadDeck({ reference: '요 3:16', slides: [], labels: [], index: 0 });
    expect(state.getState().slide).toBeNull();
  });

  it('블랙 상태에서 새 묶음을 올리면 블랙이 풀린다', () => {
    state.show(slide('가'));
    state.setBlank(true);
    state.loadDeck(deck(2));
    expect(state.getState().blank).toBe(false);
  });
});

describe('next / prev', () => {
  it('순서대로 이동한다', () => {
    state.loadDeck(deck(3));
    expect(state.next()).toBe(true);
    expect(state.getDeck()?.index).toBe(1);
    expect(state.next()).toBe(true);
    expect(state.getDeck()?.index).toBe(2);
    expect(state.prev()).toBe(true);
    expect(state.getDeck()?.index).toBe(1);
  });

  it('끝을 넘어가지 않는다 (순환하지 않음)', () => {
    // 마지막에서 한 번 더 누르면 처음으로 돌아가는 동작은 예배 중 사고다
    state.loadDeck(deck(2));
    state.next();
    expect(state.getDeck()?.index).toBe(1);
    expect(state.next()).toBe(false);
    expect(state.getDeck()?.index).toBe(1);

    state.prev();
    expect(state.getDeck()?.index).toBe(0);
    expect(state.prev()).toBe(false);
    expect(state.getDeck()?.index).toBe(0);
  });

  it('연타해도 경계에서 멈추고 위치가 정확하다', () => {
    state.loadDeck(deck(4));
    for (let i = 0; i < 20; i++) state.next();
    expect(state.getDeck()?.index).toBe(3);
    for (let i = 0; i < 20; i++) state.prev();
    expect(state.getDeck()?.index).toBe(0);
  });

  it('묶음이 없으면 아무 일도 하지 않는다', () => {
    state.show(slide('단일'));
    expect(state.next()).toBe(false);
    expect(state.prev()).toBe(false);
  });

  it('goto 는 범위를 보정한다', () => {
    state.loadDeck(deck(3));
    state.goto(99);
    expect(state.getDeck()?.index).toBe(2);
    state.goto(-1);
    expect(state.getDeck()?.index).toBe(0);
  });
});

describe('blank / restore', () => {
  it('블랙은 슬라이드를 지우지 않는다', () => {
    // 내용을 유지해야 복구가 즉시 이뤄진다
    state.show(slide('가'));
    state.setBlank(true);
    expect(state.getState().blank).toBe(true);
    expect(state.getState().slide).not.toBeNull();
  });

  it('restore 는 블랙을 풀고 마지막 슬라이드를 되살린다', () => {
    state.show(slide('가'));
    state.setBlank(true);
    state.restore();
    expect(state.getState().blank).toBe(false);
    expect(state.getState().slide).toEqual(slide('가'));
  });

  it('비운 뒤에도 restore 로 마지막 슬라이드를 되돌린다', () => {
    state.show(slide('가'));
    state.clear();
    expect(state.getState().slide).toBeNull();
    state.restore();
    expect(state.getState().slide).toEqual(slide('가'));
  });

  it('clear 는 묶음도 비운다', () => {
    state.loadDeck(deck(3));
    state.clear();
    expect(state.getDeck()).toBeNull();
    expect(state.getState().slide).toBeNull();
  });
});

describe('show', () => {
  it('단일 슬라이드를 송출하고 묶음을 버린다', () => {
    state.loadDeck(deck(3));
    state.show(slide('단일'));
    expect(state.getDeck()).toBeNull();
    expect(state.getState().slide).toEqual(slide('단일'));
  });
});

describe('subscribe', () => {
  it('변경마다 상태와 묶음을 함께 알린다', () => {
    const seen: Array<{ revision: number; deckSize: number | null }> = [];
    const unsubscribe = state.subscribe((live, currentDeck) => {
      seen.push({ revision: live.revision, deckSize: currentDeck?.slides.length ?? null });
    });

    state.loadDeck(deck(2));
    state.next();
    unsubscribe();
    state.next(); // 구독 해제 후에는 안 들어와야 한다

    expect(seen).toEqual([
      { revision: 1, deckSize: 2 },
      { revision: 2, deckSize: 2 },
    ]);
  });
});

describe('불변성', () => {
  it('넘긴 묶음 객체를 변형하지 않는다', () => {
    const original = deck(3);
    const snapshot = JSON.parse(JSON.stringify(original));
    state.loadDeck(original);
    state.next();
    expect(original).toEqual(snapshot);
  });

  it('상태 갱신은 새 객체를 만든다', () => {
    state.show(slide('가'));
    const before = state.getState();
    state.setBlank(true);
    expect(state.getState()).not.toBe(before);
    expect(before.blank).toBe(false);
  });
});

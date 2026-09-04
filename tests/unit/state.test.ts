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
    state.loadDeck(deck(2));
    state.next();
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

  it('블랙 상태에서 새 묶음을 올려도 블랙은 유지된다', () => {
    // 2026-08-15 동작 변경 — 예전에는 여기서 블랙이 풀렸다.
    // 실사용에서 '블랙을 켜 뒀는데 다른 슬라이드를 누르니 화면이 나가 버린다'로 드러났다.
    // 블랙은 사람이 끄기 전까지 유지되는 것이 맞다(블랙 해제·Esc).
    state.loadDeck(deck(1));
    state.setBlank(true);
    state.loadDeck(deck(2));
    expect(state.getState().blank).toBe(true);
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
    // 화면에 내용은 있는데 묶음이 없는 상태 — 비우기 뒤 복구로 실제로 이렇게 된다
    state.loadDeck(deck(3));
    state.clear();
    state.restore();
    expect(state.getState().slide).not.toBeNull();
    expect(state.getDeck()).toBeNull();
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
    state.loadDeck(deck(1));
    state.setBlank(true);
    expect(state.getState().blank).toBe(true);
    expect(state.getState().slide).not.toBeNull();
  });

  it('restore 는 블랙을 풀고 마지막 슬라이드를 되살린다', () => {
    state.loadDeck(deck(1));
    state.setBlank(true);
    state.restore();
    expect(state.getState().blank).toBe(false);
    expect(state.getState().slide).toEqual(slide('절 1'));
  });

  it('비운 뒤에도 restore 로 마지막 슬라이드를 되돌린다', () => {
    state.loadDeck(deck(1));
    state.clear();
    expect(state.getState().slide).toBeNull();
    state.restore();
    expect(state.getState().slide).toEqual(slide('절 1'));
  });

  it('clear 는 묶음도 비운다', () => {
    state.loadDeck(deck(3));
    state.clear();
    expect(state.getDeck()).toBeNull();
    expect(state.getState().slide).toBeNull();
  });
});

describe('블랙 유지 (사람이 끌 때까지)', () => {
  it('블랙 중 다른 슬라이드를 골라도 블랙이 풀리지 않는다', () => {
    // 블랙은 '지금 화면을 가린다'는 결정이라, 그 사이 다음 것을 준비해도
    // 화면은 계속 가려져 있어야 한다. 예전에는 여기서 풀려 화면이 나가 버렸다.
    state.loadDeck(deck(3));
    state.setBlank(true);

    state.goto(2);
    expect(state.getState().blank).toBe(true);
    state.next();
    expect(state.getState().blank).toBe(true);
    state.prev();
    expect(state.getState().blank).toBe(true);
  });

  it('덱을 새로 올려도 블랙이 유지된다', () => {
    state.setBlank(true);
    state.loadDeck(deck(2));
    expect(state.getState().blank).toBe(true);
  });

  it('사람이 끄면 풀린다 (블랙 해제 · Esc)', () => {
    state.loadDeck(deck(2));
    state.setBlank(true);
    state.setBlank(false);
    expect(state.getState().blank).toBe(false);

    state.setBlank(true);
    state.restore();
    expect(state.getState().blank).toBe(false);
  });
});

describe('비우기 · 복구 — 묶음 없는 한 장', () => {
  /**
   * 이 상태가 실제로 생긴다: 오퍼레이터가 **비우기**를 누르면 묶음까지 버려지고,
   * 이어서 **복구**를 누르면 마지막 슬라이드만 화면에 돌아온다. 진행 위치는 없다.
   *
   * 전에는 `show()`(단일 슬라이드 송출)로 이 상태를 만들어 검사했는데, 그것을
   * 보내는 곳이 화면에 하나도 없어 **실제로는 일어나지 않는 경로**를 검사하고 있었다
   * (2026-09-03 §4.6 C). 지금은 사람이 누르는 두 버튼으로 같은 상태를 만든다.
   */
  it('비우기 뒤 복구하면 슬라이드만 남고 묶음은 없다', () => {
    state.loadDeck(deck(3));
    state.next();
    state.clear();
    state.restore();
    expect(state.getDeck()).toBeNull();
    expect(state.getState().slide).toEqual(slide('절 2'));
    expect(state.getState().cursor).toBeNull();
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
    state.loadDeck(deck(1));
    const before = state.getState();
    state.setBlank(true);
    expect(state.getState()).not.toBe(before);
    expect(before.blank).toBe(false);
  });
});

describe('항목별 템플릿 (덱 경계에서 따라오기)', () => {
  /** 항목 셋: 0~1번 슬라이드 = 템플릿 7, 2~3번 = 지정 없음, 4번 = 템플릿 9 */
  function grouped(): Deck {
    return {
      ...deck(5),
      groups: [
        { label: '찬양', startIndex: 0, templateId: 7 },
        { label: '본문', startIndex: 2 },
        { label: '광고', startIndex: 4, templateId: 9 },
      ],
    };
  }

  it('올릴 때 첫 항목의 템플릿이 적용된다', () => {
    state.loadDeck(grouped());
    expect(state.getState().templateId).toBe(7);
  });

  it('경계를 넘으면 그 항목의 템플릿으로 바뀐다', () => {
    state.loadDeck(grouped());
    state.goto(4);
    expect(state.getState().templateId).toBe(9);
  });

  it('지정이 없는 항목에서는 바꾸지 않는다 — 앞 항목 것을 그대로 쓴다', () => {
    // 지정 없는 항목에서 기본값으로 되돌리면, 앞에서 고른 템플릿이 예고 없이 풀린다
    state.loadDeck(grouped());
    state.goto(3);
    expect(state.getState().templateId).toBe(7);
  });

  it('groups 가 없는 덱(단일 본문 조회)은 템플릿을 건드리지 않는다', () => {
    const before = state.getState().templateId;
    state.loadDeck(deck(3));
    state.goto(2);
    expect(state.getState().templateId).toBe(before);
  });
});

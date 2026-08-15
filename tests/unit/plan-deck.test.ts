import { describe, expect, it, vi } from 'vitest';

import { buildPlanDeck, describeItem, moveItem, removeItem, type ItemResolver } from '../../lib/plan-deck.ts';
import type { CueItem, SlidePayload } from '../../shared/types.ts';

function bible(id: string, ref: string): CueItem {
  return { id, type: 'bible', ref, primary: 'nkrv', secondary: [] };
}

function song(id: string, songId: number, title: string): CueItem {
  return { id, type: 'song', songId, songTitle: title, langs: ['ko'] };
}

function slide(text: string): SlidePayload {
  return { kind: 'text', lines: [text] };
}

/** n개의 슬라이드를 내는 리졸버 */
function resolverWith(counts: Record<string, number>): ItemResolver {
  return async (item) => {
    const count = counts[item.id] ?? 0;
    if (count === 0) return { slides: [], labels: [], error: '내용 없음' };
    return {
      slides: Array.from({ length: count }, (_, i) => slide(`${item.id}-${i}`)),
      labels: Array.from({ length: count }, (_, i) => `${i + 1}`),
    };
  };
}

describe('describeItem', () => {
  it('성경은 참조를 쓴다', () => {
    expect(describeItem(bible('a', '요 3:16'))).toBe('요 3:16');
  });

  it('찬양은 제목을 쓴다', () => {
    expect(describeItem(song('b', 1, '나 같은 죄인 살리신'))).toBe('나 같은 죄인 살리신');
  });

  it('텍스트는 첫 줄을 자른다', () => {
    expect(describeItem({ id: 'c', type: 'text', content: '광고 안내\n두 번째 줄' })).toBe('광고 안내');
  });

  it('공백 항목', () => {
    expect(describeItem({ id: 'd', type: 'blank' })).toBe('(공백)');
  });
});

describe('buildPlanDeck', () => {
  it('여러 항목을 하나의 평평한 덱으로 이어붙인다', async () => {
    const items = [bible('a', '요 3:16'), song('b', 1, '찬송')];
    const { deck } = await buildPlanDeck('주일 1부', items, resolverWith({ a: 2, b: 3 }));

    expect(deck.reference).toBe('주일 1부');
    expect(deck.slides).toHaveLength(5);
    expect(deck.labels).toHaveLength(5);
  });

  it('항목 경계를 담는다 — 담기 전 인덱스여야 한다', async () => {
    const items = [bible('a', '요 3:16'), song('b', 1, '찬송'), bible('c', '롬 8:28')];
    const { deck } = await buildPlanDeck('순서', items, resolverWith({ a: 2, b: 3, c: 1 }));

    expect(deck.groups).toEqual([
      { label: '요 3:16', startIndex: 0 },
      { label: '찬송', startIndex: 2 },
      { label: '롬 8:28', startIndex: 5 },
    ]);
  });

  it('풀지 못한 항목은 건너뛰고 반드시 알린다', async () => {
    // 예배 중 순서가 조용히 사라지는 것이 가장 위험하다
    const items = [bible('a', '요 3:16'), bible('bad', '없는책 1:1'), song('b', 1, '찬송')];
    const { deck, failed } = await buildPlanDeck('순서', items, resolverWith({ a: 1, b: 1 }));

    expect(deck.slides).toHaveLength(2);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.item.id).toBe('bad');
    expect(failed[0]!.error).toBe('내용 없음');
  });

  it('건너뛴 항목이 경계 인덱스를 밀지 않는다', async () => {
    const items = [bible('bad', 'x'), bible('a', '요 3:16')];
    const { deck } = await buildPlanDeck('순서', items, resolverWith({ a: 2 }));
    expect(deck.groups).toEqual([{ label: '요 3:16', startIndex: 0 }]);
  });

  it('리졸버가 던진 예외도 실패로 모은다 (전체가 죽지 않는다)', async () => {
    const resolver = vi.fn<ItemResolver>(async (item) => {
      if (item.id === 'boom') throw new Error('조회 실패');
      return { slides: [slide('ok')], labels: ['1'] };
    });

    const { deck, failed } = await buildPlanDeck('순서', [bible('boom', 'x'), bible('a', 'y')], resolver);
    expect(deck.slides).toHaveLength(1);
    expect(failed[0]!.error).toBe('조회 실패');
  });

  it('빈 순서표는 빈 덱', async () => {
    const { deck, failed } = await buildPlanDeck('순서', [], resolverWith({}));
    expect(deck.slides).toEqual([]);
    expect(deck.groups).toEqual([]);
    expect(failed).toEqual([]);
  });

  it('원본 항목 배열을 변형하지 않는다', async () => {
    const items = [bible('a', '요 3:16')];
    const snapshot = JSON.parse(JSON.stringify(items));
    await buildPlanDeck('순서', items, resolverWith({ a: 1 }));
    expect(items).toEqual(snapshot);
  });
});

describe('moveItem', () => {
  const items = [bible('a', 'A'), bible('b', 'B'), bible('c', 'C')];

  it('위로 옮긴다', () => {
    expect(moveItem(items, 1, 0).map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('아래로 옮긴다', () => {
    expect(moveItem(items, 0, 2).map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('범위를 벗어난 목표는 끝으로 붙인다', () => {
    expect(moveItem(items, 0, 99).map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(moveItem(items, 2, -5).map((i) => i.id)).toEqual(['c', 'a', 'b']);
  });

  it('같은 자리로 옮기면 그대로', () => {
    expect(moveItem(items, 1, 1).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('잘못된 출처 인덱스는 그대로', () => {
    expect(moveItem(items, 99, 0).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('원본을 변형하지 않는다 (불변)', () => {
    const snapshot = items.map((i) => i.id);
    moveItem(items, 0, 2);
    expect(items.map((i) => i.id)).toEqual(snapshot);
  });
});

describe('removeItem', () => {
  it('id 로 지운다', () => {
    const items = [bible('a', 'A'), bible('b', 'B')];
    expect(removeItem(items, 'a').map((i) => i.id)).toEqual(['b']);
  });

  it('없는 id 는 아무 영향 없다', () => {
    const items = [bible('a', 'A')];
    expect(removeItem(items, 'zzz')).toHaveLength(1);
  });
});

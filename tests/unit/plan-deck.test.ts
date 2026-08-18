import { describe, expect, it, vi } from 'vitest';

import {
  buildPlanDeck, buildPlanRows, describeItem, holdMsFor, insertIndexFor, isExpandable, itemsInGroup, splitOrderText, moveItem, removeItem, type ItemResolver } from '../../lib/plan-deck.ts';
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

describe('구분(divider) 처리', () => {
  const divider = (label: string): CueItem => ({ id: `d-${label}`, type: 'divider', label });
  const text = (content: string): CueItem => ({ id: `t-${content}`, type: 'text', content });

  /** 텍스트 항목만 슬라이드 한 장으로 푸는 단순 리졸버 */
  const resolve: ItemResolver = async (item) =>
    item.type === 'text'
      ? { slides: [{ kind: 'text', lines: [item.content] }], labels: [item.content] }
      : { slides: [], labels: [], error: '이 테스트가 풀지 않는 종류' };

  it('구분은 슬라이드를 만들지 않는다', async () => {
    const result = await buildPlanDeck('테스트', [divider('찬양'), text('가')], resolve);
    expect(result.deck.slides).toHaveLength(1);
  });

  it('구분은 실패로 잡히지 않는다', async () => {
    // resolve 에 넘어가면 '표시할 내용이 없습니다' 로 실패 목록에 쌓인다
    const result = await buildPlanDeck('테스트', [divider('찬양'), text('가')], resolve);
    expect(result.failed).toHaveLength(0);
  });

  it('구분이 항목 경계(groups)를 어긋나게 하지 않는다', async () => {
    // PgDn 이 빈 화면으로 점프하면 예배 중 사고다
    const result = await buildPlanDeck(
      '테스트',
      [divider('예배 부름'), text('가'), divider('찬양'), text('나'), text('다')],
      resolve,
    );

    expect(result.deck.groups).toHaveLength(3);
    expect(result.deck.groups!.map((g) => g.startIndex)).toEqual([0, 1, 2]);
    expect(result.deck.groups!.map((g) => g.label)).toEqual(['가', '나', '다']);
  });

  it('구분만 있으면 빈 덱이 된다', async () => {
    const result = await buildPlanDeck('테스트', [divider('찬양')], resolve);
    expect(result.deck.slides).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });

  it('describeItem 은 구분 이름을 그대로 준다', () => {
    expect(describeItem(divider('말씀'))).toBe('말씀');
  });
});

describe('itemsInGroup — 예배 전 안내 구간', () => {
  const divider = (label: string): CueItem => ({ id: `d-${label}`, type: 'divider', label });
  const text = (content: string): CueItem => ({ id: `t-${content}`, type: 'text', content });

  it('구분 다음부터 다음 구분 전까지만 준다', () => {
    const items = [divider('예배 전'), text('가'), text('나'), divider('예배 부름'), text('다')];
    expect(itemsInGroup(items, 'd-예배 전').map((i) => i.id)).toEqual(['t-가', 't-나']);
  });

  it('마지막 구분이면 끝까지 준다', () => {
    const items = [divider('예배 전'), text('가'), divider('광고'), text('나'), text('다')];
    expect(itemsInGroup(items, 'd-광고').map((i) => i.id)).toEqual(['t-나', 't-다']);
  });

  it('아래에 항목이 없으면 빈 배열 — 시작할 수 없다는 뜻', () => {
    const items = [divider('예배 전'), divider('예배 부름'), text('가')];
    expect(itemsInGroup(items, 'd-예배 전')).toEqual([]);
  });

  it('없는 id 나 구분이 아닌 id 는 빈 배열', () => {
    const items = [divider('예배 전'), text('가')];
    expect(itemsInGroup(items, 'nope')).toEqual([]);
    expect(itemsInGroup(items, 't-가')).toEqual([]);
  });
});

describe('splitOrderText — 순서 이름과 담당자', () => {
  it('첫 줄이 순서 이름, 다음 줄이 담당자', () => {
    expect(splitOrderText('대표기도\n박기현 목사')).toEqual({ title: '대표기도', presenter: '박기현 목사' });
  });

  it('담당자가 여러 줄이면 한 줄로 합친다 (오른쪽 한 칸에 들어가야 한다)', () => {
    expect(splitOrderText('설교 제목\n박기현\n목사')).toEqual({ title: '설교 제목', presenter: '박기현 목사' });
  });

  it('한 줄뿐이면 담당자가 없다 — 빈 밑줄만 남기지 않는다', () => {
    expect(splitOrderText('주기도문')).toEqual({ title: '주기도문' });
  });

  it('끝에 빈 줄이 있어도 담당자가 생기지 않는다', () => {
    expect(splitOrderText('축도\n\n  \n')).toEqual({ title: '축도' });
  });

  it('앞뒤 공백을 떼어 낸다', () => {
    expect(splitOrderText('  봉헌  \n   김집사  ')).toEqual({ title: '봉헌', presenter: '김집사' });
  });
});

describe('buildPlanRows — 한 열 목록', () => {
  const divider = (label: string): CueItem => ({ id: `d-${label}`, type: 'divider', label });
  const notice = (content: string): CueItem => ({ id: `t-${content}`, type: 'text', content });
  const bible = (ref: string): CueItem =>
    ({ id: `b-${ref}`, type: 'bible', ref, primary: 'nkrv', secondary: [] });

  it('펼치지 않으면 항목마다 한 줄', () => {
    const rows = buildPlanRows([divider('찬양'), notice('광고'), bible('요 3:16')], null, 0);
    expect(rows.map((r) => r.kind)).toEqual(['divider', 'item', 'item']);
  });

  it('광고·순서 표시·공백은 펼칠 수 없다 (언제나 한 장)', () => {
    expect(isExpandable(notice('광고'))).toBe(false);
    expect(isExpandable({ id: 'x', type: 'blank' })).toBe(false);
    expect(isExpandable(bible('요 3:16'))).toBe(true);
    expect(isExpandable({ id: 's', type: 'song', songId: 1, songTitle: '찬송', langs: ['ko'] })).toBe(true);
  });

  it('펼친 항목의 슬라이드가 그 항목 바로 아래 들어간다', () => {
    const rows = buildPlanRows([notice('광고'), bible('요 3:16'), notice('뒤')], 'b-요 3:16', 3);
    expect(rows.map((r) => r.kind)).toEqual(['item', 'item', 'slide', 'slide', 'slide', 'item']);
    // 슬라이드는 자기 항목을 가리켜야 송출할 때 무엇을 올릴지 알 수 있다
    expect(rows.slice(2, 5).every((r) => r.itemId === 'b-요 3:16')).toBe(true);
    expect(rows[3]).toMatchObject({ kind: 'slide', slideIndex: 1, itemIndex: 1 });
  });

  it('펼칠 수 없는 항목은 펼침 지정을 받아도 펼쳐지지 않는다', () => {
    const rows = buildPlanRows([notice('광고')], 't-광고', 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'item', expanded: false, expandable: false });
  });

  it('장수를 아직 모르면(0) 머리 줄만 남는다 — 불러오는 중에도 목록이 깨지지 않는다', () => {
    const rows = buildPlanRows([bible('요 3:16')], 'b-요 3:16', 0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'item', expanded: true });
  });
});

describe('holdMsFor — 자동 진행에서 머무는 시간', () => {
  const media = (holdMs?: number): SlidePayload => ({
    kind: 'media',
    src: 'notice.png',
    mediaKind: 'image',
    ...(holdMs === undefined ? {} : { holdMs }),
  });

  it('기본은 구분에 설정한 시간', () => {
    expect(holdMsFor(undefined, 8000)).toBe(8000);
    expect(holdMsFor({ kind: 'text', lines: ['광고'] }, 8000)).toBe(8000);
    expect(holdMsFor(media(), 8000)).toBe(8000);
  });

  it('그림·동영상이 따로 정하면 그것을 쓴다 — 긴 안내가 잘리면 안 된다', () => {
    expect(holdMsFor(media(40_000), 8000)).toBe(40_000);
  });

  /** 0 을 그대로 쓰면 타이머가 즉시 터져 화면이 미친 듯이 넘어간다 */
  it('0 이나 음수는 정하지 않은 것으로 본다', () => {
    expect(holdMsFor(media(0), 8000)).toBe(8000);
    expect(holdMsFor(media(-1), 8000)).toBe(8000);
  });

  it('글자 슬라이드는 자기 시간을 가질 수 없다 (그림·동영상만)', () => {
    // text 에 holdMs 를 억지로 붙여도 무시된다 — 규칙이 한 종류에만 있다
    const sneaky = { kind: 'text', lines: ['광고'], holdMs: 40_000 } as unknown as SlidePayload;
    expect(holdMsFor(sneaky, 8000)).toBe(8000);
  });
});

describe('insertIndexFor — 새 항목이 들어갈 자리', () => {
  /** 요 3:16(펼침, 슬라이드 2장) · 찬송가 · 광고 */
  const three: CueItem[] = [
    bible('a', '요 3:16'),
    { id: 'b', type: 'song', songId: 1, songTitle: '찬송가', langs: ['ko'] },
    { id: 'c', type: 'text', content: '광고' },
  ];
  const expanded = buildPlanRows(three, 'a', 2); // 줄: a, 슬1, 슬2, b, c

  it('펼친 항목이 있어도 고른 항목 바로 다음에 넣는다', () => {
    expect(expanded.map((r) => r.kind)).toEqual(['item', 'slide', 'slide', 'item', 'item']);
    // 줄3 = 찬송가(항목1) → 항목2 자리
    expect(insertIndexFor(expanded, 3, three.length)).toBe(2);
    // 줄4 = 광고(항목2) → 맨 끝
    expect(insertIndexFor(expanded, 4, three.length)).toBe(3);
  });

  /** 이게 실제 신고였다 — 슬라이드 줄에 커서가 있으면 맨 끝에 붙었다 */
  it('슬라이드 줄에 커서가 있으면 그 항목 다음에 넣는다', () => {
    expect(insertIndexFor(expanded, 1, three.length)).toBe(1);
    expect(insertIndexFor(expanded, 2, three.length)).toBe(1);
  });

  it('접힌 목록에서는 줄 번호와 항목 번호가 같다', () => {
    const flat = buildPlanRows(three, null, 0);
    expect(insertIndexFor(flat, 0, three.length)).toBe(1);
    expect(insertIndexFor(flat, 1, three.length)).toBe(2);
    expect(insertIndexFor(flat, 2, three.length)).toBe(3);
  });

  it('구분 줄에서도 그 다음에 넣는다', () => {
    const withDivider: CueItem[] = [
      { id: 'd', type: 'divider', label: '예배 부름' },
      bible('a', '요 3:16'),
    ];
    const rows = buildPlanRows(withDivider, null, 0);
    expect(insertIndexFor(rows, 0, withDivider.length)).toBe(1);
  });

  it('항목이 없으면 0', () => {
    expect(insertIndexFor([], 0, 0)).toBe(0);
    expect(insertIndexFor([], 5, 0)).toBe(0);
  });

  it('커서가 범위를 벗어나도 항목 수를 넘지 않는다', () => {
    expect(insertIndexFor(expanded, 99, three.length)).toBe(3);
    expect(insertIndexFor(expanded, -3, three.length)).toBe(1);
  });
});

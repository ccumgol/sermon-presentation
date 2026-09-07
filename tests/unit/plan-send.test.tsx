// @vitest-environment jsdom
/**
 * **예배 순서 탭이 화면으로 내보내는 것** (`src/control/hooks/usePlanSend.ts`).
 *
 * ## 왜 값이 있는가
 *
 * 이 화면의 본업이 여기다. 틀리면 **예배 중에 엉뚱한 것이 나가거나 아무것도
 * 나가지 않는다.** 2026-09-07 까지 2,549줄짜리 `PlanPanel` 안에 있어서 화면을
 * 다 띄우지 않고는 부를 수 없었고, 그래서 검사가 하나도 없었다.
 *
 * 검사가 없는 동안 실제로 사고가 났다 — 기본 템플릿을 바꾼 직후 ▶ 를 누르면
 * **이전 판이 나갔다** (`lib/plan-item-template.ts` 머리말). 여기서 그 규칙에
 * 못을 박는다.
 *
 * ## 틀(harness)
 *
 * `resolveItem` 이 **인자**라서 서버도 `api` 도 필요 없다 — 떼어낸 값이 이것이다.
 * `send` 가 받은 것을 순서까지 그대로 모아 두고, 그것으로 판정한다.
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlanSend, type PlanSendOptions } from '../../src/control/hooks/usePlanSend.ts';
import { getBuiltinTemplate } from '../../lib/template-presets.ts';
import type { ClientMsg, CueItem, Deck, ServicePlan, SlidePayload } from '../../shared/types.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const BOTTOM = getBuiltinTemplate(-1)!;

// ── 만들어 쓰는 것들 ─────────────────────────────────────────

const bible = (patch: Record<string, unknown> = {}): CueItem =>
  ({ id: 'b1', type: 'bible', ref: '롬 8:28', primary: 'nkrv', secondary: [], ...patch }) as unknown as CueItem;
const divider = (patch: Record<string, unknown> = {}): CueItem =>
  ({ id: 'd1', type: 'divider', label: '예배 부름', ...patch }) as unknown as CueItem;

const slide = (line: string): SlidePayload => ({ kind: 'text', lines: [line] }) as unknown as SlidePayload;

/** 두 장짜리 결과 — resolveItem 이 이걸 돌려준다 */
const TWO = { slides: [slide('가'), slide('나')], labels: ['1', '2'] };

function setup(patch: Partial<PlanSendOptions> = {}) {
  const sent: ClientMsg[] = [];
  const feedback = { setBusy: vi.fn(), setError: vi.fn(), setNotice: vi.fn() };
  const resolveItem = vi.fn(async () => TWO);

  const options: PlanSendOptions = {
    deck: null,
    currentIndex: 0,
    connected: true,
    send: (msg) => { sent.push(msg); return true; },
    items: [bible()],
    plan: null,
    resolveItem,
    templateChoice: { template: BOTTOM, styleTemplates: [] },
    feedback,
    ...patch,
  };

  const hook = renderHook((props: PlanSendOptions) => usePlanSend(props), {
    initialProps: options,
  });
  return { hook, sent, feedback, resolveItem, options };
}

/** 보낸 메시지의 종류만 순서대로 */
const kinds = (sent: ClientMsg[]): string[] => sent.map((m) => m.t);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('★ 끊겼으면 아무것도 보내지 않는다', () => {
  it('sendItem — 간 줄 알고 다음 동작을 하면 화면이 어긋난다', async () => {
    const { hook, sent, resolveItem } = setup({ connected: false });
    await act(async () => { await hook.result.current.sendItem(bible()); });
    expect(sent).toEqual([]);
    // 풀어 보지도 않는다 — 헛되게 서버를 부르지 않는다
    expect(resolveItem).not.toHaveBeenCalled();
  });

  it('sendTitle · restoreBefore 도 같다', async () => {
    const { hook, sent } = setup({ connected: false });
    act(() => hook.result.current.sendTitle(bible()));
    act(() => hook.result.current.restoreBefore());
    expect(sent).toEqual([]);
  });
});

describe('구분(그룹 머리글)은 송출하지 않는다', () => {
  it('슬라이드가 없는 것이라 보낼 것이 없다', async () => {
    const { hook, sent } = setup();
    await act(async () => { await hook.result.current.sendItem(divider()); });
    expect(sent).toEqual([]);
  });
});

describe('단독 송출 — 순서표가 올라가 있지 않을 때', () => {
  it('푼 슬라이드를 덱으로 올린다', async () => {
    const { hook, sent } = setup();
    await act(async () => { await hook.result.current.sendItem(bible()); });

    const load = sent.find((m) => m.t === 'deck:load') as Extract<ClientMsg, { t: 'deck:load' }>;
    expect(load.payload.slides).toHaveLength(2);
    expect(load.payload.reference).toBe('롬 8:28');
    expect(load.payload.index).toBe(0);
  });

  it('★ 고른 장으로 열린다 — 슬라이드 줄을 누르면 그 장이 나가야 한다', async () => {
    const { hook, sent } = setup();
    await act(async () => { await hook.result.current.sendItem(bible(), 1); });
    const load = sent.find((m) => m.t === 'deck:load') as Extract<ClientMsg, { t: 'deck:load' }>;
    expect(load.payload.index).toBe(1);
  });

  it('★ 장 수보다 큰 번호는 마지막 장으로 잘린다 — 줄이 줄어든 뒤에도 빈 화면이 되지 않게', async () => {
    const { hook, sent } = setup();
    await act(async () => { await hook.result.current.sendItem(bible(), 9); });
    const load = sent.find((m) => m.t === 'deck:load') as Extract<ClientMsg, { t: 'deck:load' }>;
    expect(load.payload.index).toBe(1);
  });

  it('★ 템플릿을 슬라이드보다 **먼저** 보낸다 — 순서가 반대면 옛 판으로 한 번 그려져 화면이 튄다', async () => {
    const { hook, sent } = setup({ templateChoice: { template: BOTTOM, styleTemplates: [] } });
    await act(async () => { await hook.result.current.sendItem(bible({ templateId: -8 })); });
    expect(kinds(sent)).toEqual(['template:set', 'deck:load']);
    expect(sent[0]).toEqual({ t: 'template:set', id: -8 });
  });

  it('지정이 없으면 template:set 을 보내지 않는다 — 지금 판을 유지한다', async () => {
    const { hook, sent } = setup();
    await act(async () => { await hook.result.current.sendItem(bible()); });
    expect(kinds(sent)).toEqual(['deck:load']);
  });

  it('예배 기본 설정의 템플릿도 따른다', async () => {
    const { hook, sent } = setup({
      templateChoice: { template: BOTTOM, styleTemplates: [], defaults: { templates: { bible: -3 } } },
    });
    await act(async () => { await hook.result.current.sendItem(bible()); });
    expect(sent[0]).toEqual({ t: 'template:set', id: -3 });
  });
});

describe('★ 순서표가 올라가 있으면 그 자리로 점프한다', () => {
  const deck: Deck = {
    reference: '주일예배',
    slides: [slide('a'), slide('b'), slide('c'), slide('d')],
    labels: ['1', '2', '3', '4'],
    index: 0,
    groups: [
      { label: '첫 항목', startIndex: 0 },
      { label: '롬 8:28', startIndex: 2 },
    ],
  } as unknown as Deck;

  const items = [bible({ id: 'a0', ref: '창 1:1' }), bible()];

  it('덱을 다시 올리지 않는다 — 통째로 바꾸면 진행 위치를 잃는다', async () => {
    const { hook, sent, resolveItem } = setup({ deck, items });
    await act(async () => { await hook.result.current.sendItem(bible()); });
    expect(kinds(sent)).toEqual(['goto']);
    expect(sent[0]).toEqual({ t: 'goto', index: 2 });
    // 이미 올라가 있으니 다시 풀 필요가 없다
    expect(resolveItem).not.toHaveBeenCalled();
  });

  it('그 항목 안의 몇 번째 장인지까지 더해 점프한다', async () => {
    const { hook, sent } = setup({ deck, items });
    await act(async () => { await hook.result.current.sendItem(bible(), 1); });
    expect(sent[0]).toEqual({ t: 'goto', index: 3 });
  });

  it('구분은 경계 번호 셈에서 빠진다 — 끼어 있으면 엉뚱한 장으로 점프한다', async () => {
    const withDivider = [bible({ id: 'a0', ref: '창 1:1' }), divider(), bible()];
    const { hook, sent } = setup({ deck, items: withDivider });
    await act(async () => { await hook.result.current.sendItem(bible()); });
    expect(sent[0]).toEqual({ t: 'goto', index: 2 });
  });
});

describe('★ 풀린 것이 없으면 오류를 낸다 — 조용히 빈 화면을 내보내지 않는다', () => {
  it('푼 이유를 그대로 올린다', async () => {
    const resolveItem = vi.fn(async () => ({ slides: [], labels: [], error: '본문을 찾지 못했습니다' }));
    const { hook, sent, feedback } = setup({ resolveItem });
    await act(async () => { await hook.result.current.sendItem(bible()); });

    expect(feedback.setError).toHaveBeenCalledWith('본문을 찾지 못했습니다');
    expect(kinds(sent)).not.toContain('deck:load');
  });

  it('이유가 없으면 최소한 무슨 일인지 말한다', async () => {
    const resolveItem = vi.fn(async () => ({ slides: [], labels: [] }));
    const { hook, feedback } = setup({ resolveItem });
    await act(async () => { await hook.result.current.sendItem(bible()); });
    expect(feedback.setError).toHaveBeenCalledWith('표시할 내용이 없습니다');
  });

  it('푸는 도중에 던져도 화면이 멈추지 않는다', async () => {
    const resolveItem = vi.fn(async () => { throw new Error('끊김'); });
    const { hook, feedback } = setup({ resolveItem: resolveItem as never });
    await act(async () => { await hook.result.current.sendItem(bible()); });
    expect(feedback.setError).toHaveBeenCalledWith('송출하지 못했습니다');
  });
});

describe('★ 인용구는 직전 화면을 기억한다 — 설교 중 잠깐 띄우고 돌아와야 한다', () => {
  const deck: Deck = {
    reference: '설교', slides: [slide('설교 본문')], labels: ['설교 중'], index: 0,
  } as unknown as Deck;

  it('인용구를 띄우면 그 전 화면을 붙잡아 둔다', async () => {
    const { hook } = setup({ deck });
    await act(async () => { await hook.result.current.sendItem(bible({ quote: true })); });
    expect(hook.result.current.before).toEqual({ slide: slide('설교 본문'), label: '설교 중' });
  });

  it('인용구가 아니면 붙잡지 않는다 — 아무 항목마다 기억하면 돌아갈 곳이 흐려진다', async () => {
    const { hook } = setup({ deck });
    await act(async () => { await hook.result.current.sendItem(bible()); });
    expect(hook.result.current.before).toBeNull();
  });

  it('옛 순서표의 자유 글자 인용구도 같다 — 이것이 광고와의 유일한 실제 차이다', async () => {
    const quoteText = { id: 'q1', type: 'text', variant: 'quote', content: '한 말씀' } as unknown as CueItem;
    const { hook } = setup({ deck });
    await act(async () => { await hook.result.current.sendItem(quoteText); });
    expect(hook.result.current.before).not.toBeNull();
  });

  it('되돌리면 그 화면을 그대로 올리고 기억을 비운다', async () => {
    const { hook, sent } = setup({ deck });
    await act(async () => { await hook.result.current.sendItem(bible({ quote: true })); });
    sent.length = 0;

    act(() => hook.result.current.restoreBefore());

    const load = sent.find((m) => m.t === 'deck:load') as Extract<ClientMsg, { t: 'deck:load' }>;
    expect(load.payload.slides).toEqual([slide('설교 본문')]);
    expect(load.payload.reference).toBe('설교 중');
    expect(hook.result.current.before).toBeNull();
  });

  it('기억한 것이 없으면 아무 일도 하지 않는다', () => {
    const { hook, sent } = setup();
    act(() => hook.result.current.restoreBefore());
    expect(sent).toEqual([]);
  });
});

describe('제목만 띄우기', () => {
  it('제목과 함께 그 항목이 쓸 템플릿을 올린다 — 본문과 같은 자리·모양으로 뜨게', () => {
    const { hook, sent } = setup();
    act(() => hook.result.current.sendTitle(bible({ templateId: -3 })));
    expect(kinds(sent)).toEqual(['template:set', 'deck:load']);
    const load = sent[1] as Extract<ClientMsg, { t: 'deck:load' }>;
    expect(load.payload.slides).toEqual([{ kind: 'text', lines: ['롬 8:28'] }]);
    expect(load.payload.reference).toBe('롬 8:28 (제목)');
  });

  it('★ 제목이 없는 항목은 보내지 않는다 (인용구는 제목을 띄우지 않는다)', () => {
    const { hook, sent } = setup();
    act(() => hook.result.current.sendTitle(bible({ quote: true })));
    expect(sent).toEqual([]);
  });
});

describe('★ 자동 넘김 — 예배 전 안내', () => {
  const deck = (n: number): Deck =>
    ({ reference: '예배 부름', slides: Array.from({ length: n }, (_, i) => slide(`${i}`)),
       labels: [], index: 0 }) as unknown as Deck;

  /** 자동 진행을 켠 상태로 만든다 */
  function auto(patch: Partial<PlanSendOptions> = {}) {
    const s = setup({ deck: deck(3), ...patch });
    act(() => s.hook.result.current.setAuto({ dividerId: 'd1', holdMs: 8000, loop: true }));
    return s;
  }

  it('머무는 시간이 지나면 다음 장으로 넘어간다', () => {
    vi.useFakeTimers();
    const { hook, sent } = auto();
    sent.length = 0;

    act(() => { vi.advanceTimersByTime(7999); });
    expect(sent).toEqual([]);
    act(() => { vi.advanceTimersByTime(1); });
    expect(sent).toEqual([{ t: 'next' }]);
    void hook;
  });

  it('★ 다음 한 번만 예약한다 — 반복 타이머면 사람이 손으로 넘겼을 때 두 장이 연달아 넘어간다', () => {
    vi.useFakeTimers();
    const { sent } = auto();
    sent.length = 0;
    act(() => { vi.advanceTimersByTime(24_000); });
    // 3배 시간이 지나도 한 번뿐이다 (다음 예약은 currentIndex 가 바뀌어야 걸린다)
    expect(sent).toEqual([{ t: 'next' }]);
  });

  it('★ 마지막 장이면 처음으로 돌아간다 — 예배 **전** 안내라 순환한다', () => {
    vi.useFakeTimers();
    const { sent } = auto({ currentIndex: 2 });
    sent.length = 0;
    act(() => { vi.advanceTimersByTime(8000); });
    expect(sent).toEqual([{ t: 'goto', index: 0 }]);
  });

  it('순환을 끈 구분이면 마지막에서 자동 진행을 멈춘다', () => {
    vi.useFakeTimers();
    const s = setup({ deck: deck(3), currentIndex: 2 });
    act(() => s.hook.result.current.setAuto({ dividerId: 'd1', holdMs: 8000, loop: false }));
    s.sent.length = 0;

    act(() => { vi.advanceTimersByTime(8000); });
    expect(s.sent).toEqual([]);
    expect(s.hook.result.current.auto).toBeNull();
  });

  it('★ 끊겼으면 타이머를 걸지 않는다 — 죽은 서버를 향해 쏘지 않는다', () => {
    vi.useFakeTimers();
    const { sent } = auto({ connected: false });
    sent.length = 0;
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(sent).toEqual([]);
  });

  it('올라간 덱이 비었으면 아무것도 하지 않는다', () => {
    vi.useFakeTimers();
    const { sent } = auto({ deck: deck(0) });
    sent.length = 0;
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(sent).toEqual([]);
  });

  it('★ 사람이 무언가를 송출하면 자동 진행이 꺼진다 — 예배가 시작된 것이다', async () => {
    const { hook } = auto();
    expect(hook.result.current.auto).not.toBeNull();
    await act(async () => { await hook.result.current.sendItem(bible()); });
    expect(hook.result.current.auto).toBeNull();
  });
});

describe('나가 있는 항목을 고쳤을 때 다시 보내기', () => {
  it('★ 단독 송출 중인 그 항목일 때만 한다 — 순서표가 올라가 있으면 진행 위치를 잃는다', async () => {
    vi.useFakeTimers();
    const { hook, sent } = setup();
    // 아직 아무것도 단독 송출하지 않았다
    act(() => hook.result.current.refreshLive(bible()));
    act(() => { vi.advanceTimersByTime(500); });
    expect(sent).toEqual([]);
  });

  it('★ 연달아 불러도 한 번만 보낸다 — 슬라이더를 끌면 늦게 온 옛 응답이 새 화면을 덮는다', async () => {
    vi.useFakeTimers();
    const { hook, sent } = setup();
    await act(async () => { await hook.result.current.sendItem(bible()); });
    sent.length = 0;

    act(() => {
      hook.result.current.refreshLive(bible());
      hook.result.current.refreshLive(bible());
      hook.result.current.refreshLive(bible());
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    expect(sent.filter((m) => m.t === 'deck:load')).toHaveLength(1);
  });

  it('보고 있던 장에 머문다 — 크기를 만질 때마다 첫 장으로 돌아가면 못 쓴다', async () => {
    vi.useFakeTimers();
    const { hook, sent } = setup({ currentIndex: 1 });
    await act(async () => { await hook.result.current.sendItem(bible(), 1); });
    sent.length = 0;

    act(() => hook.result.current.refreshLive(bible()));
    await act(async () => { await vi.advanceTimersByTimeAsync(200); });

    const load = sent.find((m) => m.t === 'deck:load') as Extract<ClientMsg, { t: 'deck:load' }>;
    expect(load.payload.index).toBe(1);
  });
});

describe('순서표 전체를 올리기', () => {
  const plan = { id: 1, name: '주일예배', kind: 'template', items: [] } as unknown as ServicePlan;

  it('열어 둔 것이 없거나 항목이 없으면 아무 일도 하지 않는다', async () => {
    const a = setup({ plan: null });
    await act(async () => { await a.hook.result.current.loadForService(); });
    expect(a.sent).toEqual([]);

    const b = setup({ plan, items: [] });
    await act(async () => { await b.hook.result.current.loadForService(); });
    expect(b.sent).toEqual([]);
  });

  it('★ 지정이 없는 항목의 경계에 예배 기본 설정을 실어 보낸다 — 없으면 전체 진행에서만 기본이 빠진다', async () => {
    const { hook, sent } = setup({
      plan,
      items: [bible(), bible({ id: 'b2', ref: '창 1:1' })],
      templateChoice: { template: BOTTOM, styleTemplates: [], defaults: { templates: { bible: -3 } } },
    });
    await act(async () => { await hook.result.current.loadForService(); });

    const load = sent.find((m) => m.t === 'deck:load') as Extract<ClientMsg, { t: 'deck:load' }>;
    expect(load.payload.groups?.every((g) => g.templateId === -3)).toBe(true);
  });

  it('항목이 스스로 지정한 것은 덮어쓰지 않는다', async () => {
    const { hook, sent } = setup({
      plan,
      items: [bible({ templateId: -8 })],
      templateChoice: { template: BOTTOM, styleTemplates: [], defaults: { templates: { bible: -3 } } },
    });
    await act(async () => { await hook.result.current.loadForService(); });

    const load = sent.find((m) => m.t === 'deck:load') as Extract<ClientMsg, { t: 'deck:load' }>;
    expect(load.payload.groups?.[0]?.templateId).toBe(-8);
  });

  it('★ 건너뛴 항목이 있으면 무엇을 왜 건너뛰었는지 알린다 — 모르고 예배를 시작하면 안 된다', async () => {
    let call = 0;
    const resolveItem = vi.fn(async () => {
      call += 1;
      return call === 1 ? { slides: [], labels: [], error: '본문을 찾지 못했습니다' } : TWO;
    });
    const { hook, feedback } = setup({
      plan, items: [bible({ id: 'bad', ref: '없음 1:1' }), bible()], resolveItem,
    });
    await act(async () => { await hook.result.current.loadForService(); });

    expect(feedback.setNotice).toHaveBeenCalledWith(expect.stringContaining('1개 항목을 건너뛰었습니다'));
    expect(feedback.setNotice).toHaveBeenCalledWith(expect.stringContaining('본문을 찾지 못했습니다'));
  });

  it('★ 올릴 수 있는 것이 하나도 없으면 덱을 보내지 않는다 — 빈 화면으로 예배를 시작하지 않는다', async () => {
    const resolveItem = vi.fn(async () => ({ slides: [], labels: [], error: '없음' }));
    const { hook, sent, feedback } = setup({ plan, items: [bible()], resolveItem });
    await act(async () => { await hook.result.current.loadForService(); });

    expect(kinds(sent)).not.toContain('deck:load');
    expect(feedback.setError).toHaveBeenCalledWith('올릴 수 있는 항목이 없습니다');
  });

  it('올리는 동안 busy 를 켜고 끝나면 반드시 끈다 — 켜진 채 남으면 버튼이 영구히 흐려진다', async () => {
    const resolveItem = vi.fn(async () => { throw new Error('끊김'); });
    const { hook, feedback } = setup({ plan, items: [bible()], resolveItem: resolveItem as never });
    await act(async () => { await hook.result.current.loadForService(); });

    expect(feedback.setBusy).toHaveBeenNthCalledWith(1, true);
    expect(feedback.setBusy).toHaveBeenLastCalledWith(false);
  });
});

describe('예배 전 안내 시작', () => {
  it('그 구분이 거느린 항목이 없으면 왜 안 되는지 말한다', async () => {
    const { hook, sent, feedback } = setup({ items: [divider()] });
    await act(async () => {
      await hook.result.current.startAuto(divider() as Extract<CueItem, { type: 'divider' }>);
    });
    expect(feedback.setError).toHaveBeenCalledWith("'예배 부름' 아래에 항목이 없습니다");
    expect(sent).toEqual([]);
  });

  it('★ 그 구분 아래 항목만 올리고 자동 진행을 켠다 — 예배 전 안내는 예배 순서의 일부가 아니다', async () => {
    const items = [divider(), bible(), divider({ id: 'd2', label: '찬양' }), bible({ id: 'b9', ref: '시 23' })];
    const { hook, sent } = setup({ items });
    await act(async () => {
      await hook.result.current.startAuto(items[0] as Extract<CueItem, { type: 'divider' }>);
    });

    const load = sent.find((m) => m.t === 'deck:load') as Extract<ClientMsg, { t: 'deck:load' }>;
    expect(load.payload.reference).toBe('예배 부름');
    // 아래 항목 하나(두 장)만 올라간다 — 뒤 구분의 항목은 들어오지 않는다
    expect(load.payload.slides).toHaveLength(2);
    expect(hook.result.current.auto).toMatchObject({ dividerId: 'd1', loop: true });
  });

  it('구분이 정한 머무는 시간과 순환 여부를 따른다', async () => {
    const d = divider({ auto: { holdMs: 3000, loop: false } });
    const { hook } = setup({ items: [d, bible()] });
    await act(async () => {
      await hook.result.current.startAuto(d as Extract<CueItem, { type: 'divider' }>);
    });
    expect(hook.result.current.auto).toMatchObject({ holdMs: 3000, loop: false });
  });
});

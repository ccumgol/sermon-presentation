// @vitest-environment jsdom
/**
 * **순서표에 항목을 넣는 것** (`src/control/hooks/usePlanAdd.ts`).
 *
 * ## 왜 값이 있는가
 *
 * 넣는 **자리** 계산이 이 화면에서 가장 틀리기 쉬운 곳이다. `cursor` 는 항목 번호가
 * 아니라 **줄** 번호인데(펼친 항목의 슬라이드도 한 줄을 차지한다), 그것을 항목
 * 번호처럼 쓰면 새 항목이 조용히 **맨 끝에 붙는다** — 예배 순서를 짜는 중에
 * 20번째 뒤에 붙은 것을 못 보고 지나간다.
 *
 * 2026-09-07 까지 2,549줄짜리 `PlanPanel` 안에 있어서 검사를 붙일 수 없었다.
 *
 * ## 틀(harness)
 *
 * `api` 를 바꿔 끼우고, 척추(`usePlanDraft`)는 실물을 쓴다 — 그쪽 규칙(`patchItems`
 * 가 dirty 를 켠다 등)까지 함께 확인된다. `rows` 는 `buildPlanRows` 로 실제로 만든다.
 *
 * ⚠️ **초안 저장소는 `window.sessionStorage` 로 부른다.** 맨몸 `localStorage` 는
 * Node 자체의 실험적 전역이 jsdom 것을 가려서 `--localstorage-file` 없이는
 * `undefined` 다 (실제로 여기서 걸렸다). jsdom 것을 쓰려면 `window.` 를 붙인다.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPlanRows } from '../../lib/plan-deck.ts';
import type { CueItem } from '../../shared/types.ts';

// ── api 를 바꿔 끼운다 (import 보다 먼저) ────────────────────
const songs = vi.fn();
const parse = vi.fn();
const readings = vi.fn();
const passage = vi.fn();

class FakeApiError extends Error {}

vi.mock('../../src/control/api.ts', () => ({
  api: {
    songs: (...a: unknown[]) => songs(...a),
    parse: (...a: unknown[]) => parse(...a),
    readings: (...a: unknown[]) => readings(...a),
    passage: (...a: unknown[]) => passage(...a),
  },
  ApiError: FakeApiError,
  READING_BOOK_LABELS: { hymn_old: '통일찬송가', hymn_new: '새찬송가' },
}));

const { usePlanAdd } = await import('../../src/control/hooks/usePlanAdd.ts');
const { usePlanDraft } = await import('../../src/control/hooks/usePlanDraft.ts');

/** 초안이 다음 검사로 새지 않게 비운다 (jsdom 것을 쓰려면 window. 를 붙인다) */
const clearDraftStore = (): void => {
  try { window.sessionStorage.clear(); } catch { /* 저장소가 없어도 검사는 돌아야 한다 */ }
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  clearDraftStore();
});

beforeEach(() => {
  vi.clearAllMocks();
  clearDraftStore();
  songs.mockResolvedValue({ total: 0, hits: [] });
  parse.mockResolvedValue({ ok: true, reference: '요한복음 3:16' });
  readings.mockResolvedValue({ items: [], total: 0, counts: { hymn_old: 0, hymn_new: 0 } });
  passage.mockResolvedValue({ parse: { ok: true }, passage: { blocks: [] } });
});

const item = (patch: Record<string, unknown>): CueItem => patch as unknown as CueItem;

/**
 * 척추 + 추가 훅을 함께 띄운다.
 *
 * `rows` 는 척추의 실제 값으로 매 렌더 다시 만든다 — PlanPanel 이 하는 것과 같다.
 * 이것이 중요하다: 넣을 자리가 `rows` 로 계산되므로, 가짜 rows 를 주면
 * 정작 확인하려는 규칙이 헛돈다.
 */
function setup(opts: { items?: CueItem[]; cursor?: number; expandedId?: string | null;
                       previewSlideCount?: number } = {}) {
  const feedback = { setBusy: vi.fn(), setError: vi.fn(), setNotice: vi.fn() };

  const hook = renderHook(() => {
    const draft = usePlanDraft();
    const rows = buildPlanRows(draft.items, draft.expandedId, opts.previewSlideCount ?? 0);
    const add = usePlanAdd({
      draft, rows,
      previewSlideCount: opts.previewSlideCount ?? 0,
      feedback,
      defaultTranslation: 'nkrv',
    });
    return { draft, rows, add };
  });

  // 시작 상태를 넣는다 (척추의 실제 setter 로)
  if (opts.items) {
    act(() => {
      hook.result.current.draft.setItems(opts.items!);
      if (opts.expandedId !== undefined) hook.result.current.draft.setExpandedId(opts.expandedId);
      hook.result.current.draft.setCursor(opts.cursor ?? 0);
    });
  }
  return { hook, feedback };
}

const types = () => (h: ReturnType<typeof setup>['hook']) => h.result.current.draft.items.map((i) => i.type);

describe('★ 넣는 자리 — 고른 항목 바로 다음', () => {
  const three = [
    item({ id: 'a', type: 'text', content: '첫' }),
    item({ id: 'b', type: 'text', content: '둘' }),
    item({ id: 'c', type: 'text', content: '셋' }),
  ];

  it('커서가 두 번째면 두 번째와 세 번째 사이에 들어간다', () => {
    const { hook } = setup({ items: three, cursor: 1 });
    act(() => hook.result.current.add.insertItem(item({ id: 'new', type: 'blank' })));
    expect(hook.result.current.draft.items.map((i) => i.id)).toEqual(['a', 'b', 'new', 'c']);
  });

  it('커서가 맨 위면 첫 항목 다음이다 (맨 앞이 아니다)', () => {
    const { hook } = setup({ items: three, cursor: 0 });
    act(() => hook.result.current.add.insertItem(item({ id: 'new', type: 'blank' })));
    expect(hook.result.current.draft.items.map((i) => i.id)).toEqual(['a', 'new', 'b', 'c']);
  });

  it('빈 순서표에는 그냥 들어간다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.insertItem(item({ id: 'new', type: 'blank' })));
    expect(hook.result.current.draft.items.map((i) => i.id)).toEqual(['new']);
  });

  it('★ 펼친 항목의 슬라이드 줄이 있어도 자리가 어긋나지 않는다 — 이것이 줄 번호를 쓰는 이유다', () => {
    // 펼칠 수 있는 종류(성경)여야 슬라이드 줄이 붙는다 — 순서 표시·광고는 펼치지 못한다
    const expandable = [
      item({ id: 'a', type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [] }),
      item({ id: 'b', type: 'text', content: '둘' }),
      item({ id: 'c', type: 'text', content: '셋' }),
    ];
    // 'a' 를 펼쳐 슬라이드 3줄이 붙은 상태. 줄 목록은 [a, s0, s1, s2, b, c] 다.
    // 커서를 마지막 슬라이드 줄(3)에 두면, 사람이 보고 있는 항목은 여전히 'a' 다.
    const { hook } = setup({ items: expandable, expandedId: 'a', cursor: 3, previewSlideCount: 3 });
    expect(hook.result.current.rows).toHaveLength(6);
    expect(hook.result.current.rows[3]).toMatchObject({ kind: 'slide', itemId: 'a' });

    act(() => hook.result.current.add.insertItem(item({ id: 'new', type: 'blank' })));
    // 항목 번호로 셌다면 cursor 3 → 'c' 뒤(맨 끝)에 붙는다. 그것이 옛 버그다.
    expect(hook.result.current.draft.items.map((i) => i.id)).toEqual(['a', 'new', 'b', 'c']);
  });

  it('★ 넣은 뒤 커서가 새 항목을 가리킨다 — 이어서 다음을 넣는 자리', () => {
    const { hook } = setup({ items: three, cursor: 0 });
    act(() => hook.result.current.add.insertItem(item({ id: 'new', type: 'blank' })));
    const row = hook.result.current.rows[hook.result.current.draft.cursor];
    expect(row?.itemId).toBe('new');
  });

  it('넣으면 저장 안 됨이 켜진다', () => {
    const { hook } = setup({ items: three });
    expect(hook.result.current.draft.dirty).toBe(false);
    act(() => hook.result.current.add.insertItem(item({ id: 'new', type: 'blank' })));
    expect(hook.result.current.draft.dirty).toBe(true);
  });

  it('넣으면 입력칸과 검색 결과를 비운다 — 같은 것을 두 번 넣는 사고를 막는다', async () => {
    songs.mockResolvedValue({ total: 1, hits: [{ id: 7, title: '주 사랑', entries: [] }] });
    vi.useFakeTimers();
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('song'));
    act(() => hook.result.current.add.setAddInput('주'));
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(hook.result.current.add.songHits).toHaveLength(1);

    act(() => hook.result.current.add.insertItem(item({ id: 'new', type: 'blank' })));
    expect(hook.result.current.add.addInput).toBe('');
    expect(hook.result.current.add.songHits).toEqual([]);
    expect(hook.result.current.add.songTotal).toBe(0);
  });
});

describe('★ 인용구 — 절 낱개로 여럿을 한 번에', () => {
  it('참조 하나로 절마다 항목을 만든다 (묶는 머리 줄을 만들지 않는다)', async () => {
    passage.mockResolvedValue({
      parse: { ok: true },
      passage: { blocks: [{ verses: [
        { number: 1, text: '태초에' }, { number: 2, text: '땅이' }, { number: 3, text: '빛이' },
      ] }] },
    });
    const { hook, feedback } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('창 1:1-3'); });
    act(() => hook.result.current.add.pickKind('quote'));
    await act(async () => { hook.result.current.add.addFromInput(); });

    await waitFor(() => expect(hook.result.current.draft.items).toHaveLength(3));
    const items = hook.result.current.draft.items;
    expect(items.every((i) => i.type === 'bible')).toBe(true);
    expect(items.every((i) => 'quote' in i && i.quote === true)).toBe(true);
    expect(feedback.setNotice).toHaveBeenCalledWith(expect.stringContaining('인용구 3개'));
  });

  it('★ 본문을 한 번만 조회한다 — 절마다 부르면 여섯 번 왕복한다', async () => {
    passage.mockResolvedValue({
      parse: { ok: true },
      passage: { blocks: [{ verses: [{ number: 1, text: 'ㄱ' }, { number: 2, text: 'ㄴ' }] }] },
    });
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('창 1:1-2'); });
    act(() => hook.result.current.add.pickKind('quote'));
    await act(async () => { hook.result.current.add.addFromInput(); });
    await waitFor(() => expect(hook.result.current.draft.items).toHaveLength(2));
    expect(passage).toHaveBeenCalledTimes(1);
  });

  /**
   * 여럿을 넣는 길도 입력칸을 비워야 한다.
   *
   * 처음에 이 검사가 없었다 — 변이 검증에서 `insertItems` 쪽 비우기를 지웠는데
   * 아무 검사도 실패하지 않아 드러났다 (`insertItem` 쪽만 덮고 있었다).
   */
  it('★ 여럿을 넣은 뒤에도 입력칸을 비운다 — 같은 참조를 두 번 넣는 사고를 막는다', async () => {
    passage.mockResolvedValue({
      parse: { ok: true },
      passage: { blocks: [{ verses: [{ number: 1, text: 'ㄱ' }, { number: 2, text: 'ㄴ' }] }] },
    });
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('창 1:1-2'); });
    act(() => hook.result.current.add.pickKind('quote'));
    await act(async () => { hook.result.current.add.addFromInput(); });

    await waitFor(() => expect(hook.result.current.draft.items).toHaveLength(2));
    expect(hook.result.current.add.addInput).toBe('');
    expect(hook.result.current.add.parseOk).toBeNull();
  });

  it('주 역본 하나만 넘긴다 — 여러 역본이면 같은 절이 역본 수만큼 온다', async () => {
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddSecondary(['niv', 'esv']); });
    act(() => { hook.result.current.add.setAddInput('창 1:1'); });
    act(() => hook.result.current.add.pickKind('quote'));
    await act(async () => { hook.result.current.add.addFromInput(); });
    expect(passage).toHaveBeenCalledWith('창 1:1', ['nkrv'], 'verse');
  });

  it('해당하는 본문이 없으면 그렇게 말하고 아무것도 넣지 않는다', async () => {
    passage.mockResolvedValue({ parse: { ok: true }, passage: { blocks: [] } });
    const { hook, feedback } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('창 99:1'); });
    act(() => hook.result.current.add.pickKind('quote'));
    await act(async () => { hook.result.current.add.addFromInput(); });

    await waitFor(() => expect(feedback.setError).toHaveBeenCalledWith('그 참조에 해당하는 본문이 없습니다'));
    expect(hook.result.current.draft.items).toEqual([]);
  });

  it('참조 자체가 틀렸으면 그 이유를 올린다', async () => {
    passage.mockResolvedValue({ parse: { ok: false, message: '그런 책이 없습니다' }, passage: null });
    const { hook, feedback } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('없음 1:1'); });
    act(() => hook.result.current.add.pickKind('quote'));
    await act(async () => { hook.result.current.add.addFromInput(); });
    await waitFor(() => expect(feedback.setError).toHaveBeenCalledWith('그런 책이 없습니다'));
  });

  it('★ 조회 중에 사람이 항목을 지웠어도 넣은 것이 사라지지 않는다 (함수형 갱신)', async () => {
    let resolve!: (v: unknown) => void;
    passage.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { hook } = setup({ items: [item({ id: 'x', type: 'blank' }), item({ id: 'y', type: 'blank' })] });

    act(() => { hook.result.current.add.setAddInput('창 1:1'); });
    act(() => hook.result.current.add.pickKind('quote'));
    const pending = hook.result.current.add.addFromInput();

    // 조회가 도는 동안 사람이 항목을 다 지운다
    act(() => hook.result.current.draft.patchItems([]));

    await act(async () => {
      resolve({ parse: { ok: true }, passage: { blocks: [{ verses: [{ number: 1, text: 'ㄱ' }] }] } });
      await pending;
    });

    // 배열째로 덮어썼다면 지운 x·y 가 되살아난다. 함수형이면 넣은 것 하나만 남는다.
    expect(hook.result.current.draft.items.map((i) => i.id)).toHaveLength(1);
  });
});

describe('입력칸의 내용으로 넣기 — 종류마다 다르다', () => {
  it('성경: 기본 역본과 순서표의 화면 넘김 설정을 담는다', () => {
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('  요 3:16  '); });
    act(() => { hook.result.current.add.addFromInput(); });

    const added = hook.result.current.draft.items[0]!;
    // 앞뒤 공백은 뗀다
    expect(added).toMatchObject({ type: 'bible', ref: '요 3:16', primary: 'nkrv', paging: 'verse' });
  });

  it('★ 참조가 틀렸다고 나와 있으면 넣지 않는다 — 틀린 참조를 예배 중에 발견하면 늦다', async () => {
    parse.mockResolvedValue({ ok: false, message: '그런 책이 없습니다' });
    vi.useFakeTimers();
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('없음 1:1'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(hook.result.current.add.parseOk).toMatchObject({ ok: false });

    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items).toEqual([]);
  });

  it('아직 확인 전(parseOk 없음)이면 넣는다 — 기다리게 하면 손이 멈춘다', () => {
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('요 3:16'); });
    expect(hook.result.current.add.parseOk).toBeNull();
    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items).toHaveLength(1);
  });

  it('빈 입력으로는 아무것도 넣지 않는다 (공백만도 마찬가지)', () => {
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('   '); });
    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items).toEqual([]);
  });

  it('공백은 입력이 없어도 넣는다 — 넣을 내용이 없는 종류다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('blank'));
    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items[0]).toEqual({ id: expect.any(String), type: 'blank' });
  });

  it('구분은 입력을 이름으로 쓴다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('divider'));
    act(() => { hook.result.current.add.setAddInput('예배 부름'); });
    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items[0]).toMatchObject({ type: 'divider', label: '예배 부름' });
  });

  it('★ 광고는 가운데 줄바꿈을 그대로 둔다 — 여러 줄 광고를 한 항목으로 넣는다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('notice'));
    act(() => { hook.result.current.add.setAddInput('  첫 줄\n둘째 줄  '); });
    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items[0]).toMatchObject({ type: 'text', content: '첫 줄\n둘째 줄' });
  });

  it("순서 표시는 variant 를 남긴다 (광고는 안 남긴다 — 그것이 기본이다)", () => {
    const a = setup({ items: [] });
    act(() => a.hook.result.current.add.pickKind('order'));
    act(() => { a.hook.result.current.add.setAddInput('대표기도  김집사'); });
    act(() => { a.hook.result.current.add.addFromInput(); });
    expect(a.hook.result.current.draft.items[0]).toMatchObject({ variant: 'order' });

    const b = setup({ items: [] });
    act(() => b.hook.result.current.add.pickKind('notice'));
    act(() => { b.hook.result.current.add.setAddInput('광고입니다'); });
    act(() => { b.hook.result.current.add.addFromInput(); });
    expect(b.hook.result.current.draft.items[0]).not.toHaveProperty('variant');
  });

  it('그림 폴더: 고른 것이 없으면 넣지 않고, 넣으면 고른 것을 비운다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('slideshow'));
    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items).toEqual([]);

    act(() => { hook.result.current.add.setPickedFolder('library/광고'); });
    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items[0]).toMatchObject({
      type: 'slideshow', source: 'library', folder: '광고',
    });
    expect(hook.result.current.add.pickedFolder).toBe('');
  });

  it('폴더 경로에 하위 폴더가 있어도 source 만 떼어 낸다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('slideshow'));
    act(() => { hook.result.current.add.setPickedFolder('data/광고/2026'); });
    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items[0]).toMatchObject({ source: 'data', folder: '광고/2026' });
  });

  it('찬양은 검색 결과의 첫 곡을 넣는다 (결과가 없으면 아무것도)', async () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('song'));
    act(() => { hook.result.current.add.setAddInput('없는곡'); });
    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items).toEqual([]);
  });
});

describe('전례문 · 교독문', () => {
  it('★ 판본은 순서표 기본값으로 넣는다 — 넣을 때마다 물으면 매주 같은 답을 한다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.addLiturgy('lords-prayer'));
    // 기본 설정이 없으면 내장 기본 판본
    expect(hook.result.current.draft.items[0]).toMatchObject({
      type: 'liturgy', textId: 'lords-prayer', version: 'new',
    });
  });

  it('순서표가 정한 판본·줄 수·배경을 물려받는다', () => {
    const { hook } = setup({ items: [] });
    act(() => {
      hook.result.current.draft.setPlan({
        id: 1, name: 'ㄱ', kind: 'template', items: [],
        defaults: {
          liturgy: { version: 'traditional', perSlide: 2 },
          readingBackground: { source: 'library', name: 'bg_1.png' },
        },
      } as never);
    });
    act(() => hook.result.current.add.addLiturgy('apostles-creed'));
    expect(hook.result.current.draft.items[0]).toMatchObject({
      version: 'traditional', perSlide: 2,
      background: { source: 'library', name: 'bg_1.png' },
    });
  });

  it('★ 교독문은 제목을 함께 담는다 — 다른 PC 에서도 무엇이었는지 남는다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.addReading({ number: 23, title: '시편 98', book: 'hymn_old' } as never));
    expect(hook.result.current.draft.items[0]).toMatchObject({
      type: 'reading', readingNumber: 23, readingTitle: '시편 98',
    });
  });

  it("통일찬송가는 readingBook 을 적지 않는다 (기본) · 새찬송가는 적는다", () => {
    const a = setup({ items: [] });
    act(() => a.hook.result.current.add.addReading({ number: 1, title: 'ㄱ', book: 'hymn_old' } as never));
    expect(a.hook.result.current.draft.items[0]).not.toHaveProperty('readingBook');

    const b = setup({ items: [] });
    act(() => { b.hook.result.current.add.setReadingBook('hymn_new'); });
    act(() => b.hook.result.current.add.addReading({ number: 1, title: 'ㄱ', book: 'hymn_new' } as never));
    expect(b.hook.result.current.draft.items[0]).toMatchObject({ readingBook: 'hymn_new' });
  });
});

describe('검색 — 디바운스와 정리', () => {
  it('★ 찬양은 한 글자마다 부르지 않는다 (디바운스)', async () => {
    vi.useFakeTimers();
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('song'));

    act(() => { hook.result.current.add.setAddInput('은'); });
    act(() => { hook.result.current.add.setAddInput('은혜'); });
    act(() => { hook.result.current.add.setAddInput('은혜의'); });
    expect(songs).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(songs).toHaveBeenCalledTimes(1);
    expect(songs).toHaveBeenCalledWith('은혜의', 30);
  });

  it('★ 30개까지 받고, 잘렸으면 전체 수를 들고 있는다 — 찾는 곡이 눈에 보여야 한다', async () => {
    songs.mockResolvedValue({
      total: 34,
      hits: [{ id: 1, title: '은혜', entries: [{ number: 305, songbookShortLabel: '새' }] }],
    });
    vi.useFakeTimers();
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('song'));
    act(() => { hook.result.current.add.setAddInput('은혜'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });

    expect(hook.result.current.add.songTotal).toBe(34);
    expect(hook.result.current.add.songHits[0]).toMatchObject({ id: 1, title: '은혜', label: '새305' });
  });

  it('입력을 비우면 결과도 비운다', async () => {
    songs.mockResolvedValue({ total: 1, hits: [{ id: 1, title: 'ㄱ', entries: [] }] });
    vi.useFakeTimers();
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('song'));
    act(() => { hook.result.current.add.setAddInput('ㄱ'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(hook.result.current.add.songHits).toHaveLength(1);

    act(() => { hook.result.current.add.setAddInput(''); });
    expect(hook.result.current.add.songHits).toEqual([]);
  });

  it('찬양 종류가 아니면 부르지 않는다', async () => {
    vi.useFakeTimers();
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('은혜'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(songs).not.toHaveBeenCalled();
  });

  it('★ 참조 확인도 디바운스한다 — 성경·인용구에서만', async () => {
    vi.useFakeTimers();
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('요 3:16'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(parse).toHaveBeenCalledWith('요 3:16');
    expect(hook.result.current.add.parseOk).toEqual({ ok: true, text: '요한복음 3:16' });

    act(() => hook.result.current.add.pickKind('notice'));
    expect(hook.result.current.add.wantsRef).toBe(false);
    expect(hook.result.current.add.parseOk).toBeNull();
  });

  it('참조 확인이 실패해도 넣는 것을 막지 않는다 (parseOk 가 null 로 남는다)', async () => {
    parse.mockRejectedValue(new Error('끊김'));
    vi.useFakeTimers();
    const { hook } = setup({ items: [] });
    act(() => { hook.result.current.add.setAddInput('요 3:16'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(hook.result.current.add.parseOk).toBeNull();

    act(() => { hook.result.current.add.addFromInput(); });
    expect(hook.result.current.draft.items).toHaveLength(1);
  });

  it('★ 교독문 검색은 찬송가별로 다시 읽는다 — 번호가 같아도 다른 글이다', async () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('reading'));
    await waitFor(() => expect(readings).toHaveBeenCalledWith(undefined, 'hymn_old'));

    act(() => { hook.result.current.add.setReadingBook('hymn_new'); });
    await waitFor(() => expect(readings).toHaveBeenLastCalledWith(undefined, 'hymn_new'));
  });

  it('★ 가져오기를 안 했으면 total 0 을 들고 있는다 — 화면이 무엇을 해야 하는지 알려야 한다', async () => {
    readings.mockResolvedValue({ items: [], total: 0, counts: { hymn_old: 0, hymn_new: 0 } });
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('reading'));
    await waitFor(() => expect(hook.result.current.add.readingTotal).toBe(0));
    expect(hook.result.current.add.readingCounts).toEqual({ hymn_old: 0, hymn_new: 0 });
  });

  it('교독문 목록은 40개까지 — 한 줄짜리 띠라 그 이상은 화면을 덮는다', async () => {
    readings.mockResolvedValue({
      items: Array.from({ length: 100 }, (_, i) => ({ number: i, title: `${i}`, book: 'hymn_old' })),
      total: 100, counts: { hymn_old: 100, hymn_new: 0 },
    });
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('reading'));
    await waitFor(() => expect(hook.result.current.add.readingHits).toHaveLength(40));
  });

  it('교독문을 못 읽어도 순서표 작업이 멈추지 않는다', async () => {
    readings.mockRejectedValue(new Error('끊김'));
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('reading'));
    await waitFor(() => expect(hook.result.current.add.readingTotal).toBe(0));
    expect(hook.result.current.add.readingHits).toEqual([]);
  });
});

describe('★ 종류를 바꿀 때 — 입력 요소가 교체된다', () => {
  it('같은 종류를 다시 누르면 종류가 그대로다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('bible'));
    expect(hook.result.current.add.addKind).toBe('bible');
  });

  it('다른 종류로 바꾸면 그 종류가 된다', () => {
    const { hook } = setup({ items: [] });
    act(() => hook.result.current.add.pickKind('song'));
    expect(hook.result.current.add.addKind).toBe('song');
  });

  it('★ 요소가 교체된 **뒤에** 포커스를 잡는다 — 즉시 잡으면 포커스가 body 로 떨어지고 이어 친 글자가 전역 단축키로 들어간다', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const { hook } = setup({ items: [] });

    // ref 를 화면의 입력칸에 연결해 둔다 (PlanPanel 이 하는 일)
    (hook.result.current.add.addRef as { current: HTMLElement | null }).current = input;
    act(() => hook.result.current.add.pickKind('song'));

    // effect 가 addKind 변화 뒤에 돌아 포커스를 준다
    expect(document.activeElement).toBe(input);
    input.remove();
  });
});

describe('인용구 미리보기 다시 읽기', () => {
  it('새 역본의 미리보기로 그 항목만 고친다', async () => {
    passage.mockResolvedValue({
      parse: { ok: true },
      passage: { blocks: [{ verses: [{ number: 1, text: 'In the beginning' }] }] },
    });
    const quote = item({ id: 'q1', type: 'bible', ref: '창 1:1', primary: 'nkrv', secondary: [], quote: true });
    const other = item({ id: 'x', type: 'blank' });
    const { hook } = setup({ items: [quote, other] });

    await act(async () => {
      await hook.result.current.add.refreshQuotePreview('q1', '창 1:1', 'niv');
    });

    expect(passage).toHaveBeenCalledWith('창 1:1', ['niv'], 'verse');
    const updated = hook.result.current.draft.items.find((i) => i.id === 'q1')!;
    expect('preview' in updated && updated.preview).toBeTruthy();
    // 다른 항목은 손대지 않는다
    expect(hook.result.current.draft.items.find((i) => i.id === 'x')).toEqual(other);
  });

  it('★ 실패하면 아무것도 하지 않는다 — 미리보기는 라벨일 뿐이고 화면에 나가는 본문은 다시 읽는다', async () => {
    passage.mockRejectedValue(new FakeApiError('끊김'));
    const quote = item({ id: 'q1', type: 'bible', ref: '창 1:1', primary: 'nkrv', secondary: [], quote: true });
    const { hook, feedback } = setup({ items: [quote] });

    await act(async () => {
      await hook.result.current.add.refreshQuotePreview('q1', '창 1:1', 'niv');
    });

    expect(hook.result.current.draft.items[0]).toEqual(quote);
    // 배너를 띄우지 않는다 — 사람이 할 일이 없다
    expect(feedback.setError).not.toHaveBeenCalled();
  });
});

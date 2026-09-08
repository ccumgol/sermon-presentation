// @vitest-environment jsdom
/**
 * **순서 목록** (`src/control/components/plan/PlanCueList.tsx`).
 *
 * ## 왜 값이 있는가
 *
 * 예배를 **실제로 진행하는 화면**이다. 이 프로젝트의 핵심 규칙이 여기 있다:
 * **선택과 송출은 갈라져 있다** — 파란 테두리(`current`) = 보고 있는 것,
 * 빨간 점(`live`) = 실제로 나가고 있는 것. 이것이 뒤섞이면 오퍼레이터가
 * 거짓을 보고 판단한다.
 *
 * 2026-09-08 까지 이 JSX 는 2,549줄짜리 `PlanPanel` 안에 있어서, 화면을 다 띄우지
 * 않고는 그릴 수 없었다 — 그래서 검사가 하나도 없었다. **컴포넌트로 갈라낸 이득이
 * 이것이다**: 훅 검사가 규칙을 잡고, 컴포넌트 검사가 **화면에 무엇이 보이는지**를 잡는다.
 * 실제로 났던 사고 중 §4.6 D(서버 거절을 조용히 버림)와 태블릿 카드의 `lanWanted`
 * 결함은 둘 다 **화면 쪽** 버그였다.
 *
 * ## 틀(harness)
 *
 * 훅 객체를 가짜로 만들어 넣는다 — 서버도 다른 훅도 필요 없다. `rows` 는
 * `buildPlanRows` 로 실제로 만든다 (가짜 rows 를 주면 정작 확인할 규칙이 헛돈다).
 *
 * ⚠️ `scrollIntoView` 는 **jsdom 에 없다.** 커서를 화면 안으로 끌어오는 effect 가
 * 그것을 부르므로 여기서 채워 넣는다 — 컴포넌트에 검사 환경용 방어 코드를 넣지
 * 않는다 (브라우저에는 다 있는 함수다).
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildPlanRows } from '../../lib/plan-deck.ts';
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from '../../lib/template-presets.ts';
import { PlanCueList } from '../../src/control/components/plan/PlanCueList.tsx';
import type { CueItem, ServicePlan, SlidePayload } from '../../shared/types.ts';
import type { PlanDraft } from '../../src/control/hooks/usePlanDraft.ts';
import type { PlanFeedback } from '../../src/control/hooks/usePlanFeedback.ts';
import type { PlanPreview } from '../../src/control/hooks/usePlanPreview.ts';
import type { PlanSend } from '../../src/control/hooks/usePlanSend.ts';

// jsdom 에 없는 것 — 있는 척만 해 준다 (호출 여부는 여기서 보지 않는다)
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => undefined);

afterEach(cleanup);

const BOTTOM = getBuiltinTemplate(-1)!;
const PLAN = { id: 1, name: '주일예배', kind: 'template', items: [] } as unknown as ServicePlan;

const bible = (id: string, ref: string, patch: Record<string, unknown> = {}): CueItem =>
  ({ id, type: 'bible', ref, primary: 'nkrv', secondary: [], ...patch }) as unknown as CueItem;
const divider = (id: string, label: string, patch: Record<string, unknown> = {}): CueItem =>
  ({ id, type: 'divider', label, ...patch }) as unknown as CueItem;
const text = (id: string, content: string): CueItem =>
  ({ id, type: 'text', content }) as unknown as CueItem;
const slide = (line: string): SlidePayload => ({ kind: 'text', lines: [line] }) as unknown as SlidePayload;

// ── 가짜 훅들 ────────────────────────────────────────────────

const spies = {
  setCursor: vi.fn(), patchItems: vi.fn(), setAuto: vi.fn(),
  sendItem: vi.fn(), startAuto: vi.fn(), activateRow: vi.fn(),
};

function setup(o: {
  items?: CueItem[];
  cursor?: number;
  expandedId?: string | null;
  /** 지금 송출 중인 항목의 배열 위치 */
  liveItemIndex?: number;
  liveSlideIndexInItem?: number;
  preview?: { slides: SlidePayload[]; labels: string[] } | null;
  previewError?: string | null;
  auto?: { dividerId: string; holdMs: number; loop: boolean } | null;
  connected?: boolean;
  busy?: boolean;
  plan?: ServicePlan | null;
} = {}) {
  const items = o.items ?? [];
  const preview = o.preview ?? null;
  const rows = buildPlanRows(items, o.expandedId ?? null, preview?.slides.length ?? 0);

  const draft = {
    plan: o.plan === undefined ? PLAN : o.plan,
    items, cursor: o.cursor ?? 0, expandedId: o.expandedId ?? null,
    setCursor: spies.setCursor, patchItems: spies.patchItems,
  } as unknown as PlanDraft;

  const send = {
    auto: o.auto ?? null, setAuto: spies.setAuto,
    sendItem: spies.sendItem, startAuto: spies.startAuto,
    liveItemIndex: o.liveItemIndex ?? -1,
    liveSlideIndexInItem: o.liveSlideIndexInItem ?? -1,
  } as unknown as PlanSend;

  // 프리셋 실물을 쓴다 — 목록이 비어 있으면 `<option>` 이 없어 select 의 value 가
  // 반영되지 않는다 (React 의 동작). 실제 값과 어긋난 채로 통과하는 것도 막는다.
  const previewHook = {
    preview, previewError: o.previewError ?? null, styleTemplates: BUILTIN_TEMPLATES,
  } as unknown as PlanPreview;

  const feedback = { busy: o.busy ?? false, error: null } as unknown as PlanFeedback;

  render(
    <PlanCueList
      draft={draft} send={send} preview={previewHook} feedback={feedback}
      rows={rows} activateRow={spies.activateRow}
      template={BOTTOM} connected={o.connected ?? true}
    />,
  );
  return { rows };
}

/** 클래스로 찾는다 — 파란 테두리·빨간 점이 이 클래스로 그려진다 */
const rowsWith = (cls: string): Element[] =>
  Array.from(document.querySelectorAll(`.${cls}`));
const cueRows = (): Element[] => Array.from(document.querySelectorAll('.cue-list > .cue-row'));

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockReset();
});

describe('아무것도 열지 않았으면 그리지 않는다', () => {
  it('plan 이 없으면 목록 자체가 없다', () => {
    setup({ plan: null, items: [bible('a', '요 3:16')] });
    expect(document.querySelector('.cue-list')).toBeNull();
  });

  it('열었지만 항목이 없으면 무엇을 해야 하는지 알려 준다', () => {
    setup({ items: [] });
    expect(screen.getByText('아래에서 항목을 추가하세요.')).toBeTruthy();
  });
});

describe('★ 선택과 송출은 갈라져 있다 — 이 화면의 핵심 규칙', () => {
  const three = [bible('a', '요 3:16'), bible('b', '시 23'), bible('c', '롬 8:28')];

  it('★ 커서(파란 테두리)와 송출(빨간 점)이 **다른 줄**에 있을 수 있다', () => {
    setup({ items: three, cursor: 0, liveItemIndex: 2 });

    const rows = cueRows();
    expect(rows[0]!.className).toContain('current');
    expect(rows[0]!.className).not.toContain('live');
    expect(rows[2]!.className).toContain('live');
    expect(rows[2]!.className).not.toContain('current');
  });

  it('★ 같은 줄이면 둘 다 붙는다 — 보고 있는 것이 나가고 있는 상태', () => {
    setup({ items: three, cursor: 1, liveItemIndex: 1 });
    expect(cueRows()[1]!.className).toContain('current');
    expect(cueRows()[1]!.className).toContain('live');
  });

  it('아무것도 나가지 않으면 live 가 없다', () => {
    setup({ items: three, cursor: 1 });
    expect(rowsWith('live')).toHaveLength(0);
  });

  it("송출 중인 줄의 점에만 '송출 중' 이 붙는다 — 보조 기술에도 구분돼야 한다", () => {
    setup({ items: three, liveItemIndex: 1 });
    const dots = Array.from(document.querySelectorAll('.cue-list > .cue-row .live-dot'));
    expect(dots.filter((d) => d.getAttribute('title') === '송출 중')).toHaveLength(1);
  });

  it('★ 줄을 눌러도 바로 나가지 않는다 — activateRow 에 맡긴다 (눌렀다고 나가면 예배 중 사고)', () => {
    setup({ items: three, cursor: 0 });
    (cueRows()[1] as HTMLElement).click();

    expect(spies.setCursor).toHaveBeenCalledWith(1);
    expect(spies.activateRow).toHaveBeenCalledTimes(1);
    // 이 컴포넌트가 직접 송출하지는 않는다
    expect(spies.sendItem).not.toHaveBeenCalled();
  });

  it('▶ 는 바로 송출한다 — 그 버튼만 그렇다', () => {
    setup({ items: three });
    const go = cueRows()[1]!.querySelector('button[title="바로 송출"]') as HTMLButtonElement;
    go.click();
    expect(spies.sendItem).toHaveBeenCalledTimes(1);
    // 줄 선택은 번지지 않는다 (stopPropagation)
    expect(spies.activateRow).not.toHaveBeenCalled();
  });

  it('★ 끊겼으면 ▶ 를 누를 수 없다', () => {
    setup({ items: three, connected: false });
    const go = cueRows()[0]!.querySelector('button[title="바로 송출"]') as HTMLButtonElement;
    expect(go.disabled).toBe(true);
  });
});

describe('펼친 항목의 슬라이드 줄', () => {
  const two = [bible('a', '시 23'), text('b', '광고')];
  const preview = { slides: [slide('1절'), slide('2절'), slide('3절')], labels: ['23:1', '23:2', '23:3'] };

  it('펼치면 그 아래에 슬라이드가 줄로 들어온다 (라벨은 절 번호)', () => {
    setup({ items: two, expandedId: 'a', preview });
    const slideRows = rowsWith('cue-slide-row');
    expect(slideRows).toHaveLength(3);
    expect(slideRows.map((r) => r.querySelector('.num')?.textContent)).toEqual(['23:1', '23:2', '23:3']);
  });

  it('라벨이 없으면 번호로 대신한다 — 빈 칸을 보여 주지 않는다', () => {
    setup({ items: two, expandedId: 'a', preview: { slides: [slide('가')], labels: [] } });
    expect(rowsWith('cue-slide-row')[0]!.querySelector('.num')?.textContent).toBe('1');
  });

  it('펼칠 수 있는 항목에만 ▸ 가 붙는다 (광고는 펼칠 것이 없다)', () => {
    setup({ items: two });
    expect(cueRows()[0]!.querySelector('.twisty')?.textContent).toBe('▸');
    expect(cueRows()[1]!.querySelector('.twisty')?.textContent).toBe('');
  });

  it('펼쳐 두면 ▾ 로 바뀌고 줄에 expanded 가 붙는다', () => {
    setup({ items: two, expandedId: 'a', preview });
    expect(cueRows()[0]!.querySelector('.twisty')?.textContent).toBe('▾');
    expect(cueRows()[0]!.className).toContain('expanded');
  });

  it('★ 나가고 있는 **그 슬라이드에만** 빨간 점이 붙는다', () => {
    setup({ items: two, expandedId: 'a', preview, liveItemIndex: 0, liveSlideIndexInItem: 1 });
    const slideRows = rowsWith('cue-slide-row');
    expect(slideRows[0]!.className).not.toContain('live');
    expect(slideRows[1]!.className).toContain('live');
    expect(slideRows[2]!.className).not.toContain('live');
  });

  it('★ 다른 항목이 나가고 있으면 이 항목의 슬라이드에는 안 붙는다', () => {
    setup({ items: two, expandedId: 'a', preview, liveItemIndex: 1, liveSlideIndexInItem: 1 });
    expect(rowsWith('cue-slide-row').filter((r) => r.className.includes('live'))).toHaveLength(0);
  });

  it('슬라이드 줄을 누르면 **그 장으로** 송출한다 — 여기는 한 번에 나간다', () => {
    setup({ items: two, expandedId: 'a', preview });
    (rowsWith('cue-slide-row')[2] as HTMLElement).click();
    expect(spies.sendItem).toHaveBeenCalledWith(two[0], 2);
  });

  it('푸는 데 실패하면 그 이유를 목록 아래에 보여 준다', () => {
    setup({ items: two, expandedId: 'a', preview: { slides: [], labels: [] }, previewError: '본문을 찾지 못했습니다' });
    expect(screen.getByText('본문을 찾지 못했습니다')).toBeTruthy();
  });
});

describe('구분(그룹 머리글)과 예배 전 안내', () => {
  const items = [divider('d1', '예배 부름'), bible('a', '시 23')];

  it('구분은 이름만 있는 줄이다', () => {
    setup({ items });
    const d = document.querySelector('.cue-divider')!;
    expect(d.querySelector('.label')?.textContent).toContain('예배 부름');
  });

  it('★ 자동 넘김이 꺼져 있어도 ⏱ 자리를 보여 준다 — 없으면 기능이 있는 줄도 모른다 (2026-09-01 신고)', () => {
    setup({ items });
    const clock = document.querySelector('.cue-divider button[title^="예배 전 안내로 쓰기"]');
    expect(clock).toBeTruthy();
    expect(clock!.textContent).toContain('⏱');
  });

  it('⏱ 를 누르면 그 구분에 자동 넘김을 켠다 (기본 간격·순환으로)', () => {
    setup({ items });
    (document.querySelector('.cue-divider button[title^="예배 전 안내로 쓰기"]') as HTMLElement).click();
    expect(spies.patchItems).toHaveBeenCalledTimes(1);
    const next = spies.patchItems.mock.calls[0]![0] as CueItem[];
    expect(next[0]).toMatchObject({ auto: { holdMs: expect.any(Number), loop: true } });
  });

  it('★ 켠 뒤에는 같은 자리에 ▶ 가 생긴다 — 켜는 곳과 시작하는 곳이 같아야 헤매지 않는다', () => {
    setup({ items: [divider('d1', '예배 부름', { auto: { holdMs: 8000, loop: true } }), bible('a', '시 23')] });
    const go = document.querySelector('.cue-divider button.go')!;
    expect(go.textContent).toBe('▶');
    (go as HTMLElement).click();
    expect(spies.startAuto).toHaveBeenCalledTimes(1);
  });

  it('★ 돌고 있으면 ■ 로 바뀌고 누르면 멈춘다 (돌고 있다는 것이 줄에도 보인다)', () => {
    setup({
      items: [divider('d1', '예배 부름', { auto: { holdMs: 8000, loop: true } })],
      auto: { dividerId: 'd1', holdMs: 8000, loop: true },
    });
    const d = document.querySelector('.cue-divider')!;
    expect(d.className).toContain('auto');
    const stop = d.querySelector('button.go')!;
    expect(stop.textContent).toBe('■');
    (stop as HTMLElement).click();
    expect(spies.setAuto).toHaveBeenCalledWith(null);
    expect(spies.startAuto).not.toHaveBeenCalled();
  });

  it('다른 구분이 돌고 있으면 이 구분은 ▶ 다', () => {
    setup({
      items: [divider('d1', 'ㄱ', { auto: { holdMs: 8000, loop: true } }),
              divider('d2', 'ㄴ', { auto: { holdMs: 8000, loop: true } })],
      auto: { dividerId: 'd2', holdMs: 8000, loop: true },
    });
    const ds = Array.from(document.querySelectorAll('.cue-divider'));
    expect(ds[0]!.querySelector('button.go')?.textContent).toBe('▶');
    expect(ds[1]!.querySelector('button.go')?.textContent).toBe('■');
  });

  it('끊겼으면 ▶ 를 누를 수 없다', () => {
    setup({
      items: [divider('d1', 'ㄱ', { auto: { holdMs: 8000, loop: true } })],
      connected: false,
    });
    expect((document.querySelector('.cue-divider button.go') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('줄에서 바로 하는 것들', () => {
  const three = [bible('a', '요 3:16'), bible('b', '시 23'), bible('c', '롬 8:28')];

  it('★ 맨 위는 ↑ 를, 맨 아래는 ↓ 를 누를 수 없다', () => {
    setup({ items: three });
    const rows = cueRows();
    expect((rows[0]!.querySelector('button[title="위로"]') as HTMLButtonElement).disabled).toBe(true);
    expect((rows[0]!.querySelector('button[title="아래로"]') as HTMLButtonElement).disabled).toBe(false);
    expect((rows[2]!.querySelector('button[title="아래로"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('↑ 로 한 칸 올린다', () => {
    setup({ items: three });
    (cueRows()[1]!.querySelector('button[title="위로"]') as HTMLElement).click();
    const next = spies.patchItems.mock.calls[0]![0] as CueItem[];
    expect(next.map((i) => i.id)).toEqual(['b', 'a', 'c']);
  });

  it('✕ 로 그 항목만 지운다', () => {
    setup({ items: three });
    (cueRows()[1]!.querySelector('button[title="삭제"]') as HTMLElement).click();
    const next = spies.patchItems.mock.calls[0]![0] as CueItem[];
    expect(next.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('★ 항목의 템플릿을 여기서 바로 고른다 (기본은 "템플릿 그대로")', () => {
    setup({ items: [bible('a', '요 3:16'), bible('b', '시 23', { templateId: -8 })] });
    const sels = Array.from(document.querySelectorAll('select.row-template')) as HTMLSelectElement[];
    expect(sels[0]!.value).toBe('');
    expect(sels[1]!.value).toBe('-8');
  });
});

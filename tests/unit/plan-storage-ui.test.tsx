// @vitest-environment jsdom
/**
 * **순서표를 열고·저장하는 화면** — `PlanHead` · `PlanActions` ·
 * `PlanNameBar` · `PlanLoadList` · `PlanDirtyLine`.
 *
 * ## 왜 값이 있는가
 *
 * 이 다섯이 **사용자 데이터를 쓰는 길로 가는 문**이다. 훅(`usePlanStorage`)에는
 * 이미 검사 46개가 붙어 있지만, 그것은 "부르면 무엇을 하는가" 를 잡는다.
 * 여기서 잡는 것은 **화면에 무엇이 보이고 무엇을 누를 수 있는가** 다 —
 * 이 프로젝트에서 실제로 났던 사고 둘이 정확히 그 종류였다:
 *
 *  - 저장된 순서를 불러오면 위 칸이 '— 예배 유형 —' 로 비어, **무엇을 고치고
 *    있는지 화면 어디에도 없었다** (2026-09-03 사용자 보고).
 *  - '저장 안 됨' 만 떠 있고 **어느 버튼을 눌러야 하는지** 알 수 없었다.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlanActions } from '../../src/control/components/plan/PlanActions.tsx';
import { PlanDirtyLine } from '../../src/control/components/plan/PlanDirtyLine.tsx';
import { PlanHead } from '../../src/control/components/plan/PlanHead.tsx';
import { PlanLoadList } from '../../src/control/components/plan/PlanLoadList.tsx';
import { PlanNameBar } from '../../src/control/components/plan/PlanNameBar.tsx';
import type { CueItem, ServicePlan } from '../../shared/types.ts';
import type { PlanDraft } from '../../src/control/hooks/usePlanDraft.ts';
import type { Feedback } from '../../src/control/hooks/useFeedback.ts';
import type { PlanSend } from '../../src/control/hooks/usePlanSend.ts';
import type { PlanStorage } from '../../src/control/hooks/usePlanStorage.ts';

afterEach(cleanup);

const plan = (patch: Partial<ServicePlan> = {}): ServicePlan =>
  ({ id: 1, name: '주일예배', kind: 'template', items: [], ...patch }) as ServicePlan;
const SUNDAY = plan();
const WEDNESDAY = plan({ id: 2, name: '수요예배' });
const SAVED = plan({ id: 9, name: '2026-08-17 주일 1부', kind: 'plan', serviceDate: '2026-08-17' });
const item = (id: string): CueItem => ({ id, type: 'blank' }) as unknown as CueItem;

const spies = {
  openPlan: vi.fn(), duplicateCurrent: vi.fn(), removeTemplate: vi.fn(), removeSaved: vi.fn(),
  setNameBar: vi.fn(), setLoadOpen: vi.fn(), commitNameBar: vi.fn(), saveCurrent: vi.fn(),
  loadForService: vi.fn(), setDefaultsOpen: vi.fn(),
};

/** 가짜 usePlanStorage — 화면이 무엇을 보고 그리는지만 준다 */
function storageOf(o: Partial<PlanStorage> & { kind?: 'template' | 'plan' } = {}): PlanStorage {
  const kind = o.kind ?? 'template';
  return {
    templates: [SUNDAY, WEDNESDAY], saved: [SAVED],
    nameBar: null, nameBarTarget: undefined, loadOpen: false,
    nameInputRef: { current: null },
    planNoun: kind === 'template' ? '유형' : '순서',
    planNounObj: kind === 'template' ? '유형을' : '순서를',
    saveLabel: kind === 'template' ? '템플릿 업데이트' : '저장하기',
    ...spies,
    ...o,
  } as unknown as PlanStorage;
}
const draftOf = (o: Partial<PlanDraft> = {}): PlanDraft =>
  ({ plan: SUNDAY, items: [item('a')], dirty: false, ...o }) as unknown as PlanDraft;
const feedbackOf = (busy = false): Feedback => ({ busy } as unknown as Feedback);
const sendOf = (): PlanSend => ({ loadForService: spies.loadForService } as unknown as PlanSend);

beforeEach(() => {
  for (const s of Object.values(spies)) s.mockReset();
});

describe('★ 지금 무엇을 고치고 있는지 — PlanHead', () => {
  it('열어 둔 유형이 칸에 선택돼 있다', () => {
    render(<PlanHead storage={storageOf()} plan={SUNDAY} busy={false} />);
    const sel = screen.getByTitle('지금 고치는 중인 예배 유형 또는 저장된 순서') as HTMLSelectElement;
    expect(sel.value).toBe(String(SUNDAY.id));
  });

  it('★ 저장된 순서를 열어도 그 이름이 보인다 — 전에는 칸이 비어 무엇을 고치는지 몰랐다 (2026-09-03)', () => {
    render(<PlanHead storage={storageOf({ kind: 'plan' })} plan={SAVED} busy={false} />);
    const sel = screen.getByTitle('지금 고치는 중인 예배 유형 또는 저장된 순서') as HTMLSelectElement;
    expect(sel.value).toBe(String(SAVED.id));
    // 유형과 회차를 갈라 보여 준다
    expect(sel.querySelectorAll('optgroup')).toHaveLength(2);
  });

  it('아무것도 열지 않았으면 빈 값이다', () => {
    render(<PlanHead storage={storageOf()} plan={null} busy={false} />);
    expect((screen.getByTitle('지금 고치는 중인 예배 유형 또는 저장된 순서') as HTMLSelectElement).value).toBe('');
  });

  it('칸에서 고르면 그것을 연다', () => {
    render(<PlanHead storage={storageOf()} plan={SUNDAY} busy={false} />);
    const sel = screen.getByTitle('지금 고치는 중인 예배 유형 또는 저장된 순서') as HTMLSelectElement;
    sel.value = String(WEDNESDAY.id);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(spies.openPlan).toHaveBeenCalledWith(WEDNESDAY);
  });

  it('저장된 회차도 같은 칸에서 열 수 있다', () => {
    render(<PlanHead storage={storageOf()} plan={SUNDAY} busy={false} />);
    const sel = screen.getByTitle('지금 고치는 중인 예배 유형 또는 저장된 순서') as HTMLSelectElement;
    sel.value = String(SAVED.id);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    expect(spies.openPlan).toHaveBeenCalledWith(SAVED);
  });

  it('복제·이름 바꾸기·삭제 버튼이 그 자리에 있다', () => {
    render(<PlanHead storage={storageOf()} plan={SUNDAY} busy={false} />);
    screen.getByTitle(/복제합니다/).click();
    expect(spies.duplicateCurrent).toHaveBeenCalled();
    screen.getByTitle(/지웁니다/).click();
    expect(spies.removeTemplate).toHaveBeenCalled();
    screen.getByTitle(/이름을 바꿉니다/).click();
    expect(spies.setNameBar).toHaveBeenCalled();
  });

  it('★ 아무것도 열지 않았으면 복제·이름·삭제를 누를 수 없다 — 대상이 없다', () => {
    render(<PlanHead storage={storageOf()} plan={null} busy={false} />);
    for (const re of [/복제합니다/, /이름을 바꿉니다/, /지웁니다/]) {
      expect((screen.getByTitle(re) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('주 동작 버튼 줄 — PlanActions', () => {
  const render1 = (o: { kind?: 'template' | 'plan'; connected?: boolean; busy?: boolean; items?: CueItem[] } = {}) =>
    render(
      <PlanActions
        storage={storageOf({ kind: o.kind })}
        draft={draftOf({ items: o.items ?? [item('a')] })}
        send={sendOf()}
        feedback={feedbackOf(o.busy)}
        plan={o.kind === 'plan' ? SAVED : SUNDAY}
        connected={o.connected ?? true}
        defaultsOpen={false}
        setDefaultsOpen={spies.setDefaultsOpen}
      />,
    );

  it("★ '예배용으로 올리기' 가 있다 — 한 줄 합치기에서 이 버튼만 빠진 회귀가 있었다", () => {
    render1();
    const go = screen.getByTitle(/순서표 전체를 하나로 올립니다/);
    go.click();
    expect(spies.loadForService).toHaveBeenCalled();
  });

  it('★ 끊겼거나 항목이 없으면 올릴 수 없다', () => {
    render1({ connected: false });
    expect((screen.getByTitle(/순서표 전체를 하나로 올립니다/) as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    render1({ items: [] });
    expect((screen.getByTitle(/순서표 전체를 하나로 올립니다/) as HTMLButtonElement).disabled).toBe(true);
  });

  it("★ 저장 버튼 이름이 열어 둔 것에 따라 갈린다 — 화면에 없는 버튼을 찾게 하면 안 된다", () => {
    render1({ kind: 'template' });
    expect(screen.getByText('템플릿 업데이트')).toBeTruthy();
    cleanup();
    render1({ kind: 'plan' });
    expect(screen.getByText('저장하기')).toBeTruthy();
  });

  it('저장을 누르면 열어 둔 것에 그대로 저장한다', () => {
    render1();
    screen.getByText('템플릿 업데이트').click();
    expect(spies.saveCurrent).toHaveBeenCalled();
  });

  it('불러오기와 기본 설정은 열고 닫는 것이다 (여기서 그리지 않는다)', () => {
    render1();
    screen.getByTitle('저장해 둔 순서를 엽니다').click();
    expect(spies.setLoadOpen).toHaveBeenCalled();
    screen.getByTitle('이 예배에서 기본으로 쓸 템플릿·역본').click();
    expect(spies.setDefaultsOpen).toHaveBeenCalled();
  });

  it('작업 중이면 버튼이 흐려진다 — 두 번 눌리는 것을 막는다', () => {
    render1({ busy: true });
    expect((screen.getByText('템플릿 업데이트') as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('★ 이름 입력 바 — PlanNameBar', () => {
  const render1 = (nameBar: unknown, target?: ServicePlan) =>
    render(<PlanNameBar storage={storageOf({ nameBar, nameBarTarget: target } as never)} busy={false} />);

  it('열지 않았으면 아무것도 그리지 않는다', () => {
    const { container } = render1(null);
    expect(container.querySelector('input')).toBeNull();
  });

  it('넣은 값이 칸에 그대로 있다', () => {
    render1({ kind: 'template', value: '새 유형' });
    expect((document.querySelector('.plan-head input') as HTMLInputElement).value).toBe('새 유형');
  });

  it('★ 같은 이름이 있으면 버튼이 덮어쓰기로 바뀐다 — 회차가 하나 더 생기던 사고를 막는다', () => {
    render1({ kind: 'template', value: '수요예배' }, WEDNESDAY);
    expect(screen.getByText('덮어쓰기')).toBeTruthy();
    expect(screen.getByText(/누르면 그 유형를 덮어씁니다|덮어씁니다/)).toBeTruthy();
  });

  it('없는 이름이면 그냥 저장이다', () => {
    render1({ kind: 'plan', value: '새 회차' });
    expect(screen.getByText('저장')).toBeTruthy();
    expect(document.querySelector('.hintline.warn')).toBeNull();
  });

  it('★ 이름을 바꾸는 중에 겹치면 덮어쓰기가 아니라 **다른 이름을 쓰라**고 한다', () => {
    render1({ kind: 'template', value: '수요예배', renameId: 1 }, WEDNESDAY);
    expect(screen.getByText(/다른 이름을 쓰세요/)).toBeTruthy();
  });

  /**
   * 변이 검증이 찾아낸 빈틈 — 안내문만 보고 있었고 **버튼이 막히는지**는 안 봤다.
   * 겹친 이름으로 확정되면 같은 이름이 둘이 되어 어느 쪽을 덮어쓸지 알 수 없게 된다.
   */
  it('★ 이름을 바꾸는 중에 겹치면 확정 버튼이 막힌다 — 같은 이름이 둘이면 안 된다', () => {
    render1({ kind: 'template', value: '수요예배', renameId: 1 }, WEDNESDAY);
    expect((screen.getByText('이름 바꾸기') as HTMLButtonElement).disabled).toBe(true);
  });

  it('겹치지 않으면 확정할 수 있다', () => {
    render1({ kind: 'template', value: '주일 1부', renameId: 1 });
    expect((screen.getByText('이름 바꾸기') as HTMLButtonElement).disabled).toBe(false);
  });

  it("조사를 갈라 쓴다 — '유형이' / '순서가' (받침이 다르다)", () => {
    render1({ kind: 'template', value: 'ㄱ', renameId: 1 }, WEDNESDAY);
    expect(screen.getByText(/유형이 이미 있습니다/)).toBeTruthy();
    cleanup();
    render1({ kind: 'plan', value: 'ㄱ', renameId: 1 }, SAVED);
    expect(screen.getByText(/순서가 이미 있습니다/)).toBeTruthy();
  });

  it('빈 이름으로는 저장할 수 없다', () => {
    render1({ kind: 'template', value: '   ' });
    expect((screen.getByText('저장') as HTMLButtonElement).disabled).toBe(true);
  });

  it('취소하면 바를 닫는다', () => {
    render1({ kind: 'template', value: 'ㄱ' });
    screen.getByText('취소').click();
    expect(spies.setNameBar).toHaveBeenCalledWith(null);
  });
});

describe('저장해 둔 순서 목록 — PlanLoadList', () => {
  it('닫혀 있으면 그리지 않는다', () => {
    const { container } = render(<PlanLoadList storage={storageOf({ loadOpen: false })} />);
    expect(container.querySelector('.plan-saved')).toBeNull();
  });

  it('없으면 없다고 말한다 — 빈 띠만 보여 주지 않는다', () => {
    render(<PlanLoadList storage={storageOf({ loadOpen: true, saved: [] })} />);
    expect(screen.getByText('저장된 순서가 없습니다.')).toBeTruthy();
  });

  it('★ 이름에 이미 날짜가 있으면 앞에 또 붙이지 않는다 — 날짜 둘이 붙으면 어느 주인지 읽히지 않는다', () => {
    render(<PlanLoadList storage={storageOf({ loadOpen: true })} />);
    const row = document.querySelector('.saved-row')!;
    // '2026-08-17 주일 1부' 라는 이름 앞에 '2026-08-17 · ' 가 또 붙지 않는다
    expect(row.textContent).not.toMatch(/2026-08-17[^]]*2026-08-17/);
  });

  it('누르면 그 회차를 열고, ✕ 로 지운다', () => {
    render(<PlanLoadList storage={storageOf({ loadOpen: true })} />);
    (document.querySelector('.saved-row button') as HTMLElement).click();
    expect(spies.openPlan).toHaveBeenCalledWith(SAVED);
    (document.querySelectorAll('.saved-row button')[1] as HTMLElement).click();
    expect(spies.removeSaved).toHaveBeenCalledWith(SAVED);
  });
});

describe("★ '저장 안 됨' 줄 — PlanDirtyLine", () => {
  const render1 = (dirty: boolean, kind: 'template' | 'plan' = 'template', p: ServicePlan | null = SUNDAY) =>
    render(<PlanDirtyLine storage={storageOf({ kind })} plan={p} dirty={dirty} />);

  it('저장 안 한 변경이 없으면 그리지 않는다', () => {
    const { container } = render1(false);
    expect(container.querySelector('.plan-dirty')).toBeNull();
  });

  it('★ 어느 버튼을 눌러야 어디에 남는지 그대로 말한다', () => {
    render1(true, 'template');
    const line = document.querySelector('.plan-dirty')!.textContent!.replace(/\s+/g, ' ');
    expect(line).toContain('저장 안 됨');
    expect(line).toContain('템플릿 업데이트');   // 실제 버튼 이름
    expect(line).toContain('주일예배');           // 어디에 남는지
    expect(line).toContain('유형');
  });

  it('저장된 회차면 그쪽 말로 바뀐다', () => {
    render1(true, 'plan', SAVED);
    const line = document.querySelector('.plan-dirty')!.textContent!.replace(/\s+/g, ' ');
    expect(line).toContain('저장하기');
    expect(line).toContain('2026-08-17 주일 1부');
    expect(line).toContain('순서');
  });

  it('아무것도 열지 않았으면 그리지 않는다 — 남길 곳이 없다', () => {
    const { container } = render1(true, 'template', null);
    expect(container.querySelector('.plan-dirty')).toBeNull();
  });
});

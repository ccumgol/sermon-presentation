// @vitest-environment jsdom
/**
 * **순서표를 읽고·저장하고·지우는 것** (`src/control/hooks/usePlanStorage.ts`)
 * 과 그 척추(`usePlanDraft`).
 *
 * ## 왜 값이 있는가
 *
 * 여기가 **사용자 데이터를 쓰는 유일한 길**이다. 예배 유형과 저장된 회차는
 * `app.sqlite` 에 있고, 잘못 덮어쓰면 지난주에 짜 둔 순서가 사라진다.
 * 되돌릴 방법은 백업뿐이다.
 *
 * 실제로 이 화면에서 사고가 두 번 있었다 (둘 다 규칙으로 굳혀 여기서 못 박는다):
 *
 *  1. 저장된 순서를 고치면 **이름을 다시 쳐서 맞혀야** 덮어써졌다. 이름이
 *     '2026-08-17 주일 1부 예배' 처럼 길어 한 글자만 달라도 회차가 하나 더
 *     생겼다 (2026-09-03 사용자 보고).
 *  2. 탭을 옮겼다 돌아오면 **짜 놓은 순서가 통째로 없어졌다** — 패널이 언마운트되고
 *     '첫 유형을 연다' 규칙이 다시 돌았기 때문이다. 초안(sessionStorage)으로 고쳤다.
 *
 * ## 틀(harness)
 *
 * ⚠️ 초안 저장소는 `window.sessionStorage` 로 부른다. 맨몸 `localStorage` 는
 * Node 자체의 실험적 전역이 jsdom 것을 가려서 `undefined` 다.
 */

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CueItem, ServicePlan } from '../../shared/types.ts';

// ── api 를 바꿔 끼운다 (import 보다 먼저) ────────────────────
const plans = vi.fn();
const updatePlan = vi.fn();
const createPlan = vi.fn();
const duplicatePlan = vi.fn();
const deletePlan = vi.fn();

class FakeApiError extends Error {}

vi.mock('../../src/control/api.ts', () => ({
  api: {
    plans: (...a: unknown[]) => plans(...a),
    updatePlan: (...a: unknown[]) => updatePlan(...a),
    createPlan: (...a: unknown[]) => createPlan(...a),
    duplicatePlan: (...a: unknown[]) => duplicatePlan(...a),
    deletePlan: (...a: unknown[]) => deletePlan(...a),
  },
  ApiError: FakeApiError,
}));

const { usePlanStorage } = await import('../../src/control/hooks/usePlanStorage.ts');
const { usePlanDraft } = await import('../../src/control/hooks/usePlanDraft.ts');

const clearDraftStore = (): void => {
  try { window.sessionStorage.clear(); } catch { /* 없어도 검사는 돌아야 한다 */ }
};

afterEach(() => {
  cleanup();
  clearDraftStore();
  vi.unstubAllGlobals();
});

// ── 만들어 쓰는 것들 ─────────────────────────────────────────

const plan = (patch: Partial<ServicePlan> = {}): ServicePlan =>
  ({ id: 1, name: '주일예배', kind: 'template', items: [], ...patch }) as ServicePlan;
const item = (id: string): CueItem => ({ id, type: 'blank' }) as unknown as CueItem;

const SUNDAY = plan();
const WEDNESDAY = plan({ id: 2, name: '수요예배', items: [item('w1')] });
const SAVED = plan({ id: 9, name: '2026-08-17 주일 1부', kind: 'plan', serviceDate: '2026-08-17' });

/**
 * 서버의 목록을 흉내 낸다 — **지우면 실제로 빠져야 한다.**
 *
 * 처음에 `deletePlan` 을 그냥 성공으로만 두었더니, 지운 뒤 `reload()` 가 여전히
 * 그 유형을 돌려줘 '아무것도 열지 않았으면 첫 유형을 연다' 규칙이 다시 돌았다.
 * 그래서 '초안을 버린다' 검사가 실패했다 — 코드가 아니라 **픽스처가 현실과 달랐다.**
 */
let templateList: ServicePlan[] = [];
let savedList: ServicePlan[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  clearDraftStore();
  templateList = [SUNDAY, WEDNESDAY];
  savedList = [SAVED];
  plans.mockImplementation(async (kind: string) =>
    kind === 'template' ? [...templateList] : [...savedList]);
  updatePlan.mockImplementation(async (id: number, patch: Record<string, unknown>) => ({
    plan: { ...plan({ id }), ...patch, items: (patch.items as CueItem[]) ?? [] },
  }));
  createPlan.mockImplementation(async (name: string) => ({ plan: plan({ id: 100, name }) }));
  duplicatePlan.mockResolvedValue(plan({ id: 101, name: '주일예배 사본' }));
  deletePlan.mockImplementation(async (id: number) => {
    templateList = templateList.filter((p) => p.id !== id);
    savedList = savedList.filter((p) => p.id !== id);
    return { deleted: 1 };
  });
  // 확인 대화상자는 기본으로 '예'
  vi.stubGlobal('confirm', vi.fn(() => true));
});

/** 척추 + 저장 훅을 함께 띄운다 — 척추의 실제 규칙까지 함께 확인된다 */
function setup() {
  const feedback = { setBusy: vi.fn(), setError: vi.fn(), setNotice: vi.fn() };
  const onOpened = vi.fn();
  const hook = renderHook(() => {
    const draft = usePlanDraft();
    const storage = usePlanStorage({ draft, feedback, onOpened });
    return { draft, storage };
  });
  return { hook, feedback, onOpened };
}

describe('목록 읽기', () => {
  it('유형과 회차를 따로 읽는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.storage.templates).toHaveLength(2));
    expect(plans).toHaveBeenCalledWith('template');
    expect(plans).toHaveBeenCalledWith('plan');
    expect(hook.result.current.storage.saved).toEqual([SAVED]);
  });

  it('못 읽으면 그 이유를 올린다', async () => {
    plans.mockRejectedValue(new FakeApiError('예배 순서를 불러오지 못했습니다'));
    const { feedback } = setup();
    await waitFor(() =>
      expect(feedback.setError).toHaveBeenCalledWith('예배 순서를 불러오지 못했습니다'));
  });

  it('★ 아무것도 열지 않았으면 첫 유형을 연다 — 빈 화면에서 시작하면 매번 무엇을 골라야 하는지부터 판단해야 한다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan?.id).toBe(SUNDAY.id));
    expect(hook.result.current.draft.dirty).toBe(false);
  });

  it('★ 되살린 초안이 있으면 건드리지 않는다 — 덮어쓰면 짜 놓은 순서가 없어진다', async () => {
    window.sessionStorage.setItem('sermon.plan-draft.v1', JSON.stringify({
      plan: WEDNESDAY, items: [item('mine')], dirty: true, cursor: 3, expandedId: null,
    }));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.storage.templates).toHaveLength(2));

    expect(hook.result.current.draft.plan?.id).toBe(WEDNESDAY.id);
    expect(hook.result.current.draft.items.map((i) => i.id)).toEqual(['mine']);
    expect(hook.result.current.draft.dirty).toBe(true);
    expect(hook.result.current.draft.cursor).toBe(3);
  });
});

describe('★ 순서표 열기 — 편집 중인 변경을 잃는 자리', () => {
  it('저장 안 한 변경이 있으면 확인을 받는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.draft.patchItems([item('x')]));
    expect(hook.result.current.draft.dirty).toBe(true);

    act(() => hook.result.current.storage.openPlan(WEDNESDAY));
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('저장하지 않은 변경'));
    expect(hook.result.current.draft.plan?.id).toBe(WEDNESDAY.id);
  });

  it('★ 아니오를 누르면 그대로 둔다 — 여기서 잃으면 되돌릴 방법이 없다', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.draft.patchItems([item('x')]));

    act(() => hook.result.current.storage.openPlan(WEDNESDAY));
    expect(hook.result.current.draft.plan?.id).toBe(SUNDAY.id);
    expect(hook.result.current.draft.items.map((i) => i.id)).toEqual(['x']);
  });

  it('저장 안 한 변경이 없으면 묻지 않는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.storage.openPlan(WEDNESDAY));
    expect(globalThis.confirm).not.toHaveBeenCalled();
  });

  it('열면 항목·커서를 그 순서표의 것으로 되돌린다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.draft.setCursor(7));

    act(() => hook.result.current.storage.openPlan(WEDNESDAY));
    expect(hook.result.current.draft.items.map((i) => i.id)).toEqual(['w1']);
    expect(hook.result.current.draft.cursor).toBe(0);
    expect(hook.result.current.draft.dirty).toBe(false);
  });

  it('★ 추가 바의 역본을 그 예배의 기본값으로 되돌린다 (onOpened) — 이 훅과 추가 바 사이의 유일한 결합', async () => {
    const { hook, onOpened } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    const target = plan({ id: 5, name: 'ㄱ', defaults: { bible: { primary: 'niv' } } });

    act(() => hook.result.current.storage.openPlan(target));
    expect(onOpened).toHaveBeenCalledWith(target);
  });

  it('열면 불러오기 목록과 이름 바를 닫는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => {
      hook.result.current.storage.setLoadOpen(true);
      hook.result.current.storage.setNameBar({ kind: 'plan', value: 'ㄱ' });
    });

    act(() => hook.result.current.storage.openPlan(WEDNESDAY));
    expect(hook.result.current.storage.loadOpen).toBe(false);
    expect(hook.result.current.storage.nameBar).toBeNull();
  });
});

describe('★ 열어 둔 것에 그대로 저장한다 (이름을 다시 치지 않는다)', () => {
  it('유형이면 그 유형을 갱신한다', async () => {
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.draft.patchItems([item('a'), item('b')]));

    await act(async () => { await hook.result.current.storage.saveCurrent(); });

    expect(updatePlan).toHaveBeenCalledWith(SUNDAY.id, {
      name: SUNDAY.name,
      items: [item('a'), item('b')],
      defaults: null,
    });
    expect(hook.result.current.draft.dirty).toBe(false);
    expect(feedback.setNotice).toHaveBeenCalledWith(expect.stringContaining('유형에 저장했습니다'));
  });

  it('저장된 회차면 그 회차에 저장한다 — 이름을 맞혀 치지 않는다 (2026-09-03 사고)', async () => {
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.storage.openPlan(SAVED));
    act(() => hook.result.current.draft.patchItems([item('a')]));

    await act(async () => { await hook.result.current.storage.saveCurrent(); });
    expect(updatePlan).toHaveBeenCalledWith(SAVED.id, expect.objectContaining({ name: SAVED.name }));
    expect(feedback.setNotice).toHaveBeenCalledWith(expect.stringContaining('순서에 저장했습니다'));
  });

  it('★ 버려진 항목이 있으면 몇 개를 왜 버렸는지 알린다', async () => {
    updatePlan.mockResolvedValue({ plan: SUNDAY, rejected: ['알 수 없는 종류', '빈 항목'] });
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());

    await act(async () => { await hook.result.current.storage.saveCurrent(); });
    expect(feedback.setNotice).toHaveBeenCalledWith(expect.stringContaining('2개 항목을 버렸습니다'));
  });

  it('아무것도 열지 않았으면 아무 일도 하지 않는다', async () => {
    templateList = []; savedList = [];
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.storage.templates).toEqual([]));
    await act(async () => { await hook.result.current.storage.saveCurrent(); });
    expect(updatePlan).not.toHaveBeenCalled();
  });

  it('실패하면 이유를 올리고 저장 안 됨을 유지한다 — 저장된 줄 알면 안 된다', async () => {
    updatePlan.mockRejectedValue(new FakeApiError('디스크가 가득 찼습니다'));
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.draft.patchItems([item('a')]));

    await act(async () => { await hook.result.current.storage.saveCurrent(); });
    expect(feedback.setError).toHaveBeenCalledWith('디스크가 가득 찼습니다');
    expect(hook.result.current.draft.dirty).toBe(true);
  });

  it('busy 를 켜고 끝나면 반드시 끈다 — 켜진 채 남으면 버튼이 영구히 흐려진다', async () => {
    updatePlan.mockRejectedValue(new Error('무엇'));
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    await act(async () => { await hook.result.current.storage.saveCurrent(); });
    expect(feedback.setBusy).toHaveBeenNthCalledWith(1, true);
    expect(feedback.setBusy).toHaveBeenLastCalledWith(false);
  });

  it('버튼 이름과 부르는 말이 열어 둔 것을 따른다 — 화면에 없는 버튼을 찾게 하면 안 된다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    expect(hook.result.current.storage.saveLabel).toBe('템플릿 업데이트');
    expect(hook.result.current.storage.planNoun).toBe('유형');
    expect(hook.result.current.storage.planNounObj).toBe('유형을');

    act(() => hook.result.current.storage.openPlan(SAVED));
    expect(hook.result.current.storage.saveLabel).toBe('저장하기');
    expect(hook.result.current.storage.planNoun).toBe('순서');
    expect(hook.result.current.storage.planNounObj).toBe('순서를');
  });
});

describe('이름 입력 바', () => {
  it('같은 이름이 이미 있으면 그것을 가리킨다 — 버튼이 덮어쓰기로 바뀐다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.storage.templates).toHaveLength(2));
    act(() => hook.result.current.storage.setNameBar({ kind: 'template', value: ' 수요예배 ' }));
    expect(hook.result.current.storage.nameBarTarget?.id).toBe(WEDNESDAY.id);
  });

  it('★ 이름을 바꾸는 중이면 자기 자신은 빼고 본다 — 자기 이름과 겹친다고 막으면 안 된다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.storage.templates).toHaveLength(2));
    act(() => hook.result.current.storage.setNameBar({
      kind: 'template', value: '수요예배', renameId: WEDNESDAY.id,
    }));
    expect(hook.result.current.storage.nameBarTarget).toBeUndefined();
  });

  it('유형과 회차는 따로 본다 — 이름이 겹쳐도 다른 것이다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.storage.saved).toHaveLength(1));
    act(() => hook.result.current.storage.setNameBar({ kind: 'template', value: SAVED.name }));
    expect(hook.result.current.storage.nameBarTarget).toBeUndefined();

    act(() => hook.result.current.storage.setNameBar({ kind: 'plan', value: SAVED.name }));
    expect(hook.result.current.storage.nameBarTarget?.id).toBe(SAVED.id);
  });

  it('빈 이름으로는 확정하지 않는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.storage.setNameBar({ kind: 'template', value: '   ' }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });
    expect(createPlan).not.toHaveBeenCalled();
    expect(updatePlan).not.toHaveBeenCalled();
  });

  it('★ 이름만 바꿀 때 항목을 함께 보내지 않는다 — 아직 저장하지 않은 편집까지 조용히 굳는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.draft.patchItems([item('아직 저장 안 한 것')]));

    act(() => hook.result.current.storage.setNameBar({
      kind: 'template', value: '주일 1부', renameId: SUNDAY.id,
    }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });

    expect(updatePlan).toHaveBeenCalledWith(SUNDAY.id, { name: '주일 1부' });
    // 편집은 그대로 살아 있다
    expect(hook.result.current.draft.items.map((i) => i.id)).toEqual(['아직 저장 안 한 것']);
    expect(hook.result.current.draft.dirty).toBe(true);
  });

  it('★ 이름을 바꾼 뒤 서버의 기본 설정으로 덮지 않는다 — 저장 안 한 기본 설정 편집이 사라진다', async () => {
    updatePlan.mockResolvedValue({ plan: plan({ id: SUNDAY.id, name: '주일 1부' }) }); // defaults 없음
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());

    // 사람이 기본 설정을 고쳤지만 아직 저장하지 않았다
    act(() => hook.result.current.draft.setPlan(plan({ defaults: { templates: { bible: -8 } } })));
    act(() => hook.result.current.storage.setNameBar({
      kind: 'template', value: '주일 1부', renameId: SUNDAY.id,
    }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });

    expect(hook.result.current.draft.plan?.name).toBe('주일 1부');
    expect(hook.result.current.draft.plan?.defaults).toEqual({ templates: { bible: -8 } });
  });

  it('새로 만들면 그 이름으로 만들고 그것을 연다', async () => {
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.draft.patchItems([item('a')]));
    act(() => hook.result.current.storage.setNameBar({ kind: 'plan', value: '2026-09-07 주일' }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });

    expect(createPlan).toHaveBeenCalledWith('2026-09-07 주일', expect.any(String), [item('a')], 'plan');
    expect(feedback.setNotice).toHaveBeenCalledWith(expect.stringContaining('저장했습니다'));
    expect(hook.result.current.storage.nameBar).toBeNull();
  });

  it('같은 이름이 있으면 덮어쓴다 (새로 만들지 않는다)', async () => {
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.storage.templates).toHaveLength(2));
    act(() => hook.result.current.storage.setNameBar({ kind: 'template', value: '수요예배' }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });

    expect(createPlan).not.toHaveBeenCalled();
    expect(updatePlan).toHaveBeenCalledWith(WEDNESDAY.id, expect.objectContaining({ name: '수요예배' }));
    expect(feedback.setNotice).toHaveBeenCalledWith(expect.stringContaining('덮어썼습니다'));
  });

  it('★ 빈 상태에서 유형을 만들면 뼈대를 넣어 준다 — 빈 목록은 무엇을 할 수 있는지 알려주지 못한다', async () => {
    templateList = []; savedList = [];
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.storage.templates).toEqual([]));
    act(() => hook.result.current.storage.setNameBar({ kind: 'template', value: '새 유형' }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });

    const sent = createPlan.mock.calls[0]![2] as CueItem[];
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((i) => i.type === 'divider')).toBe(true);
  });

  it('회차는 빈 상태여도 뼈대를 넣지 않는다 — 유형에서만 하는 일이다', async () => {
    templateList = []; savedList = [];
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.storage.templates).toEqual([]));
    act(() => hook.result.current.storage.setNameBar({ kind: 'plan', value: '빈 회차' }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });
    expect(createPlan.mock.calls[0]![2]).toEqual([]);
  });

  it('★ 저장된 순서를 다른 이름으로 저장하면 그 회차의 날짜를 물려받는다 — 오늘로 찍으면 날짜 둘이 붙는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.storage.openPlan(SAVED));
    act(() => hook.result.current.storage.setNameBar({ kind: 'plan', value: '2026-08-17 주일 2부' }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });

    expect(createPlan).toHaveBeenCalledWith('2026-08-17 주일 2부', '2026-08-17', expect.anything(), 'plan');
  });

  it('유형에서 순서로 저장하면 오늘로 찍는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan?.kind).toBe('template'));
    act(() => hook.result.current.storage.setNameBar({ kind: 'plan', value: '오늘 예배' }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });

    const date = createPlan.mock.calls[0]![1] as string;
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('유형을 만들 때는 날짜를 찍지 않는다 — 유형에 날짜는 뜻이 없다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.storage.setNameBar({ kind: 'template', value: '새 유형' }));
    await act(async () => { await hook.result.current.storage.commitNameBar(); });
    expect(createPlan.mock.calls[0]![1]).toBe('');
  });
});

describe('복제', () => {
  it("서버가 kind 를 물려준다 — 복제한 것을 열어 '이름을 바꿔 쓰세요' 라고 알린다", async () => {
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    await act(async () => { await hook.result.current.storage.duplicateCurrent(); });

    expect(duplicatePlan).toHaveBeenCalledWith(SUNDAY.id);
    expect(hook.result.current.draft.plan?.id).toBe(101);
    expect(feedback.setNotice).toHaveBeenCalledWith(expect.stringContaining('이름을 바꿔 쓰세요'));
  });

  it('실패하면 이유를 올린다', async () => {
    duplicatePlan.mockRejectedValue(new FakeApiError('복제하지 못했습니다'));
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    await act(async () => { await hook.result.current.storage.duplicateCurrent(); });
    expect(feedback.setError).toHaveBeenCalledWith('복제하지 못했습니다');
  });
});

describe('★ 지우기 — 되돌릴 수 없다', () => {
  it('확인을 받는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    await act(async () => { await hook.result.current.storage.removeTemplate(); });
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('되돌릴 수 없습니다'));
    expect(deletePlan).toHaveBeenCalledWith(SUNDAY.id);
  });

  it('아니오면 지우지 않는다', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    await act(async () => { await hook.result.current.storage.removeTemplate(); });
    expect(deletePlan).not.toHaveBeenCalled();
  });

  it('★ 마지막 유형이면 기본이 되살아난다고 미리 알린다 — 지우고 나서 되살아나면 고장으로 보인다', async () => {
    templateList = [SUNDAY];
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.storage.templates).toHaveLength(1));
    await act(async () => { await hook.result.current.storage.removeTemplate(); });
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('기본 유형이 되살아납니다'));
  });

  it('★ 지우면 초안도 버린다 — 남겨 두면 다음에 탭을 열 때 지운 유형이 되살아난다', async () => {
    // 유형이 하나뿐인 상태에서 지운다. 남아 있으면 '첫 유형을 연다' 가 다른 것을
    // 여는 것이 **맞는 동작**이라, 그때는 초안에 그 새 유형이 담긴다.
    templateList = [SUNDAY];
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    await waitFor(() => expect(window.sessionStorage.getItem('sermon.plan-draft.v1')).not.toBeNull());

    await act(async () => { await hook.result.current.storage.removeTemplate(); });
    expect(window.sessionStorage.getItem('sermon.plan-draft.v1')).toBeNull();
    expect(hook.result.current.draft.plan).toBeNull();
    expect(hook.result.current.draft.items).toEqual([]);
  });

  it('유형이 여럿이면 지운 뒤 남은 첫 유형이 열린다 — 빈 화면으로 두지 않는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan?.id).toBe(SUNDAY.id));
    await act(async () => { await hook.result.current.storage.removeTemplate(); });
    await waitFor(() => expect(hook.result.current.draft.plan?.id).toBe(WEDNESDAY.id));
  });

  it('★ 저장된 순서를 열어 두고 지우기를 누르면 순서 쪽 길로 넘긴다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.storage.openPlan(SAVED));

    await act(async () => { await hook.result.current.storage.removeTemplate(); });
    expect(globalThis.confirm).toHaveBeenCalledWith(expect.stringContaining('저장된 순서'));
    expect(deletePlan).toHaveBeenCalledWith(SAVED.id);
  });

  it('열지 않은 다른 회차를 지워도 편집 중인 것은 건드리지 않는다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    const before = hook.result.current.draft.plan;

    await act(async () => { await hook.result.current.storage.removeSaved(SAVED); });
    expect(deletePlan).toHaveBeenCalledWith(SAVED.id);
    expect(hook.result.current.draft.plan).toEqual(before);
  });

  it('실패하면 이유를 올린다', async () => {
    deletePlan.mockRejectedValue(new FakeApiError('지우지 못했습니다'));
    const { hook, feedback } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    await act(async () => { await hook.result.current.storage.removeTemplate(); });
    expect(feedback.setError).toHaveBeenCalledWith('지우지 못했습니다');
  });
});

describe('★ 척추 — 초안에 담고 되살린다 (탭을 옮기면 패널이 언마운트된다)', () => {
  it('열어 둔 것이 있으면 담는다 (커서와 펼친 항목까지)', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => {
      hook.result.current.draft.patchItems([item('a')]);
      hook.result.current.draft.setCursor(5);
      hook.result.current.draft.setExpandedId('a');
    });

    await waitFor(() => {
      const raw = window.sessionStorage.getItem('sermon.plan-draft.v1');
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw!)).toMatchObject({ cursor: 5, expandedId: 'a', dirty: true });
    });
  });

  it('아무것도 열지 않았으면 담지 않는다 — 담을 것이 없다', () => {
    templateList = []; savedList = [];
    setup();
    expect(window.sessionStorage.getItem('sermon.plan-draft.v1')).toBeNull();
  });

  it('★ patchItems 는 함수도 받는다 — 비동기 뒤에 배열을 넘기면 그 사이의 편집을 덮어쓴다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.draft.patchItems([item('a')]));
    act(() => hook.result.current.draft.patchItems((prev) => [...prev, item('b')]));
    expect(hook.result.current.draft.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('setItems 는 저장 안 됨을 켜지 않는다 — 서버에서 받은 것을 넣는 길이다', async () => {
    const { hook } = setup();
    await waitFor(() => expect(hook.result.current.draft.plan).not.toBeNull());
    act(() => hook.result.current.draft.setItems([item('서버에서 온 것')]));
    expect(hook.result.current.draft.dirty).toBe(false);
  });

  it('형태가 맞지 않는 옛 초안은 무시한다 — 그대로 밀어 넣으면 패널이 깨진다', () => {
    window.sessionStorage.setItem('sermon.plan-draft.v1', JSON.stringify({ 옛것: true }));
    const { hook } = setup();
    expect(hook.result.current.draft.plan).toBeNull();
    expect(hook.result.current.draft.items).toEqual([]);
  });

  it('깨진 JSON 에도 죽지 않는다', () => {
    window.sessionStorage.setItem('sermon.plan-draft.v1', '{{{');
    const { hook } = setup();
    expect(hook.result.current.draft.items).toEqual([]);
  });
});

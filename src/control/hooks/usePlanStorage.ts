/**
 * **순서표를 읽고·저장하고·지우는 것** (예배 순서 탭).
 *
 * `PlanPanel` 에서 떼어냈다(2026-09-07 R-4). 여기가 **사용자 데이터를 쓰는 길**이다 —
 * 예배 유형과 저장된 회차는 `app.sqlite` 에 있고, 잘못 덮어쓰면 지난주에 짜 둔
 * 순서가 사라진다. 검사가 붙어야 하는 자리인데 2,500줄짜리 컴포넌트 안에 있었다.
 *
 * ## 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 편집 중인 변경을 잃는 자리에는 **반드시 확인**을 받는다 | 되돌릴 방법이 없다 |
 * | 이름만 바꿀 때 **항목을 함께 보내지 않는다** | 아직 저장하지 않은 편집까지 조용히 굳는다 |
 * | 이름 바꾸기 뒤 서버의 `defaults` 로 덮지 않는다 | 저장 안 한 기본 설정 편집이 사라진다 |
 * | 같은 이름이 있으면 **덮어쓰기**로 바뀐다 | 한 글자 달라 회차가 하나 더 생기던 사고를 막는다 (2026-09-03 사용자 보고) |
 * | 지울 때 초안도 버린다 | 남겨 두면 다음에 탭을 열 때 지운 유형이 되살아난다 |
 * | 마지막 유형을 지우면 **미리 알린다** | 다음 서버 시작 때 기본 넷이 되살아나 고장으로 보인다 |
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { newItemId } from '../../../lib/plan-deck.ts';
import { DEFAULT_GROUPS, today } from '../../../lib/plan-item-view.ts';
import type { CueItem, PlanKind, ServicePlan } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { clearPlanDraft } from '../panels/plan-draft.ts';
import type { PlanDraft } from './usePlanDraft.ts';

/** 화면에 알릴 것들 — 이 훅은 그 상태를 갖지 않고 부르는 쪽의 것을 쓴다 */
export interface StorageFeedback {
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
}

export interface PlanStorageOptions {
  /** 편집 중인 것 (usePlanDraft) */
  draft: PlanDraft;
  feedback: StorageFeedback;
  /**
   * 순서표를 새로 열었을 때 — **추가 바를 이 예배의 기본값으로 되돌린다.**
   *
   * 이 훅이 추가 바 상태를 직접 만지지 않게 하려고 콜백으로 뺐다. 이것이
   * 순서표 열기와 추가 바 사이에 실제로 있는 유일한 결합이다.
   */
  onOpened: (plan: ServicePlan) => void;
}

export function usePlanStorage(options: PlanStorageOptions) {
  const {
    draft: { plan, setPlan, items, setItems, dirty, setDirty, setCursor },
    feedback: { setBusy, setError, setNotice },
    onOpened,
  } = options;

  /** 예배 유형(주일예배·수요예배 …) — 매주 고쳐 쓰는 원본 */
  const [templates, setTemplates] = useState<ServicePlan[]>([]);
  /** 저장해 둔 회차 — 지난주 순서를 다시 열 때 */
  const [saved, setSaved] = useState<ServicePlan[]>([]);

  /** 이름을 받아야 하는 저장 동작 (유형 만들기 / 순서 저장하기) */
  const [nameBar, setNameBar] = useState<{ kind: PlanKind; value: string; renameId?: number } | null>(
    null,
  );
  const [loadOpen, setLoadOpen] = useState(false);
  /** 이름 입력 칸 — '이름 바꾸기' 를 열 때 전체 선택하려고 붙잡는다 */
  const nameInputRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const [templateList, savedList] = await Promise.all([api.plans('template'), api.plans('plan')]);
      setTemplates(templateList);
      setSaved(savedList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '예배 순서를 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * 아무것도 열지 않았으면 첫 유형을 연다.
   *
   * 빈 화면에서 시작하면 매번 '무엇을 골라야 하는지' 부터 판단해야 한다.
   * 편집 중인 것이 있으면(=plan) 건드리지 않는다.
   */
  useEffect(() => {
    if (plan || templates.length === 0) return;
    const first = templates[0];
    if (first) {
      setPlan(first);
      setItems(first.items);
      setDirty(false);
      setCursor(0);
    }
  }, [templates, plan]);

  /** 편집 중인 변경을 잃는 자리에는 반드시 확인을 받는다 */
  function openPlan(target: ServicePlan): void {
    if (dirty && !window.confirm('저장하지 않은 변경이 있습니다. 그래도 여시겠습니까?')) return;
    setPlan(target);
    setItems(target.items);
    // 추가 바의 역본도 이 예배의 기본값에서 시작한다 (부르는 쪽이 한다)
    onOpened(target);
    setDirty(false);
    setCursor(0);
    setNotice(null);
    setLoadOpen(false);
    setNameBar(null);
  }

  /**
   * '이름 바꾸기' 를 열 때 기존 이름을 전체 선택한다.
   *
   * 칸이 이미 차 있는데 선택돼 있지 않으면 커서가 끝에 붙어, 새 이름을 치는 순간
   * 옛 이름 뒤에 이어 붙는다('주일예배' + '주일 1부 예배').
   *
   * **'순서 저장하기' 에는 걸지 않는다** — 거기는 '2026-08-17 주일 1부 예배' 처럼
   * 날짜가 채워져 있어 대개 그대로 쓰거나 뒤에 덧붙인다. 전체 선택하면 날짜까지
   * 다시 쳐야 한다.
   *
   * 의존성에 `value` 를 넣으면 안 된다 — 한 글자 칠 때마다 전체가 선택돼
   * 다음 글자가 앞의 것을 지운다.
   */
  const renamingId = nameBar?.renameId;
  useEffect(() => {
    if (renamingId !== undefined) nameInputRef.current?.select();
  }, [renamingId]);

  /** 지금 열어 둔 것을 뭐라고 부르는가 — 버튼·안내 문구가 이걸 따른다 */
  const planNoun = plan?.kind === 'template' ? '유형' : '순서';
  /** 목적격까지 붙인 것 — '유형을' / '순서를'. 받침이 달라 조사를 이어 붙일 수 없다 */
  const planNounObj = plan?.kind === 'template' ? '유형을' : '순서를';
  /**
   * 저장 버튼의 이름. 안내 문구가 **실제 버튼과 같은 말**을 가리켜야 한다 —
   * 다르면 화면에 없는 버튼을 찾게 된다.
   */
  const saveLabel = plan?.kind === 'template' ? '템플릿 업데이트' : '저장하기';

  /**
   * **열어 둔 것에 그대로 저장한다** — 유형이면 '템플릿 업데이트', 저장된 순서면 '저장하기'.
   *
   * 전에는 유형만 이 길이 있었다. 저장된 순서를 불러와 고치면 '순서 저장하기' 로
   * 이름을 **다시 쳐서 같은 이름을 맞혀야** 덮어쓸 수 있었다. 이름이
   * '2026-08-17 주일 1부 예배' 처럼 길어 한 글자만 달라도 덮어쓰기가 아니라
   * 새 순서가 하나 더 생겼다 (2026-09-03 사용자 보고).
   */
  async function saveCurrent(): Promise<void> {
    if (!plan) return;
    const noun = plan.kind === 'template' ? '유형' : '순서';
    // '유형을' / '순서를' — 받침이 달라 조사를 이어 붙일 수 없다
    const nounObj = plan.kind === 'template' ? '유형을' : '순서를';
    setBusy(true);
    setError(null);
    try {
      const result = await api.updatePlan(plan.id, {
        name: plan.name,
        items,
        defaults: plan.defaults ?? null,
      });
      setPlan(result.plan);
      setItems(result.plan.items);
      setDirty(false);
      await reload();
      setNotice(
        result.rejected && result.rejected.length > 0
          ? `${nounObj} 갱신했지만 ${result.rejected.length}개 항목을 버렸습니다: ${result.rejected.join(', ')}`
          : `'${result.plan.name}' ${noun}에 저장했습니다`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 같은 이름이 이미 있는지 — 있으면 버튼이 '덮어쓰기' 로 바뀐다.
   * 이름을 바꾸는 중이면 **자기 자신은 빼고** 본다 (자기 이름과 겹친다고 막으면 안 된다).
   */
  const nameBarTarget = nameBar
    ? (nameBar.kind === 'template' ? templates : saved).find(
        (p) => p.name === nameBar.value.trim() && p.id !== nameBar.renameId,
      )
    : undefined;

  /** 이름 입력 바 확정 — 새로 만들거나, 같은 이름이 있으면 덮어쓴다 */
  async function commitNameBar(): Promise<void> {
    if (!nameBar) return;
    const name = nameBar.value.trim();
    if (name.length === 0) return;

    setBusy(true);
    setError(null);
    try {
      // 이름만 바꾼다 — 항목은 건드리지 않는다.
      // 지금 화면의 items 를 함께 보내면, 아직 저장하지 않은 편집까지 조용히 굳는다.
      if (nameBar.renameId !== undefined) {
        const renamed = await api.updatePlan(nameBar.renameId, { name });
        /*
          **이름만 바꾸고 편집 중인 것은 그대로 둔다.**

          서버가 돌려주는 plan 에는 **저장된** 기본 설정이 들어 있다. 그것을 그대로
          넣으면 아직 저장하지 않은 기본 설정 편집이 조용히 사라진다 — items 는
          별도 state 라 살아남는데 defaults 만 없어져, '저장 안 됨' 이 떠 있는 채로
          방금 고친 역본·템플릿이 옛 값으로 돌아간다.
        */
        const current = plan;
        if (current?.id === nameBar.renameId) {
          setPlan({
            ...renamed.plan,
            ...(current.defaults ? { defaults: current.defaults } : {}),
          });
        }
        setNameBar(null);
        await reload();
        setNotice(`이름을 '${name}' 으로 바꿨습니다`);
        return;
      }

      // 빈 상태에서 유형을 만들면 뼈대를 넣어 준다 — 빈 목록은 무엇을 할 수 있는지 알려주지 못한다
      const payload: CueItem[] =
        items.length === 0 && nameBar.kind === 'template'
          ? DEFAULT_GROUPS.map((label) => ({ id: newItemId(), type: 'divider', label }))
          : items;

      /*
        회차 날짜. 유형에서 '순서 저장하기' 로 오면 오늘 예배를 남기는 것이니 오늘이다.
        저장된 순서에서 '다른 이름으로 저장' 으로 오면 **그 회차의 날짜를 물려받는다** —
        오늘로 찍으면 지난주 순서를 복제한 것이 '2026-09-03 · 2026-08-17 주일 2부' 처럼
        날짜 둘이 붙어 목록에서 어느 주의 것인지 읽히지 않는다.
      */
      const serviceDate =
        nameBar.kind !== 'plan' ? '' : plan?.kind === 'plan' ? (plan.serviceDate ?? '') : today();

      const result = nameBarTarget
        ? await api.updatePlan(nameBarTarget.id, { name, items: payload, defaults: plan?.defaults ?? null })
        : (await api.createPlan(name, serviceDate, payload, nameBar.kind));

      setPlan(result.plan);
      setItems(result.plan.items);
      setDirty(false);
      setNameBar(null);
      await reload();
      setNotice(
        `${nameBar.kind === 'template' ? '유형' : '순서'} '${name}' 을(를) ` +
          `${nameBarTarget ? '덮어썼습니다' : '저장했습니다'}`,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 유형 복제 — '주일 1부' 를 놔둔 채 '주일 2부' 를 만드는 길.
   * 비슷한 유형을 여럿 두는 것이 실제 운영이라, 처음부터 짜는 것보다 이게 기본이다.
   */
  async function duplicateCurrent(): Promise<void> {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      // 서버가 kind 를 그대로 물려준다 — 순서를 복제하면 순서가 된다
      const copy = await api.duplicatePlan(plan.id);
      await reload();
      openPlan(copy);
      setNotice(`'${copy.name}' 을(를) 만들었습니다 — 이름을 바꿔 쓰세요`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '복제하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 유형 삭제.
   *
   * 유형을 **전부** 지우면 다음 서버 시작 때 기본 넷이 되살아난다
   * (`seedDefaultTemplates` 는 '하나도 없을 때'만 넣는다). 지우고 나서 되살아나면
   * 고장으로 보이므로 미리 알린다.
   */
  async function removeTemplate(): Promise<void> {
    if (!plan) return;
    // 저장된 순서는 지우는 절차가 따로 있다 ('순서 불러오기' 목록의 ✕ 와 같은 길)
    if (plan.kind !== 'template') {
      void removeSaved(plan);
      return;
    }
    const last = templates.length <= 1;
    const warning = last
      ? '\n\n마지막 유형입니다. 모두 지우면 다음 서버 시작 때 기본 유형이 되살아납니다.'
      : '';
    if (!window.confirm(`예배 유형 '${plan.name}' 을(를) 지웁니다. 되돌릴 수 없습니다.${warning}`)) return;

    setBusy(true);
    setError(null);
    try {
      await api.deletePlan(plan.id);
      setPlan(null);
      setItems([]);
      setDirty(false);
      // 초안도 함께 버린다 — 남겨 두면 다음에 이 탭을 열 때 지운 유형이 되살아난다
      clearPlanDraft();
      await reload();
      setNotice(`유형 '${plan.name}' 을(를) 지웠습니다`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /** 저장된 순서 삭제 — 되돌릴 수 없으므로 확인을 받는다 */
  async function removeSaved(target: ServicePlan): Promise<void> {
    if (!window.confirm(`저장된 순서 '${target.name}' 을(를) 지웁니다. 되돌릴 수 없습니다.`)) return;
    try {
      await api.deletePlan(target.id);
      if (plan?.id === target.id) {
        setPlan(null);
        clearPlanDraft();
      }
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했습니다');
    }
  }
  return {
    /** 예배 유형 목록 */
    templates,
    /** 저장해 둔 회차 목록 */
    saved,
    /** 목록을 다시 읽는다 */
    reload,
    /** 순서표 하나를 편집 상태로 올린다 (저장 안 한 변경이 있으면 확인을 받는다) */
    openPlan,
    /** 열어 둔 것에 그대로 저장한다 */
    saveCurrent,
    /** 유형 복제 — '주일 1부' 를 놔둔 채 '주일 2부' 를 만드는 길 */
    duplicateCurrent,
    /** 열어 둔 유형을 지운다 (순서면 removeSaved 로 넘긴다) */
    removeTemplate,
    /** 저장된 순서 하나를 지운다 */
    removeSaved,
    /** 이름 입력 바 */
    nameBar, setNameBar,
    /** 같은 이름이 이미 있으면 그것 — 버튼이 '덮어쓰기' 로 바뀐다 */
    nameBarTarget,
    commitNameBar,
    /** '순서 불러오기' 목록을 펼쳤는지 */
    loadOpen, setLoadOpen,
    /** 이름 입력 칸에 걸 ref */
    nameInputRef,
    /** 지금 열어 둔 것을 뭐라고 부르는가 — 버튼·안내 문구가 이걸 따른다 */
    planNoun, planNounObj, saveLabel,
  };
}

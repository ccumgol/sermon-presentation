/**
 * **예배 순서 탭이 편집 중인 것** — 이 화면의 척추다.
 *
 * `PlanPanel` 에서 떼어냈다(2026-09-07 R-4). 순서표 읽기·저장(`usePlanStorage`)과
 * 항목 추가(`usePlanAdd`)가 **둘 다 이것을 붙잡고 있다.** 먼저 떼어내지 않으면
 * 그 둘이 프롭 열 개씩 받는 껍데기가 된다 — R-4 가 전에 멈춘 이유가 그것이다.
 *
 * ## 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 되살릴 초안은 **첫 렌더에** 넣는다 | effect 로 늦게 넣으면 '첫 유형을 연다' 규칙이 먼저 돌아 화면이 한 번 튄다 |
 * | 커서까지 초안에 담는다 | 20개짜리 순서에서 돌아왔을 때 맨 위로 튀면 어디까지 짜던 중인지 다시 찾아야 한다 |
 * | `patchItems` 는 **함수도 받는다** | 비동기 뒤에 배열을 넘기면 옛 렌더의 값이라 그 사이의 편집을 덮어쓴다 |
 * | 항목을 고치면 **반드시 dirty** | '저장 안 됨' 이 안 뜨면 사용자가 저장 없이 탭을 옮긴다 |
 */

import { useCallback, useEffect, useState } from 'react';

import type { CueItem, ServicePlan } from '../../../shared/types.ts';
import { readPlanDraft, writePlanDraft } from '../panels/plan-draft.ts';

export interface PlanDraft {
  /** 지금 편집 중인 것이 어디서 왔는지 (`null` = 아무것도 열지 않았다) */
  plan: ServicePlan | null;
  setPlan: (plan: ServicePlan | null) => void;
  items: CueItem[];
  setItems: React.Dispatch<React.SetStateAction<CueItem[]>>;
  /** 저장하지 않은 변경이 있는지 — '저장 안 됨' 줄이 이걸 따른다 */
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  /**
   * 선택(커서) — **줄** 번호다. 펼친 슬라이드도 한 줄로 센다.
   *
   * 항목 번호가 아니라 줄 번호인 이유는 3차 재설계에서 오른쪽 열을 없애고
   * 슬라이드를 목록 안으로 넣었기 때문이다(`docs/plan-service-tab-3.md`).
   */
  cursor: number;
  setCursor: React.Dispatch<React.SetStateAction<number>>;
  /** 펼친 항목 — 한 번에 하나만. 여러 개가 열리면 목록이 길어져 진행이 안 보인다 */
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  /** 항목 목록을 바꾸고 '저장 안 됨' 을 켠다. **항목을 고치는 길은 이것뿐이다** */
  patchItems: (next: CueItem[] | ((prev: CueItem[]) => CueItem[])) => void;
}

export function usePlanDraft(): PlanDraft {
  /**
   * 탭을 옮겼다 돌아온 것이면 편집 중이던 초안을 되살린다.
   *
   * `useState(() => …)` 로 **첫 렌더에** 넣는 것이 중요하다. effect 로 나중에 넣으면
   * 그 사이에 '아무것도 열지 않았으면 첫 유형을 연다' 규칙이 먼저 돌아 기본 유형이
   * 들어차고, 초안이 그것을 덮어써 화면이 한 번 튄다.
   */
  const [restored] = useState(readPlanDraft);

  const [plan, setPlan] = useState<ServicePlan | null>(restored?.plan ?? null);
  const [items, setItems] = useState<CueItem[]>(restored?.items ?? []);
  const [dirty, setDirty] = useState(restored?.dirty ?? false);
  const [cursor, setCursor] = useState(restored?.cursor ?? 0);
  const [expandedId, setExpandedId] = useState<string | null>(restored?.expandedId ?? null);

  /**
   * 편집 상태를 초안에 담는다 — 탭을 옮기면 이 패널은 언마운트된다.
   *
   * 커서까지 담는 이유: 20개짜리 순서에서 돌아왔을 때 커서가 맨 위로 튀면
   * 어디까지 짜던 중이었는지 다시 찾아야 한다.
   */
  useEffect(() => {
    if (!plan) return;
    writePlanDraft({ plan, items, dirty, cursor, expandedId });
  }, [plan, items, dirty, cursor, expandedId]);

  /**
   * 항목 목록을 바꾼다.
   *
   * 함수도 받는다. **비동기 작업이 끝난 뒤**에 고칠 때는 반드시 함수를 넘겨야 한다 —
   * 배열을 넘기면 그 배열이 만들어진 시점(옛 렌더)의 값이라, 그 사이에 사람이 한
   * 다른 편집을 조용히 덮어쓴다. 실제로 역본을 바꾼 직후 미리보기를 다시 읽는
   * 경로에서 역본 변경이 되돌아갔다.
   */
  const patchItems = useCallback((next: CueItem[] | ((prev: CueItem[]) => CueItem[])): void => {
    setItems(next);
    setDirty(true);
  }, []);

  return {
    plan, setPlan,
    items, setItems,
    dirty, setDirty,
    cursor, setCursor,
    expandedId, setExpandedId,
    patchItems,
  };
}

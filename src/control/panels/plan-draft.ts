import type { CueItem, ServicePlan } from '../../../shared/types.ts';

/**
 * 예배 순서 탭에서 **저장하지 않은 편집**을 담아 둔다.
 *
 * 왜 필요한가: 탭은 조건부 렌더라서 '찬양' 으로 옮기는 순간 PlanPanel 이 언마운트되고
 * useState 가 전부 사라진다. 돌아오면 '아무것도 열지 않았으면 첫 유형을 연다' 규칙이
 * 다시 돌아 **기본 유형 상태로 되돌아간다** — 짜 놓은 순서가 통째로 없어진다
 * (2026-09-03 사용자 보고).
 *
 * 왜 sessionStorage 인가: 모듈 변수로도 탭 이동은 견디지만 브라우저 새로고침에 사라진다.
 * 예배 준비 중에 조작 화면을 새로 고치는 일은 실제로 있고(OBS 안내 배너를 보고 F5),
 * sessionStorage 면 그것까지 살아남는다. 탭을 닫으면 비워진다 — 다음 예배까지 끌고
 * 가면 안 되는 것은 '저장하지 않은 편집' 이므로 이 수명이 맞다.
 *
 * 저장 실패는 삼킨다. 시크릿 창·저장 용량 초과에서 예외가 나는데, 초안을 못 담는 것이
 * 예배 진행을 막을 이유는 없다.
 */
const KEY = 'sermon.plan-draft.v1';

export interface PlanDraft {
  /** 이 편집이 어느 유형·회차에서 나왔는지 (저장 버튼이 어디로 갈지 결정한다) */
  plan: ServicePlan;
  items: CueItem[];
  dirty: boolean;
  cursor: number;
  expandedId: string | null;
}

/** 형태가 맞는지 본다 — 판이 바뀐 옛 초안을 그대로 밀어 넣으면 패널이 깨진다 */
function isDraft(value: unknown): value is PlanDraft {
  if (typeof value !== 'object' || value === null) return false;
  const d = value as Partial<PlanDraft>;
  return (
    typeof d.plan === 'object' && d.plan !== null &&
    typeof (d.plan as ServicePlan).id === 'number' &&
    typeof (d.plan as ServicePlan).name === 'string' &&
    Array.isArray(d.items) &&
    typeof d.dirty === 'boolean' &&
    typeof d.cursor === 'number'
  );
}

export function readPlanDraft(): PlanDraft | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isDraft(parsed)) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writePlanDraft(draft: PlanDraft): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // 담아 두지 못해도 진행에는 지장이 없다
  }
}

export function clearPlanDraft(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // 위와 같다
  }
}

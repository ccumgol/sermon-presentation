/**
 * **'저장 안 됨' 줄** — 어느 버튼을 눌러야 어디에 남는지 그대로 알려 준다.
 *
 * `PlanPanel` 에서 갈라냈다(2026-09-08). 버튼 이름이 열어 둔 것에 따라 달라지므로
 * ('템플릿 업데이트' / '저장하기'), '저장 안 됨' 만 있으면 어느 버튼인지 매번 헷갈린다.
 */

import type { ServicePlan } from '../../../../shared/types.ts';
import type { PlanStorage } from '../../hooks/usePlanStorage.ts';

export function PlanDirtyLine({
  storage, plan, dirty,
}: {
  storage: PlanStorage;
  plan: ServicePlan | null;
  /** 저장하지 않은 변경이 있는지 */
  dirty: boolean;
}): React.JSX.Element {
  const { saveLabel, planNoun } = storage;

  return (
    <>
      {plan && dirty && (
        <p className="hintline muted plan-dirty">
          {/*
            어디를 눌러야 하는지 여기서 말해 준다 — 버튼 이름이 열어 둔 것에 따라
            달라지기 때문이다. '저장 안 됨' 만 있으면 어느 버튼인지 매번 헷갈린다.
          */}
          <b>저장 안 됨</b> — <b>{saveLabel}</b> 를 누르면
          {' '}'{plan.name}' {planNoun}에 남습니다
        </p>
      )}
    </>
  );
}

/**
 * **주 동작 버튼 줄** — 예배용으로 올리기 · 저장 · 순서 저장하기 · 불러오기 · 기본 설정.
 *
 * `PlanPanel` 에서 갈라냈다(2026-09-08). 프롭 다섯 — 쓰는 이름 열이 훅 넷으로 묶인다.
 *
 * ## 여기서 보이는 규칙
 *
 * | | 왜 |
 * |---|---|
 * | 한 줄에 **다 넣는다** | 두 줄이면 순서 목록이 53px 좁아진다. 랩탑(900px)에서 목록이 285px 밖에 안 됐다 (2026-08-18 실측) |
 * | '예배용으로 올리기' 가 **주 동작**이다 | 한 줄 합치기에서 이 버튼만 빠져 순서표 전체를 올릴 길이 사라진 회귀가 있었다 |
 * | 저장 버튼 이름이 **열어 둔 것에 따라** 다르다 | 유형이면 '템플릿 업데이트', 저장된 순서면 '저장하기' |
 */

import { today } from '../../../../lib/plan-item-view.ts';
import type { ServicePlan } from '../../../../shared/types.ts';
import type { PlanDraft } from '../../hooks/usePlanDraft.ts';
import type { PlanFeedback } from '../../hooks/usePlanFeedback.ts';
import type { PlanSend } from '../../hooks/usePlanSend.ts';
import type { PlanStorage } from '../../hooks/usePlanStorage.ts';

export function PlanActions({
  storage, draft, send, feedback, plan, connected, defaultsOpen, setDefaultsOpen,
}: {
  storage: PlanStorage;
  draft: PlanDraft;
  /** 열어 둔 순서표 — 부모가 `{plan && …}` 로 걸러 넣는다 */
  plan: ServicePlan;
  send: PlanSend;
  feedback: PlanFeedback;
  connected: boolean;
  /** 기본 설정 카드를 펼쳤는지 (카드는 부모가 그린다) */
  defaultsOpen: boolean;
  setDefaultsOpen: React.Dispatch<React.SetStateAction<boolean>>;
}): React.JSX.Element {
  const { saveCurrent, saveLabel, setNameBar, setLoadOpen } = storage;
  const { items } = draft;
  const { loadForService } = send;
  const { busy } = feedback;

  return (
    <>
    {/*
      한 줄로 합쳤다 (2026-08-18). 전에는 '예배용으로 올리기' 가 한 줄을 통째로
      쓰고 보조 버튼이 또 한 줄을 써서, 순서 목록이 그만큼(53px) 좁아졌다.
      랩탑(높이 900px)에서 목록이 285px 밖에 안 됐다.
    */}
    <div className="plan-head plan-actions">
      {/*
        '예배용으로 올리기' — 순서표 전체를 하나의 덱으로 올리는 **주 동작**이다.
        110eac5 의 한 줄 합치기에서 이 버튼만 빠져(회귀), 순서표 전체를 올릴 길이
        없어졌다. 항목마다 ▶ 를 누르는 것으로는 화살표로 끝까지 진행할 수 없다.
        .plan-actions > button.primary 의 `flex: 2` 는 원래 이 버튼 자리다.
      */}
      <button
        type="button"
        className="primary grow"
        onClick={() => void loadForService()}
        disabled={!connected || busy || items.length === 0}
        title="순서표 전체를 하나로 올립니다. 이후 화살표로 끝까지 진행합니다."
      >
        예배용으로 올리기
      </button>
      {/*
        **열어 둔 것에 그대로 저장한다.** 유형이면 '템플릿 업데이트',
        저장된 순서면 '저장하기' — 이름을 다시 치지 않는다.
        전에는 저장된 순서에 이 버튼이 회색이라, 불러와 고친 것을 남기려면
        '순서 저장하기' 로 긴 이름을 똑같이 맞혀 쳐야 했다 (2026-09-03).
      */}
      <button
        type="button"
        className="grow"
        onClick={() => void saveCurrent()}
        disabled={busy}
        title={
          plan.kind === 'template'
            ? '지금 고친 내용을 이 유형의 원본으로 굳힙니다'
            : `지금 고친 내용을 '${plan.name}' 에 그대로 저장합니다`
        }
      >
        {saveLabel}
      </button>
      <button
        type="button"
        className="grow"
        onClick={() => {
          setLoadOpen(false);
          // 유형에서는 '이번 회차' 를 새로 만드는 것이니 날짜를 붙여 준다.
          // 순서에서는 이미 그 회차라, 지금 이름에서 고쳐 쓰게 둔다.
          setNameBar({
            kind: 'plan',
            value: plan.kind === 'template' ? `${today()} ${plan.name}` : plan.name,
          });
        }}
        disabled={busy}
        title={
          plan.kind === 'template'
            ? '이번 회차를 따로 남깁니다'
            : '이 순서를 건드리지 않고 새 이름으로 하나 더 만듭니다'
        }
      >
        {plan.kind === 'template' ? '순서 저장하기' : '다른 이름으로 저장'}
      </button>
      <button
        type="button"
        className="grow"
        onClick={() => { setNameBar(null); setLoadOpen((prev) => !prev); }}
        disabled={busy}
        title="저장해 둔 순서를 엽니다"
      >
        순서 불러오기
      </button>
      <button
        type="button"
        className={defaultsOpen ? 'primary' : undefined}
        onClick={() => setDefaultsOpen((prev) => !prev)}
        title="이 예배에서 기본으로 쓸 템플릿·역본"
      >
        기본 설정
      </button>
    </div>
    </>
  );
}

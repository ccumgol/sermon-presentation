/**
 * **지금 열어 둔 것** — 예배 유형·저장된 순서 고르기와 그 옆의 넷(＋ ⧉ ✎ ✕).
 *
 * `PlanPanel` 에서 갈라냈다(2026-09-08). 프롭이 셋인 이유는 **낱개 값이 아니라
 * 훅 객체를 받기** 때문이다 — 여기서 쓰는 이름 아홉 중 일곱이 `usePlanStorage`
 * 하나에서 온다. 낱개로 받으면 프롭 아홉짜리 껍데기가 된다.
 */

import type { ServicePlan } from '../../../../shared/types.ts';
import type { PlanStorage } from '../../hooks/usePlanStorage.ts';

export function PlanHead({
  storage, plan, busy,
}: {
  storage: PlanStorage;
  /** 지금 열어 둔 것 (`null` = 아무것도 열지 않았다) */
  plan: ServicePlan | null;
  busy: boolean;
}): React.JSX.Element {
  const {
    templates, saved, openPlan, duplicateCurrent, removeTemplate, setNameBar, setLoadOpen,
    planNoun, planNounObj,
  } = storage;

  return (
      <div className="plan-head">
        {/*
          **지금 열어 둔 것**을 보여 준다 — 유형이든 저장된 순서든.
          전에는 유형만 담아서, 저장된 순서를 불러오면 이 칸이 '— 예배 유형 —' 로
          비어 무엇을 고치고 있는지 화면 어디에도 없었다 (2026-09-03 사용자 보고).
        */}
        <select
          className="grow"
          value={plan?.id ?? ''}
          onChange={(e) => {
            const id = Number(e.target.value);
            const found = templates.find((p) => p.id === id) ?? saved.find((p) => p.id === id);
            if (found) openPlan(found);
          }}
          title="지금 고치는 중인 예배 유형 또는 저장된 순서"
        >
          <option value="">— 예배 유형 —</option>
          <optgroup label="예배 유형 (매주 고쳐 쓰는 원본)">
            {templates.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </optgroup>
          {saved.length > 0 && (
            <optgroup label="저장된 순서 (회차)">
              {saved.map((p) => (
                <option key={p.id} value={p.id}>
                  {/* 이름에 이미 날짜가 들어 있으면 앞에 또 붙이지 않는다 */}
                  {p.serviceDate && !p.name.includes(p.serviceDate) ? `${p.serviceDate} · ` : ''}
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          type="button"
          onClick={() => { setLoadOpen(false); setNameBar({ kind: 'template', value: '' }); }}
          disabled={busy}
          title="지금 항목으로 새 예배 유형 만들기"
        >
          ＋
        </button>

        {/*
          지금 연 것을 관리한다 — 복제·이름 바꾸기·삭제.
          전에는 유형에만 걸려 있었다. 저장된 순서를 열면 셋이 모두 회색이라,
          이름을 고칠 길이 없었다 — 사용자가 '제목을 정확히 찾아 저장하기 어렵다'
          고 한 것이 이것이다 (2026-09-03). 유형·순서 모두 같은 세 버튼으로 다룬다.
        */}
        <button
          type="button"
          onClick={() => void duplicateCurrent()}
          disabled={busy || !plan}
          title={`이 ${planNounObj} 복제합니다 (주일 1부 → 2부)`}
        >
          ⧉
        </button>
        <button
          type="button"
          onClick={() => {
            if (!plan) return;
            setLoadOpen(false);
            setNameBar({ kind: plan.kind ?? 'plan', value: plan.name, renameId: plan.id });
          }}
          disabled={busy || !plan}
          title={`이 ${planNoun}의 이름을 바꿉니다`}
        >
          ✎
        </button>
        <button
          type="button"
          className="del"
          onClick={() => void removeTemplate()}
          disabled={busy || !plan}
          title={`이 ${planNounObj} 지웁니다`}
        >
          ✕
        </button>
      </div>
  );
}

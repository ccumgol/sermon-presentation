/**
 * **저장해 둔 순서 목록** — '순서 불러오기' 를 눌렀을 때 펼쳐지는 띠.
 *
 * `PlanPanel` 에서 갈라냈다(2026-09-08). 이름에 이미 날짜가 들어 있으면 앞에
 * 또 붙이지 않는다 — '2026-09-03 · 2026-08-17 주일 2부' 처럼 날짜 둘이 붙으면
 * 목록에서 어느 주의 것인지 읽히지 않는다.
 */

import type { PlanStorage } from '../../hooks/usePlanStorage.ts';

export function PlanLoadList({ storage }: { storage: PlanStorage }): React.JSX.Element {
  const { saved, openPlan, removeSaved, loadOpen } = storage;

  return (
    <>
      {loadOpen && (
        <div className="candidates plan-saved">
          {saved.length === 0 && <span className="hintline muted">저장된 순서가 없습니다.</span>}
          {saved.map((p) => (
            <span key={p.id} className="saved-row">
              <button type="button" onClick={() => openPlan(p)}>
                {/* 이름에 이미 날짜가 들어 있으면 앞에 또 붙이지 않는다 */}
                {p.serviceDate && !p.name.includes(p.serviceDate) ? `${p.serviceDate} · ` : ''}
                {p.name}
              </button>
              <button type="button" className="del" onClick={() => void removeSaved(p)} title="삭제">✕</button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

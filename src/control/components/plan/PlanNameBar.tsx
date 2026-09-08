/**
 * **이름 입력 바** — 유형을 만들거나 순서를 저장할 때 이름을 받는다.
 *
 * `PlanPanel` 에서 갈라냈다(2026-09-08).
 *
 * ## 여기서 보이는 규칙
 *
 * | | 왜 |
 * |---|---|
 * | 같은 이름이 있으면 버튼이 **'덮어쓰기'** 로 바뀐다 | 한 글자 달라 회차가 하나 더 생기던 사고를 막는다 (2026-09-03 사용자 보고) |
 * | 이름을 **바꾸는 중**이면 겹쳐도 덮어쓰기가 아니다 | 그때는 다른 이름을 써야 한다 |
 * | 칸이 열리면 기존 이름이 전체 선택된다 | 커서가 끝에 붙으면 새 이름이 옛 이름 뒤에 이어 붙는다 (`nameInputRef` · usePlanStorage) |
 */

import { isComposing } from '../../ime.ts';
import type { PlanStorage } from '../../hooks/usePlanStorage.ts';

export function PlanNameBar({
  storage, busy,
}: {
  storage: PlanStorage;
  busy: boolean;
}): React.JSX.Element {
  const { nameBar, setNameBar, nameBarTarget, commitNameBar, nameInputRef } = storage;

  return (
    <>
      {nameBar && (
        <div className="plan-head">
          <input
            className="grow"
            autoFocus
            ref={nameInputRef}
            value={nameBar.value}
            onChange={(e) => setNameBar({ ...nameBar, value: e.target.value })}
            onKeyDown={(e) => {
              if (isComposing(e)) return; // 한글 조합 확정용 Enter 는 넘긴다
              if (e.key === 'Enter') { e.preventDefault(); void commitNameBar(); }
              if (e.key === 'Escape') { e.preventDefault(); setNameBar(null); }
            }}
            placeholder={
              nameBar.renameId !== undefined
                ? `새 ${nameBar.kind === 'template' ? '유형' : '순서'} 이름`
                : nameBar.kind === 'template'
                  ? '새 예배 유형 이름'
                  : '저장할 순서 이름'
            }
            spellCheck={false}
          />
          <button
            type="button"
            className="primary"
            onClick={() => void commitNameBar()}
            // 이름을 바꿀 때 다른 유형과 겹치면 막는다 — 이름이 곧 '덮어쓰기' 의 기준이라
            // 같은 이름이 둘이면 어느 쪽을 덮어쓸지 알 수 없게 된다
            disabled={
              busy ||
              nameBar.value.trim().length === 0 ||
              (nameBar.renameId !== undefined && nameBarTarget !== undefined)
            }
          >
            {nameBar.renameId !== undefined ? '이름 바꾸기' : nameBarTarget ? '덮어쓰기' : '저장'}
          </button>
          <button type="button" onClick={() => setNameBar(null)}>취소</button>
        </div>
      )}

      {nameBar && nameBarTarget && (
        <p className="hintline warn">
          {nameBar.renameId !== undefined
            // '유형이' / '순서가' — 받침이 달라 조사를 이어 붙일 수 없다
            ? `같은 이름의 ${nameBar.kind === 'template' ? '유형이' : '순서가'} 이미 있습니다 — 다른 이름을 쓰세요.`
            : `같은 이름이 이미 있습니다 — 누르면 그 ${
                nameBar.kind === 'template' ? '유형' : '순서'
              }를 덮어씁니다.`}
        </p>
      )}
    </>
  );
}

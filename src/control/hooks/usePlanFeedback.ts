/**
 * **화면에 알리는 것** — 예배 순서 탭의 배너 셋.
 *
 * `PlanPanel` 에서 떼어냈다(2026-09-08). 값이 셋뿐인데 훅으로 만든 이유는
 * **이것이 화면 블록 아홉 중 일곱에 흩어져 있었기** 때문이다. 블록을 컴포넌트로
 * 자를 때마다 프롭이 1~4개씩 늘어난다 — 하나로 묶으면 하나다.
 *
 * ## 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 오류를 **삼키지 않는다** | 조작 화면이 서버의 거절을 조용히 버리던 사고가 있었다 (§4.6 D) |
 * | 실패와 알림을 **가른다** | 실패는 사람이 할 일이 있고, 알림은 알기만 하면 된다 |
 * | 사람이 닫을 수 있다 | 예배 중에 배너가 화면을 덮으면 안 된다 |
 * | 세터가 **늘 같은 것**이다 | 송출 함수들이 이걸 의존성으로 쓴다. 매 렌더 바뀌면 memo 가 헛돈다 |
 */

import { useState } from 'react';

export interface PlanFeedback {
  /** 무언가 하는 중 — 버튼을 흐리게 한다 */
  busy: boolean;
  setBusy: (value: boolean) => void;
  /** 실패. 사람이 할 일이 있다 */
  error: string | null;
  setError: (value: string | null) => void;
  /** 됐지만 알아야 하는 것 (건너뛴 항목 등) */
  notice: string | null;
  setNotice: (value: string | null) => void;
}

export function usePlanFeedback(): PlanFeedback {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // useState 세터는 늘 같은 것이므로 따로 고정할 필요가 없다
  return { busy, setBusy, error, setError, notice, setNotice };
}

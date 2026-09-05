/**
 * 조작 화면의 **세로 열 너비** 계산.
 *
 * 화면을 마우스로 끌어 열 비율을 바꾸는 기능(사용자 요청 2026-09-04)의 셈 부분이다.
 * 그리기·이벤트는 `src/control/hooks/useColumnSplit.ts` 가 맡는다.
 *
 * ## 왜 여기에 따로 두는가
 *
 * `src/`(React) 는 테스트가 거의 없다. 잘못 자르면 **열이 사라져 조작을 못 하게 되는**
 * 셈이라 눈으로만 확인하고 넘길 수 없다. 순수 함수만 떼어 두면 검사할 수 있다.
 *
 * ## 이웃 칸을 반드시 남긴다
 *
 * 끝까지 끌면 한쪽이 0이 되어 **그 안의 단추를 누를 수 없게 된다.** 예배 중에
 * 그렇게 되면 되돌릴 방법을 찾느라 진행이 멈춘다. 그래서 위아래 양쪽을 막는다.
 */

export interface SplitBounds {
  /** 조절하는 칸이 이보다 좁아지지 않는다 (px) */
  min: number;
  /** 이웃 칸에 최소한 남겨 두는 폭 (px) */
  minNeighbor: number;
}

/**
 * 끌어 놓은 폭을 쓸 수 있는 값으로 다듬는다.
 *
 * 창이 아주 좁아 둘 다 만족할 수 없으면 **`min` 이 이긴다.** 조절하는 칸이 0이 되면
 * 잡이마저 사라져 되돌릴 길이 없어지기 때문이다 — 이웃은 스크롤로 버틸 수 있다.
 */
export function clampSplit(width: number, containerWidth: number, bounds: SplitBounds): number {
  const upper = Math.max(bounds.min, containerWidth - bounds.minNeighbor);
  return Math.round(Math.min(Math.max(width, bounds.min), upper));
}

/**
 * 저장해 둔 값을 읽는다. 숫자가 아니거나 0 이하면 **없는 것으로 본다** —
 * 값이 없으면 CSS 에 적힌 기본 너비가 그대로 쓰인다.
 *
 * 기본값을 여기에 적지 않는 이유: 두 곳(CSS·코드)에 적으면 한쪽만 고쳐 어긋난다.
 */
export function parseSplit(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 잡이를 오른쪽으로 끌 때 조절하는 칸이 넓어지는가, 좁아지는가 */
export type SplitEdge =
  /** 잡이 **왼쪽** 칸을 조절한다 — 오른쪽으로 끌면 넓어진다 */
  | 'start'
  /** 잡이 **오른쪽** 칸을 조절한다 — 오른쪽으로 끌면 좁아진다 */
  | 'end';

/** 잡이를 `dx` 만큼 옮겼을 때의 새 폭 (다듬기 전) */
export function widthAfterDrag(startWidth: number, dx: number, edge: SplitEdge): number {
  return edge === 'start' ? startWidth + dx : startWidth - dx;
}

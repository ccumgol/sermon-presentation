/**
 * 두 열 사이의 **잡이**. 끌면 왼쪽·오른쪽 열 너비가 바뀐다.
 *
 * ## 왜 격자의 한 칸인가 (겹쳐 띄우지 않는가)
 *
 * 두 열 위에 겹쳐 띄우면 **그 아래 있는 단추를 가린다.** 목록의 오른쪽 끝과 설정
 * 칸의 왼쪽 끝에 실제로 단추가 있어서, 예배 중에 눌리지 않는 자리가 생긴다.
 * 격자의 가운데 칸으로 두면 자리를 스스로 차지하므로 그런 일이 없다.
 *
 * 대신 **눌리는 범위는 넓힌다** — 보이는 선은 얇아야 하지만(6px) 6px 을 겨냥해
 * 마우스를 놓는 것은 어렵다. `::before` 로 좌우를 넘겨 잡는 폭만 키운다.
 *
 * ## 되돌릴 길을 둘 둔다
 *
 * **더블클릭**과 **Home** 키. 마우스만으로 조절하게 두면 잘못 끌었을 때
 * '원래 얼마였더라' 를 찾을 방법이 없다.
 */

import type { ResizerHandlers } from '../hooks/useColumnSplit.ts';

export function ColumnResizer({ label, width, onPointerDown, onKeyDown, onDoubleClick }: ResizerHandlers): React.JSX.Element {
  return (
    <div
      className="col-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={`${label} 너비 — 끌어서 조절, 더블클릭이나 Home 으로 기본값`}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
      title={`${label} 너비를 끌어서 조절합니다 (더블클릭 = 기본값)`}
    />
  );
}

/**
 * QR 모듈 격자 → SVG 경로. 순수 함수.
 *
 * 태블릿 연결 주소를 관리자 화면에 QR 로 띄우기 위한 것이다. QR 자체를 만드는 것은
 * `qrcode-generator`(전이 의존성 0)가 하고, 여기서는 **격자를 그림으로 바꾸는 부분**만
 * 맡는다 — 그래야 테스트할 수 있다.
 *
 * ## 왜 `<rect>` 를 모듈마다 두지 않는가
 *
 * 25×25 만 해도 어두운 모듈이 300개가 넘는다. 그만큼의 요소를 React 가 그리는 것보다
 * **경로 하나**가 가볍고, 화면에서 모듈 사이에 실선 틈이 생기는 문제도 없다.
 *
 * ## 여백(quiet zone)을 반드시 둔다
 *
 * QR 규격은 사방 **4모듈**의 빈 테두리를 요구한다. 이것이 없으면 배경과 경계가 붙어
 * 인식률이 떨어진다 — 예배 직전에 몇 번씩 다시 찍게 만들면 안 된다.
 */

/** 규격이 요구하는 여백 (모듈 단위) */
export const QUIET_ZONE = 4;

export interface QrSvg {
  /** viewBox 한 변의 길이 (여백 포함, 모듈 단위) */
  size: number;
  /** 어두운 모듈을 모두 담은 하나의 경로 */
  path: string;
  /** 여백을 뺀 실제 모듈 수 — 표시·검증용 */
  moduleCount: number;
}

/**
 * @param isDark (행, 열) 이 어두운가
 * @param moduleCount 한 변의 모듈 수
 */
export function qrToSvg(
  isDark: (row: number, col: number) => boolean,
  moduleCount: number,
): QrSvg {
  if (!Number.isInteger(moduleCount) || moduleCount <= 0) {
    throw new Error(`모듈 수가 올바르지 않습니다: ${moduleCount}`);
  }

  const parts: string[] = [];
  for (let row = 0; row < moduleCount; row++) {
    // 같은 행에서 이어지는 어두운 모듈은 한 덩어리로 묶는다 (경로가 짧아진다)
    let runStart = -1;
    for (let col = 0; col <= moduleCount; col++) {
      const dark = col < moduleCount && isDark(row, col);
      if (dark && runStart < 0) runStart = col;
      if (!dark && runStart >= 0) {
        const x = runStart + QUIET_ZONE;
        const y = row + QUIET_ZONE;
        const width = col - runStart;
        parts.push(`M${x} ${y}h${width}v1h-${width}z`);
        runStart = -1;
      }
    }
  }

  return {
    size: moduleCount + QUIET_ZONE * 2,
    path: parts.join(''),
    moduleCount,
  };
}

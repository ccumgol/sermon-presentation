/**
 * 순서 표시 제목의 글자별 크기·높낮이 계산.
 *
 * **자동 리듬**(네 글자 표)이 기본이고, 사람이 슬라이더로 만진 글자는 그 값이 이긴다.
 * 표를 넘어가는 다섯째 글자부터는 흔들지 않는다 — 직접 조정하는 자리다.
 *
 * ⚠️ 출력 페이지(`public/output/output.js`)에 **같은 계산이 한 벌 더 있다.**
 * 출력 페이지는 의존성 0 원칙 때문에 이 모듈을 가져다 쓸 수 없다(번들러가 없다).
 * 앵커 표(ANCHOR_MAP)와 같은 사정이다. 여기를 고치면 그쪽도 함께 고쳐야 하며,
 * 값이 어긋나면 **컨트롤 패널의 슬라이더 눈금과 실제 화면이 달라진다.**
 */

import type { OrderCharStyle } from '../shared/types.ts';

/**
 * 자동 리듬의 **네 글자 표** (2026-08-15 사용자 지정).
 *
 * 계산식(파도)이 아니라 표인 이유는, 사용자가 실제 예배 화면을 보고 고른 값이기
 * 때문이다. 식으로 근사하면 그 값이 그대로 나오지 않는다.
 *
 * 실제로 쓰는 순서 이름이 이 표에 맞춰져 있다 —
 * '예배부름'(4자)이 기준이고, '축도'(2자)·'축복송'(3자)은 앞 두세 글자를 그대로 따른다.
 *
 * `dy` 는 음수가 위, 양수가 아래다(컨트롤 패널의 ↑↓ 표시와 같다).
 */
export const AUTO_PATTERN: ReadonlyArray<{ size: number; dy: number }> = [
  { size: 1.0, dy: 0 },
  { size: 0.96, dy: -0.19 },
  { size: 0.9, dy: 0.1 },
  { size: 0.9, dy: -0.05 },
];

/** 표 밖(다섯째 글자부터) — 흔들지 않는다 */
const NEUTRAL = { size: 1, dy: 0 } as const;

/**
 * 표는 **네 글자까지만** 적용한다.
 *
 * 다섯 글자 이상('찬양과경배' 처럼 `XX와XX` 꼴)은 어떻게 흔드는 것이 좋은지가
 * 이름마다 달라, 자동으로 정하면 오히려 어색해진다. 그래서 남는 글자는 기본
 * 크기로 두고 **글자별 조정으로 직접 맞추게** 한다(2026-08-15 사용자 결정).
 * 되풀이하면 여섯째 글자부터 의도치 않게 다시 흔들린다.
 */
function patternAt(indexInWord: number): { size: number; dy: number } {
  return AUTO_PATTERN[indexInWord] ?? NEUTRAL;
}

/**
 * 자동 크기 배수.
 *
 * `strength` 는 표를 얼마나 강하게 적용할지를 뜻하는 **배율**이다.
 * `1` 이면 표 그대로, `0` 이면 모두 같은 크기(리듬 끔), `2` 면 편차가 두 배.
 */
export function autoScale(indexInWord: number, strength: number): number {
  return 1 + (patternAt(indexInWord).size - 1) * strength;
}

/** 자동 높낮이(em). 음수가 위, 양수가 아래. */
export function autoDy(indexInWord: number, strength: number): number {
  const dy = patternAt(indexInWord).dy * strength;
  // 음수 × 0 = -0 이라 화면에 'translateY(-0.000em)' 으로 나간다. 0 으로 정리한다.
  return dy === 0 ? 0 : dy;
}

/** 사람이 만질 수 있는 범위 — 벗어나면 글자가 화면 밖으로 나가거나 겹친다 */
export const CHAR_SIZE_MIN = 0.4;
export const CHAR_SIZE_MAX = 2.5;
export const CHAR_DY_MIN = -0.6;
export const CHAR_DY_MAX = 0.6;

/** 외곽선 두께(px) 범위 — 너무 굵으면 글자 속이 메워져 읽히지 않는다 */
export const STROKE_MIN = 0;
export const STROKE_MAX = 20;

/** 담당자 글자 크기 배수의 범위 */
export const PRESENTER_SCALE_MIN = 0.3;
export const PRESENTER_SCALE_MAX = 2.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 글자별 수동 조정값을 검증한다. 알 수 없는 값은 버리고 범위를 넘으면 자른다.
 * 빈 항목(`{}`)은 '이 글자는 자동' 을 뜻하므로 그대로 남긴다.
 */
export function normalizeCharStyles(raw: unknown, maxLength = 40): OrderCharStyle[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const out: OrderCharStyle[] = [];
  for (const entry of raw.slice(0, maxLength)) {
    if (typeof entry !== 'object' || entry === null) {
      out.push({});
      continue;
    }
    const value = entry as { size?: unknown; dy?: unknown };
    const style: OrderCharStyle = {};
    if (typeof value.size === 'number' && Number.isFinite(value.size)) {
      style.size = clamp(value.size, CHAR_SIZE_MIN, CHAR_SIZE_MAX);
    }
    if (typeof value.dy === 'number' && Number.isFinite(value.dy)) {
      style.dy = clamp(value.dy, CHAR_DY_MIN, CHAR_DY_MAX);
    }
    out.push(style);
  }

  // 아무도 만지지 않았으면 저장하지 않는다 — 순서표에 빈 배열이 쌓이지 않게
  return out.some((style) => style.size !== undefined || style.dy !== undefined) ? out : undefined;
}

/**
 * 담당자 크기 배수를 검증한다. 기본값(1)은 저장하지 않는다 —
 * 순서표에 기본값이 박히면 나중에 기본을 바꿀 수 없다.
 */
export function normalizePresenterScale(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  const value = clamp(raw, PRESENTER_SCALE_MIN, PRESENTER_SCALE_MAX);
  return value === 1 ? undefined : value;
}

/**
 * 외곽선 두께를 검증한다.
 *
 * `0`(테두리 없음)도 뜻이 있는 값이라 버리지 않는다 — 기본값이 아니라
 * '이 항목은 테두리를 끈다' 는 지정이다. 값이 없어야 템플릿을 따른다.
 */
export function normalizeStroke(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return clamp(raw, STROKE_MIN, STROKE_MAX);
}

/**
 * 제목에서 **공백을 뺀** 글자 목록. 슬라이더 한 줄이 여기 한 글자에 대응한다.
 *
 * 공백을 빼면 '예배 부름' 을 '예배부름' 으로 고쳐도 글자별 조정이 그대로 따라간다.
 */
export function adjustableChars(title: string): string[] {
  return Array.from(title).filter((ch) => ch.trim().length > 0);
}

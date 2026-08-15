/**
 * 순서 표시 제목의 글자별 크기·높낮이 계산.
 *
 * **자동 리듬**(세 글자 주기)이 기본이고, 사람이 슬라이더로 만진 글자는 그 값이 이긴다.
 *
 * ⚠️ 출력 페이지(`public/output/output.js`)에 **같은 계산이 한 벌 더 있다.**
 * 출력 페이지는 의존성 0 원칙 때문에 이 모듈을 가져다 쓸 수 없다(번들러가 없다).
 * 앵커 표(ANCHOR_MAP)와 같은 사정이다. 여기를 고치면 그쪽도 함께 고쳐야 하며,
 * 값이 어긋나면 **컨트롤 패널의 슬라이더 눈금과 실제 화면이 달라진다.**
 */

import type { OrderCharStyle } from '../shared/types.ts';

/**
 * 자동 리듬의 파도값 (-1 ~ 1).
 *
 * 세 글자 주기 — 큰 · 작은 · 작은. 어절 길이로 나누지 않는 이유는, 길이로 나눠
 * 양끝을 크게 두면 **2자 어절은 두 글자가 모두 양끝이라 크기가 같아지기** 때문이다
 * ('예배 부름'·'축도'·'광고' 에서 리듬이 통째로 사라졌다 — 2026-08-15 실사용 발견).
 */
export function rhythmWave(indexInWord: number): number {
  return Math.cos((indexInWord * 2 * Math.PI) / 3);
}

/** 자동 크기 배수 */
export function autoScale(indexInWord: number, amount: number): number {
  return 1 + amount * rhythmWave(indexInWord);
}

/** 자동 내림 폭(em). 값은 '가장 많이 내려간 글자가 몇 em 내려가는지'로 읽힌다. */
export function autoDy(indexInWord: number, amountY: number): number {
  return amountY * ((1 - rhythmWave(indexInWord)) / 2);
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

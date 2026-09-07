/**
 * `deck:load` 로 들어온 묶음을 **받아도 되는 모양인지** 본다 (보안 감사 L-1).
 *
 * ## 무엇이 문제였나
 *
 * WebSocket 으로 온 `deck:load` 의 페이로드를 그대로 `state.loadDeck` 에 넘겼고,
 * 그것이 그대로 `app.sqlite` 의 `live_state` 에 저장됐다. 형태를 보지 않았으므로
 *
 * - 슬라이드가 수만 장인 묶음을 보내면 **상태 파일이 부풀고** 서버가 뜰 때마다
 *   그것을 읽는다 (감사 L-1 이 지적한 그대로다)
 * - `slides` 가 배열이 아니면 진행 중에 `undefined` 를 그리게 된다 — 출력 페이지는
 *   모르는 것을 받으면 이전 화면을 유지하므로(안전 동작) **'안 바뀜' 으로 나타나**
 *   원인을 찾기 어렵다
 *
 * ## 왜 이렇게 느슨한가
 *
 * 슬라이드 **내용**은 검사하지 않는다. 종류가 계속 늘고(성경·찬양·교독문·전례문·
 * 순서 표시·그림) 출력 페이지가 이미 모르는 종류를 안전하게 넘기기 때문이다.
 * 여기서 막는 것은 **크기와 겉모양**이다 — 상태 파일을 지키는 것이 목적이다.
 *
 * 한도는 실제보다 훨씬 넉넉하게 잡았다. 시편 150편이 150장이고 예배 순서 전체를
 * 올려도 수백 장이다. 여기 걸리면 정상 사용이 아니다.
 */

import type { Deck } from '../shared/types.ts';

/** 슬라이드 수 상한 — 실제 최대는 수백 장이다 */
export const MAX_SLIDES = 5000;

/** 직렬화 크기 상한 — `live_state` 에 그대로 저장되는 값이다 */
export const MAX_DECK_BYTES = 4 * 1024 * 1024;

/** 출처 문자열 상한 ('요 3:16-17' · 예배 순서 이름) */
const MAX_REFERENCE = 500;

export type DeckCheck = { ok: true; deck: Deck } | { ok: false; error: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 받아도 되는 묶음인가.
 *
 * @returns 통과하면 그 묶음(같은 객체), 아니면 **사람이 읽을 수 있는 이유**.
 *   이유는 로그와 `{ t: 'error' }` 로 나가므로 예배 전에 진단할 수 있어야 한다.
 */
export function checkDeck(raw: unknown): DeckCheck {
  if (!isObject(raw)) return { ok: false, error: '묶음이 객체가 아닙니다' };

  if (typeof raw.reference !== 'string') return { ok: false, error: 'reference 가 문자열이 아닙니다' };
  if (raw.reference.length > MAX_REFERENCE) {
    return { ok: false, error: `reference 가 너무 깁니다 (${raw.reference.length}자)` };
  }

  if (!Array.isArray(raw.slides)) return { ok: false, error: 'slides 가 배열이 아닙니다' };
  if (raw.slides.length > MAX_SLIDES) {
    return { ok: false, error: `슬라이드가 너무 많습니다 (${raw.slides.length}장 · 상한 ${MAX_SLIDES})` };
  }
  if (!raw.slides.every(isObject)) return { ok: false, error: '슬라이드 중 객체가 아닌 것이 있습니다' };

  if (!Array.isArray(raw.labels) || !raw.labels.every((label) => typeof label === 'string')) {
    return { ok: false, error: 'labels 가 문자열 배열이 아닙니다' };
  }
  if (typeof raw.index !== 'number' || !Number.isInteger(raw.index)) {
    return { ok: false, error: 'index 가 정수가 아닙니다' };
  }

  if (raw.groups !== undefined) {
    if (!Array.isArray(raw.groups)) return { ok: false, error: 'groups 가 배열이 아닙니다' };
    const badGroup = raw.groups.some(
      (group) =>
        !isObject(group) ||
        typeof group.label !== 'string' ||
        typeof group.startIndex !== 'number' ||
        !Number.isInteger(group.startIndex),
    );
    if (badGroup) return { ok: false, error: 'groups 의 모양이 올바르지 않습니다' };
  }

  /*
   * 마지막에 크기를 잰다. **이것이 `live_state` 를 지키는 실제 방어막이다** —
   * 슬라이드 수가 적어도 한 장이 거대하면 같은 문제가 된다.
   * 앞의 검사를 먼저 하는 이유는 그쪽 오류 메시지가 더 쓸모 있기 때문이다.
   */
  let bytes: number;
  try {
    bytes = Buffer.byteLength(JSON.stringify(raw));
  } catch {
    return { ok: false, error: '묶음을 직렬화할 수 없습니다 (순환 참조?)' };
  }
  if (bytes > MAX_DECK_BYTES) {
    return {
      ok: false,
      error: `묶음이 너무 큽니다 (${Math.round(bytes / 1024)}KB · 상한 ${MAX_DECK_BYTES / 1024 / 1024}MB)`,
    };
  }

  return { ok: true, deck: raw as unknown as Deck };
}

/**
 * 표시 언어 고르기 — 찬양 탭과 예배 순서 탭이 **같은 규칙**을 쓴다.
 *
 * 전에는 이 규칙이 찬양 탭 안에만 있었고 순서 탭에는 컨트롤이 아예 없었다.
 * 그래서 순서표에 넣은 찬양은 만들 때 정해진 언어(기본 `['ko']`)로 굳어,
 * 영어 가사를 넣어도 순서표에서는 볼 길이 없었다.
 */

import type { LangCode } from '../shared/types.ts';

/**
 * 화면에 함께 올릴 수 있는 언어 수 — **성경의 '주 역본 + 보조 2개' 와 같게 3개.**
 *
 * 3번째 줄은 2번째와 같은 스타일을 받는다(출력 렌더러에 3단계 역할이 없다).
 * 성경 3역본도 같은 한계이고 `overridesByLang` 으로 구분한다 — 사용자 확인을 받은
 * 절충이다 (2026-08-19). 넷을 넘기지 않는 이유는 3언어 × 여러 줄이면 세로가
 * 넘쳐 자동 축소가 개입하기 때문이다.
 */
export const MAX_LANGS = 3;

/** 고를 수 있는 언어와 이름 — 순서가 곧 버튼 순서다 */
export const LANG_LABELS: Readonly<Record<string, string>> = {
  ko: '한국어',
  en: 'English',
  zh: '中文',
  ja: '日本語',
};

export const SELECTABLE_LANGS: ReadonlyArray<LangCode> = ['ko', 'en', 'zh', 'ja'];

/**
 * 언어 하나를 켜거나 끈다.
 *
 * - **순서가 뜻을 갖는다**: 앞에 있는 언어가 화면 위로 간다.
 * - 마지막 하나는 뺄 수 없다 — 언어가 없으면 화면이 빈다.
 * - 둘이 찬 상태에서 새 언어를 누르면 **첫 번째를 남기고** 아래만 갈아 끼운다.
 *   주 언어를 지키는 쪽이 뜻이 통한다 (한/영에서 영/중으로 튀지 않는다).
 *
 * 새 배열을 돌려준다 — 받은 배열을 고치지 않는다.
 */
export function toggleLang(current: readonly LangCode[], lang: LangCode): LangCode[] {
  if (current.includes(lang)) {
    return current.length <= 1 ? [...current] : current.filter((l) => l !== lang);
  }
  if (current.length >= MAX_LANGS) return [current[0]!, lang];
  return [...current, lang];
}

/**
 * 언어를 **보기 좋은 순서**로 정렬한다 — 기준 언어가 맨 앞, 나머지는 정해진 순서.
 *
 * DB 는 `('en','ko','zh')` 처럼 알파벳 순으로 돌려준다. 그대로 격자에 그리면
 * 기준 언어(한국어)가 가운데에 오고, 진하게 그린 줄이 맨 위가 아니어서
 * 무엇을 기준으로 맞추는지 헷갈린다.
 *
 * **송출 언어(`langs`)에는 쓰지 않는다.** 그쪽은 사람이 누른 순서가 곧 화면
 * 위아래 순서라는 뜻이 있다. 이 함수는 **비교 격자**처럼 순서에 뜻이 없는 곳에 쓴다.
 */
export function orderLangs(langs: readonly LangCode[], primaryLang: LangCode = 'ko'): LangCode[] {
  const unique = [...new Set(langs)];
  const rank = (lang: LangCode): number => {
    if (lang === primaryLang) return -1;
    const index = SELECTABLE_LANGS.indexOf(lang);
    // 모르는 언어는 뒤로 — 버리지 않는다
    return index >= 0 ? index : SELECTABLE_LANGS.length;
  };
  return unique.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

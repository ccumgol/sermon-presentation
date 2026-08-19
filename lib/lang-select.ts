/**
 * 표시 언어 고르기 — 찬양 탭과 예배 순서 탭이 **같은 규칙**을 쓴다.
 *
 * 전에는 이 규칙이 찬양 탭 안에만 있었고 순서 탭에는 컨트롤이 아예 없었다.
 * 그래서 순서표에 넣은 찬양은 만들 때 정해진 언어(기본 `['ko']`)로 굳어,
 * 영어 가사를 넣어도 순서표에서는 볼 길이 없었다.
 */

import type { LangCode } from '../shared/types.ts';

/** 화면에 함께 올릴 수 있는 언어 수 — 위/아래 두 줄이 한계다 */
export const MAX_LANGS = 2;

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

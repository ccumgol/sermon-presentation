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

/** 기준 언어 — 다른 언어는 이 언어의 줄에 짝지어 붙는다 */
export const PRIMARY_LANG: LangCode = 'ko';

/**
 * 이름표 — **렌더러와 데이터가 아는 전부.**
 *
 * UI 에 내보이는 것과 따로 둔다. 여기서 지우면 이미 들어와 있는 가사가 이름을 잃는다.
 */
export const LANG_LABELS: Readonly<Record<string, string>> = {
  ko: '한국어',
  en: 'English',
  zh: '中文',
  ja: '日本語',
};

/**
 * **지금 UI 에 내보이는 언어.** 순서가 곧 버튼 순서다.
 *
 * 中文·日本語 를 뺐다 (2026-08-23 사용자 결정) — 넣은 가사가 **0줄**이었고, 고를 것이
 * 많으면 정작 쓰는 한/영이 묻힌다. `LANG_LABELS` 에는 남겨 두었으므로 **데이터는
 * 그대로 읽힌다.**
 *
 * ## 언어를 다시 켜려면
 *
 * **이 배열에 한 줄을 더하면 된다.** 화면·병합·저장이 모두 이 목록을 따른다.
 * 코드를 고칠 곳은 여기뿐이다.
 */
export const ACTIVE_LANGS: ReadonlyArray<LangCode> = ['ko', 'en'];

/**
 * **아는 언어의 정해진 순서** — 화면에 놓는 순서의 기준이다.
 *
 * `ACTIVE_LANGS` 와 따로 둔다. 정렬을 활성 목록으로 하면, 꺼 둔 언어(데이터는 있는)가
 * 이름 순으로 밀려 `ja` 가 `zh` 앞에 온다. 켜고 끄는 것과 놓는 순서는 다른 문제다.
 */
export const KNOWN_LANGS: ReadonlyArray<LangCode> = ['ko', 'en', 'zh', 'ja'];

/**
 * 이 곡에서 고를 수 있는 언어 — **켜진 언어 + 이미 이 곡에 들어 있는 언어.**
 *
 * 둘째 항이 안전장치다. 나중에 `ACTIVE_LANGS` 에서 언어를 빼도, 그 언어 가사가 있는
 * 곡에서는 계속 보인다 — 손댈 수 없는 데이터가 남는 것을 막는다.
 */
export function langChoices(existing: readonly LangCode[] = []): LangCode[] {
  const out = [...ACTIVE_LANGS];
  for (const lang of existing) if (!out.includes(lang)) out.push(lang);
  return out;
}

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
    const index = KNOWN_LANGS.indexOf(lang);
    // 모르는 언어는 뒤로 — 버리지 않는다
    return index >= 0 ? index : KNOWN_LANGS.length;
  };
  return unique.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

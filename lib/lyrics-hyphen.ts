/**
 * 악보용 **음절 하이픈**을 뗀다.
 *
 * ## 왜 필요한가
 *
 * 새찬송가 영어 가사 자료는 악보에 맞춰 낱말을 음절로 쪼개 적었다.
 * 화면에는 낱말로 보여야 한다.
 *
 * ```
 * Cleans-ing        → Cleansing
 * glo - ry          → glory        (하이픈 양쪽에 공백)
 * cre-a - tion      → creation     (잇단 하이픈)
 * ```
 *
 * ## 두 가지를 실측으로 정했다 (2026-08-28)
 *
 * ### 1. 겹치는 자리 — 한 번으로는 모자란다
 *
 * `cre-a - tion` 에 치환을 한 번만 돌리면 `crea - tion` 이 된다. 앞 치환이 `a` 를
 * 먹어 다음 짝의 왼쪽이 사라지기 때문이다. **바뀌지 않을 때까지 되돌린다.**
 *
 * ### 2. '양쪽이 소문자면 붙인다' 만으로는 합성어를 파괴한다
 *
 * 처음엔 양쪽이 소문자인 하이픈을 모두 붙이려 했다. 그러면 `nail-scarred`(20번)
 * `thorn-crowned` `blood-bought` `far-off` 같은 **뜻이 있는 합성어**가 뭉개진다.
 *
 * 사전(`/usr/share/dict/words`)으로 자료 전체를 재서 골라냈다 — 두 조각짜리 중
 * **양쪽이 모두 영어 낱말이고 붙인 결과는 낱말이 아닌 것**이 65가지였고, 그것만
 * 손으로 갈랐다. 남길 것이 21가지, 나머지는 사전에 없는 굴절형(`sea-sons`
 * `for-given` `hon-our`)이라 붙이는 것이 맞았다.
 *
 * `plea-Christ`(214장 「나 주의 도움 받고자」의 `…my only plea - Christ died for me!`)
 * 처럼 하이픈이 **문장 부호**인 것은 뒤가 대문자라 규칙에 걸리지 않는다.
 */

/**
 * 하이픈을 **남길** 낱말. 소문자로 대조한다(`Far-off` 도 걸린다).
 *
 * 자료 실측에서 골라낸 21가지다. 붙이면 뜻이 상한다.
 * 새 자료를 넣을 때는 다시 재야 한다 — 이 목록은 이 자료에 대한 판정이다.
 */
const KEEP_HYPHEN: ReadonlySet<string> = new Set([
  'blood-bought',
  'blood-red',
  'boat-fast',
  'cross-crowned',
  'death-dew',
  'far-off',
  'fast-closed',
  'heaven-born',
  'heaven-drawn',
  'ill-treat',
  'man-made',
  'nail-pierced',
  'nail-scarred',
  'pain-filled',
  'self-born',
  'sin-sick',
  'six-winged',
  'stone-cold',
  'thatch-roof',
  'thorn-crowned',
  'well-nigh',
]);

/** 하이픈 낀 토막 하나 — 공백이 끼어 있어도 한 토막으로 본다 */
const HYPHENATED = /[A-Za-z'’]+(?:[ \t]*-[ \t]*[A-Za-z'’]+)+/g;

/**
 * 낱말 안 음절 하이픈 — **뒤가 소문자일 때만** 붙인다.
 *
 * 앞쪽 글자는 대소문자를 가리지 않는다. 낱말 첫 음절이 한 글자인 경우가 흔해서다
 * (`A-men` → `Amen`, `O-ver-come` → `Overcome`, `E-ter-nal` → `Eternal`).
 * '양쪽이 소문자' 로 좁히면 이것들이 `A-men` `O-vercome` 으로 남는다.
 *
 * 뒤가 대문자면 붙이지 않는다 — 그것은 문장 부호이거나 고유명사 합성어다
 * (`plea - Christ died for me!`, `Life-Line`).
 */
const SYLLABLE_HYPHEN = /([A-Za-z'’])[ \t]*-[ \t]*(\p{Ll})/u;

/** 토막 하나에서 음절 하이픈을 뗀다. 바뀌지 않을 때까지 되돌린다 */
function joinToken(token: string): string {
  let out = token;
  for (let guard = 0; guard < 100; guard += 1) {
    const next = out.replace(SYLLABLE_HYPHEN, '$1$2');
    if (next === out) return out;
    out = next;
  }
  return out;
}

/**
 * 한 줄에서 쪼개진 음절을 붙인다. 뜻이 있는 합성어(`KEEP_HYPHEN`)와
 * 문장 부호로 쓰인 하이픈(`plea - Christ`)은 그대로 남는다.
 */
export function joinSyllableHyphens(text: string): string {
  return text.replace(HYPHENATED, (token) => {
    const key = token.replace(/[ \t]/g, '').toLowerCase();
    if (KEEP_HYPHEN.has(key)) return token.replace(/[ \t]*-[ \t]*/g, '-');
    return joinToken(token);
  });
}

/**
 * Daum 블로그에서 긁어온 **첨부 목록 잔재**를 뗀다.
 *
 * ```
 * ...Hal-le-lu-jah! etc 파일 jpg 파일 ppt 파일 © Daum Corp.
 * ```
 *
 * 645곡 중 293곡에 붙어 있었다(2026-08-28 실측). 이대로 두면 **예배 화면에 나온다.**
 * 줄 끝 접미로만 붙으므로 뗄 수 있고, 잔재만 있던 줄은 빈 줄이 된다.
 */
const SCRAPE_JUNK =
  /(?:\b(?:etc|zip|jpe?g|png|gif|pptx?|hwp|pdf|mp3|docx?|xlsx?)\s*파일\s*|\s*파일\s*)+(?:©\s*Daum\s*Corp\.?)?\s*$/;

/** 크롤링 잔재를 뗀다. 잔재뿐인 줄은 빈 문자열이 된다 */
export function stripScrapeJunk(text: string): string {
  return text.replace(SCRAPE_JUNK, '').trimEnd();
}

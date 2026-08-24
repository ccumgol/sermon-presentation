/**
 * 악보용 **음절 하이픈**을 뗀다 — 한/영 병기 자료 반입용.
 *
 * 찬송가 악보는 영어 가사를 음표에 맞춰 음절로 끊어 적는다:
 *
 * ```
 * On a hill for a-way stood an old rug-ged cross, The em-blem
 * ```
 *
 * 그대로 화면에 내보내면 `rug-ged cross` 가 오타처럼 보인다. 그래서 뗀다.
 *
 * ## 진짜 복합어는 남긴다
 *
 * `nail-scarred`·`thorn-crowned` 처럼 **하이픈이 뜻인** 낱말이 섞여 있다. 이것까지
 * 붙이면 `nailscarred` 가 되어 더 나쁘다.
 *
 * 판정은 규칙과 두 개의 표로 한다. 새찬송가 645곡(하이픈 21,222회·4,055종)에 실제로
 * 돌려 보며 다듬었고, **끝까지 갈리지 않은 것은 13종 18회(0.08%)** 다. 그것은 붙이지도
 * 남기지도 않고 **부르는 쪽에 알린다**(`kept`) — 대부분 원본 자료의 오류였다
 * (`God-in Three Persons` 는 'God in', `turst-ful` 은 'trustful' 오타).
 */

/** 붙였을 때 낱말인지 볼 사전 — 부르는 쪽이 넣어 준다(파일을 읽는 것은 스크립트의 일) */
export type Dictionary = ReadonlySet<string>;

/**
 * 하이픈을 **남겨야 하는** 낱말 (소문자 기준).
 *
 * 손으로 판정했다. 기준은 '하이픈이 두 낱말을 잇는 뜻을 갖는가' 다.
 * `might-ier`·`heav-iest` 처럼 굴절형은 여기 없다 — 그건 한 낱말이다.
 */
export const COMPOUNDS: ReadonlySet<string> = new Set([
  'nail-scarred', 'nail-pierced', 'thorn-crowned', 'cross-crowned',
  'blood-bought', 'blood-ransomed', 'blood-red',
  'new-born', 'heaven-born', 'heaven-drawn',
  'shore-line', 'flood-tide', 'storm-tossed', 'far-off',
  'so-called', 'sin-sick', 'pain-filled', 'earth-friends',
  'world-wide', 'wave-notes', 'death-dew', 'man-made', 'ill-treat',
  'stone-cold', 'six-winged', 'fast-closed', 'thatch-roof',
  'good-bye', 'well-nigh', 'no-one', 'boat-fast', 'self-born',
  // 찬송가가 일부러 그렇게 적는 방언 — `In-a my heart, in-a my heart`
  'in-a',
]);

/**
 * 규칙으로는 못 가리는 것들 — **붙인다.**
 *
 * 고유명사(사전에 없다)와 불규칙 형태다. 하이픈을 남기면 화면에 `E-sau`·`wo-men` 으로
 * 나간다. 새찬송가 645곡을 실제로 돌려 보고 남은 것만 적었다.
 */
const JOIN_ANYWAY: ReadonlySet<string> = new Set([
  // 고유명사
  'de-o', 'a-sia', 'e-sau', 'ma-rah', 'emma-us', 'ai-den', 'gitch-i',
  // 불규칙·변이 철자
  'wo-men', 'neigh-bours', 'bar-que', 'hark-en',
]);

/**
 * 접두사 — 뒤에 불규칙 활용이 오면 사전으로 가릴 수 없다.
 *
 * `be-came`·`for-gave`·`for-sook` 이 그렇다. 붙여도 사전에 없지만(`became` 이 web2 에
 * 없다) **접두사로 시작하면 한 낱말**이라고 보는 편이 맞다. 복합어는 앞쪽이
 * 접두사가 아니라 온전한 낱말이다(`nail-scarred`·`new-born`).
 */
const PREFIXES: readonly string[] = ['be', 'for', 'un', 're', 'en', 'em', 'dis', 'mis', 'with'];

/** 굴절형까지 본다 — web2 사전은 `-ing`·`-ers`·`-ies` 를 담지 않는다 */
function isWord(raw: string, dict: Dictionary): boolean {
  const word = raw.toLowerCase().replace(/'/g, '');
  if (dict.has(word)) return true;
  if (word.endsWith('ies') && dict.has(`${word.slice(0, -3)}y`)) return true;
  if (word.endsWith('ied') && dict.has(`${word.slice(0, -3)}y`)) return true;
  // heaviest → heavy · mightier → mighty
  if (word.endsWith('iest') && dict.has(`${word.slice(0, -4)}y`)) return true;
  if (word.endsWith('ier') && dict.has(`${word.slice(0, -3)}y`)) return true;
  // 영국식 철자 — honour → honor · fulfil → fulfill
  if (word.endsWith('our') && dict.has(`${word.slice(0, -3)}or`)) return true;
  if (word.endsWith('ours') && dict.has(`${word.slice(0, -4)}ors`)) return true;
  if (word.endsWith('il') && dict.has(`${word}l`)) return true;

  const suffixes: ReadonlyArray<[string, readonly string[]]> = [
    ['ing', ['', 'e']], ['ed', ['', 'e']], ['ers', ['', 'e']], ['er', ['', 'e']],
    ['es', ['']], ['s', ['']], ['est', ['', 'e']], ['ly', ['']], ['ness', ['']],
    ['eth', ['', 'e']],
  ];
  for (const [suffix, adds] of suffixes) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    if (adds.some((add) => dict.has(stem + add))) return true;
    // running → run (겹자음 되돌리기)
    if (stem.length > 2 && stem.at(-1) === stem.at(-2) && dict.has(stem.slice(0, -1))) return true;
  }
  return false;
}

/**
 * 이 하이픈 낱말을 붙여야 하는가.
 *
 * @returns 붙일 글자, 또는 `undefined`(하이픈을 남긴다)
 */
export function joinHyphenated(token: string, dict: Dictionary): string | undefined {
  const lower = token.toLowerCase();
  if (COMPOUNDS.has(lower)) return undefined;

  const joined = token.replace(/-/g, '');
  if (JOIN_ANYWAY.has(lower)) return joined;
  // 접두사 + 불규칙 활용 (`be-came`) — 사전으로는 가릴 수 없다
  const head = lower.split('-')[0] ?? '';
  if (PREFIXES.includes(head)) return joined;
  // ① 붙이면 사전에 있는 낱말 → 음절로 끊은 것이다
  if (isWord(joined, dict)) return joined;
  // ② 시적 축약(`ev-'ry` `vic-t'ry` `what-e'er`)은 한 낱말이다
  if (token.includes("'")) return joined;
  // ③ 세 조각 이상은 음절 분해다 (`glo-ri-fied` `Who-so-ev-er`)
  if ((token.match(/-/g)?.length ?? 0) >= 2) return joined;
  return undefined;
}

export interface HyphenResult {
  text: string;
  /** 규칙으로도 표로도 갈리지 않아 **하이픈을 남긴** 낱말 — 다음 자료를 위해 알린다 */
  kept: string[];
}

/** 영어 한 줄에서 음절 하이픈을 뗀다 */
export function stripSyllableHyphens(line: string, dict: Dictionary): HyphenResult {
  const kept: string[] = [];
  const text = line.replace(/[A-Za-z']+(?:\s?-\s?[A-Za-z']+)+/g, (match) => {
    // `A Won - drous` 처럼 하이픈 둘레에 공백이 있는 경우도 같은 것으로 본다
    const tight = match.replace(/\s*-\s*/g, '-');
    const joined = joinHyphenated(tight, dict);
    if (joined !== undefined) return joined;
    kept.push(tight);
    return tight;
  });
  return { text, kept };
}

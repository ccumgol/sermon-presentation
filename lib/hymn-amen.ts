/**
 * 찬송가 가사에서 **표시로서의 아멘**을 가려낸다 — 한/영 자료 반입용.
 *
 * 이 앱은 아멘을 가사가 아니라 곡의 플래그(`has_amen`)로 다룬다. 가사에 남겨 두면
 * 화면에 두 번 나간다. 그래서 반입할 때 떼어 플래그로 옮긴다.
 *
 * ## 떼면 안 되는 아멘이 있다
 *
 * 줄 전체가 아멘이면 그것은 **가사 자체**다 (새 628·641·643·644·645장). 그리고
 * 새 624장 「우리 모두 찬양해」처럼 `… 찬양해 아멘` 이 절마다 나오는 곡도 가사다 —
 * 그것은 부르는 쪽이 `--keep-amen` 으로 집어 준다.
 *
 * ## 한쪽만 떼면 짝이 어긋난다
 *
 * 처음엔 한국어만 뗐다. 그래서 **227곡**에서 한국어는 아멘 없이, 영어는 `… Amen.`
 * 으로 나가고 그 뒤에 아멘 슬라이드가 또 붙었다 (2026-08-28 실측).
 * 짝을 맞춰 함께 떼야 한다.
 */

/**
 * `[아멘]` 섹션인가 — 통째로 버릴 대상이다.
 *
 * 원본을 전수 조사하니 아멘이 두 가지로 적혀 있었다 (2026-08-25):
 *
 * | 어떻게 | 몇 곡 | 뜻 |
 * |---|---|---|
 * | `[아멘]` 섹션 + `아멘` 한 줄 | 294 | 예배 표시 → 섹션째 버리고 `has_amen` |
 * | 가사 줄 끝에 `… 아멘` | 13 | 같은 표시 → 그 낱말만 뗀다 |
 *
 * 628번의 `아멘 아멘 아멘` 은 **둘 다 아니다** — `[1절]` 안의 가사다. 그래서 라벨로
 * 가른다. 줄 모양만 보면 그 곡의 본문을 지워 버린다.
 */
export function isAmenSection(label: string): boolean {
  return /^아\s*멘$/.test(label.trim());
}

/**
 * 줄 끝에 붙은 **표시로서의 아멘**을 뗀다.
 *
 * ## `아멘 아멘 아멘` 은 건드리지 않는다
 *
 * 628번의 첫 줄이 그렇다 — 그 곡은 **가사 자체가 아멘**이다. 줄 전체가 아멘이면
 * 표시가 아니라 본문이므로 그대로 둔다.
 */
export function stripAmenMarker(text: string): { text: string; had: boolean } {
  const trimmed = text.trim();
  if (/^(아\s*멘\s*)+$/.test(trimmed)) return { text: trimmed, had: false };
  const without = trimmed.replace(/\s*아\s*멘\s*$/, '').trim();
  return { text: without, had: without !== trimmed && without.length > 0 };
}

/**
 * 짝 한국어에서 아멘을 뗀 줄이면 **영어의 `Amen` 도 뗀다.**
 *
 * 한쪽만 떼면 화면에서 그 줄만 어긋난다 — 한국어는 아멘 없이, 영어는 `… Amen.` 으로
 * 나가고 그 뒤에 아멘 슬라이드가 또 붙는다. 2026-08-28 실측으로 **227곡**이 그 상태였다.
 *
 * **한국어에서 뗀 줄에서만** 뗀다. 영어만 보고 판단하면 `World without end.
 * Amen, Amen.`(새 3장, 글로리아 파트리)처럼 아멘이 노래의 일부인 곳을 잘못 건드린다.
 * 자료가 짝으로 되어 있으므로 짝을 판단 근거로 쓰는 것이 가장 안전하다.
 *
 * 자료에 `Amen` `A-men` `A men` 세 가지 표기가 섞여 있다(하이픈은 이미 떼어진 뒤다).
 */
export function stripAmenEnglish(text: string): string {
  const trimmed = text.trim();
  if (/^(A\s*-?\s*men[.,!]?\s*)+$/i.test(trimmed)) return trimmed; // 줄 전체가 Amen → 본문
  // 쉼표·공백만 걷어낸다. 마침표는 앞 문장의 것이므로 남긴다 (`Ghost. Amen` → `Ghost.`)
  return trimmed.replace(/[\s,]*(?:\bA\s*-?\s*men\b[.,!]?\s*)+$/i, '').trim();
}


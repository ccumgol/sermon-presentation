/**
 * CSS 폰트 체인 문자열 다루기.
 *
 * 폰트 이름은 **적어 넣은 대로 잡히지 않는 일이 잦다.** 실제로 겪은 예:
 * 파일 이름이 `BareunBatangOTFPro-3.otf` 라 `"BareunBatangOTFPro 3"` 으로 적었더니
 * 어디에도 걸리지 않아 조용히 고딕으로 대체됐다. 화면은 멀쩡해 보이는데
 * 의도한 서체가 아니었다.
 *
 * 그래서 체인을 이름 목록으로 쪼개는 일을 순수 함수로 두고(여기), 실제로 어느 것이
 * 쓰였는지 재는 일은 브라우저 쪽에서 한다.
 */

/** 총칭 키워드 — 실제 폰트가 아니라 브라우저가 알아서 고르는 값 */
export const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
]);

/**
 * `'"Noto Serif KR", "Batang", serif'` → `['Noto Serif KR', 'Batang', 'serif']`
 *
 * 따옴표를 벗기고 앞뒤 공백을 떼며 빈 항목을 버린다.
 */
export function parseFontChain(css: string): string[] {
  if (typeof css !== 'string') return [];
  return css
    .split(',')
    .map((part) => part.trim().replace(/^['"]|['"]$/g, '').trim())
    .filter((name) => name.length > 0);
}

export function isGenericFamily(name: string): boolean {
  return GENERIC_FAMILIES.has(name.toLowerCase());
}

/**
 * 체인이 총칭으로만 끝나는지 — 그러면 그 총칭이 해당 문자를 못 덮을 때
 * **글자마다 다른 폰트로 대체**돼 자간이 들쭉날쭉해진다(PLAN 3.4 헬라어 사고).
 * 총칭 앞에 실제 폰트 이름이 하나라도 있어야 한다.
 */
export function hasRealFallback(css: string): boolean {
  const names = parseFontChain(css);
  const lastReal = names.filter((name) => !isGenericFamily(name));
  return lastReal.length > 0;
}

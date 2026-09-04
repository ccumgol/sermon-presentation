/**
 * 악보 파일 이름 규칙 — 곡 번호 ↔ 파일 이름.
 *
 * 반입 스크립트(`scripts/convert-sheets.ts`)와 서버가 **같은 규칙**을 써야 한다.
 * 두 곳에 따로 적으면 한쪽이 뒤처져 '변환은 됐는데 화면에 안 나온다' 가 된다.
 *
 * 원본 이름은 `0001.bmp`~`1888.bmp` 와 `(1889).bmp`~`(2062).bmp` **두 형식**인데
 * 번호가 이어지는 한 벌이다 (2026-09-04 실측: 겹침 0 · 빠짐 0). 변환 결과는
 * `0001.webp` 처럼 **네 자리로 통일**한다 — 곡 번호로 바로 찾을 수 있어야 한다.
 */

/** 악보 파일 확장자 — 무손실 WebP 로 통일한다 (`scripts/convert-sheets.ts` 머리말) */
export const SHEET_EXT = '.webp';

/**
 * 파일 이름에서 곡 번호를 뽑는다 — `0001.bmp` · `(1889).bmp` · `0305.webp` 모두.
 *
 * **숫자 덩이가 정확히 하나일 때만** 돌려준다. `1255 (2).bmp` 처럼 내려받기가 만든
 * 사본이나 `2절-0305.bmp` 같은 이름은 어느 쪽이 곡 번호인지 알 수 없다 —
 * 조용히 하나를 고르면 **엉뚱한 곡에 악보가 붙는다.**
 */
export function sheetNumberOf(filename: string): number | undefined {
  const base = filename.replace(/^.*[/\\]/, '').replace(/\.[^.]*$/, '');
  const digits = base.match(/\d+/g);
  if (!digits || digits.length !== 1) return undefined;
  const value = Number(digits[0]);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

/** 곡 번호 → 악보 파일 이름 (`1` → `0001.webp`) */
export function sheetFileName(number: number): string {
  return `${String(number).padStart(4, '0')}${SHEET_EXT}`;
}

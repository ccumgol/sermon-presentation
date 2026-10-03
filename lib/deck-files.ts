/**
 * PDF 꾸러미의 **이름 규칙과 상한** (2026-10-03 사용자 결정).
 *
 * 서버와 조작 화면이 **같은 값을 봐야** 한다 — 한쪽만 알면 «올렸는데 거부당했다» 가
 * 되고, 사람은 무엇이 한도인지 모른 채 다시 시도한다. 그래서 여기 한 곳에 둔다.
 *
 * ## 상한이 왜 있나
 *
 * 보안 S-1 이 **업로드에 총량 제한이 없어 디스크가 차면 가사를 잃는다**는 것이었고,
 * 그래서 업로드 기능을 통째로 걷어냈다(2026-08-18). 여기서 쪽 그림을 쓰는 길을
 * 다시 여는 이상 **그 울타리를 함께 가져온다.**
 */

/** 한 PDF 가 만들 수 있는 쪽 수. 예배에 쓰는 자료가 이보다 길 일은 없다 */
export const MAX_DECK_PAGES = 300;

/** 쪽 하나의 상한. 1920 폭 사진 슬라이드가 대개 300KB 안쪽이다 */
export const MAX_PAGE_BYTES = 4 * 1024 * 1024;

/** 한 꾸러미 전체. 쪽 수 × 쪽 용량보다 훨씬 작게 잡아 디스크를 지킨다 */
export const MAX_DECK_BYTES = 200 * 1024 * 1024;

/** 쪽 그림 형식 — 사진이 많은 선교보고에서 PNG 보다 훨씬 작다 */
export const PAGE_EXT = '.webp';

/**
 * 폴더·파일 이름으로 쓸 수 있는가.
 *
 * 경로 구분자·`..`·숨김 이름을 막는다. `safeFolderName`(순서표)과 같은 규칙이고
 * **같은 이유**다 — 통과시키면 `decks/` 밖의 파일을 읽거나 쓰게 된다.
 */
export function safeDeckName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.trim();
  if (name.length === 0 || name.length > 120) return undefined;
  if (name.includes('/') || name.includes('\\') || name.startsWith('.')) return undefined;
  // 윈도우에서 막히는 글자 — 맥에서 만든 이름이 윈도우에서 안 열리는 것을 미리 막는다
  if (/[<>:"|?*\u0000-\u001f]/.test(name)) return undefined;
  return name;
}

/** `선교보고.pdf` → `선교보고`. PDF 가 아니면 `undefined` */
export function deckNameOf(file: string): string | undefined {
  if (!/\.pdf$/i.test(file)) return undefined;
  return safeDeckName(file.slice(0, -4));
}

/** 쪽 번호 → 파일 이름. **자리를 채워야** 이름순 정렬이 곧 쪽 차례가 된다 */
export function pageFileName(page: number): string {
  return `${String(page).padStart(4, '0')}${PAGE_EXT}`;
}

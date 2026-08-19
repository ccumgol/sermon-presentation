/**
 * 한국어 폰트 체인 — **고딕과 명조 두 갈래만.**
 *
 * ## 왜 한 곳에 모으는가
 *
 * 전에는 프리셋(`lib/template-presets.ts`)과 출력 페이지(`public/output/output.js`)가
 * 각자 체인을 갖고 있었고, 둘이 **달랐다.** 그래서 같은 '명조' 를 골라도 어디서
 * 골랐는지에 따라 다른 글꼴이 나왔다. 더 나쁜 것은 출력 페이지의 명조 체인 2순위가
 * `Apple SD Gothic Neo` — **고딕**이었다는 점이다. 나눔명조가 없는 PC 에서 '명조' 를
 * 고르면 조용히 고딕이 나온다. 화면은 멀쩡해 보여 알아채기 어렵다.
 *
 * ## 대표 폰트는 Noto
 *
 * `Noto Sans KR` · `Noto Serif KR` 을 맨 앞에 둔다 (사용자 지정, 2026-08-19).
 * 두 벌이 한 집안이라 고딕/명조를 섞어 써도 글자 폭·높이가 어울린다. 무료이고
 * 맥·윈도우·리눅스에 모두 설치할 수 있어 교회 PC 를 바꿔도 같은 화면이 나온다.
 *
 * 뒤쪽은 **없을 때를 위한 사다리**다. 어느 PC 에나 있는 이름으로 끝내고 총칭은
 * 마지막에 둔다 — 총칭까지 내려가면 글자마다 다른 폰트로 대체돼 심하게 벌어진다
 * (실측: 같은 구절이 `serif` 819.6px vs Times 526.6px).
 *
 * ## 출력 페이지와의 관계
 *
 * `public/output/output.js` 는 **의존성 0** 이 원칙이라(OBS 브라우저 소스가 죽지
 * 않게) 이 파일을 import 할 수 없다. 그래서 같은 문자열을 그쪽에도 적어 둔다.
 * 두 벌이 어긋나지 않도록 `tests/unit/korean-fonts.test.ts` 가 실제 파일을 읽어
 * **글자 단위로 같은지 확인**한다. 한쪽만 고치면 테스트가 깨진다.
 */

/** 고딕 (Sans) — 본문 기본 */
export const FONT_KO_SANS =
  '"Noto Sans KR", "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

/**
 * 명조 (Serif) — 순서 표시·교독문·전례문처럼 무게를 주는 자리.
 *
 * **고딕 이름을 이 체인에 넣지 않는다.** 넣으면 '명조' 를 골라도 고딕이 나온다.
 * 앞쪽 둘은 굵은 명조(설치돼 있으면), 그다음 맥·윈도우 기본 명조 순이다.
 */
export const FONT_KO_SERIF =
  '"Noto Serif KR", "Noto Serif CJK KR", "BareunBatangOTFPro", "NanumMyeongjoExtraBold", ' +
  '"Nanum Myeongjo", "AppleMyungjo", "Batang", serif';

/** 항목에서 고르는 두 갈래 — 예배 순서·성경·찬양 탭이 함께 쓴다 */
export const ITEM_FONT_CHAINS = {
  sans: FONT_KO_SANS,
  serif: FONT_KO_SERIF,
} as const;

export type ItemFontKind = keyof typeof ITEM_FONT_CHAINS;

/**
 * 이것만 있으면 화면이 의도대로 나온다 — 설정 탭의 설치 안내에 쓴다.
 *
 * 나머지 이름은 '없으면 이걸로' 사다리일 뿐이라 안내하지 않는다. 받을 것이 많아 보이면
 * 아무것도 안 받는다.
 */
export const RECOMMENDED_FONTS: ReadonlyArray<{
  /** CSS 에 적히는 이름 — 설치 여부를 재는 기준 */
  family: string;
  label: string;
  kind: ItemFontKind;
  /** 내려받는 곳 */
  url: string;
}> = [
  {
    family: 'Noto Sans KR',
    label: '본문·찬양 가사에 쓰는 고딕',
    kind: 'sans',
    url: 'https://fonts.google.com/noto/specimen/Noto+Sans+KR',
  },
  {
    family: 'Noto Serif KR',
    label: '순서 표시·교독문·주기도문에 쓰는 명조',
    kind: 'serif',
    url: 'https://fonts.google.com/noto/specimen/Noto+Serif+KR',
  },
];

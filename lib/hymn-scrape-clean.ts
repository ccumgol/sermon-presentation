/**
 * 웹에서 긁어 온 찌꺼기를 뗀다 — 한/영 병기 자료 반입용.
 *
 * ## 무엇을 겪었나
 *
 * 새찬송가 645곡 자료를 점검해 보니 **340곡(53%)** 의 마지막 영어 줄 끝에 블로그
 * 페이지의 부스러기가 붙어 있었다:
 *
 * ```
 * | ful-fill'd on earth be-low. A-men. zip 파일 jpg 파일 ppt 파일 © Daum Corp.
 * ```
 *
 * 그대로 넣으면 **예배 화면에 `© Daum Corp.` 이 나간다.** 29곡에는 `| 파일` 만 있는
 * 줄도 있었다.
 *
 * ## 만드는 쪽에서 고치는 것이 맞다
 *
 * 이것은 자료를 만든 도구의 문제다. 여기서 떼는 것은 **이번 반입을 위한 응급 처치**이고,
 * 원본을 고치면 이 모듈은 아무 일도 하지 않게 된다(그것이 정상이다).
 *
 * ## 조심한 것
 *
 * 가사 한복판을 자르지 않는다. 찌꺼기는 늘 **줄 끝**에 붙고 `파일`·`©` 로 시작한다.
 * 그 두 표시가 없으면 한 글자도 건드리지 않는다.
 */

/**
 * 줄 끝에 붙은 부스러기.
 *
 * - `zip 파일 jpg 파일 ppt 파일 …` — 첨부파일 목록
 * - `© Daum Corp.` — 저작권 꼬리
 *
 * **처음 나오는 표시부터 줄 끝까지** 자른다. 둘을 따로 지우면(교대 `A|B`) 정규식이
 * 왼쪽에 있는 것을 먼저 잡아 앞의 목록이 남는다 — 실제로 그렇게 틀렸다.
 *
 * `파일` 뒤에 `\b` 를 두지 않는다. 낱말 경계는 `[A-Za-z0-9_]` 기준이라 **한글 뒤에는
 * 경계가 생기지 않아** 아무것도 걸리지 않는다 (이것도 실제로 겪었다).
 *
 * 맨 앞의 `파일` 은 확장자가 앞에 없어 따로 받아 준다 — 실제 자료가
 * `파일 jpg 파일 … © Daum Corp.` 로 시작한다.
 */
const TRAILING_JUNK =
  /\s*(?:파일\s+)?(?:\b(?:zip|etc|jpg|jpeg|png|gif|ppt|pptx|hwp|pdf|txt)\b\s*파일|©)[\s\S]*$/i;

/** 줄 전체가 부스러기인 경우 (`파일` 한 낱말만 남은 줄) */
const JUNK_ONLY = /^\s*파일\s*$/;

/**
 * 줄 끝에 홀로 남은 확장자.
 *
 * 원본에서 찌꺼기가 **줄을 넘어가며 잘린** 경우가 있다 — `… A-men. zip` 에서 끝나고
 * 나머지(`파일 jpg …`)는 다음 줄로 갔다. 실제로 3줄이 그랬다.
 *
 * `etc`·`txt` 는 넣지 않는다. 가사에 나올 수 있는 낱말이라 잘라 내면 위험하다.
 */
const TRAILING_EXTENSION = /\s+\b(?:zip|jpg|jpeg|png|gif|ppt|pptx|hwp|pdf)\s*$/i;

export interface CleanResult {
  /** 손질한 글자. 통째로 버릴 줄이면 빈 문자열 */
  text: string;
  /** 무언가 뗐나 — 부르는 쪽이 몇 줄을 손질했는지 세는 데 쓴다 */
  changed: boolean;
}

/**
 * 번역 줄 하나를 손질한다.
 *
 * @returns 빈 문자열이면 **그 줄을 버리라는 뜻**이다 (찌꺼기뿐이었다).
 */
export function stripScrapeArtifacts(line: string): CleanResult {
  const trimmed = line.trim();
  const cleaned = trimmed.replace(TRAILING_JUNK, '').replace(TRAILING_EXTENSION, '').trim();

  /*
   * 자르고 **남은 것**도 본다. 실제 자료에 이런 줄이 있었다:
   *
   *   | 파일 jpg 파일 jpg 파일 ppt 파일 © Daum Corp.
   *
   * 맨 앞의 `파일` 은 확장자가 앞에 없어 잘리지 않고 홀로 남는다.
   */
  if (JUNK_ONLY.test(cleaned)) return { text: '', changed: true };
  if (cleaned === trimmed) return { text: trimmed, changed: false };
  return { text: cleaned, changed: true };
}

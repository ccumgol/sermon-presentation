/**
 * 항목별 표시 옵션 — 참조 표기·소제목·절 번호를 항목에서 켜고 끈다.
 *
 * ## 나누는 기준
 *
 * **모양은 템플릿, 표시 여부는 항목.** 크기·색·테두리는 매주 같지만 '이 본문에는
 * 소제목을 띄우자' 는 그 주에 정하는 일이다. 전에는 둘이 템플릿에 함께 있어,
 * 소제목을 한 번 끄려면 템플릿을 고치거나 사본을 만들어야 했다.
 *
 * ## 세 갈래 값
 *
 * 항목 값은 `undefined`(템플릿 따름) · `true` · `false` 세 갈래다. `false` 를 기본값으로
 * 두면 **이미 저장된 순서표가 모두 '끔' 이 되어** 다음 예배에 소제목·절 번호가 사라진다.
 * 지정하지 않은 것은 지금까지와 똑같이 동작해야 한다.
 *
 * ## 출력 페이지와의 관계
 *
 * `public/output/output.js` 는 **의존성 0** 이 원칙이라 이 파일을 import 할 수 없다.
 * 그래서 같은 규칙을 그쪽에도 적어 두고, `tests/unit/item-display.test.ts` 가
 * 실제 파일을 읽어 규칙이 남아 있는지 확인한다.
 *
 * 결정은 **출력 페이지에서** 해야 한다. 컨트롤 패널이 미리 풀어 슬라이드에 담으면,
 * 나중에 템플릿만 바꿨을 때(`template:set`) 그 값이 따라오지 않는다.
 */

import type { ItemDisplay, TemplateBehavior } from '../shared/types.ts';

/** 참조 표기를 켰는데 템플릿이 '표시 안 함' 일 때 놓을 자리 */
const REFERENCE_FALLBACK = 'bottom';

export interface ResolvedDisplay {
  verseNumbers: boolean;
  headings: boolean;
  /** 템플릿이 정한 자리를 그대로 쓴다 — `inline` 은 본문 줄에 붙는 형태다 */
  reference: TemplateBehavior['showReference'];
  /** 항목이 템플릿과 다르게 정했는가 — 컨트롤 패널이 표시하는 데 쓴다 */
  overridden: boolean;
}

/**
 * 템플릿 기본값에 항목 지정을 얹는다.
 *
 * @param behavior 템플릿의 표시 기본값
 * @param display 항목이 지정한 것 (없으면 템플릿 그대로)
 */
export function resolveDisplay(
  behavior: Partial<Pick<TemplateBehavior, 'showVerseNumbers' | 'showHeadings' | 'showReference'>>,
  display: ItemDisplay | undefined,
): ResolvedDisplay {
  // `showVerseNumbers` 는 '없으면 켬' 이 기존 동작이다 (renderBible 의 `!== false`)
  const baseVerse = behavior.showVerseNumbers !== false;
  const baseHeadings = behavior.showHeadings === true;
  const basePosition = behavior.showReference ?? 'none';

  const verseNumbers = display?.verseNumbers ?? baseVerse;
  const headings = display?.headings ?? baseHeadings;

  let reference: ResolvedDisplay['reference'] = basePosition;
  if (display?.reference === false) reference = 'none';
  else if (display?.reference === true) {
    // 켰는데 템플릿이 '표시 안 함' 이면 아무 데도 놓을 자리가 없다.
    // 그대로 두면 켰는데 안 보여 고장으로 읽힌다.
    reference = basePosition === 'none' ? REFERENCE_FALLBACK : basePosition;
  }

  return {
    verseNumbers,
    headings,
    reference,
    overridden:
      verseNumbers !== baseVerse || headings !== baseHeadings || reference !== basePosition,
  };
}

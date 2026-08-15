/**
 * Template → CSS Custom Property 변환.
 *
 * 순수 함수로 둔 이유: 서버·컨트롤 패널·출력 페이지 어디서든 같은 결과를 내야 하고,
 * 단위 테스트로 고정할 수 있어야 한다. 출력 페이지는 이 결과를 받아
 * `style.setProperty()` 로만 적용하므로 DOM 재구성이 없다 (계획서 §5.2).
 */

import type { Anchor, CanvasBackground, LangCode, Template, TextStyle } from '../shared/types.ts';

export type CssVars = Record<string, string>;

/** anchor → grid 정렬 (출력 페이지의 --justify/--align) */
const ANCHOR_MAP: Record<Anchor, [string, string]> = {
  'top-left': ['start', 'start'],
  'top-center': ['center', 'start'],
  'top-right': ['end', 'start'],
  'mid-left': ['start', 'center'],
  center: ['center', 'center'],
  'mid-right': ['end', 'center'],
  'bottom-left': ['start', 'end'],
  'bottom-center': ['center', 'end'],
  'bottom-right': ['end', 'end'],
};

export function anchorToAlignment(anchor: Anchor): { justify: string; align: string } {
  const pair = ANCHOR_MAP[anchor] ?? ANCHOR_MAP['bottom-center'];
  return { justify: pair[0]!, align: pair[1]! };
}

function px(value: number): string {
  return `${value}px`;
}

/** number | 'auto' 를 CSS 길이로. 'auto'/'none' 은 그대로 넘긴다. */
function size(value: number | 'auto', autoKeyword: 'auto' | 'none' = 'auto'): string {
  return value === 'auto' ? autoKeyword : px(value);
}

function strokeValue(stroke: TextStyle['stroke']): string {
  return stroke && stroke.width > 0 ? `${px(stroke.width)} ${stroke.color}` : 'none';
}

function shadowValue(shadow: TextStyle['shadow']): string {
  return shadow ? `${px(shadow.x)} ${px(shadow.y)} ${px(shadow.blur)} ${shadow.color}` : 'none';
}

function backgroundValue(background: CanvasBackground): string {
  switch (background.mode) {
    case 'transparent':
      return 'transparent';
    case 'chroma':
      return background.color;
    case 'color':
      // opacity 를 별도 변수로 두지 않고 색에 합쳐 넣는다 — 배경만 반투명하게 하려면
      // rgba 로 직접 지정하는 것이 텍스트 opacity 와 섞이지 않아 안전하다.
      return background.opacity >= 1 ? background.color : withAlpha(background.color, background.opacity);
    default:
      return 'transparent';
  }
}

/** #RRGGBB + 알파 → rgba(). 이미 rgba/hsl 형태면 그대로 둔다. */
export function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!match) return color;
  const hex = match[1]!;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const clamped = Math.min(Math.max(alpha, 0), 1);
  return `rgba(${r}, ${g}, ${b}, ${clamped})`;
}

/** 역할별 텍스트 스타일 → CSS 변수. prefix 는 'primary' | 'secondary' 등. */
function textStyleVars(prefix: string, style: TextStyle): CssVars {
  return {
    [`--${prefix}-font`]: style.fontFamily,
    [`--${prefix}-size`]: px(style.fontSize),
    [`--${prefix}-weight`]: String(style.fontWeight),
    [`--${prefix}-line-height`]: String(style.lineHeight),
    [`--${prefix}-spacing`]: px(style.letterSpacing),
    [`--${prefix}-color`]: style.color,
    [`--${prefix}-opacity`]: String(style.opacity),
    [`--${prefix}-style`]: style.italic ? 'italic' : 'normal',
    [`--${prefix}-transform`]: style.textTransform,
    [`--${prefix}-word-break`]: style.wordBreak,
    [`--${prefix}-stroke`]: strokeValue(style.stroke),
    [`--${prefix}-shadow`]: shadowValue(style.shadow),
    [`--${prefix}-box-bg`]: style.bgBox ? style.bgBox.color : 'transparent',
    [`--${prefix}-box-pad-x`]: px(style.bgBox?.paddingX ?? 0),
    [`--${prefix}-box-pad-y`]: px(style.bgBox?.paddingY ?? 0),
    [`--${prefix}-box-radius`]: px(style.bgBox?.radius ?? 0),
  };
}

/**
 * 절 번호·참조·소제목·저작권은 스트로크/그림자까지 필요한 것만 노출한다.
 * 출력 페이지 CSS 가 참조하는 변수 이름과 1:1로 맞춰야 한다.
 */
function simpleStyleVars(prefix: string, style: TextStyle): CssVars {
  return {
    [`--${prefix}-font`]: style.fontFamily,
    [`--${prefix}-size`]: px(style.fontSize),
    [`--${prefix}-weight`]: String(style.fontWeight),
    [`--${prefix}-color`]: style.color,
    [`--${prefix}-opacity`]: String(style.opacity),
    [`--${prefix}-stroke`]: strokeValue(style.stroke),
    [`--${prefix}-shadow`]: shadowValue(style.shadow),
  };
}

/** 템플릿 전체 → CSS 변수 묶음 */
export function templateToCssVars(template: Template): CssVars {
  const { justify, align } = anchorToAlignment(template.layout.anchor);
  const { canvas, layout, text, behavior } = template;

  return {
    // 캔버스
    '--canvas-bg': backgroundValue(canvas.background),
    '--safe-top': px(canvas.safeArea.top),
    '--safe-right': px(canvas.safeArea.right),
    '--safe-bottom': px(canvas.safeArea.bottom),
    '--safe-left': px(canvas.safeArea.left),

    // 레이아웃
    '--justify': justify,
    '--align': align,
    '--offset-x': px(layout.offsetX),
    '--offset-y': px(layout.offsetY),
    '--block-width': size(layout.width),
    '--block-max-height': size(layout.maxHeight, 'none'),
    '--text-align': layout.align,
    '--flow-direction': layout.direction,
    '--block-gap': px(layout.gap),

    // 텍스트
    ...textStyleVars('primary', text.primary),
    ...textStyleVars('secondary', text.secondary),
    ...simpleStyleVars('versenum', text.verseNum),
    ...simpleStyleVars('reference', text.reference),
    ...simpleStyleVars('heading', text.heading),
    ...simpleStyleVars('credit', text.credit),

    // 전환
    '--transition-duration': `${behavior.transition.type === 'none' ? 0 : behavior.transition.durationMs}ms`,
  };
}

/**
 * 역본·언어별 스타일 override 를 적용한 변수.
 *
 * 한 블록에만 다른 폰트를 주려면 CSS 변수만으로는 부족하므로,
 * 출력 페이지가 블록 요소에 직접 인라인으로 붙일 수 있게 별도로 돌려준다.
 * (예: 헬라어 블록만 SBL Greek, 영어 보조 역본만 이탤릭)
 */
export function overrideVarsFor(
  template: Template,
  role: 'primary' | 'secondary',
  translationId: string,
  lang: LangCode,
): CssVars {
  const base = role === 'primary' ? template.text.primary : template.text.secondary;
  const byLang = template.overridesByLang?.[lang];
  const byTranslation = template.overridesByTranslation?.[translationId];

  if (!byLang && !byTranslation) return {};

  // 역본 지정이 언어 지정보다 구체적이므로 나중에 덮는다
  const merged: TextStyle = { ...base, ...byLang, ...byTranslation };
  return textStyleVars(role, merged);
}

/** 두 변수 묶음의 차이만 추린다 — 바뀐 것만 보내 불필요한 setProperty 를 줄인다. */
export function diffCssVars(previous: CssVars, next: CssVars): CssVars {
  const patch: CssVars = {};
  for (const [key, value] of Object.entries(next)) {
    if (previous[key] !== value) patch[key] = value;
  }
  return patch;
}

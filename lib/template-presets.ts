/**
 * 내장 템플릿 프리셋 7종 (계획서 §5.4).
 *
 * 값은 1920×1080 기준이다. 실전에서 바로 쓸 수 있는 상태로 두되,
 * 사용자가 편집해 저장하면 별도 템플릿이 되고 프리셋은 그대로 남는다.
 *
 * 폰트는 언어별 폴백 체인(§5.6)을 문자열로 넣는다. 시스템에 없는 폰트는
 * 다음 후보로 넘어가고, 출력 페이지가 실제 사용된 폰트를 측정해 경고한다.
 */

import type { Anchor, Template, TemplateKind, TextStyle } from '../shared/types.ts';

const FONT_KO = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
const FONT_EN = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';
const FONT_GRC = '"SBL Greek", "Cardo", "Gentium Plus", serif';
const FONT_HEB = '"SBL Hebrew", "Ezra SIL", "Taamey Frank CLM", serif';

/** 밝은 영상 위에서도 읽히도록 검은 외곽선을 기본으로 둔다 */
const STROKE_DARK = { width: 3, color: '#000000' };
const SHADOW_SOFT = { x: 0, y: 3, blur: 10, color: 'rgba(0,0,0,0.55)' };

function textStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: FONT_KO,
    fontSize: 64,
    fontWeight: 700,
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#ffffff',
    opacity: 1,
    stroke: STROKE_DARK,
    shadow: SHADOW_SOFT,
    bgBox: null,
    italic: false,
    textTransform: 'none',
    // 한국어는 어절 단위로 줄바꿈해야 읽기 좋다
    wordBreak: 'keep-all',
    ...overrides,
  };
}

interface PresetInput {
  id: number;
  name: string;
  kind: TemplateKind;
  anchor?: Anchor;
  safeArea?: Partial<Template['canvas']['safeArea']>;
  layout?: Partial<Template['layout']>;
  text?: Partial<Record<keyof Template['text'], Partial<TextStyle>>>;
  behavior?: Partial<Template['behavior']>;
}

function preset(input: PresetInput): Template {
  const safe = { top: 80, right: 140, bottom: 96, left: 140, ...input.safeArea };

  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    isBuiltin: true,
    canvas: {
      width: 1920,
      height: 1080,
      // OBS 브라우저 소스가 알파 합성하므로 투명이 기본이다 (§5.3)
      background: { mode: 'transparent' },
      safeArea: safe,
    },
    layout: {
      anchor: input.anchor ?? 'bottom-center',
      offsetX: 0,
      offsetY: 0,
      width: 'auto',
      maxHeight: 'auto',
      align: 'center',
      verticalAlign: 'bottom',
      direction: 'column',
      gap: 24,
      ...input.layout,
    },
    text: {
      primary: textStyle(input.text?.primary),
      secondary: textStyle({
        fontSize: 42,
        fontWeight: 400,
        color: '#ffe9a8',
        stroke: { width: 2, color: '#000000' },
        wordBreak: 'normal',
        ...input.text?.secondary,
      }),
      verseNum: textStyle({
        fontSize: 30,
        fontWeight: 700,
        color: '#ffd24a',
        stroke: { width: 2, color: '#000000' },
        ...input.text?.verseNum,
      }),
      reference: textStyle({
        fontSize: 34,
        fontWeight: 500,
        opacity: 0.9,
        stroke: { width: 2, color: '#000000' },
        ...input.text?.reference,
      }),
      heading: textStyle({
        fontSize: 38,
        fontWeight: 600,
        color: '#cfe8ff',
        opacity: 0.95,
        stroke: { width: 2, color: '#000000' },
        ...input.text?.heading,
      }),
      credit: textStyle({
        fontSize: 22,
        fontWeight: 400,
        opacity: 0.75,
        stroke: null,
        shadow: null,
        ...input.text?.credit,
      }),
    },
    overridesByLang: {
      en: { fontFamily: FONT_EN, wordBreak: 'normal' },
      grc: { fontFamily: FONT_GRC, wordBreak: 'normal' },
      heb: { fontFamily: FONT_HEB, wordBreak: 'normal' },
    },
    behavior: {
      autoFit: true,
      autoFitMinScale: 0.6,
      maxLinesPerSlide: 'auto',
      transition: { type: 'fade', durationMs: 180 },
      showVerseNumbers: true,
      showReference: 'bottom',
      referenceFormat: 'abbr',
      showHeadings: true,
      showCredit: false,
      ...input.behavior,
    },
  };
}

/**
 * 프리셋 id 는 음수를 쓴다.
 * 사용자 템플릿은 SQLite AUTOINCREMENT 로 1부터 올라가므로 절대 충돌하지 않는다.
 */
export const BUILTIN_TEMPLATES: readonly Template[] = [
  preset({
    id: -1,
    name: '설교본문 — 단일 역본',
    kind: 'bible',
    anchor: 'bottom-center',
    text: { primary: { fontSize: 68 } },
  }),

  preset({
    id: -2,
    name: '설교본문 — 이중 역본 (위/아래)',
    kind: 'bible',
    anchor: 'bottom-center',
    layout: { direction: 'column', gap: 28 },
    text: { primary: { fontSize: 60 }, secondary: { fontSize: 40 } },
  }),

  preset({
    id: -3,
    name: '본문 — 좌우 분할 (원어 대조)',
    kind: 'bible',
    anchor: 'center',
    layout: { direction: 'row', gap: 56, align: 'left', width: 1640 },
    text: { primary: { fontSize: 46 }, secondary: { fontSize: 44 } },
    behavior: { showReference: 'top' },
  }),

  preset({
    id: -4,
    name: '찬양 — 이중 언어',
    kind: 'song',
    anchor: 'bottom-center',
    safeArea: { bottom: 120 },
    layout: { direction: 'column', gap: 18 },
    text: {
      primary: { fontSize: 62 },
      secondary: { fontSize: 44, italic: true, color: '#e8f0ff' },
    },
    behavior: {
      showVerseNumbers: false,
      showReference: 'none',
      showHeadings: false,
      showCredit: true,
      // 한/영을 위아래로 겹쳐 두 줄로 — 운율 행을 24자까지 묶는다
      maxCharsPerLine: 24,
    },
  }),

  preset({
    id: -5,
    name: '찬양 — 단일 언어',
    kind: 'song',
    anchor: 'bottom-center',
    safeArea: { bottom: 120 },
    text: { primary: { fontSize: 70 } },
    behavior: { showVerseNumbers: false, showReference: 'none', showHeadings: false, showCredit: true, maxCharsPerLine: 24 },
  }),

  preset({
    id: -8,
    name: '찬양 — 전체화면 큰 글씨',
    kind: 'song',
    anchor: 'center',
    layout: { gap: 24 },
    text: { primary: { fontSize: 96 } },
    behavior: {
      showVerseNumbers: false,
      showReference: 'none',
      showHeadings: false,
      showCredit: false,
      // 글씨가 크므로 운율 행을 묶지 않는다 — 9자 4행이 그대로 나간다
      maxCharsPerLine: 14,
    },
  }),

  preset({
    id: -6,
    name: '로우서드 (설교자·광고)',
    kind: 'lower_third',
    anchor: 'bottom-left',
    safeArea: { left: 96, bottom: 96 },
    layout: { align: 'left', gap: 8 },
    text: {
      primary: {
        fontSize: 40,
        stroke: null,
        bgBox: { color: 'rgba(0,0,0,0.55)', paddingX: 28, paddingY: 14, radius: 10 },
      },
      secondary: {
        fontSize: 26,
        stroke: null,
        bgBox: { color: 'rgba(0,0,0,0.45)', paddingX: 28, paddingY: 10, radius: 8 },
      },
    },
    behavior: { showVerseNumbers: false, showReference: 'none', showHeadings: false, autoFit: false },
  }),

  preset({
    id: -7,
    name: '공백 (블랭크)',
    kind: 'blank',
    behavior: {
      showVerseNumbers: false,
      showReference: 'none',
      showHeadings: false,
      showCredit: false,
      autoFit: false,
      transition: { type: 'none', durationMs: 0 },
    },
  }),
];

/** 기본 템플릿 — 서버가 처음 기동할 때 선택되는 것 */
export const DEFAULT_TEMPLATE_ID = -2;

export function getBuiltinTemplate(id: number): Template | undefined {
  return BUILTIN_TEMPLATES.find((t) => t.id === id);
}

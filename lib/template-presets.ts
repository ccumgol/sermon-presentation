/**
 * 내장 템플릿 프리셋 7종 (계획서 §5.4).
 *
 * 값은 1920×1080 기준이다. 실전에서 바로 쓸 수 있는 상태로 두되,
 * 사용자가 편집해 저장하면 별도 템플릿이 되고 프리셋은 그대로 남는다.
 *
 * 폰트는 언어별 폴백 체인(§5.6)을 문자열로 넣는다. 시스템에 없는 폰트는
 * 다음 후보로 넘어간다. 체인 끝을 `serif` 같은 총칭 키워드로만 두면 안 된다 —
 * 총칭 폰트가 해당 문자를 덮지 못하면 브라우저가 **글자마다** 다른 폰트로
 * 대체해 자간이 들쭉날쭉해진다. 그래서 총칭 앞에 실제로 존재하는 폰트를 둔다.
 */

import type { Anchor, Template, TemplateKind, TextStyle } from '../shared/types.ts';

const FONT_KO = '"Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
const FONT_EN = '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif';

/**
 * 한국어 **명조(바탕)** 계열 — 순서 표시처럼 굵고 큰 제목에 쓴다.
 *
 * 앞쪽은 굵은 바탕(설치돼 있으면), 그다음 맥·윈도우 기본 명조, 마지막에 총칭.
 * 총칭(serif)만 남기면 한글을 못 덮는 폰트로 대체돼 자간이 들쭉날쭉해진다
 * (헬라어에서 겪은 문제와 같은 원리 — PLAN 3.4 참고).
 */
const FONT_KO_SERIF =
  '"Noto Serif KR", "Noto Serif CJK KR", "BareunBatangOTFPro", "NanumMyeongjoExtraBold", ' +
  '"Nanum Myeongjo", "AppleMyungjo", "Batang", serif';
/**
 * 다음절 그리스어(Ἐ ῇ ἦ — U+1F00 대역)는 총칭 `serif` 로 두면 글자마다 대체가
 * 일어나 심하게 벌어진다. 실측: 같은 구절이 `serif` 819.6px vs Times 526.6px.
 *
 * 전용 폰트(SBL Greek 등)가 없는 PC 에서도 한 폰트로 그려지도록, 윈도우·맥에
 * 모두 있는 Times New Roman 을 총칭 앞에 둔다.
 */
const FONT_GRC =
  '"SBL Greek", "Cardo", "Gentium Plus", "Times New Roman", "Baskerville", serif';

/**
 * 예전 체인 — 총칭 `serif` 로만 끝나 글자별 대체가 일어났다.
 *
 * 프리셋을 고쳐도 이미 저장된 사본에는 옛 문자열이 굳어 있어, 저장소 초기화 때
 * **이 문자열과 정확히 같을 때만** 새 체인으로 바꾼다. 사용자가 직접 고른 폰트는
 * 문자열이 다르므로 건드리지 않는다.
 */


/**
 * 히브리어는 모음·악센트가 자음 위에 얹혀 폭이 늘지 않아 대체가 일어나도 티가
 * 덜 나지만(실측 비율 1.00), 같은 이유로 실제 폰트를 앞에 둔다.
 */
const FONT_HEB =
  '"SBL Hebrew", "Ezra SIL", "Taamey Frank CLM", "Arial Hebrew", "Times New Roman", serif';


/**
 * 예전 폰트 체인 — 총칭 `serif` 로만 끝나 글자별 대체가 일어났다.
 *
 * 프리셋을 고쳐도 이미 저장된 사본에는 옛 문자열이 굳어 있다. 저장소 초기화 때
 * **이 문자열과 정확히 같을 때만** 새 체인으로 바꾼다 — 사용자가 직접 고른 폰트는
 * 문자열이 다르므로 건드리지 않는다.
 */
export const LEGACY_FONT_CHAINS: ReadonlyArray<{ from: string; to: string }> = [
  { from: '"SBL Greek", "Cardo", "Gentium Plus", serif', to: FONT_GRC },
  { from: '"SBL Hebrew", "Ezra SIL", "Taamey Frank CLM", serif', to: FONT_HEB },
];

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
    id: -9,
    name: '순서 표시 — 명조 리듬',
    kind: 'order',
    anchor: 'bottom-center',
    safeArea: { left: 80, right: 80, bottom: 80 },
    layout: { align: 'left', gap: 8 },
    text: {
      // 명조(바탕) 계열. 굵은 바탕이 없는 PC 도 있으므로 체인을 두껍게 두고,
      // 총칭(serif) 앞에 어느 PC 에나 있는 이름을 둔다 (3.4 폰트 대체 교훈).
      primary: {
        fontFamily: FONT_KO_SERIF,
        fontSize: 120,
        fontWeight: 700,
        stroke: { width: 3, color: '#000000' },
      },
      secondary: {
        fontFamily: FONT_KO_SERIF,
        fontSize: 96,
        fontWeight: 700,
        stroke: { width: 3, color: '#000000' },
      },
    },
    behavior: {
      showVerseNumbers: false,
      showReference: 'none',
      showHeadings: false,
      showCredit: false,
      autoFit: true,
      // 글자마다 크기·높이를 달리해 붓글씨 같은 리듬을 준다 (둘은 따로 조절한다)
      titleRhythm: 0.18,
      titleRhythmY: 0.06,
    },
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

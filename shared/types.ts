/**
 * 서버와 클라이언트(컨트롤 패널 / 출력 페이지)가 공유하는 단일 타입 정의.
 * 이 파일이 유일한 계약이며, 어느 쪽도 자체 타입을 따로 만들지 않는다.
 */

// ─────────────────────────────────────────────────────────────
// 성경
// ─────────────────────────────────────────────────────────────

export type Testament = 'OT' | 'NT';

/** 역본 언어. 자유 문자열이 아니라 알려진 값 + 확장 가능한 형태로 둔다. */
export type LangCode = string; // 'ko' | 'en' | 'grc' | 'heb' | 'zh' | 'ja' | ...

export interface BookMeta {
  code: number; // 1..66
  nameKo: string;
  abbrKo: string;
  nameEn: string;
  abbrEn: string;
  /** 개신교 표준 장 수 (개역개정 기준). 화면 표기·탐색에 쓴다. */
  chapters: number;
  /**
   * 번들된 역본 중 최대 장 수. 참조 파싱 검증에 쓴다.
   * 요엘 4장(마소라), 다니엘 14장(공동번역 추가부)처럼 역본마다 장 구분이 다르다.
   */
  maxChapters: number;
  testament: Testament;
}

export interface Translation {
  id: string; // 'nkrv', 'niv', 'grk'
  name: string; // '개역개정'
  shortName: string; // '개정'
  lang: LangCode;
  direction: 'ltr' | 'rtl';
  /** 이 역본이 담고 있는 성경책 범위. 헬라어=신약만, 히브리어=구약만. */
  coverage: Testament[];
  sortOrder: number;
}

export interface Verse {
  book: number;
  chapter: number;
  verse: number;
  text: string;
}

/** 한 역본의 본문 블록. 다역본 표시는 이 블록을 여러 개 나열한다. */
export interface PassageBlock {
  translationId: string;
  translationName: string;
  lang: LangCode;
  direction: 'ltr' | 'rtl';
  verses: Verse[];
  /** 이 역본에 해당 본문이 없을 때(예: 헬라어로 창세기 조회) */
  unavailable?: boolean;
}

export interface Passage {
  /** 정규화된 참조 문자열 — '요한복음 3:16-17' */
  reference: string;
  referenceAbbr: string; // '요 3:16-17'
  referenceEn: string; // 'John 3:16-17'
  ranges: VerseRange[];
  blocks: PassageBlock[];
  heading?: string;
}

export interface PassageQuery {
  ranges: VerseRange[];
  /** 첫 번째가 주 역본, 나머지가 보조 역본 (표시 순서와 같다) */
  translationIds: string[];
  includeHeading?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 검색
// ─────────────────────────────────────────────────────────────

export interface SearchHit {
  translationId: string;
  book: number;
  chapter: number;
  verse: number;
  text: string;
  /** 사람이 읽는 참조 — '요 3:16' */
  reference: string;
}

export interface SearchResult {
  term: string;
  /** 실제로 쓴 검색 방식. 한국어는 부분일치, 그 외는 어절 검색 */
  strategy: 'like' | 'fts';
  total: number;
  truncated: boolean;
  hits: SearchHit[];
}

// ─────────────────────────────────────────────────────────────
// 참조 파싱
// ─────────────────────────────────────────────────────────────

export interface VerseRange {
  book: number;
  startChapter: number;
  /** null = 장 전체 */
  startVerse: number | null;
  endChapter: number;
  /** null = 장 끝까지 */
  endVerse: number | null;
}

export interface BookCandidate {
  code: number;
  nameKo: string;
  nameEn: string;
  /** 어떤 별칭에 걸렸는지 — UI에서 이유를 보여주기 위함 */
  matched: string;
}

export type ParseResult =
  | { ok: true; ranges: VerseRange[]; reference: string; referenceAbbr: string; referenceEn: string }
  | { ok: false; error: ParseErrorCode; message: string; candidates: BookCandidate[] };

export type ParseErrorCode =
  | 'EMPTY' // 입력이 비었음
  | 'BOOK_NOT_FOUND' // 책 이름을 못 찾음
  | 'BOOK_AMBIGUOUS' // 후보가 여럿
  | 'CHAPTER_REQUIRED' // 장 번호 필요
  | 'CHAPTER_OUT_OF_RANGE'
  | 'VERSE_INVALID'
  | 'RANGE_REVERSED' // 끝이 시작보다 앞
  | 'SYNTAX';

// ─────────────────────────────────────────────────────────────
// 찬양
// ─────────────────────────────────────────────────────────────

export type SectionKind = 'verse' | 'chorus' | 'prechorus' | 'bridge' | 'tag' | 'ending' | 'intro';

export interface SongLine {
  lineIndex: number;
  lang: LangCode;
  text: string;
}

export interface SongSection {
  id: number;
  kind: SectionKind;
  label: string; // '1절', '후렴', 'Bridge'
  position: number;
  lines: SongLine[];
}

/**
 * 곡집(시리즈). 새찬송가·통일찬송가·많은물소리·찬미2000·기타 …
 *
 * 시리즈를 컬럼이 아니라 **행**으로 다룬다. 컬럼으로 두면 시리즈가 늘 때마다
 * 스키마를 고쳐야 하고, 한 곡이 여러 시리즈에 실린 경우를 표현할 수 없다.
 */
export interface Songbook {
  id: string;
  name: string;
  /** 바로가기 버튼에 넣을 대표 한 글자 — '새' '통' '물' '기' */
  shortLabel: string;
  /** 번호 체계가 있는지. '기타' 곡집은 false 라 번호 없이 넣을 수 있다. */
  numbered: boolean;
  sortOrder: number;
  /** 내장 곡집(찬송가·기타)은 지울 수 없다 */
  isBuiltin: boolean;
  /** 1~4 — 바로가기 버튼 위치. 없으면 드롭다운에서만 고른다. */
  quickSlot?: number;
  sourceNote?: string;
  importedAt?: string;
  songCount: number;
}

/** 곡이 어느 곡집 몇 번으로 실렸는지 */
export interface SongEntry {
  songbookId: string;
  songbookName: string;
  songbookShortLabel: string;
  /** 번호 없는 수록곡('기타' 등)은 undefined */
  number?: number;
}

/** 가사가 다른 대응곡 (새찬송가 305장 ↔ 통일찬송가 405장) */
export interface SongLink {
  id: number;
  title: string;
  entries: SongEntry[];
}

export interface Song {
  id: number;
  title: string;
  titleAlt?: string;
  author?: string;
  composer?: string;
  copyright?: string;
  ccliNumber?: string;
  tags: string[];
  /** 이 곡이 실제로 보유한 언어 목록 */
  langs: LangCode[];
  sections: SongSection[];
  defaultTemplateId?: number;

  /** 수록 곡집·번호 (여러 곡집에 실릴 수 있다) */
  entries: SongEntry[];
  /** 가사가 다른 대응곡 — 판본이 달라 별도 곡이지만 서로 참조한다 */
  links?: SongLink[];
  /** '아멘'으로 끝나는 곡 — 별도 절로 만들지 않고 속성으로 둔다 */
  hasAmen?: boolean;
  /** 가져오기 재실행 범위를 잡는 데 쓴다 */
  source?: string;
  /**
   * 즐겨찾기 여부.
   *
   * 사용 기록(자주 쓴 곡)과 다르다 — 예배마다 반드시 쓰는 송영·봉헌송처럼
   * 사람이 직접 지정한 곡이라야 목록이 흔들리지 않는다.
   */
  isFavorite?: boolean;
  /** 줄나눔을 사람이 확인한 곡 — 자동 갱신 대상에서 빠진다 */
  confirmed?: boolean;
}

export interface SongArrangement {
  id: number;
  songId: number;
  name: string;
  /** 섹션 id 순서 — 예: 1절, 후렴, 2절, 후렴 */
  sequence: number[];
}

export interface SongSearchHit {
  id: number;
  title: string;
  titleAlt?: string;
  entries: SongEntry[];
  langs: LangCode[];
  sectionCount: number;
  /** 검색어가 걸린 위치 — UI 가 이유를 보여줄 수 있게 */
  matchedOn: 'number' | 'title' | 'lyrics';
  /** 가사에 걸린 경우 그 대목 */
  snippet?: string;
  /**
   * 사람이 줄나눔을 확인·수정한 곡인지 (`lines_source` 가 모두 `manual`).
   *
   * 목록에 드러내는 이유는 **내 작업이 자동 갱신에 지워지지 않는다는 것을 눈으로
   * 확인할 수 있어야** 하기 때문이다. 표시가 없으면 승인했는지 알 수 없고,
   * 알 수 없으면 매번 다시 확인하게 된다.
   */
  confirmed?: boolean;
}

/**
 * 줄나눔 검토 대기열의 한 항목.
 *
 * `confirmed` 는 그 곡의 모든 섹션이 `lines_source = 'manual'` 인지를 뜻한다 —
 * 즉 사람이 확인해 자동 작업에서 제외된 상태다.
 */
export interface ReviewItem {
  id: number;
  title: string;
  /** '새305' 같은 짧은 수록 표기 (번호 없는 곡은 빈 문자열) */
  reference: string;
  confirmed: boolean;
  sectionCount: number;
  lineCount: number;
  /**
   * 초안을 신뢰하기 어려운 곡인지.
   *
   * 두 경우다 — **절이 하나뿐**이라 절 간 정렬을 못 해 원본 줄나눔이 그대로
   * 남은 곡, 또는 **홀수 행**이 남아 2줄씩 표시에서 고아 줄이 생기는 곡.
   * 이 곡들을 먼저 보면 검토가 효율적이다.
   */
  needsAttention: boolean;
  /** 왜 손봐야 하는지 (없으면 빈 배열) */
  attentionReasons: string[];
  useCount: number;
}

export interface ReviewQueue {
  total: number;
  confirmed: number;
  items: ReviewItem[];
}

export interface SongSearchResult {
  /** 통합 검색인지, 특정 곡집 목록인지 */
  scope: 'all' | 'songbook';
  songbookId?: string;
  query: string;
  total: number;
  truncated: boolean;
  hits: SongSearchHit[];
}

// ─────────────────────────────────────────────────────────────
// 템플릿 / 스타일
// ─────────────────────────────────────────────────────────────

export type TemplateKind = 'bible' | 'song' | 'lower_third' | 'blank' | 'order';

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'mid-left' | 'center' | 'mid-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface TextStyle {
  fontFamily: string;
  fontSize: number; // px @1080p
  fontWeight: number; // 100..900
  lineHeight: number; // 배수
  letterSpacing: number; // px
  color: string;
  opacity: number;
  stroke: { width: number; color: string } | null;
  shadow: { x: number; y: number; blur: number; color: string } | null;
  bgBox: { color: string; paddingX: number; paddingY: number; radius: number } | null;
  italic: boolean;
  textTransform: 'none' | 'uppercase';
  wordBreak: 'normal' | 'keep-all';
}

/**
 * 캔버스 배경.
 *
 * `image`·`video` 는 카메라 영상이 없을 때 쓴다 — 그림이나 반복 동영상을 깔고
 * 그 위에 자막을 얹는다. `src` 는 **파일 이름만** 담는다(`data/backgrounds/` 안).
 * 경로를 담으면 상위 폴더를 가리킬 수 있어 서버가 거부한다.
 *
 * 배경 파일은 데이터 이전(백업)에 담기지 않는다 — 동영상이 수백 MB 라
 * 이전 파일을 못 쓸 만큼 키운다(2026-08-15 사용자 결정). 이름만 남으므로
 * 다른 PC 에서는 파일을 따로 옮겨야 한다.
 */
export type CanvasBackground =
  | { mode: 'transparent' }
  | { mode: 'color'; color: string; opacity: number }
  | { mode: 'chroma'; color: string }
  | { mode: 'image'; src: string; fit?: BackgroundFit; opacity?: number }
  | { mode: 'video'; src: string; fit?: BackgroundFit; opacity?: number };

/** 화면을 채울지(잘림), 다 보이게 넣을지(여백) */
export type BackgroundFit = 'cover' | 'contain';

export interface TemplateCanvas {
  width: number;
  height: number;
  background: CanvasBackground;
  safeArea: { top: number; right: number; bottom: number; left: number };
}

export interface TemplateLayout {
  anchor: Anchor;
  offsetX: number;
  offsetY: number;
  width: number | 'auto';
  maxHeight: number | 'auto';
  align: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** 다역본/다언어 블록 배치 방향 */
  direction: 'column' | 'row';
  gap: number;
}

export type TextRole = 'primary' | 'secondary' | 'verseNum' | 'reference' | 'heading' | 'credit';

export interface TemplateBehavior {
  autoFit: boolean;
  autoFitMinScale: number;
  maxLinesPerSlide: number | 'auto';
  /**
   * 표시 한 행에 담을 최대 글자 수 (기본 24).
   *
   * 가사는 **악보의 운율 행 단위로 저장**하고(새256 = 9.9.9.9), 표시할 때 이 폭에
   * 맞춰 인접 행을 짝으로 묶는다. 하단 두 줄 템플릿은 24자로 4행을 2행으로 묶고,
   * 전체화면 큰 글씨 템플릿은 값을 낮춰 4행 그대로 쓴다.
   *
   * 저장을 세밀하게 두는 이유는 되돌릴 수 없기 때문이다 — 긴 행으로 저장하면
   * 다시 쪼갤 안전한 방법이 없지만, 짧은 행은 언제든 묶을 수 있다.
   */
  maxCharsPerLine?: number;
  /**
   * 순서 표시 제목의 **리듬** — 글자마다 크기와 높이를 달리해 붓글씨처럼 보이게 한다.
   *
   * 값은 흔들리는 폭이다. `0` 이면 끄고(모든 글자가 같은 크기), `0.18` 이 기본,
   * `0.35` 면 꽤 과장된다. 파도 모양의 **정해진 규칙**으로 계산하므로 같은 글자는
   * 언제나 같은 모양이다 — 무작위로 두면 새로고침할 때마다 화면이 달라진다.
   */
  titleRhythm?: number;
  /**
   * 순서 표시 제목의 **높낮이** 흔들림 — 작아진 글자를 얼마나 내릴지.
   *
   * 크기(`titleRhythm`)와 **따로** 둔다. 크기만 흔들고 아랫선은 가지런히 두거나,
   * 반대로 크기는 그대로 두고 높낮이만 흔드는 배치가 각각 쓸모가 있기 때문이다.
   * 값은 글자 크기에 대한 비율(em)이고 `0` 이면 아랫선이 가지런해진다.
   */
  titleRhythmY?: number;
  transition: { type: 'none' | 'fade' | 'slide-up'; durationMs: number };
  showVerseNumbers: boolean;
  showReference: 'none' | 'top' | 'bottom' | 'inline';
  referenceFormat: 'full' | 'abbr' | 'en';
  showHeadings: boolean;
  showCredit: boolean;
}

export interface Template {
  id: number;
  name: string;
  kind: TemplateKind;
  canvas: TemplateCanvas;
  layout: TemplateLayout;
  text: Record<TextRole, TextStyle>;
  overridesByTranslation?: Record<string, Partial<TextStyle>>;
  overridesByLang?: Record<LangCode, Partial<TextStyle>>;
  behavior: TemplateBehavior;
  isBuiltin?: boolean;
}

// ─────────────────────────────────────────────────────────────
// 예배 순서 (큐)
// ─────────────────────────────────────────────────────────────

/** 예배 순서의 한 항목. id 는 목록 재배치·삭제에 필요한 안정적인 키다. */
export type CueItem =
  | {
      id: string;
      type: 'bible';
      ref: string;
      primary: string;
      secondary: string[];
      paging?: string;
      templateId?: number;
      note?: string;
    }
  | {
      id: string;
      type: 'song';
      songId: number;
      /** 표시용 — 곡이 삭제돼도 순서표에 무엇이었는지 남는다 */
      songTitle: string;
      langs: LangCode[];
      lines?: string;
      templateId?: number;
      note?: string;
    }
  | {
      id: string;
      type: 'text';
      content: string;
      /**
       * 용도 구분 — 아이콘과 기본 템플릿만 달라진다. 저장 구조는 같다.
       * 없으면 'notice'(광고)로 본다 — 기존 순서표의 하위 호환.
       *
       * - `notice` 광고 · `quote` 설교 중 인용구
       * - `order`  **순서 표시** — 대표기도·주기도문·사도신경·설교 제목·설교자·
       *   축도처럼 '지금 무슨 순서인지'를 화면에 띄우는 항목.
       *   첫 줄이 순서 이름, 다음 줄부터가 부가 설명(설교자 이름 등)이다.
       */
      variant?: 'notice' | 'quote' | 'order';
      /**
       * 순서 표시의 배치 (variant 가 'order' 일 때만 쓴다).
       *
       * - `split`(기본) 왼쪽 순서 이름 · 오른쪽 담당자 + 밑줄
       * - `stack`        줄을 그대로 쌓아 올린다 (템플릿 정렬을 따름)
       */
      layout?: 'split' | 'stack';
      /**
       * 순서 이름의 **글자별 수동 조정** (variant 가 'order' 일 때만).
       * 슬라이더로 만진 글자만 값이 차고, 나머지는 자동 리듬을 따른다.
       */
      charStyles?: OrderCharStyle[];
      templateId?: number;
      note?: string;
    }
  | { id: string; type: 'blank'; note?: string }
  /**
   * 그룹 머리글 — '예배 부름 / 찬양 / 말씀 / 광고' 처럼 순서를 구획한다.
   *
   * **슬라이드를 만들지 않는다.** 덱에 들어가지 않으므로 항목 경계(groups)의
   * 인덱스에도 영향을 주지 않아야 한다 (lib/plan-deck.ts 참고).
   */
  | {
      id: string;
      type: 'divider';
      label: string;
      /**
       * **예배 전 안내** — 이 구분부터 다음 구분 전까지를 자동으로 넘긴다.
       *
       * 예배가 시작되면 자동이 돌면 안 되므로, 사람이 다른 것을 송출하거나
       * 정지를 누르면 곧바로 멈춘다. 켜져 있다고 저절로 시작되지도 않는다 —
       * 구분 행의 ▶ 를 눌러야 시작한다.
       */
      auto?: { holdMs: number; loop: boolean };
    };

/** 예배 전 안내 자동 진행 기본값 (2026-08-15 사용자 결정) */
export const AUTO_HOLD_MS_DEFAULT = 8000;
export const AUTO_HOLD_MS_MIN = 1000;
export const AUTO_HOLD_MS_MAX = 600000;

/**
 * 순서표의 성격.
 *
 * - `template` **예배 유형** — 주일예배·수요예배·새벽기도회·부흥회처럼 매주 고쳐 쓰는 원본
 * - `plan`     **저장된 순서** — 특정 회차를 남겨 둔 것 (지난주 순서를 다시 열 때)
 *
 * 두 성격이 저장 구조가 같아 한 테이블에 둔다. 유형에서 시작해 고친 뒤,
 * 그대로 다음에도 쓰려면 '템플릿 업데이트', 이번 회차만 남기려면 '순서 저장하기'.
 */
export type PlanKind = 'template' | 'plan';

export interface ServicePlan {
  id: number;
  name: string;
  serviceDate?: string; // ISO date
  items: CueItem[];
  updatedAt?: string;
  /** 없으면 'plan' 으로 본다 — 유형 개념 도입 전 순서표의 하위 호환 */
  kind?: PlanKind;
}

// ─────────────────────────────────────────────────────────────
// 송출 상태 (Live State)
// ─────────────────────────────────────────────────────────────

/**
 * 순서 표시 제목의 **글자 하나**에 대한 수동 조정.
 *
 * 값이 없으면 그 글자는 자동 리듬을 따른다. 사람이 슬라이더로 만진 글자만 채워진다.
 * 색인은 제목에서 **공백을 뺀** 글자 순서다 — '예배 부름' 을 '예배부름' 으로 고쳐도
 * 조정이 그대로 따라간다.
 */
export interface OrderCharStyle {
  /** 크기 배수 (1 = 기준) */
  size?: number;
  /** 내림 폭(em). 양수면 아래로 */
  dy?: number;
}

export type SlidePayload =
  | {
      kind: 'bible';
      reference: string;
      blocks: PassageBlock[];
      heading?: string;
    }
  | {
      kind: 'song';
      title: string;
      sectionLabel: string;
      /** 줄 배열. 각 줄은 언어별 텍스트 페어 묶음. */
      lines: SongLine[][];
      credit?: string;
    }
  | { kind: 'text'; lines: string[] }
  /**
   * 순서 표시 — **왼쪽에 순서 이름, 오른쪽에 담당자**를 한 줄로 놓고 담당자 아래에 밑줄.
   *
   * `text` 로 두지 않는 이유는 두 값의 **자리가 다르기 때문**이다. 줄 배열로는
   * "이건 왼쪽, 저건 오른쪽"을 표현할 수 없어 출력 페이지가 알 방법이 없다.
   */
  | { kind: 'order'; title: string; presenter?: string; charStyles?: OrderCharStyle[] }
  | { kind: 'blank' };

export interface LiveState {
  slide: SlidePayload | null;
  blank: boolean;
  templateId: number;
  /** 단조 증가. 출력 페이지는 자기가 아는 값보다 작은 메시지를 버린다. */
  revision: number;
  cursor: { planItemIndex: number; slideIndex: number } | null;
}

/**
 * 현재 로드된 슬라이드 묶음. **컨트롤 패널에만** 보낸다.
 * 출력 페이지는 현재 슬라이드 하나만 알면 되므로, 장 전체(150절 이상)를
 * OBS 브라우저 소스로 매번 보내지 않는다.
 */
/**
 * 덱 안의 항목 경계. 예배 순서를 불러오면 여러 항목이 하나의 평평한 덱으로 합쳐지고,
 * 이 경계로 PgUp/PgDn 항목 단위 점프를 한다.
 */
export interface DeckGroup {
  label: string;
  startIndex: number;
  /**
   * 이 항목에 지정된 템플릿. 덱을 진행하다 이 경계를 넘으면 서버가 바꿔 적용한다.
   *
   * 없으면 **바꾸지 않는다** — 직전 템플릿을 그대로 쓴다. 지정하지 않은 항목에서
   * 기본값으로 되돌리면, 앞 항목에서 고른 템플릿이 예고 없이 풀려 더 놀랍다.
   */
  templateId?: number;
}

export interface Deck {
  /** 이 묶음의 출처 — '요 3:16-17' 또는 예배 순서 이름 */
  reference: string;
  slides: SlidePayload[];
  /** 슬라이드별 짧은 라벨 ('3:16-17') */
  labels: string[];
  index: number;
  /** 예배 순서로 만든 덱일 때의 항목 경계 */
  groups?: DeckGroup[];
}

// ─────────────────────────────────────────────────────────────
// WebSocket 메시지
// ─────────────────────────────────────────────────────────────

export type ServerMsg =
  /** 접속 직후 전체 스냅샷. 새로고침 후 즉시 복구되는 근거. */
  | { t: 'state'; payload: LiveState }
  | { t: 'state:patch'; payload: Partial<LiveState>; revision: number }
  /** 컨트롤 패널 전용 */
  | { t: 'deck'; payload: Deck | null }
  /** 접속 수가 바뀔 때 컨트롤 패널에 알린다 (폴링 대신 푸시) */
  | { t: 'connections'; payload: { control: number; output: number } }
  | { t: 'template'; payload: Template }
  | { t: 'style:patch'; payload: Record<string, string> }
  /** 출력 페이지에서 올라온 오류를 컨트롤 패널에 알린다 */
  | { t: 'output:error'; payload: { message: string; url: string } }
  /**
   * 접속한 출력 페이지가 **옛 판**이라 새로고침이 필요하다는 알림.
   * 새 슬라이드 종류를 못 그려 '아무 일도 안 일어나는' 상태를 미리 잡아 준다.
   */
  | { t: 'output:stale'; payload: { layer: string } }
  | { t: 'error'; message: string };

export type ClientRole = 'control' | 'output';

export type ClientMsg =
  /**
   * `loadedAt` 은 출력 페이지가 **자기가 로드된 시각**(Date.now())을 알리는 값이다.
   * 서버가 출력 파일 수정 시각과 비교해 '옛 판이니 새로고침하라'를 컨트롤 패널에 띄운다.
   */
  | { t: 'hello'; role: ClientRole; layer?: string; loadedAt?: number }
  | { t: 'show'; payload: SlidePayload }
  /** 슬라이드 묶음을 올린다 (본문 조회 결과) */
  | { t: 'deck:load'; payload: Deck }
  | { t: 'next' }
  | { t: 'prev' }
  | { t: 'goto'; index: number }
  /** 예배 순서 항목 단위 이동 (PgDn/PgUp) */
  | { t: 'group:next' }
  | { t: 'group:prev' }
  | { t: 'blank'; on: boolean }
  | { t: 'restore' }
  | { t: 'clear' }
  | { t: 'template:set'; id: number }
  | { t: 'style:set'; patch: Record<string, unknown> }
  | { t: 'measure:report'; payload: { overflow: boolean; height: number; revision: number } }
  | { t: 'client:error'; payload: { message: string; stack?: string; url: string } };

// ─────────────────────────────────────────────────────────────
// API 공통 응답 형식 (~/.claude/rules/common/patterns.md)
// ─────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

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
  /**
   * 이 줄나눔이 어디서 왔나 — **화면에서 줄을 묶을지 정하는 데 쓴다.**
   *
   * 찬송가는 짧은 운율 행(`나 같은 죄인 살리신` 8자)으로 저장돼 있어 한 줄씩 띄우면
   * 화면이 텅 빈다. 그래서 이웃 두 줄을 묶어 그린다.
   *
   * 그러나 **사람이 앱에서 직접 친 줄(`manual`)은 묶지 않는다.** 친 줄 자체가 의도이고,
   * 편집 칸도 '줄바꿈이 그대로 화면 줄이 됩니다' 라고 약속한다. 묶으면 그 약속이 깨진다
   * (2026-09-01 실제로 12줄이 6덩이가 되어 나갔다).
   */
  linesSource?: LinesSource;
}

/** 줄나눔 출처. `server/db/songs.ts` 의 `LinesSource` 와 같은 값이다 */
export type LinesSource = 'auto' | 'manual' | 'imported';

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

/**
 * 가사 한 슬라이드에 대응하는 **악보 조각**.
 *
 * 그림은 한 장(곡 전체)이고 `crop` 이 그중 어느 단인지를 가리킨다 — 슬라이드마다
 * 파일을 따로 만들지 않는다.
 */
export interface SheetRef {
  /** 출력 페이지가 그대로 쓰는 주소 (`/sheets/chanmi2000/0305.webp`) */
  src: string;
  /** 원본의 세로 몇 %부터 몇 %까지 (0~100) — `image` 슬라이드의 `crop` 과 같은 규격 */
  crop: { top: number; bottom: number };
  /**
   * 배분이 흔들릴 수 있는 곡인가.
   *
   * 줄 수와 단 수가 어긋나면(전체의 26%) 어느 단인지 짐작이 틀릴 수 있다.
   * 화면에는 영향을 주지 않고 **조작 화면이 알려 주는 데** 쓴다.
   */
  uncertain?: boolean;
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

export type TemplateKind = 'bible' | 'song' | 'lower_third' | 'blank' | 'order' | 'reading';

export type Anchor =
  | 'top-left' | 'top-center' | 'top-right'
  | 'mid-left' | 'center' | 'mid-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

export interface TextStyle {
  fontFamily: string;
  fontSize: number; // px @1080p
  fontWeight: number; // 100..900
  lineHeight: number; // 배수
  /**
   * **절대 행간(leading)** — 글자 크기와 무관하게 고정되는 여백(px).
   *
   * 지정하면 `lineHeight`(배수) 대신 `calc(1em + Npx)` 로 나간다. 그래서 글자를 키워도
   * **줄 사이 여백이 그대로**다 (2026-08-18 사용자 요청: "행간을 글자크기의 상대 비율이
   * 아니라 절대 고정으로").
   *
   * 배수(1.4)로 두면 글자를 84 → 110px 로 키울 때 여백도 34 → 44px 로 벌어져
   * 화면이 헐거워진다. 반대로 `line-height` 를 px 로 고정하면 글자가 커질 때 겹친다.
   * `1em + Npx` 는 글자 상자는 글자를 따라가고 **여백만** 고정이라 겹치지 않는다.
   *
   * **`null` 은 '쓰지 않는다'** 는 뜻이다. `undefined` 로 두면 안 되는 이유:
   * 템플릿 저장은 초안을 통째로 PUT 하고 서버가 얕게 병합하는데(`mergeTemplate`),
   * `JSON.stringify` 가 `undefined` 키를 **지워 버려** 서버에는 그 필드가 아예 오지
   * 않는다. 그러면 옛 값이 그대로 남아 **화면에서 끌 수 없다.**
   */
  lineGapPx?: number | null;
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
 * `image` 는 카메라 영상이 없을 때 쓴다 — 그림을 깔고 그 위에 자막을 얹는다.
 * **반복 동영상은 OBS 미디어 소스가 한다** (2026-08-18, D-B 결정). `src` 는 **파일 이름만** 담는다(`data/backgrounds/` 안).
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
  | { mode: 'image'; src: string; fit?: BackgroundFit; opacity?: number };

/** 화면을 채울지(잘림), 다 보이게 넣을지(여백) */
export type BackgroundFit = 'cover' | 'contain';

/**
 * **항목이 직접 지정하는 배경 그림** — 그 항목에서만 템플릿 배경을 덮는다.
 *
 * 템플릿 배경(`canvas.background`)과 다르다. 배경을 템플릿에 두면 배경을 바꿀 때마다
 * 템플릿을 새로 만들어야 한다. 교독문·주기도문·사도신경처럼 **배경을 늘 깔지만 글은
 * 같은 스타일로 나가는** 순서에는 항목 쪽에 두는 것이 맞다 (2026-08-18 사용자 요구).
 *
 * `src` 는 **파일 이름만** 담고, 어느 폴더인지는 `source` 가 말한다. 출력 페이지가
 * 정해진 표로 주소를 만들므로 순서표에 담긴 값이 폴더 밖을 가리킬 수 없다.
 */
/**
 * 회중이 함께 읽는 순서(교독문·주기도문·사도신경)의 **표시 설정**.
 *
 * 이 순서들은 화면을 글자로 채우고 회중이 멀리서 따라 읽는다. 예배당 크기·좌석 거리가
 * 교회마다 다르므로 **그 자리에서 조절**할 수 있어야 한다 (2026-08-18 사용자 요청).
 *
 * 템플릿에 두지 않고 항목에 둔 이유: 같은 예배 안에서도 교독문은 크게, 사도신경은
 * 작게 두고 싶을 수 있다. 템플릿이면 그때마다 템플릿을 새로 만들어야 한다.
 * 지정하지 않으면 템플릿 값을 그대로 쓴다.
 */
/**
 * 항목이 정하는 **글자 모양** — 폰트와 크기.
 *
 * 처음에는 교독문·전례문 전용이라 `ReadingStyle` 이었는데, 성경·찬양도 폰트를 항목에서
 * 고르게 되어(요청 5) 이름을 고쳤다. 쓰는 곳이 넷이면 이름이 하나를 가리켜서는 안 된다.
 *
 * **크기(`scale`)는 교독문·전례문에서만 화면에 노출한다.** 성경·찬양은 본문 길이가
 * 매번 달라 자동 축소가 개입하므로, 크기를 항목마다 주면 무엇이 이겼는지 알기 어렵다.
 */
export interface ItemTextStyle {
  /** `sans` 고딕 · `serif` 명조. 없으면 템플릿 폰트 */
  font?: 'sans' | 'serif';
  /**
   * 글자 크기 배수. 템플릿 크기에 곱한다.
   * 행간은 **따라 커지지 않는다** (`TextStyle.lineGapPx` 참고).
   */
  scale?: number;
}

/**
 * 항목이 정하는 **표시 여부** — 모양이 아니라 켜고 끄기다.
 *
 * 세 값 모두 세 갈래다: `undefined`(템플릿 따름) · `true` · `false`.
 * `false` 를 기본값으로 두면 이미 저장된 순서표가 모두 '끔' 이 되어 다음 예배에
 * 소제목·절 번호가 사라진다. 지정하지 않은 것은 지금까지와 똑같이 동작해야 한다.
 *
 * 크기·색·테두리 같은 **모양은 템플릿**에 남는다 (`text.reference` 등).
 */
export interface ItemDisplay {
  /** 참조 표기 (`요 3:16`). 켜면 템플릿이 정한 자리에 놓는다 */
  reference?: boolean;
  /** 소제목 (성경 본문의 단락 제목) */
  headings?: boolean;
  /** 절 번호 */
  verseNumbers?: boolean;
}

export interface ItemBackground {
  /** 파일 이름만 (경로 구분자가 들어오면 서버가 거른다) */
  src: string;
  /** `library` = 사용자 폴더(읽기 전용) · `data` = 앱이 관리하는 배경 폴더 */
  source: 'library' | 'data';
  /** 기본 `cover` — 배경은 화면을 채워야 글자 뒤에 빈 자리가 생기지 않는다 */
  fit?: BackgroundFit;
}

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
  /**
   * 순서 표시 **담당자(오른쪽) 글자 크기 배수의 기본값**.
   *
   * 보조 텍스트 크기에 곱한다. 항목에서 따로 지정하면 그 값이 이긴다.
   * 템플릿에 두는 이유는, 담당자를 제목보다 얼마나 작게 둘지가 대개
   * 화면 전체의 성격이지 항목마다 다른 값이 아니기 때문이다.
   */
  presenterScale?: number;
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
  /**
   * 프리셋인데 **사용자가 덮어쓴** 상태.
   *
   * `isBuiltin` 은 그대로 참이다 — 목록에서 프리셋 자리를 지킨다. 이 값이 있으면
   * '원본 불러오기' 로 코드의 값으로 되돌릴 수 있다. 표시하지 않으면 어느 줄이 원본과
   * 다른지 모르고, 되돌릴 생각도 못 한다.
   */
  isOverridden?: boolean;
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
      /**
       * **인용구** 로 넣은 절.
       *
       * 설교 중 잠깐 띄우고 `↩ 직전으로` 돌아오는 절이다 (2026-08-20 사용자 요청으로
       * '인용구' 가 자유 글자에서 성경 절로 바뀌었다 — 광고와 기능이 겹쳤다).
       *
       * 성경 항목과 저장 구조를 같게 둔 이유: 역본·표시 설정·글꼴이 **그대로** 쓰이고,
       * 본문은 언제나 DB 가 원본이다. 자유 글자로 담으면 역본을 바꿀 수 없고 본문이
       * 순서표에 복사된다.
       *
       * 이 표시가 하는 일은 둘뿐이다 — 💬 아이콘, 그리고 `↩ 직전으로`.
       * 그리고 **제목 슬라이드를 띄우지 않는다** ('타이틀 없이' 가 요청이었다).
       */
      quote?: true;
      /**
       * 목록 줄에 보일 본문 — `창 1:1 태초에 하나님이 천지를 창조하시니라`.
       *
       * 컨트롤 패널은 **펼친 항목 하나만** 본문을 조회하므로(`resolveItem`), 낱개로
       * 흩어진 절의 본문을 조회 없이 그리려면 항목이 담고 있어야 한다
       * (`songTitle` 을 담는 것과 같은 이유).
       *
       * **라벨일 뿐이다.** 화면에 나가는 본문은 언제나 DB 에서 다시 읽으므로, 잘려
       * 있어도 되고 없어도 된다 (없으면 참조만 보인다).
       */
      preview?: string;
      /** 참조 표기·소제목·절 번호를 이 항목에서만 켜고 끈다 */
      display?: ItemDisplay;
      /** 폰트(고딕/명조). 크기는 자동 축소와 겹쳐 항목에서 정하지 않는다 */
      style?: ItemTextStyle;
      templateId?: number;
      note?: string;
    }
  | {
      id: string;
      type: 'song';
      songId: number;
      /** 표시용 — 곡이 삭제돼도 순서표에 무엇이었는지 남는다 */
      songTitle: string;
      /**
       * 곡집·번호 표기 (`새찬송가 1장`) — **제목 슬라이드에 쓴다.**
       *
       * `songTitle` 과 같은 이유로 항목에 담는다: 예배 중 DB 조회가 실패해도 제목이
       * 떠야 한다. 옛 순서표에는 없으므로 그때는 제목만 띄운다.
       */
      songLabel?: string;
      langs: LangCode[];
      lines?: string;
      /**
       * 절 번호·저작권 표기를 이 항목에서만 켜고 끈다.
       *
       * 찬양 슬라이드에는 **참조 표기와 소제목이 없다** (`renderSong` 이 비운다).
       * 그래서 `reference`·`headings` 는 찬양에서 아무 일도 하지 않는다.
       */
      display?: ItemDisplay;
      /** 폰트(고딕/명조) */
      style?: ItemTextStyle;
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
      /**
       * 담당자(오른쪽) 글자 크기 배수 — `1` 이면 템플릿의 보조 텍스트 크기 그대로.
       * 이름이 길어 한 줄에 안 들어갈 때 이 항목만 줄일 수 있어야 한다.
       */
      presenterScale?: number;
      /**
       * 외곽선 두께(px) — 지정하면 템플릿 값 대신 이 값을 쓴다.
       * `0` 은 '테두리 없음' 이라는 뜻이므로 지정으로 친다(undefined 와 다르다).
       */
      titleStroke?: number;
      presenterStroke?: number;
      templateId?: number;
      note?: string;
    }
  /**
   * 주기도문·사도신경 — 회중이 함께 읽는 고정 본문.
   *
   * **본문을 담지 않고 어느 것인지만 담는다.** 실제 글은 `lib/liturgy-texts.ts` 에서
   * 온다. 찬양이 가사 대신 `songId` 를 담는 것과 같은 이유로, 판본 바꾸기가 한 글자로
   * 끝나고 오탈자를 고치면 지난 순서표까지 함께 고쳐진다.
   */
  | {
      id: string;
      type: 'liturgy';
      /** `lib/liturgy-texts.ts` 의 LiturgyId */
      textId: string;
      /** 'new'(새번역, 기본) | 'traditional'(전통) */
      version: 'new' | 'traditional';
      /** 한 장에 몇 줄 — `0` 은 전체를 한 장에. 없으면 기본 4줄 */
      perSlide?: 0 | 2 | 4 | 6;
      /**
       * 직접 고친 본문 — 교회 판본이 내장본과 다를 때만 찬다.
       * 있으면 **이것이 이긴다.** 찬양의 '승인'과 같은 원칙이다.
       */
      overrideLines?: string[];
      /** 이 항목에만 깔 배경 그림 (템플릿 배경을 덮는다) */
      background?: ItemBackground;
      /** 폰트·글자 크기 (없으면 템플릿 값) */
      style?: ItemTextStyle;
      templateId?: number;
      note?: string;
    }
  /**
   * 교독문 — 인도자와 회중이 번갈아 읽는다.
   *
   * **본문을 담지 않고 번호만 담는다.** 글은 `responsive_readings` 테이블에서 온다
   * (찬양이 `songId` 를 담는 것과 같다). 제목은 표시용으로만 함께 둔다 —
   * 가져오기를 안 한 PC 에서도 순서표에 무엇이었는지 남는다.
   */
  | {
      id: string;
      type: 'reading';
      /**
       * 어느 찬송가의 교독문인지. **없으면 통일찬송가용**(`hymn_old`).
       *
       * 두 찬송가의 교독문은 번호가 같아도 다른 글이다 (통일 76편 · 새 137편).
       * 없을 때 통일로 보는 이유: 새찬송가 교독문을 넣을 길이 생긴 것은 나중이라
       * 이미 저장된 순서표는 모두 통일 것을 가리킨다.
       */
      readingBook?: 'hymn_old' | 'hymn_new';
      /** 교독문 번호 (통일 1~76 · 새 1~137) */
      readingNumber: number;
      /** 표시용 — DB 에 없어도 순서표에 무엇이었는지 남는다 */
      readingTitle?: string;
      /** 이 항목에만 깔 배경 그림 (템플릿 배경을 덮는다) */
      background?: ItemBackground;
      /** 폰트·글자 크기 (없으면 템플릿 값) */
      style?: ItemTextStyle;
      templateId?: number;
      note?: string;
    }
  | { id: string; type: 'blank'; note?: string }
  /**
   * **슬라이드쇼** — 폴더 하나를 가리키면 그 안의 그림이 이름순으로 슬라이드가 된다.
   *
   * 예배 전에 띄워 둘 안내다. **한 장이면 그대로 걸어 두는 썸네일**, 여러 장이면
   * 구분 행의 자동 넘김(`auto`)이 순환한다 — 순환 장치를 새로 만들지 않는다.
   *
   * 폴더를 항목에 담고 **그림 이름은 담지 않는다.** 담아 두면 나중에 폴더에 파일을
   * 더 넣어도 순서표를 고쳐야 한다. 폴더에 넣기만 하면 되는 것이 이 기능의 요점이다.
   */
  | {
      id: string;
      type: 'slideshow';
      /** `library` = 사용자 폴더(읽기 전용) · `data` = 앱이 관리하는 배경 폴더 */
      source: 'library' | 'data';
      /** 그 폴더 아래의 하위 폴더 이름. 비우면 폴더 바로 밑 */
      folder: string;
      /** 기본 `contain` — 안내문은 잘리면 읽을 수 없다 */
      fit?: BackgroundFit;
      label?: string;
    }
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

/**
 * 순서표 하나에 걸리는 **기본 설정**.
 *
 * 한 예배 안에서는 성경·찬양의 템플릿과 역본이 대개 그대로 간다. 그런데 항목마다
 * 다시 고르게 하면 매번 같은 클릭을 반복하게 되고, 하나 빠뜨리면 그 항목만
 * 다른 모양으로 나간다. 그래서 **여기서 한 번 정하고 항목은 예외만** 지정한다.
 *
 * - `templates` 는 **송출할 때 기준**이 된다. 항목에 templateId 가 없으면 이 값을 쓴다.
 *   나중에 기본을 바꾸면 따로 지정하지 않은 항목이 모두 따라온다.
 * - 나머지(역본·화면 넘김·언어)는 **항목을 새로 넣을 때 채워 넣는다.**
 *   이미 만든 항목의 본문 설정까지 나중에 바뀌면 놀랍기 때문이다.
 */
export interface PlanDefaults {
  /** 항목 종류별 기본 템플릿 id */
  templates?: {
    bible?: number;
    song?: number;
    /** 순서 표시 */
    order?: number;
    /** 광고·인용구 */
    text?: number;
  };
  bible?: { primary?: string; secondary?: string[]; paging?: string };
  song?: { langs?: LangCode[]; lines?: string };
  /**
   * 주기도문·사도신경의 기본 판본. 교회가 쓰는 판본은 좀처럼 바뀌지 않으므로
   * 넣을 때마다 고르게 하지 않고 예배 기본값으로 둔다.
   *
   * 자세한 값은 `lib/liturgy-texts.ts` — 여기서 import 하면 순환이 되므로
   * 리터럴로 적는다 (lib 가 이 파일을 import 한다).
   */
  liturgy?: { version?: 'new' | 'traditional'; perSlide?: 0 | 2 | 4 | 6 };
  /**
   * 항목을 누르면 그 **제목을 화면에 띄운다** (성경·찬양·교독문·전례문).
   *
   * 여러 장짜리 항목은 누른 뒤 그 안의 장을 골라야 화면에 나가므로, 누르는 그 순간이
   * '다음은 이것' 이라고 알릴 자리다 (사용자 요청, 2026-08-19).
   *
   * **끌 수 있게 둔다.** 클릭이 송출을 일으키는 것은 큰 변화라, 예배 중 항목을 살펴보려고
   * 눌렀을 때 화면이 바뀌는 것이 부담스러울 수 있다. 없으면 켠 것으로 본다 —
   * 요청받은 기능이 기본으로 동작해야 한다.
   */
  titleOnSelect?: boolean;
  /**
   * **교독문·주기도문·사도신경에 함께 쓸 배경 그림.**
   *
   * 이 셋은 회중이 함께 읽는 순서라 배경을 늘 깐다(2026-08-18 사용자 결정).
   * 여기에 한 번 정해 두면 앞으로 넣는 항목이 자동으로 이 배경을 받는다 —
   * 항목마다 고르게 하면 잊어버린 한 장이 맨 화면으로 나간다.
   */
  readingBackground?: ItemBackground;
}

export interface ServicePlan {
  id: number;
  name: string;
  serviceDate?: string; // ISO date
  items: CueItem[];
  updatedAt?: string;
  /** 없으면 'plan' 으로 본다 — 유형 개념 도입 전 순서표의 하위 호환 */
  kind?: PlanKind;
  /** 이 예배에서 기본으로 쓸 템플릿·역본 (항목이 따로 지정하면 그쪽이 이긴다) */
  defaults?: PlanDefaults;
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
      /** 항목이 정한 표시 여부 (없으면 템플릿 따름) */
      display?: ItemDisplay;
      /** 항목이 정한 폰트 (없으면 템플릿 따름) */
      style?: ItemTextStyle;
    }
  | {
      kind: 'song';
      title: string;
      sectionLabel: string;
      /**
       * 이 슬라이드가 그 절의 **첫 장**인지. 절 번호를 여기서만 띄운다 —
       * 이어지는 장에도 붙으면 절이 바뀐 것처럼 읽힌다.
       * 출력 페이지는 슬라이드 하나만 받으므로 앞뒤를 비교할 수 없어 여기에 담는다.
       */
      sectionStart?: boolean;
      /** 줄 배열. 각 줄은 언어별 텍스트 페어 묶음. */
      lines: SongLine[][];
      credit?: string;
      /** 항목이 정한 표시 여부 (없으면 템플릿 따름) */
      display?: ItemDisplay;
      /** 항목이 정한 폰트 (없으면 템플릿 따름) */
      style?: ItemTextStyle;
      /**
       * 이 줄에 해당하는 **악보 조각**. 있으면 프로젝터가 가사 대신 이것을 그린다.
       *
       * 가사 슬라이드에 실어 보내는 이유: 화면마다 다른 것을 보여 줘야 하는데
       * (프로젝터는 악보, OBS·강사 모니터는 가사) 슬라이드를 두 벌 만들면 진행 위치가
       * 갈라진다. 한 슬라이드에 둘 다 담고 **보는 쪽이 고른다.**
       */
      sheet?: SheetRef;
    }
  /** `background`·`style` 은 전례문(주기도문·사도신경)이 실어 보낼 때만 찬다 */
  | { kind: 'text'; lines: string[]; background?: ItemBackground; style?: ItemTextStyle }
  /**
   * 순서 표시 — **왼쪽에 순서 이름, 오른쪽에 담당자**를 한 줄로 놓고 담당자 아래에 밑줄.
   *
   * `text` 로 두지 않는 이유는 두 값의 **자리가 다르기 때문**이다. 줄 배열로는
   * "이건 왼쪽, 저건 오른쪽"을 표현할 수 없어 출력 페이지가 알 방법이 없다.
   */
  | {
      kind: 'order';
      title: string;
      presenter?: string;
      charStyles?: OrderCharStyle[];
      /** 담당자 글자 크기 배수 (1 = 템플릿의 보조 텍스트 크기) */
      presenterScale?: number;
      /** 외곽선 두께(px). 없으면 템플릿 값을 쓴다 */
      titleStroke?: number;
      presenterStroke?: number;
    }
  /**
   * 교독문 한 화면 — 인도자 줄과 회중 줄이 **함께** 나온다.
   *
   * 회중은 자기 차례 줄이 화면에 있어야 읽을 수 있다. 두 줄을 템플릿의
   * 주/보조 텍스트 역할로 그려 누가 읽을 차례인지 눈에 보이게 한다.
   */
  | {
      kind: 'reading';
      leader: string;
      /** 없으면 마지막 '다같이' 줄 — 혼자 한 화면을 쓴다 */
      people?: string;
      /** '시편 1편' 처럼 작게 붙는 표기 */
      reference?: string;
      background?: ItemBackground;
      style?: ItemTextStyle;
    }
  /**
   * 그림 한 장 — 예배 전 안내·악보처럼 **글자 없이 그림만** 나가는 화면.
   *
   * 배경(`ItemBackground`)과 다르다. 배경은 글자 뒤에 까는 것이고 이것은 **내용 자체**다.
   * 그래서 `contain` 이 기본이다 — 안내문이나 악보는 잘리면 읽을 수 없다.
   * (배경은 화면을 채워야 하므로 `cover` 가 기본이다.)
   *
   * `crop` 은 원본의 **세로 일부만** 보여 준다. 악보 한 장에서 지금 부르는 단만
   * 잘라 내기 위한 것이다 — 슬라이드마다 파일을 따로 만들지 않아도 된다.
   */
  | {
      kind: 'image';
      /** 출력 페이지가 그대로 쓰는 주소 (`/backgrounds/…` · `/background-library/…`) */
      src: string;
      /** 화면 낭독기를 위한 설명. 파일 이름이 기본 */
      alt?: string;
      /** 기본 `contain` — 내용이므로 잘리면 안 된다 */
      fit?: BackgroundFit;
      /** 원본의 세로 몇 %부터 몇 %까지 보일지 (0~100). 없으면 전체 */
      crop?: { top: number; bottom: number };
    }
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
  /** 컨트롤 패널과 **강사 모니터**에만 보낸다 (출력 페이지는 쓰지 않는다) */
  | { t: 'deck'; payload: Deck | null }
  /**
   * 접속 수가 바뀔 때 컨트롤 패널에 알린다 (폴링 대신 푸시).
   * `stage` 는 강사 모니터 — OBS 로 나가는 `output` 과 섞지 않는다.
   */
  | { t: 'connections'; payload: { control: number; output: number; stage: number; projector: number } }
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

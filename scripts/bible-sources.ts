/**
 * 원본 성경 소스 어댑터 정의 — **선언만** 담는다.
 * 실제 읽기는 scripts/source-reader.ts 가 담당한다.
 *
 * 원본 파일들이 같은 구조가 아니다:
 *  - 10개는 안드로이드 성경앱 SQLite : bible(bibleCode, Jang, Jul, Cont)
 *  - ESV 만 다른 SQLite 배치        : bible(book, chapter, verse, content) + HTML 마크업
 *  - 현대인의성경은 JSON            : [{ book: 'Genesis', chapters: [{ '1': { '1': '본문' } }] }]
 *
 * 정제는 '표시용'이다. 원문과 달라진 절은 verses.text_raw 에 원문을 남겨
 * 언제든 대조할 수 있게 한다 (계획서 §3.1 원칙).
 */

import type { LangCode } from '../shared/types.ts';

export type SourceSchema = 'android' | 'flat' | 'json';

/** 한 역본을 어느 파일에서, 어떤 스키마·정제로 읽을지 */
export interface SourceVariant {
  file: string;
  schema: SourceSchema;
  clean: (raw: string) => string;
  /** 정제 규칙에 대한 사람이 읽는 설명 — 빌드 리포트에 실린다 */
  cleanNotes: string;
  /**
   * 본문 품질이 떨어지는 대체본일 때 그 사유.
   * 값이 있으면 빌드가 경고를 띄우고 리포트 맨 앞에 표시한다 —
   * 품질 저하가 조용히 넘어가서는 안 된다.
   */
  degraded?: string;
}

export interface SourceSpec extends SourceVariant {
  id: string;
  name: string;
  shortName: string;
  lang: LangCode;
  direction: 'ltr' | 'rtl';
  sortOrder: number;
  /**
   * 주 파일이 없을 때 쓸 대체 파일.
   * 다른 PC 에 원본 폴더를 복사했을 때 파일 구성이 다를 수 있어 대비한다.
   */
  fallback?: SourceVariant;
}

/** 실제로 존재하는 변형을 고른다. 없으면 undefined. */
export function pickVariant(spec: SourceSpec, exists: (file: string) => boolean): SourceVariant | undefined {
  if (exists(spec.file)) return spec;
  if (spec.fallback && exists(spec.fallback.file)) return spec.fallback;
  return undefined;
}

// ── 정제 단계 ──────────────────────────────────────────────────

/** 연속 공백 정규화 + 앞뒤 다듬기. 모든 역본에 공통 적용. */
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** 한국어 역본의 문단 기호 (개역개정 3,383절 · 표준새번역 5,010절에 존재) */
const stripParagraphMarks = (s: string): string => s.replace(/[○¶]/g, '');

/** 표준새번역의 본문 내 소제목 '<그리스도의 사랑을 알아라>' */
const stripInlineHeading = (s: string): string => s.replace(/<[^>]*>/g, '');

/**
 * 표준새번역의 각주 마커와 본문 뒤에 붙은 각주 본문.
 *   '... c) 아버지께 빕니다. (c. 다른 고대 사본들에는 ...)'
 * 한국어 본문에 홀로 나오는 라틴 소문자 + ')' 는 각주 마커로 본다.
 */
const stripKoreanFootnotes = (s: string): string =>
  s.replace(/\([a-z]\.[^)]*\)/g, '').replace(/(^|\s)[a-z]\)/g, '$1');

/** ESV 의 HTML 엔티티 — 실측 결과 3종뿐이다 (&quot; 12,908 / &apos; 4,661 / &mdash; 616) */
const decodeEntities = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** ESV 의 태그 — <block>, </block>, <span class="j">, </span> 4종뿐 */
const stripTags = (s: string): string => s.replace(/<[^>]*>/g, '');

const pipe =
  (...steps: Array<(s: string) => string>) =>
  (raw: string): string =>
    steps.reduce((acc, step) => step(acc), raw);

// ── 역본 목록 ──────────────────────────────────────────────────

export const SOURCES: readonly SourceSpec[] = [
  {
    id: 'nkrv',
    file: '개역개정NKRV.db',
    name: '개역개정',
    shortName: '개정',
    lang: 'ko',
    direction: 'ltr',
    sortOrder: 10,
    schema: 'android',
    clean: pipe(stripParagraphMarks, collapse),
    cleanNotes: '문단 기호(○) 제거, 공백 정규화',
  },
  {
    id: 'krv',
    file: '개역한글KRV.db',
    name: '개역한글',
    shortName: '개역',
    lang: 'ko',
    direction: 'ltr',
    sortOrder: 20,
    schema: 'android',
    clean: pipe(stripParagraphMarks, collapse),
    cleanNotes: '문단 기호(○) 제거, 공백 정규화',
  },
  {
    id: 'snkv',
    file: '표준새번역SNKV.db',
    name: '표준새번역',
    shortName: '표준',
    lang: 'ko',
    direction: 'ltr',
    sortOrder: 30,
    schema: 'android',
    clean: pipe(stripParagraphMarks, stripInlineHeading, stripKoreanFootnotes, collapse),
    cleanNotes: '문단 기호(○), 본문 내 소제목(<...>), 각주 마커·각주 본문 제거',
  },
  {
    id: 'nctb',
    file: '공동번역NCTB.db',
    name: '공동번역',
    shortName: '공동',
    lang: 'ko',
    direction: 'ltr',
    sortOrder: 40,
    schema: 'android',
    clean: pipe(stripParagraphMarks, collapse),
    cleanNotes: '공백 정규화 (마크업 없음)',
  },
  {
    id: 'kor',
    file: '우리말성경.db',
    name: '우리말성경',
    shortName: '우리말',
    lang: 'ko',
    direction: 'ltr',
    sortOrder: 50,
    schema: 'android',
    clean: pipe(stripParagraphMarks, collapse),
    cleanNotes: '공백 정규화 (마크업 없음)',
  },
  {
    id: 'klb',
    /**
     * 현대인의성경 (Korean Living Bible). 유일한 JSON 원본.
     *
     * 실측: 66권 · 31,094절 · 마크업 0 · 빈 절 0 · 장 수는 표준과 완전 일치.
     * 개역개정보다 8절 적은데, 확인해 보니 본문 손실이 아니라 **절 병합**이다
     * (수 2:24 → 2:23 에 합쳐짐 등 10곳, 반대로 고후 13:14·계 12:18 은 이쪽에만 있다).
     * 의역 성경이라 절 경계가 다른 것이 정상이다.
     *
     * 책 이름이 영문 문자열('Genesis', '1 Chronicles')이라 lib/books.ts 의
     * 별칭 테이블로 해석한다 — 66권 전부 해석됨을 확인했다.
     */
    file: '현대인의성경.json',
    name: '현대인의성경',
    shortName: '현대인',
    lang: 'ko',
    direction: 'ltr',
    sortOrder: 55,
    schema: 'json',
    clean: collapse,
    cleanNotes: '공백 정규화만 (마크업 없음). 직접화법의 홑따옴표는 이 역본의 표기 방식이라 보존',
  },
  {
    id: 'kjvko',
    file: '킹제임스흠정역KJVonly.db',
    name: '킹제임스 흠정역',
    shortName: '흠정',
    lang: 'ko',
    direction: 'ltr',
    sortOrder: 60,
    schema: 'android',
    clean: collapse,
    // [ ] 안의 말은 번역자가 보충한 단어라는 흠정역 표기 관행이다.
    // 지우면 본문을 바꾸는 것이므로 그대로 둔다 (Phase 3에서 이탤릭 렌더 옵션 예정).
    cleanNotes: '공백 정규화. 보충어 대괄호 [ ] 는 보존',
  },
  {
    id: 'kjv',
    file: 'KJV.db',
    name: 'KJV',
    shortName: 'KJV',
    lang: 'en',
    direction: 'ltr',
    sortOrder: 70,
    schema: 'android',
    clean: collapse,
    cleanNotes: '공백 정규화. 보충어 대괄호 [ ] 는 보존 (14,229절)',
  },
  {
    id: 'niv',
    file: 'NIV.db',
    name: 'NIV',
    shortName: 'NIV',
    lang: 'en',
    direction: 'ltr',
    sortOrder: 80,
    schema: 'android',
    clean: collapse,
    cleanNotes: '공백 정규화 (마크업 없음)',
  },
  {
    id: 'esv',
    /**
     * 원본 폴더에 ESV 파일이 두 개 있다. **ESV.db 를 쓴다.**
     *
     * 31,086절 전수 비교 결과 14_ESV.db 는 겉모습만 깨끗한 손상된 파생본이었다:
     *   - `LORD` 를 포함한 5,566절이 전부 `Lord` 로 바뀌었다 (GOD 300절도 마찬가지).
     *     영어 성경에서 LORD(대문자)는 신명사문자 YHWH, Lord 는 Adonai 를 옮긴 것으로
     *     구별이 의미를 갖는다. 시 23:1 이 'The Lord is my shepherd' 가 된다.
     *   - 작은대문자 조판을 평문으로 풀면서 구두점 앞에 공백이 남았다 (`the Lord ,`) — 2,472절.
     *
     * ESV.db 의 단점은 flat 스키마와 HTML 마크업뿐이고, 둘 다 여기서 흡수한다.
     * 빈 절 15개는 ESV 가 사본상 근거가 약해 의도적으로 뺀 절이므로 정상이다.
     *
     * 14_ESV.db 는 이 PC 에서 제거했지만, 원본 폴더 구성이 다른 PC 를 위해
     * 대체본 설정은 남겨 둔다 (사용 시 경고).
     *
     * 소제목은 두 파일 모두에서 쓸 수 없다. 14_ESV.db 에 bible_theme 2,429행이
     * 있지만 bible.ThemeCd 가 전부 0 이고 bible_theme.KindBCd 도 전부 1 이어서
     * 어느 책·어느 장의 소제목인지 알 방법이 없다. 순서로 추론하면 한 곳만
     * 틀려도 이후 전체가 밀려 엉뚱한 소제목이 송출되므로 넣지 않는다.
     * 영어 소제목이 필요하면 NIV(2,120건)를 쓴다.
     */
    file: 'ESV.db',
    name: 'ESV',
    shortName: 'ESV',
    lang: 'en',
    direction: 'ltr',
    sortOrder: 90,
    schema: 'flat',
    clean: pipe(decodeEntities, stripTags, collapse),
    cleanNotes:
      'HTML 엔티티 복원, 태그(<block>, <span class="j">) 제거, 빈 절 15개 건너뜀. LORD/GOD(YHWH) 표기 보존',
    fallback: {
      file: '14_ESV.db',
      schema: 'android',
      clean: collapse,
      cleanNotes: '공백 정규화 (마크업 없음)',
      degraded:
        'LORD/GOD(YHWH) 표기가 모두 소문자로 바뀌어 있고(5,866절), 구두점 앞 공백 오류가 2,472절 있습니다. ' +
        'ESV.db 를 구할 수 있으면 그쪽을 쓰세요.',
    },
  },
  {
    id: 'grk',
    file: '헬라어.db',
    name: '헬라어 원문',
    shortName: '헬',
    lang: 'grc',
    direction: 'ltr',
    sortOrder: 100,
    schema: 'android',
    clean: collapse,
    cleanNotes: '공백 정규화만. 악센트·기식 기호 보존',
  },
  {
    id: 'heb',
    file: '히브리어.db',
    name: '히브리어 원문',
    shortName: '히',
    lang: 'heb',
    direction: 'rtl',
    sortOrder: 110,
    schema: 'android',
    clean: collapse,
    cleanNotes: '공백 정규화만. 모음 부호(니쿠드)·악센트 보존',
  },
];

// ── 원본 데이터 오류 교정 ────────────────────────────────────────
//
// 원본 DB 의 bible 테이블은 (책,장,절) 에 유일성 제약이 없어 중복 행이 존재할 수 있다.
// 중복을 조용히 버리면 본문이 사라지므로, 확인된 건은 아래에 근거와 함께 명시해 옮기고
// 확인되지 않은 중복은 빌드 리포트에 그대로 드러낸다.

export interface DuplicateFix {
  translationId: string;
  book: number;
  chapter: number;
  verse: number;
  /** 몇 번째 행인지 (2 = 두 번째) */
  occurrence: number;
  moveTo: { chapter: number; verse: number };
  reason: string;
}

export const DUPLICATE_FIXES: readonly DuplicateFix[] = [
  {
    translationId: 'heb',
    book: 17, // 에스더
    chapter: 8,
    verse: 9,
    occurrence: 2,
    moveTo: { chapter: 3, verse: 12 },
    reason:
      '원본 히브리어 DB 에 에스더 3:12 가 아예 없고, 그 본문이 8:9 의 두 번째 행으로 들어가 있다. ' +
      '해당 행이 "첫째 달"(בַּחֹדֶשׁ הָרִאשׁוֹן) · 하만의 명령을 말하는 3:12 내용이고, ' +
      '개역개정 3:12("첫째 달 십삼일에 … 하만의 명령을 따라")와 일치함을 확인했다. ' +
      '이동 대상 자리가 비어 있을 때에만 적용된다.',
  },
];

export function findDuplicateFix(
  translationId: string,
  book: number,
  chapter: number,
  verse: number,
  occurrence: number,
): DuplicateFix | undefined {
  return DUPLICATE_FIXES.find(
    (f) =>
      f.translationId === translationId &&
      f.book === book &&
      f.chapter === chapter &&
      f.verse === verse &&
      f.occurrence === occurrence,
  );
}


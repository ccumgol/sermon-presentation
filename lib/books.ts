/**
 * 성경 66권 메타데이터와 이름 별칭 테이블.
 *
 * 장 수는 원본 DB(volume_name.end)와 대조해 확인했다.
 * 영문 이름은 원본 NIV DB에 오타가 있어(Song of Song, Phillippians)
 * 여기서 바로잡고, 원본 표기는 별칭으로 남겨 검색은 계속 되게 했다.
 */

import type { BookMeta, Testament } from '../shared/types.ts';
import { isChoseongOnly, toChoseong } from './hangul.ts';

/** [코드, 한글명, 한글약어, 영문명, 영문약어, 장수, 추가별칭] */
type BookRow = readonly [number, string, string, string, string, number, readonly string[]];

/**
 * 역본에 따라 장 구분이 다른 책. 값은 번들된 역본 중 최대 장 수다.
 * 파서는 이 값까지 허용하고, 해당 장이 없는 역본은 조회 시 '없는 본문'으로 처리한다.
 *
 * - 요엘: 마소라 본문은 4장으로 나눈다(히브리어 원문·공동번역). 개신교 판은 3장.
 *   개신교 2:28-32 = 마소라 3:1-5, 개신교 3장 = 마소라 4장. 절 수까지 대조해 확인했다.
 * - 다니엘: 공동번역은 13장(수산나)·14장(벨과 용) 추가부를 포함한다.
 */
const CHAPTER_VARIANTS: Readonly<Record<number, { max: number; reason: string }>> = {
  29: { max: 4, reason: '마소라 본문(히브리어 원문·공동번역)은 요엘을 4장으로 나눈다' },
  27: { max: 14, reason: '공동번역은 다니엘 13장(수산나)·14장(벨과 용)을 포함한다' },
};

const ROWS: readonly BookRow[] = [
  [1, '창세기', '창', 'Genesis', 'Gen', 50, ['창세', 'Ge', 'Gn']],
  [2, '출애굽기', '출', 'Exodus', 'Exod', 40, ['출애', 'Ex', 'Exo']],
  [3, '레위기', '레', 'Leviticus', 'Lev', 27, ['레위', 'Lv']],
  [4, '민수기', '민', 'Numbers', 'Num', 36, ['민수', 'Nu', 'Nm']],
  [5, '신명기', '신', 'Deuteronomy', 'Deut', 34, ['신명', 'Dt', 'Deu', 'De']],
  [6, '여호수아', '수', 'Joshua', 'Josh', 24, ['여호수아기', 'Jos', 'Jsh']],
  [7, '사사기', '삿', 'Judges', 'Judg', 21, ['Jdg', 'Jg']],
  [8, '룻기', '룻', 'Ruth', 'Ruth', 4, ['Ru', 'Rth']],
  [9, '사무엘상', '삼상', '1 Samuel', '1Sam', 31, ['1사무엘', '1삼', '1Sa', '1S', '1Sm']],
  [10, '사무엘하', '삼하', '2 Samuel', '2Sam', 24, ['2사무엘', '2삼', '2Sa', '2S', '2Sm']],
  [11, '열왕기상', '왕상', '1 Kings', '1Kgs', 22, ['1열왕기', '1왕', '1Ki', '1K', '1Kin']],
  [12, '열왕기하', '왕하', '2 Kings', '2Kgs', 25, ['2열왕기', '2왕', '2Ki', '2K', '2Kin']],
  [13, '역대상', '대상', '1 Chronicles', '1Chr', 29, ['1역대', '1대', '1Ch', '1Chron']],
  [14, '역대하', '대하', '2 Chronicles', '2Chr', 36, ['2역대', '2대', '2Ch', '2Chron']],
  [15, '에스라', '스', 'Ezra', 'Ezra', 10, ['Ezr']],
  [16, '느헤미야', '느', 'Nehemiah', 'Neh', 13, ['Ne']],
  [17, '에스더', '에', 'Esther', 'Esth', 10, ['Est', 'Es']],
  [18, '욥기', '욥', 'Job', 'Job', 42, ['Jb']],
  [19, '시편', '시', 'Psalms', 'Ps', 150, ['Psa', 'Psalm', 'Pss']],
  [20, '잠언', '잠', 'Proverbs', 'Prov', 31, ['Pr', 'Prv', 'Pro']],
  [21, '전도서', '전', 'Ecclesiastes', 'Eccl', 12, ['Ecc', 'Ec', 'Qoh']],
  [22, '아가', '아', 'Song of Songs', 'Song', 8, ['아가서', 'Song of Song', 'Song of Solomon', 'SS', 'SoS', 'Cant', 'Canticles']],
  [23, '이사야', '사', 'Isaiah', 'Isa', 66, ['Is']],
  [24, '예레미야', '렘', 'Jeremiah', 'Jer', 52, ['Je']],
  [25, '예레미야애가', '애', 'Lamentations', 'Lam', 5, ['애가', 'La']],
  [26, '에스겔', '겔', 'Ezekiel', 'Ezek', 48, ['Eze', 'Ezk']],
  [27, '다니엘', '단', 'Daniel', 'Dan', 12, ['Da', 'Dn']],
  [28, '호세아', '호', 'Hosea', 'Hos', 14, ['Ho']],
  [29, '요엘', '욜', 'Joel', 'Joel', 3, ['Joe', 'Jl']],
  [30, '아모스', '암', 'Amos', 'Amos', 9, ['Am', 'Amo']],
  [31, '오바댜', '옵', 'Obadiah', 'Obad', 1, ['Ob', 'Oba']],
  [32, '요나', '욘', 'Jonah', 'Jonah', 4, ['Jon', 'Jnh']],
  [33, '미가', '미', 'Micah', 'Mic', 7, ['Mi']],
  [34, '나훔', '나', 'Nahum', 'Nah', 3, ['Na']],
  [35, '하박국', '합', 'Habakkuk', 'Hab', 3, []],
  [36, '스바냐', '습', 'Zephaniah', 'Zeph', 3, ['Zep', 'Zp']],
  [37, '학개', '학', 'Haggai', 'Hag', 2, ['Hg']],
  [38, '스가랴', '슥', 'Zechariah', 'Zech', 14, ['Zec', 'Zc']],
  [39, '말라기', '말', 'Malachi', 'Mal', 4, ['Ml']],
  [40, '마태복음', '마', 'Matthew', 'Matt', 28, ['마태', 'Mt', 'Mat']],
  [41, '마가복음', '막', 'Mark', 'Mark', 16, ['마가', 'Mk', 'Mrk', 'Mar']],
  [42, '누가복음', '눅', 'Luke', 'Luke', 24, ['누가', 'Lk', 'Luk']],
  [43, '요한복음', '요', 'John', 'John', 21, ['요한', 'Jn', 'Jhn', 'Joh']],
  [44, '사도행전', '행', 'Acts', 'Acts', 28, ['행전', 'Ac', 'Act']],
  [45, '로마서', '롬', 'Romans', 'Rom', 16, ['Ro', 'Rm']],
  [46, '고린도전서', '고전', '1 Corinthians', '1Cor', 16, ['1고린도', '1고', '1Co']],
  [47, '고린도후서', '고후', '2 Corinthians', '2Cor', 13, ['2고린도', '2고', '2Co']],
  [48, '갈라디아서', '갈', 'Galatians', 'Gal', 6, ['Ga']],
  [49, '에베소서', '엡', 'Ephesians', 'Eph', 6, ['Ep']],
  [50, '빌립보서', '빌', 'Philippians', 'Phil', 4, ['Phillippians', 'Php', 'Pp']],
  [51, '골로새서', '골', 'Colossians', 'Col', 4, ['Cl']],
  [52, '데살로니가전서', '살전', '1 Thessalonians', '1Thess', 5, ['1데살로니가', '1살', '1데', '1Th', '1Thes']],
  [53, '데살로니가후서', '살후', '2 Thessalonians', '2Thess', 3, ['2데살로니가', '2살', '2데', '2Th', '2Thes']],
  [54, '디모데전서', '딤전', '1 Timothy', '1Tim', 6, ['1디모데', '1딤', '1Ti']],
  [55, '디모데후서', '딤후', '2 Timothy', '2Tim', 4, ['2디모데', '2딤', '2Ti']],
  [56, '디도서', '딛', 'Titus', 'Titus', 3, ['Tit', 'Ti']],
  [57, '빌레몬서', '몬', 'Philemon', 'Philem', 1, ['Phm', 'Phlm']],
  [58, '히브리서', '히', 'Hebrews', 'Heb', 13, ['Hebr']],
  [59, '야고보서', '약', 'James', 'Jas', 5, ['Jam', 'Jm']],
  [60, '베드로전서', '벧전', '1 Peter', '1Pet', 5, ['1베드로', '1벧', '1Pe', '1P']],
  [61, '베드로후서', '벧후', '2 Peter', '2Pet', 3, ['2베드로', '2벧', '2Pe', '2P']],
  [62, '요한일서', '요일', '1 John', '1John', 5, ['요한1서', '1요한', '1요', '1Jn', '1Jo', '1J']],
  [63, '요한이서', '요이', '2 John', '2John', 1, ['요한2서', '2요한', '2요', '2Jn', '2Jo', '2J']],
  [64, '요한삼서', '요삼', '3 John', '3John', 1, ['요한3서', '3요한', '3요', '3Jn', '3Jo', '3J']],
  [65, '유다서', '유', 'Jude', 'Jude', 1, ['Jd']],
  [66, '요한계시록', '계', 'Revelation', 'Rev', 22, ['계시록', '요한계시', 'Re', 'Rv', 'Revelations', 'Apoc']],
];

function testamentOf(code: number): Testament {
  return code <= 39 ? 'OT' : 'NT';
}

export const BOOKS: readonly BookMeta[] = ROWS.map(([code, nameKo, abbrKo, nameEn, abbrEn, chapters]) => ({
  code,
  nameKo,
  abbrKo,
  nameEn,
  abbrEn,
  chapters,
  maxChapters: CHAPTER_VARIANTS[code]?.max ?? chapters,
  testament: testamentOf(code),
}));

/** 장 구분이 역본마다 다른 책의 사유 설명 (오류 메시지·문서용) */
export function chapterVariantReason(code: number): string | undefined {
  return CHAPTER_VARIANTS[code]?.reason;
}

const BY_CODE = new Map<number, BookMeta>(BOOKS.map((b) => [b.code, b]));

export function getBook(code: number): BookMeta | undefined {
  return BY_CODE.get(code);
}

/**
 * 조회용 키 정규화.
 * - 로마 숫자 접두어(I/II/III + 공백)를 아라비아 숫자로 — 'I Samuel' → '1samuel'
 *   공백을 요구하므로 'Isaiah' 가 '1saiah' 로 망가지지 않는다.
 * - 공백·마침표 제거, 소문자화
 */
export function normalizeBookKey(input: string): string {
  return input
    .trim()
    .replace(/^III\s+/i, '3')
    .replace(/^II\s+/i, '2')
    .replace(/^I\s+/i, '1')
    .replace(/[.\s ]/g, '')
    .toLowerCase();
}

/** 정규화 키 → 책 코드. 충돌한 키는 EXACT 에서 제외하고 AMBIGUOUS 로 옮긴다. */
const EXACT = new Map<string, number>();
const AMBIGUOUS = new Map<string, number[]>();

function addKey(key: string, code: number): void {
  const normalized = normalizeBookKey(key);
  if (normalized.length === 0) return;

  const existing = EXACT.get(normalized);
  if (existing !== undefined && existing !== code) {
    EXACT.delete(normalized);
    AMBIGUOUS.set(normalized, [existing, code]);
    return;
  }
  const clash = AMBIGUOUS.get(normalized);
  if (clash) {
    if (!clash.includes(code)) clash.push(code);
    return;
  }
  EXACT.set(normalized, code);
}

for (const [code, nameKo, abbrKo, nameEn, abbrEn, , aliases] of ROWS) {
  addKey(nameKo, code);
  addKey(abbrKo, code);
  addKey(nameEn, code);
  addKey(abbrEn, code);
  for (const alias of aliases) addKey(alias, code);
}

/**
 * 초성 → 책 코드. **정식 한글명만** 등록한다.
 *
 * 약어 초성을 함께 넣으면 'ㅇㅎ' 가 '왕하'(열왕기하)와 정확히 일치해 버려서
 * 요한복음 계열보다 먼저 확정되는 문제가 생긴다. 약어는 두 글자라 그대로 치는 게
 * 더 빠르므로 초성 검색 대상에서 제외했다.
 */
const CHOSEONG_INDEX: Array<{ choseong: string; code: number }> = ROWS.map(([code, nameKo]) => ({
  choseong: toChoseong(nameKo),
  code,
}));

export interface BookLookup {
  /** 정확히 하나로 확정된 경우 */
  code?: number;
  /** 후보가 여럿이거나 없을 때 */
  candidates: Array<{ code: number; matched: string }>;
}

/**
 * 책 이름을 해석한다.
 * 우선순위: 정확 일치 → 초성 일치 → 접두 일치 → 부분 일치
 * 확정하지 못하면 후보 목록을 돌려주고, 절대 임의로 하나를 고르지 않는다.
 */
export function lookupBook(input: string): BookLookup {
  const raw = input.trim();
  if (raw.length === 0) return { candidates: [] };

  const key = normalizeBookKey(raw);

  const exact = EXACT.get(key);
  if (exact !== undefined) return { code: exact, candidates: [{ code: exact, matched: raw }] };

  const ambiguous = AMBIGUOUS.get(key);
  if (ambiguous) {
    return { candidates: ambiguous.map((code) => ({ code, matched: raw })) };
  }

  if (isChoseongOnly(raw)) {
    const folded = toChoseong(raw);
    // 초성이 정확히 일치하는 책이 있으면 그쪽을 우선한다.
    // 'ㅇㅎㅂㅇ' 는 요한복음으로 확정되지만, 'ㅇㅎ' 는 요한복음/요한일서/…로 갈리므로
    // 후보를 그대로 돌려준다 (성경책 코드 순 = 요한복음이 첫 후보).
    const exactHits = CHOSEONG_INDEX.filter((entry) => entry.choseong === folded);
    const hits = exactHits.length > 0 ? exactHits : CHOSEONG_INDEX.filter((e) => e.choseong.startsWith(folded));
    const codes = [...new Set(hits.map((h) => h.code))].sort((a, b) => a - b);
    if (codes.length === 1) return { code: codes[0]!, candidates: [{ code: codes[0]!, matched: raw }] };
    return { candidates: codes.map((code) => ({ code, matched: raw })) };
  }

  // 접두 일치 — '고린도' 처럼 여러 권에 걸리면 후보로 돌려준다
  const prefixHits = matchBy((candidate) => candidate.startsWith(key));
  if (prefixHits.length === 1) return { code: prefixHits[0]!.code, candidates: prefixHits };
  if (prefixHits.length > 1) return { candidates: prefixHits };

  const partialHits = matchBy((candidate) => candidate.includes(key));
  if (partialHits.length === 1) return { code: partialHits[0]!.code, candidates: partialHits };
  return { candidates: partialHits };
}

function matchBy(predicate: (candidate: string) => boolean): Array<{ code: number; matched: string }> {
  const found = new Map<number, string>();
  for (const [code, nameKo, abbrKo, nameEn, abbrEn, , aliases] of ROWS) {
    for (const name of [nameKo, abbrKo, nameEn, abbrEn, ...aliases]) {
      if (predicate(normalizeBookKey(name))) {
        if (!found.has(code)) found.set(code, name);
        break;
      }
    }
  }
  return [...found].map(([code, matched]) => ({ code, matched }));
}

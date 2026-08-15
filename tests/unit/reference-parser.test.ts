import { describe, expect, it } from 'vitest';

import { formatRanges, normalizeInput, parseReference } from '../../lib/reference-parser.ts';
import type { VerseRange } from '../../shared/types.ts';

/** 성공 케이스에서 단일 구간을 간결히 비교하기 위한 헬퍼 */
function single(input: string): VerseRange {
  const result = parseReference(input);
  if (!result.ok) throw new Error(`파싱 실패: ${input} — ${result.message}`);
  expect(result.ranges).toHaveLength(1);
  return result.ranges[0]!;
}

function range(
  book: number,
  startChapter: number,
  startVerse: number | null,
  endChapter = startChapter,
  endVerse: number | null = startVerse,
): VerseRange {
  return { book, startChapter, startVerse, endChapter, endVerse };
}

describe('normalizeInput', () => {
  it('한글 장/절 표기를 콜론 형태로 바꾼다', () => {
    expect(normalizeInput('요한복음 3장 16절')).toBe('요한복음 3:16');
  });

  it('시편의 편 표기를 처리하되 책 이름의 편은 건드리지 않는다', () => {
    expect(normalizeInput('시편 23편')).toBe('시편 23');
  });

  it('전각 기호와 유사 대시를 통일한다', () => {
    expect(normalizeInput('요 3：16～17')).toBe('요 3:16-17');
    expect(normalizeInput('마 5:3–12；6:9—13')).toBe('마 5:3-12;6:9-13');
  });

  it('콜론과 대시 주변 공백을 없앤다', () => {
    expect(normalizeInput('요 3 : 16 - 17')).toBe('요 3:16-17');
  });
});

describe('parseReference — 한글 입력', () => {
  it('약어 + 장:절', () => {
    expect(single('요 3:16')).toEqual(range(43, 3, 16));
  });

  it('공백 없는 약어', () => {
    expect(single('요3:16')).toEqual(range(43, 3, 16));
  });

  it('정식 이름 + 장/절 한글 표기', () => {
    expect(single('요한복음 3장 16절')).toEqual(range(43, 3, 16));
  });

  it('절 범위', () => {
    expect(single('창 1:1-3')).toEqual(range(1, 1, 1, 1, 3));
  });

  it('장 전체', () => {
    expect(single('시 23')).toEqual(range(19, 23, null, 23, null));
  });

  it('공백 없는 장 전체', () => {
    expect(single('시23')).toEqual(range(19, 23, null, 23, null));
  });

  it('시편 + 편 표기', () => {
    expect(single('시편 23편')).toEqual(range(19, 23, null, 23, null));
  });

  it('장 범위', () => {
    expect(single('창 1-2')).toEqual(range(1, 1, null, 2, null));
  });

  it('장을 넘는 절 범위', () => {
    expect(single('요 3:16-4:2')).toEqual(range(43, 3, 16, 4, 2));
  });

  it('장 표기만 있으면 그 장 전체', () => {
    expect(single('요 3장')).toEqual(range(43, 3, null, 3, null));
  });

  it('별칭(요한)으로도 찾는다', () => {
    expect(single('요한 3:16')).toEqual(range(43, 3, 16));
  });

  it('상/하 구분이 있는 책', () => {
    expect(single('삼상 1:1')).toEqual(range(9, 1, 1));
    expect(single('삼하 1:1')).toEqual(range(10, 1, 1));
    expect(single('왕상 2:3')).toEqual(range(11, 2, 3));
    expect(single('대하 7:14')).toEqual(range(14, 7, 14));
  });

  it('숫자 접두 별칭', () => {
    expect(single('1요 2:1')).toEqual(range(62, 2, 1));
    expect(single('요일 2:1')).toEqual(range(62, 2, 1));
    expect(single('요한1서 2:1')).toEqual(range(62, 2, 1));
    expect(single('1고 13:4')).toEqual(range(46, 13, 4));
    expect(single('고전 13:4')).toEqual(range(46, 13, 4));
  });

  it('한 장짜리 책은 장 없이도 해석한다', () => {
    expect(single('유')).toEqual(range(65, 1, null, 1, null));
    expect(single('옵')).toEqual(range(31, 1, null, 1, null));
  });

  it('예레미야애가 약어', () => {
    expect(single('애 3:23')).toEqual(range(25, 3, 23));
  });

  it('마지막 책 경계', () => {
    expect(single('계 22:21')).toEqual(range(66, 22, 21));
  });
});

describe('parseReference — 역본별 장 구분 차이', () => {
  // 개신교 판은 요엘 3장·다니엘 12장까지지만, 히브리어 원문(마소라)은 요엘을 4장으로
  // 나누고 공동번역은 다니엘 13·14장(수산나, 벨과 용)을 포함한다.
  // 파서는 받아들이고, 해당 장이 없는 역본은 조회 단계에서 처리한다.
  it('요엘 4장을 받아들인다 (마소라 장 구분)', () => {
    expect(single('욜 4:1')).toEqual(range(29, 4, 1));
  });

  it('다니엘 13-14장을 받아들인다 (공동번역 추가부)', () => {
    expect(single('단 13:1')).toEqual(range(27, 13, 1));
    expect(single('단 14:2')).toEqual(range(27, 14, 2));
  });

  it('상한을 넘으면 여전히 거부한다', () => {
    for (const input of ['욜 5:1', '단 15:1']) {
      const result = parseReference(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('CHAPTER_OUT_OF_RANGE');
    }
  });

  it('오류 메시지가 표준 장 수와 확장 장 수를 함께 알려준다', () => {
    const result = parseReference('욜 5:1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('3장');
    expect(result.message).toContain('4장');
  });

  it('장 구분 차이가 없는 책은 표준 장 수만 안내한다', () => {
    const result = parseReference('창 51:1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toBe('창세기 51장은 없습니다 (1-50장)');
  });
});

describe('parseReference — 영문 입력', () => {
  it('정식 이름', () => {
    expect(single('John 3:16')).toEqual(range(43, 3, 16));
  });

  it('약어와 대소문자 무시', () => {
    expect(single('jn 3:16')).toEqual(range(43, 3, 16));
    expect(single('ROM 8:28')).toEqual(range(45, 8, 28));
  });

  it('마침표가 붙은 약어', () => {
    expect(single('Gen. 1:1')).toEqual(range(1, 1, 1));
  });

  it('숫자 접두 이름', () => {
    expect(single('1 Samuel 3:1')).toEqual(range(9, 3, 1));
    expect(single('1Cor 13:4')).toEqual(range(46, 13, 4));
    expect(single('2 Timothy 3:16')).toEqual(range(55, 3, 16));
  });

  it('로마 숫자 접두 이름', () => {
    expect(single('I Samuel 3:1')).toEqual(range(9, 3, 1));
    expect(single('II Kings 2:1')).toEqual(range(12, 2, 1));
    expect(single('III John 1')).toEqual(range(64, 1, null, 1, null));
  });

  it('Isaiah 가 로마 숫자 I 로 오해되지 않는다', () => {
    expect(single('Isaiah 53:5')).toEqual(range(23, 53, 5));
    expect(single('Isa 53:5')).toEqual(range(23, 53, 5));
  });

  it('여러 단어로 된 이름', () => {
    expect(single('Song of Songs 2:1')).toEqual(range(22, 2, 1));
    expect(single('Song of Solomon 2:1')).toEqual(range(22, 2, 1));
  });

  it('원본 NIV DB의 오타 표기도 받아준다', () => {
    expect(single('Phillippians 4:13')).toEqual(range(50, 4, 13));
    expect(single('Song of Song 2:1')).toEqual(range(22, 2, 1));
  });

  it('Philippians 와 Philemon 을 구분한다', () => {
    expect(single('Phil 4:13')).toEqual(range(50, 4, 13));
    expect(single('Philem 1')).toEqual(range(57, 1, null, 1, null));
    expect(single('Phm 1')).toEqual(range(57, 1, null, 1, null));
  });
});

describe('parseReference — 초성 입력', () => {
  it('전체 초성이 일치하면 확정한다', () => {
    expect(single('ㅇㅎㅂㅇ 3:16')).toEqual(range(43, 3, 16));
    expect(single('ㅊㅅㄱ 1:1')).toEqual(range(1, 1, 1));
    expect(single('ㄹㅁㅅ 8:28')).toEqual(range(45, 8, 28));
  });

  it('초성이 여러 책에 걸리면 후보 목록을 돌려주고 임의로 확정하지 않는다', () => {
    // 'ㅇㅎ' 는 여호수아·요한복음·요한일서·요한이서·요한삼서·요한계시록에 모두 걸린다.
    // 어느 쪽인지 추측하지 않고 후보를 넘긴다 — 사용 빈도 기반 정렬은
    // 컨트롤 패널(Phase 2)이 최근 사용 기록으로 처리할 몫이다.
    const result = parseReference('ㅇㅎ 3:16');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('BOOK_AMBIGUOUS');
    const names = result.candidates.map((c) => c.nameKo);
    expect(names).toContain('요한복음');
    expect(names).toContain('여호수아');
    expect(names).toContain('요한계시록');
  });

  it('약어 초성은 검색 대상이 아니다 — ㅇㅎ 가 열왕기하로 확정되지 않는다', () => {
    const result = parseReference('ㅇㅎ 3:16');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.candidates.map((c) => c.nameKo)).not.toContain('열왕기하');
  });
});

describe('parseReference — 복수 구간', () => {
  it('세미콜론으로 나뉜 구간에서 책 이름이 이어진다', () => {
    const result = parseReference('마 5:3-12; 6:9-13');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ranges).toEqual([range(40, 5, 3, 5, 12), range(40, 6, 9, 6, 13)]);
  });

  it('책이 바뀌는 복수 구간', () => {
    const result = parseReference('요 3:16; 롬 8:28');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ranges).toEqual([range(43, 3, 16), range(45, 8, 28)]);
  });

  it('콤마로 같은 장 안의 절을 나열한다', () => {
    const result = parseReference('요 3:16,18');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ranges).toEqual([range(43, 3, 16), range(43, 3, 18)]);
  });

  it('콤마 뒤에 절 범위도 온다', () => {
    const result = parseReference('요 3:16-17,20-21');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.ranges).toEqual([range(43, 3, 16, 3, 17), range(43, 3, 20, 3, 21)]);
  });
});

describe('parseReference — 오류 처리', () => {
  const cases: Array<[string, string]> = [
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    ['없는책 1:1', 'BOOK_NOT_FOUND'],
    ['Zzz 1:1', 'BOOK_NOT_FOUND'],
    ['창', 'CHAPTER_REQUIRED'],
    ['요한복음', 'CHAPTER_REQUIRED'],
    ['창 51:1', 'CHAPTER_OUT_OF_RANGE'],
    ['요 22:1', 'CHAPTER_OUT_OF_RANGE'],
    ['시 151', 'CHAPTER_OUT_OF_RANGE'],
    ['창 0:1', 'CHAPTER_OUT_OF_RANGE'],
    ['요 3:0', 'VERSE_INVALID'],
    ['요 4:2-3:16', 'RANGE_REVERSED'],
    ['요 3:17-16', 'RANGE_REVERSED'],
    ['창 2-1', 'RANGE_REVERSED'],
    ['요 3:16-', 'SYNTAX'],
    ['요 3::16', 'SYNTAX'],
    // 책은 찾았지만 뒤가 숫자가 아니므로 형식 오류로 본다
    ['요 abc', 'SYNTAX'],
    ['3:16', 'SYNTAX'],
  ];

  for (const [input, expected] of cases) {
    it(`'${input}' → ${expected}`, () => {
      const result = parseReference(input);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe(expected);
      expect(result.message.length).toBeGreaterThan(0);
    });
  }

  it('모호한 책 이름은 후보를 함께 돌려준다', () => {
    const result = parseReference('고린도 1:1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('BOOK_AMBIGUOUS');
    expect(result.candidates.map((c) => c.nameKo)).toEqual(['고린도전서', '고린도후서']);
  });

  it('Jud 는 사사기/유다서로 갈린다', () => {
    const result = parseReference('Jud 1:1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('BOOK_AMBIGUOUS');
    expect(result.candidates.map((c) => c.nameEn)).toEqual(['Judges', 'Jude']);
  });

  it('오류 메시지에 실제 장 수를 알려준다', () => {
    const result = parseReference('창 51:1');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('50');
  });
});

describe('formatRanges', () => {
  it('단일 절', () => {
    const result = parseReference('요 3:16');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toBe('요한복음 3:16');
    expect(result.referenceAbbr).toBe('요 3:16');
    expect(result.referenceEn).toBe('John 3:16');
  });

  it('절 범위', () => {
    const result = parseReference('롬 8:28-30');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toBe('로마서 8:28-30');
    expect(result.referenceAbbr).toBe('롬 8:28-30');
    expect(result.referenceEn).toBe('Romans 8:28-30');
  });

  it('장 전체는 한글에서 장을 붙인다', () => {
    const result = parseReference('시 23');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toBe('시편 23장');
    expect(result.referenceEn).toBe('Psalms 23');
  });

  it('장 범위', () => {
    const result = parseReference('창 1-2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.reference).toBe('창세기 1-2장');
  });

  it('장을 넘는 범위', () => {
    const result = parseReference('요 3:16-4:2');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referenceAbbr).toBe('요 3:16-4:2');
  });

  it('같은 책의 복수 구간은 책 이름을 한 번만 쓴다', () => {
    const result = parseReference('마 5:3-12; 6:9-13');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referenceAbbr).toBe('마 5:3-12; 6:9-13');
  });

  it('책이 바뀌면 이름을 다시 쓴다', () => {
    const result = parseReference('요 3:16; 롬 8:28');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.referenceAbbr).toBe('요 3:16; 롬 8:28');
  });

  it('직접 호출도 지원한다', () => {
    expect(formatRanges([range(43, 3, 16)], 'abbr')).toBe('요 3:16');
  });
});

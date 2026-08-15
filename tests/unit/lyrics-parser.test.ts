import { describe, expect, it } from 'vitest';

import {
  detectRefrain,
  formatLyrics,
  inferSectionKind,
  parseLyrics,
  splitIntoLines,
  toSongLines,
} from '../../lib/lyrics-parser.ts';

describe('inferSectionKind', () => {
  const cases: Array<[string, string]> = [
    ['1절', 'verse'],
    ['2절', 'verse'],
    ['후렴', 'chorus'],
    ['Chorus', 'chorus'],
    ['Refrain', 'chorus'],
    ['브릿지', 'bridge'],
    ['Bridge', 'bridge'],
    ['Pre-Chorus', 'prechorus'],
    ['Tag', 'tag'],
    ['Ending', 'ending'],
    ['Intro', 'intro'],
    ['알 수 없는 라벨', 'verse'],
  ];

  for (const [label, kind] of cases) {
    it(`'${label}' → ${kind}`, () => {
      expect(inferSectionKind(label)).toBe(kind);
    });
  }
});

describe('parseLyrics', () => {
  it('섹션 머리와 줄을 구조로 만든다', () => {
    const sections = parseLyrics(['[1절]', '첫째 줄', '둘째 줄', '', '[후렴]', '후렴 줄'].join('\n'));

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ kind: 'verse', label: '1절' });
    expect(sections[0]!.lines.map((l) => l.text)).toEqual(['첫째 줄', '둘째 줄']);
    expect(sections[1]).toMatchObject({ kind: 'chorus', label: '후렴' });
  });

  it('| 로 시작하는 줄을 직전 줄의 번역으로 짝짓는다', () => {
    // 같은 lineIndex 를 공유해야 화면에서 위아래로 겹쳐 표시된다
    const sections = parseLyrics(
      ['[1절]', '주 예수보다 더 귀한 것은 없네', "| I'd rather have Jesus than silver or gold"].join('\n'),
    );

    const lines = sections[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ lineIndex: 0, lang: 'ko', text: '주 예수보다 더 귀한 것은 없네' });
    expect(lines[1]).toEqual({
      lineIndex: 0,
      lang: 'en',
      text: "I'd rather have Jesus than silver or gold",
    });
  });

  it('여러 줄을 각각 짝짓는다', () => {
    const sections = parseLyrics(['[1절]', '한국어 1', '| English 1', '한국어 2', '| English 2'].join('\n'));

    const byIndex = (index: number) => sections[0]!.lines.filter((l) => l.lineIndex === index).map((l) => l.text);
    expect(byIndex(0)).toEqual(['한국어 1', 'English 1']);
    expect(byIndex(1)).toEqual(['한국어 2', 'English 2']);
  });

  it('언어 코드를 지정할 수 있다', () => {
    const sections = parseLyrics(['가사', '| 歌詞'].join('\n'), { primaryLang: 'ko', secondaryLang: 'ja' });
    expect(sections[0]!.lines.map((l) => l.lang)).toEqual(['ko', 'ja']);
  });

  it('섹션 머리가 없으면 1절을 자동으로 만든다', () => {
    const sections = parseLyrics('머리 없는 가사');
    expect(sections).toHaveLength(1);
    expect(sections[0]!.label).toBe('1절');
  });

  it('빈 줄과 공백을 무시한다', () => {
    const sections = parseLyrics(['[1절]', '', '   ', '가사', ''].join('\n'));
    expect(sections[0]!.lines).toHaveLength(1);
  });

  it('내용 없는 섹션은 버린다', () => {
    expect(parseLyrics(['[1절]', '[2절]', '가사'].join('\n'))).toHaveLength(1);
  });

  it('빈 입력은 빈 배열', () => {
    expect(parseLyrics('')).toEqual([]);
    expect(parseLyrics('   \n  ')).toEqual([]);
  });

  it('첫 줄이 | 로 시작해도 죽지 않는다', () => {
    const sections = parseLyrics(['[1절]', '| 번역만 있음'].join('\n'));
    expect(sections[0]!.lines[0]).toMatchObject({ lineIndex: 0, lang: 'en' });
  });
});

describe('formatLyrics — 파싱의 역방향', () => {
  it('파싱 → 포맷을 거쳐도 같은 구조가 나온다', () => {
    const original = ['[1절]', '한국어 1', '| English 1', '한국어 2', '', '[후렴]', '후렴 줄'].join('\n');
    const roundTrip = formatLyrics(parseLyrics(original));
    expect(parseLyrics(roundTrip)).toEqual(parseLyrics(original));
  });

  it('섹션 머리를 붙인다', () => {
    expect(formatLyrics(parseLyrics(['[후렴]', '가사'].join('\n')))).toContain('[후렴]');
  });
});

describe('detectRefrain', () => {
  it('절 뒤에 반복되는 후렴을 찾아낸다', () => {
    // 새찬송가 289장 구조 — 후렴이 각 절 뒤에 인라인으로 붙어 있다
    const verses = [
      '주 예수 내 맘에 들어와 계신 후 변하여 새 사람되고 주 예수 내 맘에 오심 기쁨이 넘침은',
      '주 예수 내 맘에 들어와 계신 후 망령된 행실을 끊고 주 예수 내 맘에 오심 기쁨이 넘침은',
      '내 맘에 소망을 든든히 가짐은 의심의 구름이 사라져 주 예수 내 맘에 오심 기쁨이 넘침은',
    ];
    const result = detectRefrain(verses);

    expect(result.refrain).toBe('주 예수 내 맘에 오심 기쁨이 넘침은');
    // 7어절 — 8어절 미만이므로 '확인 필요' 등급이다
    expect(result.words).toBe(7);
    expect(result.confidence).toBe('low');
    expect(result.verses[0]).toBe('주 예수 내 맘에 들어와 계신 후 변하여 새 사람되고');
  });

  it('8~11어절은 유력으로 본다', () => {
    const tail = '가 나 다 라 마 바 사 아';
    const result = detectRefrain([`앞말1 ${tail}`, `앞말2 ${tail}`]);
    expect(result.words).toBe(8);
    expect(result.confidence).toBe('medium');
  });

  it('12어절 이상이면 확실로 본다', () => {
    const tail = '가 나 다 라 마 바 사 아 자 차 카 타';
    const result = detectRefrain([`앞말1 ${tail}`, `앞말2 ${tail}`]);
    expect(result.words).toBe(12);
    expect(result.confidence).toBe('high');
  });

  it('후렴이 없는 곡은 null', () => {
    // 새찬송가 305장 — 절마다 끝이 다르다
    const verses = [
      '나 같은 죄인 살리신 주 은혜 놀라워 잃었던 생명 찾았고',
      '큰 죄악에서 건지신 주 은혜 고마워 나 처음 믿은 그 시간',
      '이제껏 내가 산 것도 주님의 은혜라 또 나를 장차 본향에',
    ];
    expect(detectRefrain(verses).refrain).toBeNull();
  });

  it('짧은 공통 접미사는 후렴으로 보지 않는다 (우연한 일치 배제)', () => {
    expect(detectRefrain(['첫째 절 아멘', '둘째 절 아멘']).refrain).toBeNull();
  });

  it('절이 하나면 검출하지 않는다', () => {
    expect(detectRefrain(['혼자 있는 절 텍스트입니다']).refrain).toBeNull();
    expect(detectRefrain([]).refrain).toBeNull();
  });

  it('절 전체가 후렴이 되지 않게 최소 1어절은 남긴다', () => {
    const identical = '완전히 똑같은 가사 문장 반복입니다';
    const result = detectRefrain([identical, identical]);
    expect(result.verses.every((v) => v.length > 0)).toBe(true);
  });

  it('원본 배열을 변형하지 않는다', () => {
    const verses = ['가 나 공통 접미사 문장', '다 라 공통 접미사 문장'];
    const snapshot = [...verses];
    detectRefrain(verses);
    expect(verses).toEqual(snapshot);
  });
});

describe('splitIntoLines', () => {
  it('짧은 문장은 나누지 않는다', () => {
    expect(splitIntoLines('짧은 가사')).toEqual(['짧은 가사']);
  });

  it('어절 경계에서만 나눈다 — 단어가 쪼개지지 않는다', () => {
    const text = '만복의 근원 하나님 온 백성 찬송 드리고 저 천사여 찬송하세 찬송 성부 성자 성령';
    const lines = splitIntoLines(text, 20);

    expect(lines.length).toBeGreaterThan(1);
    // 다시 이어 붙이면 원문과 같아야 한다 (글자 손실 없음)
    expect(lines.join(' ')).toBe(text);
    for (const line of lines) expect(line).not.toMatch(/^\s|\s$/);
  });

  it('줄 길이를 고르게 맞춘다 (마지막 줄만 짧아지지 않게)', () => {
    const text = '가나다 라마바 사아자 차카타 파하가 나다라 마바사 아자차 카타파 하가나';
    const lines = splitIntoLines(text, 20);
    const lengths = lines.map((l) => l.length);
    // 가장 긴 줄과 가장 짧은 줄의 차이가 목표 폭의 절반을 넘지 않는다
    expect(Math.max(...lengths) - Math.min(...lengths)).toBeLessThanOrEqual(10);
  });

  it('목표 길이를 조절할 수 있다', () => {
    const text = '가나다 라마바 사아자 차카타 파하가 나다라 마바사 아자차';
    expect(splitIntoLines(text, 10).length).toBeGreaterThan(splitIntoLines(text, 30).length);
  });

  it('빈 입력은 빈 배열', () => {
    expect(splitIntoLines('')).toEqual([]);
    expect(splitIntoLines('   ')).toEqual([]);
  });

  it('목표보다 긴 단어 하나만 있어도 죽지 않는다', () => {
    const long = '가'.repeat(60);
    expect(splitIntoLines(long, 20)).toEqual([long]);
  });

  it('실제 찬송가 가사에서 글자를 잃지 않는다', () => {
    const text =
      '나 같은 죄인 살리신 주 은혜 놀라워 잃었던 생명 찾았고 광명을 얻었네 큰 죄악에서 건지신 주 은혜 고마워';
    const lines = splitIntoLines(text);
    expect(lines.join(' ')).toBe(text);
  });
});

describe('toSongLines', () => {
  it('줄 배열에 인덱스와 언어를 붙인다', () => {
    expect(toSongLines(['첫째', '둘째'], 'ko')).toEqual([
      { lineIndex: 0, lang: 'ko', text: '첫째' },
      { lineIndex: 1, lang: 'ko', text: '둘째' },
    ]);
  });
});

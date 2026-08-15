import { describe, expect, it } from 'vitest';

import {
  availableLangs,
  buildSectionSlides,
  buildSongDeck,
  fitLinesToWidth,
  pairLines,
} from '../../lib/song-slides.ts';
import type { Song, SongLine, SongSection } from '../../shared/types.ts';

function section(id: number, label: string, lines: SongLine[], kind: SongSection['kind'] = 'verse'): SongSection {
  return { id, kind, label, position: id - 1, lines };
}

function bilingual(index: number, ko: string, en: string): SongLine[] {
  return [
    { lineIndex: index, lang: 'ko', text: ko },
    { lineIndex: index, lang: 'en', text: en },
  ];
}

function entry(songbookId: string, name: string, shortLabel: string, number?: number) {
  return { songbookId, songbookName: name, songbookShortLabel: shortLabel, ...(number !== undefined ? { number } : {}) };
}

function song(sections: SongSection[], overrides: Partial<Song> = {}): Song {
  return {
    id: 1,
    title: '나 같은 죄인 살리신',
    tags: [],
    entries: [entry('misc', '기타', '기')],
    langs: [...new Set(sections.flatMap((s) => s.lines.map((l) => l.lang)))],
    sections,
    ...overrides,
  };
}

const VERSE = section(1, '1절', [
  ...bilingual(0, '나 같은 죄인 살리신', 'Amazing grace how sweet the sound'),
  ...bilingual(1, '주 은혜 놀라워', 'That saved a wretch like me'),
  ...bilingual(2, '잃었던 생명 찾았고', 'I once was lost but now am found'),
  ...bilingual(3, '광명을 얻었네', 'Was blind but now I see'),
]);

/**
 * 표시 폭 묶음을 끈다.
 *
 * 화면 나눔(chunk)과 폭 묶음(fitLinesToWidth)은 별개의 관심사다. 나눔을 검증할
 * 때 폭 묶음이 끼어들면 무엇을 재는지 알 수 없어진다.
 */
const NO_MERGE = { maxCharsPerLine: 1 } as const;

describe('pairLines — lineIndex 페어링', () => {
  it('같은 lineIndex 의 줄들을 한 묶음으로 만든다', () => {
    const groups = pairLines(VERSE, ['ko', 'en']);
    expect(groups).toHaveLength(4);
    expect(groups[0]!.map((l) => l.text)).toEqual(['나 같은 죄인 살리신', 'Amazing grace how sweet the sound']);
  });

  it('요청한 언어 순서를 그대로 표시 순서로 쓴다', () => {
    const groups = pairLines(VERSE, ['en', 'ko']);
    expect(groups[0]!.map((l) => l.lang)).toEqual(['en', 'ko']);
  });

  it('한 언어만 요청하면 그 언어만 담는다', () => {
    const groups = pairLines(VERSE, ['ko']);
    expect(groups.every((g) => g.length === 1 && g[0]!.lang === 'ko')).toBe(true);
  });

  it('없는 언어를 요청해도 빈 자리를 만들지 않는다', () => {
    // 한국어만 있는 찬송가에 영어를 켜도 화면이 비지 않아야 한다
    const koOnly = section(1, '1절', [{ lineIndex: 0, lang: 'ko', text: '가사' }]);
    const groups = pairLines(koOnly, ['ko', 'en']);
    expect(groups).toEqual([[{ lineIndex: 0, lang: 'ko', text: '가사' }]]);
  });

  it('번역만 있는 줄도 묶음이 된다', () => {
    const enOnly = section(1, '1절', [{ lineIndex: 0, lang: 'en', text: 'only english' }]);
    expect(pairLines(enOnly, ['ko', 'en'])).toHaveLength(1);
  });

  it('중간 lineIndex 가 비어도 건너뛴다', () => {
    const gapped = section(1, '1절', [
      { lineIndex: 0, lang: 'ko', text: '첫' },
      { lineIndex: 2, lang: 'ko', text: '셋' },
    ]);
    expect(pairLines(gapped, ['ko']).map((g) => g[0]!.text)).toEqual(['첫', '셋']);
  });

  it('빈 섹션은 빈 배열', () => {
    expect(pairLines(section(1, '1절', []), ['ko'])).toEqual([]);
  });
});

describe('buildSectionSlides', () => {
  it('2줄씩 나눈다', () => {
    const slides = buildSectionSlides(song([VERSE]), VERSE, { langs: ['ko', 'en'], linesPerSlide: 2 });
    expect(slides).toHaveLength(2);
    expect(slides[0]!.kind === 'song' && slides[0]!.lines).toHaveLength(2);
  });

  it('1줄씩 나눈다', () => {
    expect(buildSectionSlides(song([VERSE]), VERSE, { langs: ['ko'], linesPerSlide: 1, ...NO_MERGE })).toHaveLength(4);
  });

  it('섹션 전체를 한 화면에', () => {
    const slides = buildSectionSlides(song([VERSE]), VERSE, { langs: ['ko'], linesPerSlide: 'section', ...NO_MERGE });
    expect(slides).toHaveLength(1);
    expect(slides[0]!.kind === 'song' && slides[0]!.lines).toHaveLength(4);
  });

  it('제목과 섹션 라벨을 붙인다', () => {
    const slides = buildSectionSlides(song([VERSE]), VERSE, { langs: ['ko'] });
    const slide = slides[0]!;
    expect(slide.kind === 'song' && slide.title).toBe('나 같은 죄인 살리신');
    expect(slide.kind === 'song' && slide.sectionLabel).toBe('1절');
  });

  it('수록 곡집 번호를 저작권 표기에 넣는다', () => {
    const hymn = song([VERSE], { entries: [entry('hymn_new', '새찬송가', '새', 305)] });
    const slides = buildSectionSlides(hymn, VERSE, { langs: ['ko'], includeCredit: true });
    expect(slides[0]!.kind === 'song' && slides[0]!.credit).toBe('새찬송가 305장');
  });

  it('CCLI·저작권을 함께 표기한다', () => {
    // 번호 없는 '기타' 수록곡은 곡집 표기를 붙이지 않는다
    const ccm = song([VERSE], { copyright: '© 2020 예시', ccliNumber: '1234567' });
    const slides = buildSectionSlides(ccm, VERSE, { langs: ['ko'], includeCredit: true });
    expect(slides[0]!.kind === 'song' && slides[0]!.credit).toBe('© 2020 예시 · CCLI 1234567');
  });

  it('저작권 표기를 끄면 붙이지 않는다', () => {
    const hymn = song([VERSE], { entries: [entry('hymn_new', '새찬송가', '새', 305)] });
    const slides = buildSectionSlides(hymn, VERSE, { langs: ['ko'], includeCredit: false });
    expect(slides[0]!.kind === 'song' && slides[0]!.credit).toBeUndefined();
  });

  it('빈 섹션은 슬라이드를 만들지 않는다', () => {
    const empty = section(9, '빈 절', []);
    expect(buildSectionSlides(song([empty]), empty, { langs: ['ko'] })).toEqual([]);
  });

  it('원본 곡을 변형하지 않는다', () => {
    const target = song([VERSE]);
    const snapshot = JSON.parse(JSON.stringify(target));
    buildSectionSlides(target, VERSE, { langs: ['ko', 'en'] });
    expect(target).toEqual(snapshot);
  });
});

describe('buildSongDeck', () => {
  const CHORUS = section(2, '후렴', [{ lineIndex: 0, lang: 'ko', text: '후렴 줄' }], 'chorus');

  it('섹션 순서대로 슬라이드를 만든다', () => {
    const { slides, labels } = buildSongDeck(song([VERSE, CHORUS]), { langs: ['ko'], linesPerSlide: 2, ...NO_MERGE });
    expect(slides).toHaveLength(3); // 1절 2장 + 후렴 1장
    expect(labels).toEqual(['1절 1/2', '1절 2/2', '후렴']);
  });

  it('섹션 안에서 한 장뿐이면 번호를 붙이지 않는다', () => {
    const { labels } = buildSongDeck(song([CHORUS]), { langs: ['ko'], linesPerSlide: 'section' });
    expect(labels).toEqual(['후렴']);
  });

  it('진행 순서를 지정하면 같은 섹션이 여러 번 나온다', () => {
    // 1절 → 후렴 → 후렴 은 찬양의 기본 형태다
    const { slides, labels } = buildSongDeck(song([VERSE, CHORUS]), {
      langs: ['ko'],
      linesPerSlide: 'section',
      sequence: [1, 2, 2],
    });
    expect(slides).toHaveLength(3);
    expect(labels).toEqual(['1절', '후렴', '후렴']);
  });

  it('진행 순서에 없는 섹션 id 는 무시한다', () => {
    const { slides } = buildSongDeck(song([VERSE, CHORUS]), {
      langs: ['ko'],
      linesPerSlide: 'section',
      sequence: [1, 999],
    });
    expect(slides).toHaveLength(1);
  });

  it('position 순으로 정렬한다 (배열 순서를 신뢰하지 않는다)', () => {
    const reversed = song([
      { ...CHORUS, position: 1 },
      { ...VERSE, position: 0 },
    ]);
    const { labels } = buildSongDeck(reversed, { langs: ['ko'], linesPerSlide: 'section' });
    expect(labels).toEqual(['1절', '후렴']);
  });
});

describe('availableLangs', () => {
  it('한국어를 먼저, 영어를 다음으로 정렬한다', () => {
    expect(availableLangs(song([VERSE]))).toEqual(['ko', 'en']);
  });

  it('알 수 없는 언어는 뒤로 보낸다', () => {
    const mixed = song([section(1, '1절', [
      { lineIndex: 0, lang: 'sw', text: 'x' },
      { lineIndex: 0, lang: 'ko', text: '가' },
    ])]);
    expect(availableLangs(mixed)[0]).toBe('ko');
  });
});

describe('고아 줄 방지', () => {
  const lines = (count: number): SongSection =>
    section(
      1,
      '1절',
      Array.from({ length: count }, (_, i) => ({ lineIndex: i, lang: 'ko' as const, text: `줄${i + 1}` })),
    );

  const shape = (count: number, perSlide: 1 | 2 | 4): number[] =>
    buildSectionSlides(song([lines(count)]), lines(count), {
      langs: ['ko'],
      linesPerSlide: perSlide,
      ...NO_MERGE,
    }).map((s) =>
      s.kind === 'song' ? s.lines.length : 0,
    );

  it('3줄을 2줄씩 = 한 화면 (2+1 로 쪼개지 않는다)', () => {
    // 캡처로 보고된 실제 사고: '당하셨네' 한 줄만 다음 화면으로 넘어갔다
    expect(shape(3, 2)).toEqual([3]);
  });

  it('5줄을 2줄씩 = 3+2 (2+2+1 이 아니다)', () => {
    expect(shape(5, 2)).toEqual([3, 2]);
  });

  it('7줄을 2줄씩 = 3+2+2', () => {
    expect(shape(7, 2)).toEqual([3, 2, 2]);
  });

  it('6줄을 4줄씩 = 3+3 (4+2 로 치우치지 않는다)', () => {
    expect(shape(6, 4)).toEqual([3, 3]);
  });

  it('5줄을 4줄씩 = 3+2 (4+1 이 아니다)', () => {
    expect(shape(5, 4)).toEqual([3, 2]);
  });

  it('나누어떨어지면 그대로', () => {
    expect(shape(4, 2)).toEqual([2, 2]);
    expect(shape(8, 4)).toEqual([4, 4]);
  });

  it('한 줄뿐인 섹션은 한 화면', () => {
    // 아멘 곡 — 줄이 하나뿐이라 줄일 장이 없다
    expect(shape(1, 2)).toEqual([1]);
  });

  it('1줄씩 설정은 고아 판단을 하지 않는다', () => {
    // 모든 화면이 한 줄인 것이 의도다
    expect(shape(3, 1)).toEqual([1, 1, 1]);
  });

  it('한 화면이 size + 1 을 넘지 않는다', () => {
    for (const count of [3, 5, 7, 9, 11, 13]) {
      for (const per of [1, 2, 4] as const) {
        const sizes = shape(count, per);
        expect(Math.max(...sizes), `${count}줄 ${per}줄씩`).toBeLessThanOrEqual(per + 1);
      }
    }
  });
});

describe('fitLinesToWidth — 표시 폭에 맞춰 묶기', () => {
  /** 새256 의 실제 저장 형태 — 운율 9.9.9.9 */
  const HYMN_256 = ['나의 죄 모두 지신 주님', '십자가 모진 그 고통을', '묵묵히 참고 당하셨네', '그 은혜 어찌 보답할까'].map(
    (text, lineIndex) => [{ lineIndex, lang: 'ko' as const, text }],
  );

  const texts = (groups: ReturnType<typeof fitLinesToWidth>): string[] =>
    groups.map((group) => group.map((line) => line.text).join(' | '));

  it('24자 기준이면 4행을 2행으로 묶는다', () => {
    const fitted = fitLinesToWidth(HYMN_256, 24);
    expect(texts(fitted)).toEqual([
      '나의 죄 모두 지신 주님 십자가 모진 그 고통을',
      '묵묵히 참고 당하셨네 그 은혜 어찌 보답할까',
    ]);
  });

  it('폭이 좁으면 운율 행을 그대로 쓴다', () => {
    // 전체화면 큰 글씨 템플릿 — 9자 행을 묶지 않는다
    expect(fitLinesToWidth(HYMN_256, 12)).toHaveLength(4);
  });

  it('폭이 아주 넓어도 한 행으로 뭉치지 않는다면 2행에서 멈춘다', () => {
    // 4 → 2 → 1 까지 갈 수 있지만 1행이 되려면 39자가 필요하다
    expect(fitLinesToWidth(HYMN_256, 30)).toHaveLength(2);
  });

  it('묶은 결과가 홀수가 되면 묶지 않는다', () => {
    // 6행을 3행으로 묶으면 2줄씩 표시에서 마지막 한 줄이 혼자 남는다
    const six = Array.from({ length: 6 }, (_, lineIndex) => [
      { lineIndex, lang: 'ko' as const, text: '여덟자짜리행' },
    ]);
    expect(fitLinesToWidth(six, 24)).toHaveLength(6);
  });

  it('8행은 4행으로 묶는다', () => {
    const eight = Array.from({ length: 8 }, (_, lineIndex) => [
      { lineIndex, lang: 'ko' as const, text: '아홉자짜리인행' },
    ]);
    expect(fitLinesToWidth(eight, 24)).toHaveLength(4);
  });

  it('두 언어를 각각 이어 붙인다 (줄 짝이 유지된다)', () => {
    const groups = [
      [
        { lineIndex: 0, lang: 'ko' as const, text: '나 같은' },
        { lineIndex: 0, lang: 'en' as const, text: 'Amazing' },
      ],
      [
        { lineIndex: 1, lang: 'ko' as const, text: '죄인 살리신' },
        { lineIndex: 1, lang: 'en' as const, text: 'grace' },
      ],
    ];
    const fitted = fitLinesToWidth(groups, 24);
    expect(fitted).toHaveLength(1);
    expect(fitted[0]!.find((line) => line.lang === 'ko')!.text).toBe('나 같은 죄인 살리신');
    expect(fitted[0]!.find((line) => line.lang === 'en')!.text).toBe('Amazing grace');
  });

  it('가장 긴 언어를 기준으로 폭을 본다', () => {
    // 한국어는 짧아도 영어가 넘치면 묶지 않는다
    const groups = [
      [
        { lineIndex: 0, lang: 'ko' as const, text: '짧다' },
        { lineIndex: 0, lang: 'en' as const, text: 'This English line is quite long' },
      ],
      [
        { lineIndex: 1, lang: 'ko' as const, text: '짧다' },
        { lineIndex: 1, lang: 'en' as const, text: 'And so is this one here' },
      ],
    ];
    expect(fitLinesToWidth(groups, 24)).toHaveLength(2);
  });

  it('홀수 행은 그대로 둔다', () => {
    const three = Array.from({ length: 3 }, (_, lineIndex) => [
      { lineIndex, lang: 'ko' as const, text: '다섯자행' },
    ]);
    expect(fitLinesToWidth(three, 24)).toHaveLength(3);
  });

  it('한 행이면 그대로', () => {
    expect(fitLinesToWidth([HYMN_256[0]!], 24)).toHaveLength(1);
  });
});

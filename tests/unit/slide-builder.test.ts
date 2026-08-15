import { describe, expect, it } from 'vitest';

import { buildSlides, describeSlide } from '../../lib/slide-builder.ts';
import type { Passage, PassageBlock, Verse } from '../../shared/types.ts';

function verse(chapter: number, num: number, text: string): Verse {
  return { book: 43, chapter, verse: num, text };
}

function block(id: string, verses: Verse[], overrides: Partial<PassageBlock> = {}): PassageBlock {
  return {
    translationId: id,
    translationName: id.toUpperCase(),
    lang: id === 'nkrv' ? 'ko' : 'en',
    direction: 'ltr',
    verses,
    ...overrides,
  };
}

function passage(blocks: PassageBlock[], heading?: string): Passage {
  return {
    reference: '요한복음 3:16-18',
    referenceAbbr: '요 3:16-18',
    referenceEn: 'John 3:16-18',
    ranges: [{ book: 43, startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 18 }],
    blocks,
    ...(heading ? { heading } : {}),
  };
}

const KO = [verse(3, 16, '가'), verse(3, 17, '나'), verse(3, 18, '다')];
const EN = [verse(3, 16, 'a'), verse(3, 17, 'b'), verse(3, 18, 'c')];

describe('buildSlides — 화면 넘김 단위', () => {
  it('1절씩 나눈다', () => {
    const slides = buildSlides(passage([block('nkrv', KO)]), 'verse');
    expect(slides).toHaveLength(3);
    expect(slides.map((s) => (s.kind === 'bible' ? s.blocks[0]!.verses.map((v) => v.verse) : []))).toEqual([
      [16],
      [17],
      [18],
    ]);
  });

  it('2절씩 나누고 남는 절은 마지막 화면에 붙인다', () => {
    const slides = buildSlides(passage([block('nkrv', KO)]), 'pair');
    expect(slides).toHaveLength(2);
    expect(slides.map((s) => (s.kind === 'bible' ? s.blocks[0]!.verses.map((v) => v.verse) : []))).toEqual([
      [16, 17],
      [18],
    ]);
  });

  it('구간 전체를 한 화면에 담는다', () => {
    const slides = buildSlides(passage([block('nkrv', KO)]), 'all');
    expect(slides).toHaveLength(1);
    expect(slides[0]!.kind === 'bible' && slides[0]!.blocks[0]!.verses).toHaveLength(3);
  });

  it("auto 는 아직 'pair' 와 같다 (실측 분할은 Phase 3)", () => {
    expect(buildSlides(passage([block('nkrv', KO)]), 'auto')).toEqual(
      buildSlides(passage([block('nkrv', KO)]), 'pair'),
    );
  });

  it('기본값은 2절씩이다', () => {
    expect(buildSlides(passage([block('nkrv', KO)]))).toHaveLength(2);
  });
});

describe('buildSlides — 다역본 정렬', () => {
  it('같은 절이 같은 화면에 온다', () => {
    const slides = buildSlides(passage([block('nkrv', KO), block('niv', EN)]), 'verse');

    expect(slides).toHaveLength(3);
    for (const [index, expectedVerse] of [16, 17, 18].entries()) {
      const slide = slides[index]!;
      if (slide.kind !== 'bible') throw new Error('bible 슬라이드가 아닙니다');
      expect(slide.blocks).toHaveLength(2);
      expect(slide.blocks[0]!.verses.map((v) => v.verse)).toEqual([expectedVerse]);
      expect(slide.blocks[1]!.verses.map((v) => v.verse)).toEqual([expectedVerse]);
    }
  });

  it('보조 역본에 없는 절은 그 블록에서만 빠진다', () => {
    // 역본마다 절 분할이 다르다 (공동번역 31,258절 vs 개역개정 31,102절)
    const partial = [verse(3, 16, 'a'), verse(3, 18, 'c')];
    const slides = buildSlides(passage([block('nkrv', KO), block('niv', partial)]), 'verse');

    expect(slides).toHaveLength(3);
    const second = slides[1]!;
    if (second.kind !== 'bible') throw new Error('bible 슬라이드가 아닙니다');
    expect(second.blocks[0]!.verses.map((v) => v.verse)).toEqual([17]);
    expect(second.blocks[1]!.verses).toEqual([]);
  });

  it('주 역본에 본문이 없으면 실제로 절이 있는 블록을 기준으로 삼는다', () => {
    // 헬라어로 구약을 조회한 경우 — 화면이 비지 않아야 한다
    const slides = buildSlides(
      passage([block('grk', [], { unavailable: true }), block('nkrv', KO)]),
      'verse',
    );
    expect(slides).toHaveLength(3);
  });

  it('모든 블록이 비면 슬라이드를 만들지 않는다', () => {
    expect(buildSlides(passage([block('grk', [], { unavailable: true })]), 'verse')).toEqual([]);
    expect(buildSlides(passage([]), 'verse')).toEqual([]);
  });
});

describe('buildSlides — 참조와 소제목', () => {
  it('모든 슬라이드에 약어 참조를 붙인다', () => {
    const slides = buildSlides(passage([block('nkrv', KO)]), 'verse');
    for (const slide of slides) {
      expect(slide.kind === 'bible' && slide.reference).toBe('요 3:16-18');
    }
  });

  it('소제목은 첫 슬라이드에만 넣는다', () => {
    // 매 화면 반복하면 본문 자리를 잡아먹는다
    const slides = buildSlides(passage([block('nkrv', KO)], '예수와 니고데모'), 'verse');
    expect(slides[0]!.kind === 'bible' && slides[0]!.heading).toBe('예수와 니고데모');
    expect(slides[1]!.kind === 'bible' && slides[1]!.heading).toBeUndefined();
    expect(slides[2]!.kind === 'bible' && slides[2]!.heading).toBeUndefined();
  });

  it('원본 블록을 변형하지 않는다 (불변성)', () => {
    const original = block('nkrv', KO);
    const snapshot = JSON.parse(JSON.stringify(original));
    buildSlides(passage([original]), 'verse');
    expect(original).toEqual(snapshot);
  });
});

describe('describeSlide', () => {
  it('단일 절', () => {
    const slides = buildSlides(passage([block('nkrv', KO)]), 'verse');
    expect(describeSlide(slides[0]!)).toBe('3:16');
  });

  it('같은 장 안의 범위', () => {
    const slides = buildSlides(passage([block('nkrv', KO)]), 'pair');
    expect(describeSlide(slides[0]!)).toBe('3:16-17');
  });

  it('장을 넘는 범위', () => {
    const crossChapter = [verse(3, 36, 'x'), verse(4, 1, 'y')];
    const slides = buildSlides(passage([block('nkrv', crossChapter)]), 'all');
    expect(describeSlide(slides[0]!)).toBe('3:36-4:1');
  });

  it('성경이 아닌 슬라이드는 빈 문자열', () => {
    expect(describeSlide({ kind: 'blank' })).toBe('');
    expect(describeSlide({ kind: 'text', lines: ['광고'] })).toBe('');
  });

  it('절이 없는 슬라이드는 빈 문자열', () => {
    expect(describeSlide({ kind: 'bible', reference: '요 3:16', blocks: [] })).toBe('');
  });
});

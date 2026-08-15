/**
 * 자동 분할 테스트.
 *
 * 측정 함수를 주입하므로 브라우저 없이 로직을 고정할 수 있다.
 * '높이'는 절 텍스트 길이의 합으로 흉내 낸다.
 */

import { describe, expect, it, vi } from 'vitest';

import { paginateByMeasure, paginateFixed, slideFromKeys, type MeasureFn } from '../../lib/paginator.ts';
import type { Passage, PassageBlock, SlidePayload, Verse } from '../../shared/types.ts';

function verse(num: number, text: string): Verse {
  return { book: 43, chapter: 3, verse: num, text };
}

function block(id: string, verses: Verse[], overrides: Partial<PassageBlock> = {}): PassageBlock {
  return { translationId: id, translationName: id, lang: 'ko', direction: 'ltr', verses, ...overrides };
}

function passage(blocks: PassageBlock[], heading?: string): Passage {
  return {
    reference: '요한복음 3장',
    referenceAbbr: '요 3장',
    referenceEn: 'John 3',
    ranges: [{ book: 43, startChapter: 3, startVerse: null, endChapter: 3, endVerse: null }],
    blocks,
    ...(heading ? { heading } : {}),
  };
}

/** 글자 수 합이 limit 을 넘으면 overflow 로 보는 가짜 측정기 */
function measurerWithLimit(limit: number): MeasureFn {
  return async (slide: SlidePayload) => {
    if (slide.kind !== 'bible') return { overflow: false, height: 0 };
    const height = slide.blocks.reduce(
      (sum, b) => sum + b.verses.reduce((s, v) => s + v.text.length, 0),
      0,
    );
    return { overflow: height > limit, height };
  };
}

const TEN = Array.from({ length: 10 }, (_, i) => verse(i + 1, '가'.repeat(10)));

describe('paginateByMeasure', () => {
  it('넘치기 직전까지 절을 담는다', async () => {
    // 절당 10자, 한 화면 35자까지 → 3절씩
    const result = await paginateByMeasure(passage([block('nkrv', TEN)]), measurerWithLimit(35));
    expect(result.slides.map((s) => (s.kind === 'bible' ? s.blocks[0]!.verses.length : 0))).toEqual([3, 3, 3, 1]);
    expect(result.overflowing).toBe(0);
  });

  it('모든 절을 정확히 한 번씩만 담는다', async () => {
    const result = await paginateByMeasure(passage([block('nkrv', TEN)]), measurerWithLimit(35));
    const numbers = result.slides.flatMap((s) => (s.kind === 'bible' ? s.blocks[0]!.verses.map((v) => v.verse) : []));
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('한 절만으로도 넘치면 그 절을 홀로 담고 건수를 알린다', async () => {
    const long = [verse(1, '가'.repeat(500)), verse(2, '나'.repeat(500))];
    const result = await paginateByMeasure(passage([block('nkrv', long)]), measurerWithLimit(100));
    expect(result.slides).toHaveLength(2);
    expect(result.overflowing).toBe(2);
  });

  it('한 화면 상한(12절)을 넘기지 않는다', async () => {
    // 측정기가 계속 '맞다'고 해도 무한히 담지 않아야 한다
    const many = Array.from({ length: 40 }, (_, i) => verse(i + 1, '가'));
    const result = await paginateByMeasure(passage([block('nkrv', many)]), measurerWithLimit(100000));
    for (const slide of result.slides) {
      if (slide.kind === 'bible') expect(slide.blocks[0]!.verses.length).toBeLessThanOrEqual(12);
    }
    expect(result.slides.flatMap((s) => (s.kind === 'bible' ? s.blocks[0]!.verses : []))).toHaveLength(40);
  });

  it('소제목은 첫 화면에만 넣는다', async () => {
    const result = await paginateByMeasure(
      passage([block('nkrv', TEN)], '예수와 니고데모'),
      measurerWithLimit(35),
    );
    expect(result.slides[0]!.kind === 'bible' && result.slides[0]!.heading).toBe('예수와 니고데모');
    expect(result.slides[1]!.kind === 'bible' && result.slides[1]!.heading).toBeUndefined();
  });

  it('다역본을 함께 재서 같은 절이 같은 화면에 온다', async () => {
    const ko = [verse(1, '가'.repeat(10)), verse(2, '나'.repeat(10))];
    const en = [verse(1, 'a'.repeat(10)), verse(2, 'b'.repeat(10))];
    // 두 역본 합쳐 25자 제한 → 절당 20자이므로 1절씩
    const result = await paginateByMeasure(passage([block('nkrv', ko), block('niv', en)]), measurerWithLimit(25));

    expect(result.slides).toHaveLength(2);
    for (const [index, expected] of [1, 2].entries()) {
      const slide = result.slides[index]!;
      if (slide.kind !== 'bible') throw new Error('bible 아님');
      expect(slide.blocks[0]!.verses.map((v) => v.verse)).toEqual([expected]);
      expect(slide.blocks[1]!.verses.map((v) => v.verse)).toEqual([expected]);
    }
  });

  it('보조 역본에 없는 절은 비워 둔다 (앞으로 당기지 않는다)', async () => {
    // 절 병합 역본 — 같은 내용이 두 화면에 겹쳐 나오는 것보다 비는 게 낫다
    const ko = [verse(1, '가'), verse(2, '나'), verse(3, '다')];
    const merged = [verse(1, 'a'), verse(3, 'c')];
    const result = await paginateByMeesureSafe(passage([block('nkrv', ko), block('klb', merged)]));

    const second = result.slides.find((s) => s.kind === 'bible' && s.blocks[0]!.verses[0]?.verse === 2);
    expect(second).toBeDefined();
    if (second?.kind === 'bible') expect(second.blocks[1]!.verses).toEqual([]);
  });

  async function paginateByMeesureSafe(p: Passage) {
    return paginateByMeasure(p, measurerWithLimit(1));
  }

  it('주 역본에 본문이 없으면 실제로 절이 있는 블록을 기준으로 삼는다', async () => {
    const result = await paginateByMeasure(
      passage([block('grk', [], { unavailable: true }), block('nkrv', TEN)]),
      measurerWithLimit(35),
    );
    expect(result.slides.length).toBeGreaterThan(0);
  });

  it('절이 하나도 없으면 슬라이드를 만들지 않고 측정도 하지 않는다', async () => {
    const measure = vi.fn<MeasureFn>(async () => ({ overflow: false, height: 0 }));
    const result = await paginateByMeasure(passage([]), measure);
    expect(result.slides).toEqual([]);
    expect(measure).not.toHaveBeenCalled();
  });
});

describe('paginateFixed', () => {
  it('고정 개수로 나눈다', () => {
    expect(paginateFixed(passage([block('nkrv', TEN)]), 2).slides).toHaveLength(5);
    expect(paginateFixed(passage([block('nkrv', TEN)]), 3).slides).toHaveLength(4);
  });

  it('0 이하나 무한이면 전체를 한 화면에', () => {
    expect(paginateFixed(passage([block('nkrv', TEN)]), 0).slides).toHaveLength(1);
    expect(paginateFixed(passage([block('nkrv', TEN)]), Number.POSITIVE_INFINITY).slides).toHaveLength(1);
  });

  it('소제목은 첫 화면에만', () => {
    const result = paginateFixed(passage([block('nkrv', TEN)], '소제목'), 2);
    expect(result.slides[0]!.kind === 'bible' && result.slides[0]!.heading).toBe('소제목');
    expect(result.slides[1]!.kind === 'bible' && result.slides[1]!.heading).toBeUndefined();
  });
});

describe('slideFromKeys', () => {
  it('원본 블록을 변형하지 않는다', () => {
    const p = passage([block('nkrv', TEN)]);
    const snapshot = JSON.parse(JSON.stringify(p));
    slideFromKeys(p, ['43:3:1'], { includeHeading: false });
    expect(p).toEqual(snapshot);
  });

  it('약어 참조를 붙인다', () => {
    const slide = slideFromKeys(passage([block('nkrv', TEN)]), ['43:3:1'], { includeHeading: false });
    expect(slide.kind === 'bible' && slide.reference).toBe('요 3장');
  });
});

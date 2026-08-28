import { describe, expect, it } from 'vitest';

import { isAmenSection, stripAmenEnglish, stripAmenMarker } from '../../lib/hymn-amen.ts';

describe('아멘 섹션', () => {
  it('[아멘] 은 가사가 아니라 표시다', () => {
    expect(isAmenSection('아멘')).toBe(true);
    expect(isAmenSection(' 아 멘 ')).toBe(true);
    expect(isAmenSection('1절')).toBe(false);
    expect(isAmenSection('아멘 아멘')).toBe(false);
  });
});

describe('한국어 아멘 떼기', () => {
  it('줄 끝 아멘을 뗀다', () => {
    expect(stripAmenMarker('찬송 성부 성자 성령 아멘')).toEqual({
      text: '찬송 성부 성자 성령',
      had: true,
    });
  });

  /* 새 628·641·643장 — 그 곡은 가사 자체가 아멘이다 */
  it('줄 전체가 아멘이면 본문으로 둔다', () => {
    expect(stripAmenMarker('아멘 아멘 아멘')).toEqual({ text: '아멘 아멘 아멘', had: false });
    expect(stripAmenMarker('아 멘')).toEqual({ text: '아 멘', had: false });
  });

  it('아멘이 없으면 그대로 둔다', () => {
    expect(stripAmenMarker('영광을 돌리세')).toEqual({ text: '영광을 돌리세', had: false });
  });
});

/*
 * 2026-08-28 — 한국어만 떼어 227곡의 짝이 어긋나 있었다. 한국어는 아멘 없이,
 * 영어는 `… Amen.` 으로 나가고 그 뒤에 아멘 슬라이드가 또 붙었다.
 */
describe('영어 Amen 떼기', () => {
  const cases: Array<[string, string]> = [
    ['Praise Father, Son, and Holy Ghost. Amen', 'Praise Father, Son, and Holy Ghost.'],
    ['And shall be evermore. Amen', 'And shall be evermore.'],
    ['Jesus led me all the way. Amen.', 'Jesus led me all the way.'],
    // 잇단 Amen 도 모두 뗀다 (새 3장)
    ['World without end. Amen, Amen. Amen.', 'World without end.'],
    // 자료에 A-men · A men 표기가 섞여 있다
    ['world without end. A men, Amen.', 'world without end.'],
    ['tion. A-men.', 'tion.'],
  ];
  for (const [raw, want] of cases) {
    it(`«${raw.slice(0, 34)}…» → «${want}»`, () => expect(stripAmenEnglish(raw)).toBe(want));
  }

  it('줄 전체가 Amen 이면 본문으로 둔다 (새 638장의 6중 아멘)', () => {
    const line = 'Amen, Amen, Amen, Amen, Amen, Amen.';
    expect(stripAmenEnglish(line)).toBe(line);
    expect(stripAmenEnglish('Amen.')).toBe('Amen.');
  });

  it('Amen 으로 시작하는 다른 낱말은 건드리지 않는다', () => {
    expect(stripAmenEnglish('the amendment of my ways')).toBe('the amendment of my ways');
    expect(stripAmenEnglish('A menace to none')).toBe('A menace to none');
  });

  it('문장 마침표는 남긴다 — 앞 문장의 것이다', () => {
    expect(stripAmenEnglish('Holy Ghost. Amen')).toBe('Holy Ghost.');
  });
});

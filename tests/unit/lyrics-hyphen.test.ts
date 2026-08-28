import { describe, expect, it } from 'vitest';

import { joinSyllableHyphens, stripScrapeJunk } from '../../lib/lyrics-hyphen.ts';

/*
 * 실제 새찬송가 자료에서 뽑은 꼴들이다. 2026-08-28 에 이 붙이기를 손으로 짜다
 * 세 번 틀렸다 — ① 하이픈 양쪽 공백 ② 잇단 하이픈의 겹치는 자리 ③ 뜻 있는 하이픈.
 * 그래서 세 가지를 모두 못 박는다.
 */
describe('음절 하이픈 붙이기', () => {
  const cases: Array<[string, string]> = [
    ['Cleans-ing', 'Cleansing'],
    ['Thine is the glo - ry', 'Thine is the glory'], // 양쪽 공백
    ["Thro' all cre-a - tion. A-men.", "Thro' all creation. Amen."], // 잇단 하이픈
    ['Let its el-e-va - tion', 'Let its elevation'],
    ['than an - y-thing', 'than anything'],
    ['Je - sus saves!', 'Jesus saves!'],
    ['sal-va-tion', 'salvation'],
    ['con-tin-u-al - ly', 'continually'],
    ['A-men.', 'Amen.'], // 첫 음절이 한 글자인 꼴
    ['O-ver-come the world.', 'Overcome the world.'],
    ['Life-Line', 'Life-Line'], // 뒤가 대문자면 남는다
    ['with-out', 'without'],
    ['for-give', 'forgive'],
  ];
  for (const [raw, want] of cases) {
    it(`«${raw}» → «${want}»`, () => expect(joinSyllableHyphens(raw)).toBe(want));
  }

  /*
   * 뜻이 있는 합성어는 남긴다. '양쪽이 소문자면 붙인다' 만으로는 가릴 수 없어서
   * 사전으로 자료 전체를 재고 65가지 후보를 손으로 갈라 목록을 만들었다.
   */
  it('뜻이 있는 합성어는 남긴다', () => {
    expect(joinSyllableHyphens('His nail-scarred hand')).toBe('His nail-scarred hand');
    expect(joinSyllableHyphens('a thorn-crowned brow')).toBe('a thorn-crowned brow');
    expect(joinSyllableHyphens('blood-bought')).toBe('blood-bought');
    expect(joinSyllableHyphens('far-off')).toBe('far-off');
    expect(joinSyllableHyphens('Far-off lands')).toBe('Far-off lands'); // 대소문자 무관
    expect(joinSyllableHyphens('well-nigh')).toBe('well-nigh');
  });

  it('남길 합성어에 낀 공백은 하이픈으로 조인다', () => {
    expect(joinSyllableHyphens('His nail - scarred hand')).toBe('His nail-scarred hand');
  });

  it('문장 부호로 쓰인 하이픈은 뒤가 대문자라 걸리지 않는다', () => {
    expect(joinSyllableHyphens('my on-ly plea-Christ died for me!')).toBe(
      'my only plea-Christ died for me!',
    );
  });

  it('낱말이 아닌 하이픈은 건드리지 않는다', () => {
    expect(joinSyllableHyphens('a — b')).toBe('a — b');
    expect(joinSyllableHyphens('1-2')).toBe('1-2');
    expect(joinSyllableHyphens('- 줄 머리 하이픈')).toBe('- 줄 머리 하이픈');
  });

  it('되돌아도 결과가 같다 (여러 번 돌려도 안전하다)', () => {
    const once = joinSyllableHyphens("Thro' all cre-a - tion.");
    expect(joinSyllableHyphens(once)).toBe(once);
  });
});

describe('크롤링 잔재 떼기', () => {
  it('줄 끝 첨부 목록을 뗀다', () => {
    expect(stripScrapeJunk('Hal-le-lu-jah! etc 파일 jpg 파일 ppt 파일 © Daum Corp.')).toBe(
      'Hal-le-lu-jah!',
    );
  });
  it('etc 파일 하나만 붙은 것도 뗀다', () => {
    expect(stripScrapeJunk('Let us dwell with Thee. etc 파일')).toBe('Let us dwell with Thee.');
  });
  it('잔재뿐인 줄은 빈 문자열이 된다', () => {
    expect(stripScrapeJunk('파일')).toBe('');
  });
  it('가사에 있는 다른 말은 건드리지 않는다', () => {
    expect(stripScrapeJunk('the file of my heart')).toBe('the file of my heart');
    expect(stripScrapeJunk('주의 파일이 아닌 말씀')).toBe('주의 파일이 아닌 말씀');
  });
});

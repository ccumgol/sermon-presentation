/**
 * 악보용 음절 하이픈 떼기 (한/영 자료 반입).
 *
 * 지키는 것 둘 — **음절 하이픈은 뗀다**(화면에 `rug-ged` 가 나가면 오타로 보인다),
 * **진짜 복합어는 남긴다**(`nail-scarred` 를 붙이면 더 나쁘다).
 */
import { describe, expect, it } from 'vitest';

import { COMPOUNDS, joinHyphenated, stripSyllableHyphens } from '../../lib/hymn-hyphen.ts';

/** 시험용 작은 사전 */
const DICT = new Set([
  'rugged', 'jesus', 'savior', 'glory', 'away', 'blessed', 'children', 'darkness',
  'bring', 'march', 'work', 'shower', 'season', 'flower', 'mercy', 'glory',
  'become', 'forgive', 'woman', 'honour', 'nail', 'scar', 'born', 'cross', 'crown',
]);

describe('음절 하이픈을 뗀다', () => {
  it('붙이면 사전에 있는 낱말', () => {
    expect(joinHyphenated('rug-ged', DICT)).toBe('rugged');
    expect(joinHyphenated('Je-sus', DICT)).toBe('Jesus');
    expect(joinHyphenated('a-way', DICT)).toBe('away');
  });

  it('굴절형도 알아본다 — 사전이 -ing·-ers·-ies 를 안 담는다', () => {
    expect(joinHyphenated('bring-ing', DICT)).toBe('bringing');
    expect(joinHyphenated('work-ers', DICT)).toBe('workers');
    expect(joinHyphenated('mer-cies', DICT)).toBe('mercies');
  });

  it('시적 축약은 한 낱말이다', () => {
    expect(joinHyphenated("ev-'ry", DICT)).toBe("ev'ry");
    expect(joinHyphenated("vic-t'ry", DICT)).toBe("vict'ry");
    expect(joinHyphenated("what-e'er", DICT)).toBe("whate'er");
  });

  it('세 조각 이상은 음절 분해다', () => {
    expect(joinHyphenated('glo-ri-fied', DICT)).toBe('glorified');
    expect(joinHyphenated('Who-so-ev-er', DICT)).toBe('Whosoever');
  });
});

describe('진짜 복합어는 남긴다', () => {
  it('손으로 판정한 표에 있는 것', () => {
    for (const word of ['nail-scarred', 'thorn-crowned', 'new-born', 'far-off', 'blood-red']) {
      expect(joinHyphenated(word, DICT), word).toBeUndefined();
    }
  });

  it('대소문자를 가리지 않는다', () => {
    expect(joinHyphenated('Cross-crowned', DICT)).toBeUndefined();
    expect(joinHyphenated('Far-off', DICT)).toBeUndefined();
  });

  it('표가 굴절형을 담지 않는다 — 그건 한 낱말이다', () => {
    expect(COMPOUNDS.has('might-ier')).toBe(false);
    expect(COMPOUNDS.has('heav-iest')).toBe(false);
  });
});

describe('줄 단위로 처리한다', () => {
  it('실제 악보 줄', () => {
    const line = 'On a hill for a-way stood an old rug-ged cross';
    expect(stripSyllableHyphens(line, DICT).text).toBe('On a hill for away stood an old rugged cross');
  });

  it('하이픈 둘레에 공백이 있어도 같은 것으로 본다', () => {
    // 실제 자료에 `A Won - drous` 가 있었다
    const out = stripSyllableHyphens('A Won - drous beau-ty', new Set([...DICT, 'wondrous', 'beauty']));
    expect(out.text).toBe('A Wondrous beauty');
  });

  it('복합어가 섞여 있어도 그것만 남긴다', () => {
    const out = stripSyllableHyphens('His nail-scarred hands, so ten-der', new Set([...DICT, 'tender']));
    expect(out.text).toBe('His nail-scarred hands, so tender');
    expect(out.kept).toEqual(['nail-scarred']);
  });

  it('판정 못 한 낱말은 남기고 알린다 — 다음 자료를 위해', () => {
    const out = stripSyllableHyphens('a zzz-qqq word', DICT);
    expect(out.text).toBe('a zzz-qqq word');
    expect(out.kept).toEqual(['zzz-qqq']);
  });

  it('하이픈이 없으면 그대로', () => {
    expect(stripSyllableHyphens('Amazing grace how sweet', DICT).text).toBe('Amazing grace how sweet');
  });
});

/*
 * 2026-08-28 — DB 에 `LifeLine` 이 들어가 있었다 (새 500장 「물 위에 생명줄 던지어라」,
 * 21번). 원본은 `Life-Line` 이고 붙이면 사전에 `lifeline` 이 있어 규칙이 붙여 버렸다.
 *
 * 음절은 낱말 안에서 끊으므로 뒷 조각이 대문자로 시작할 수 없다. 대문자로 시작하면
 * 고유명사 복합어이거나 문장 부호다.
 */
describe('하이픈 뒤가 대문자면 남긴다', () => {
  const dict = new Set(['lifeline', 'lifeboat', 'life', 'line', 'boat', 'plea', 'christ']);

  it('Life-Line 은 붙이지 않는다 — 사전에 lifeline 이 있어도', () => {
    expect(joinHyphenated('Life-Line', dict)).toBeUndefined();
    expect(joinHyphenated('Life-Boat', dict)).toBeUndefined();
  });

  it('줄표로 쓰인 하이픈도 남는다', () => {
    expect(joinHyphenated('plea-Christ', dict)).toBeUndefined();
  });

  it('음절 하이픈은 그대로 붙는다 (뒤가 소문자)', () => {
    expect(joinHyphenated('life-line', dict)).toBe('lifeline');
  });
});

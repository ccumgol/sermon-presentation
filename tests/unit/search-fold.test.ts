import { describe, expect, it } from 'vitest';

import { foldForSearch } from '../../lib/search-fold.ts';

describe('foldForSearch — 전문검색 비교용 접기', () => {
  it('합자를 풀어 쓴다 (Cæsar → Caesar)', () => {
    expect(foldForSearch('Cæsar Judæa Œdipus')).toBe('Caesar Judaea Oedipus');
  });
  it('글자 사이 하이픈을 지운다 (Beth-el → Bethel)', () => {
    expect(foldForSearch('Beth-el, Beer-sheba')).toBe('Bethel, Beersheba');
  });
  it('둥근 아포스트로피를 키보드의 것으로 (brother’s → brother\'s)', () => {
    expect(foldForSearch('brother’s keeper')).toBe("brother's keeper");
  });
  it('낱말 사이가 아닌 하이픈과 한국어·원어는 건드리지 않는다', () => {
    expect(foldForSearch('3:16 - 17')).toBe('3:16 - 17');
    expect(foldForSearch('태초에 하나님이')).toBe('태초에 하나님이');
    expect(foldForSearch('Ἐν ἀρχῇ ἦν ὁ λόγος')).toBe('Ἐν ἀρχῇ ἦν ὁ λόγος');
  });
});

/**
 * 같은 곡을 알아보는 규칙.
 *
 * 이 규칙이 느슨하면 **다른 곡이 사라지고**, 빡빡하면 가져올 때마다 곡이 복제된다.
 * 둘 다 조용히 일어나므로 검사로 잡는다.
 */

import { describe, expect, it } from 'vitest';

import { buildIdentityIndex, findExisting, identityKeys, titleKey } from '../../lib/song-identity.ts';

const hymn = (number: number) => [{ songbookId: 'hymn_new', number }];

describe('제목 맞추기', () => {
  it('띄어쓰기·문장부호가 달라도 같은 제목으로 본다', () => {
    expect(titleKey('나 같은 죄인 살리신')).toBe(titleKey('나같은죄인살리신'));
    expect(titleKey('주님, 예수여!')).toBe(titleKey('주님 예수여'));
  });

  it('대소문자를 가리지 않는다 (영어 제목)', () => {
    expect(titleKey('Amazing Grace')).toBe(titleKey('amazing grace'));
  });

  it('글자가 다르면 다른 제목이다', () => {
    expect(titleKey('첫째곡')).not.toBe(titleKey('둘째곡'));
  });
});

describe('곡을 가리키는 열쇠', () => {
  it('번호가 있으면 곡집·번호·제목을 함께 쓴다', () => {
    expect(identityKeys({ title: '가곡', entries: hymn(305) })).toEqual(['n:hymn_new:305:가곡']);
  });

  it('여러 곡집에 실렸으면 열쇠도 여럿이다 — 하나만 맞아도 같은 곡이다', () => {
    const keys = identityKeys({
      title: '가곡',
      entries: [{ songbookId: 'hymn_new', number: 305 }, { songbookId: 'hymn_old', number: 405 }],
    });
    expect(keys).toHaveLength(2);
  });

  /** 번호 없는 수록은 좌표가 되지 못한다 — 그때는 제목만 본다 */
  it('번호가 하나도 없으면 제목만 본다', () => {
    expect(identityKeys({ title: '기타곡', entries: [{ songbookId: 'misc' }] })).toEqual(['t:기타곡']);
    expect(identityKeys({ title: '기타곡', entries: [] })).toEqual(['t:기타곡']);
  });
});

describe('이미 있는 곡 찾기', () => {
  const index = buildIdentityIndex([
    { id: 11, title: '나 같은 죄인 살리신', entries: hymn(305) },
    { id: 12, title: '기타곡', entries: [] },
  ]);

  it('번호와 제목이 같으면 찾는다', () => {
    expect(findExisting(index, { title: '나같은 죄인 살리신', entries: hymn(305) })).toBe(11);
  });

  /**
   * **번호가 같아도 제목이 다르면 다른 곡이다.** 같은 번호를 두 곡이 갖는 경우가
   * 실제로 35건 있다(많은물소리 301~ 등). 번호만 보면 그중 한 곡이 사라진다.
   */
  it('번호가 같아도 제목이 다르면 못 찾는다', () => {
    expect(findExisting(index, { title: '전혀 다른 곡', entries: hymn(305) })).toBeUndefined();
  });

  it('제목이 같아도 번호가 다르면 못 찾는다', () => {
    expect(findExisting(index, { title: '나 같은 죄인 살리신', entries: hymn(999) })).toBeUndefined();
  });

  it('번호 없는 곡은 제목으로 찾는다', () => {
    expect(findExisting(index, { title: '기타곡', entries: [] })).toBe(12);
  });

  /**
   * 번호가 붙은 곡과 안 붙은 곡은 **다른 열쇠**를 쓴다. 번호를 새로 매긴 곡이
   * 옛 번호 없는 곡과 겹쳐 보이면, 어느 쪽이 남는지가 순서에 따라 달라진다.
   */
  it('번호가 생기면 다른 열쇠가 된다', () => {
    expect(findExisting(index, { title: '기타곡', entries: hymn(1) })).toBeUndefined();
  });

  it('없으면 undefined', () => {
    expect(findExisting(index, { title: '처음 보는 곡', entries: hymn(7) })).toBeUndefined();
  });

  /** 같은 열쇠가 여럿이면 먼저 넣은 것이 이긴다 — 순서에 따라 달라지면 안 된다 */
  it('겹치는 열쇠는 먼저 넣은 것이 이긴다', () => {
    const dup = buildIdentityIndex([
      { id: 1, title: '겹침', entries: hymn(3) },
      { id: 2, title: '겹침', entries: hymn(3) },
    ]);
    expect(findExisting(dup, { title: '겹침', entries: hymn(3) })).toBe(1);
  });
});

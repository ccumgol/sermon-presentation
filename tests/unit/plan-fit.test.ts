/**
 * **화면 맞춤 값 고르기** (`pickFit`).
 *
 * ## 왜 한 곳에 모았나
 *
 * 전에는 네 곳이 저마다 `fit === 'cover'` 만 통과시켰다 — 미리보기 두 곳과
 * 서버의 순서표 저장 두 곳. 그래서 `fill` 을 더했을 때 **고르면 켜지는데
 * 저장하면 사라지는** 일이 났다. 값이 늘 때마다 같은 자리를 네 번 고쳐야 하는
 * 구조였다.
 *
 * | 지키는 것 | 왜 |
 * |---|---|
 * | 기본값은 **`undefined`** | 순서표에 «기본값» 을 적어 두지 않는다 |
 * | 모르는 값도 `undefined` | 손으로 고친 순서표가 와도 **찌그러지지 않는다** |
 */

import { describe, expect, it } from 'vitest';

import { pickFit } from '../../lib/plan-item-view.ts';

describe('pickFit', () => {
  it('고를 수 있는 두 값을 통과시킨다', () => {
    expect(pickFit('cover')).toBe('cover');
    expect(pickFit('fill')).toBe('fill');
  });

  it('기본값은 적어 두지 않는다', () => {
    // 'contain' 은 기본이라 순서표에 남길 이유가 없다
    expect(pickFit('contain')).toBeUndefined();
    expect(pickFit(undefined)).toBeUndefined();
  });

  it('모르는 값은 기본으로 떨어뜨린다', () => {
    /*
     * 옛 순서표나 손으로 고친 값이 들어와도 **잘리거나 찌그러지면 안 된다.**
     * 여백이 생기는 쪽이 덜 나쁘다.
     */
    for (const junk of ['COVER', 'stretch', '', 'fit', null, 42, {}, []]) {
      expect(pickFit(junk), JSON.stringify(junk)).toBeUndefined();
    }
  });
});

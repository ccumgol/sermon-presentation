/**
 * 사람이 읽는 판 번호 (`1.4.0` → `1.04`).
 *
 * semver 가 앞자리 0 을 금지해서(`1.04.0` 은 규격 위반) 저장과 표기가 갈렸다.
 * 두 값이 어긋나면 **받는 사람이 어느 판을 쓰는지 알 수 없게 되므로** 못 박는다.
 */
import { describe, expect, it } from 'vitest';

import { versionLabel } from '../../lib/version-label.ts';

describe('versionLabel', () => {
  it('가운데 자리를 두 자리로 채운다', () => {
    expect(versionLabel('1.0.0')).toBe('1.00');
    expect(versionLabel('1.4.0')).toBe('1.04');
    expect(versionLabel('1.9.0')).toBe('1.09');
  });

  /** 열을 넘으면 채울 것이 없다 — `1.09` 다음이 `1.10` 이라야 순서가 맞는다 */
  it('두 자리부터는 그대로 둔다', () => {
    expect(versionLabel('1.10.0')).toBe('1.10');
    expect(versionLabel('2.0.0')).toBe('2.00');
    expect(versionLabel('10.25.0')).toBe('10.25');
  });

  /**
   * 마지막 자리는 우리 규칙에서 늘 0 이다. 그래도 0 이 아니면 **숨기지 않는다** —
   * 숨기면 두 빌드가 같은 이름이 되어 어느 것인지 가릴 수 없다.
   */
  it('마지막 자리가 0 이 아니면 함께 적는다', () => {
    expect(versionLabel('1.4.2')).toBe('1.04.2');
  });

  it('모르는 모양은 건드리지 않는다 — 빈 판 번호를 만들지 않는다', () => {
    expect(versionLabel('nightly')).toBe('nightly');
    expect(versionLabel('')).toBe('');
  });

  it('앞뒤 공백은 떼어 낸다', () => {
    expect(versionLabel('  1.4.0  ')).toBe('1.04');
  });
});

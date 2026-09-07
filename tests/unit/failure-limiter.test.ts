/**
 * 로그인 시도 제한 — 잠금과 **표가 자라지 않는 것** (점검 S-5).
 *
 * ## 왜 단위 검사인가
 *
 * 처음에는 `/api/login` 을 1,200번 두드려 확인하려 했다. 그런데 틀린 암호도
 * `verifyPassword` 가 scrypt 를 한 번 돌리므로(**일부러 느리다** — 그것이 이
 * 방어의 요점이다) 1,200회면 2분이 넘는다. 확인하려는 것은 표를 관리하는
 * 규칙이므로 그 함수를 직접 부른다.
 *
 * ## 무엇이 문제였나
 *
 * 전에는 **그 주소로 다시 시도할 때만** 정리됐다. 주소를 바꿔 가며 찔러 보면
 * 항목이 계속 쌓인다 — LAN 안이라 실질 위험은 낮지만, 예배 중에 도는 프로세스가
 * 며칠씩 켜져 있으므로 새는 곳을 두지 않는다.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { clearFailures, lockedFor, noteFailure, trackedFailureCount } from '../../server/auth.ts';

/** 이 검사가 남긴 주소를 걷어낸다 — 다른 검사가 같은 표를 쓴다 */
const used = new Set<string>();

function fail(address: string, now?: number): void {
  used.add(address);
  noteFailure(address, now);
}

afterEach(() => {
  for (const address of used) clearFailures(address);
  used.clear();
});

describe('잠금', () => {
  it('여러 번 틀리면 잠기고, 남은 초를 알려 준다', () => {
    const address = '192.168.1.50';
    for (let i = 0; i < 8; i++) fail(address);
    expect(lockedFor(address)).toBeGreaterThan(0);
  });

  it('한 번 틀린 것으로는 잠기지 않는다 — 오퍼레이터의 오타를 막지 않는다', () => {
    fail('192.168.1.51');
    expect(lockedFor('192.168.1.51')).toBe(0);
  });

  it('시간이 지나면 풀린다', () => {
    const address = '192.168.1.52';
    const long_ago = Date.now() - 6 * 60 * 1000;
    for (let i = 0; i < 8; i++) fail(address, long_ago);
    expect(lockedFor(address)).toBe(0);
  });
});

describe('표가 자라지 않는다', () => {
  it('주소를 바꿔 가며 틀려도 상한을 넘지 않는다', () => {
    for (let i = 0; i < 2000; i++) fail(`10.9.${Math.floor(i / 250)}.${i % 250}`);
    expect(trackedFailureCount()).toBeLessThanOrEqual(1024);
  });

  it('시간이 지난 항목은 새 항목을 넣을 때 걷힌다', () => {
    const stale = Date.now() - 6 * 60 * 1000;
    for (let i = 0; i < 50; i++) fail(`10.8.0.${i}`, stale);
    const before = trackedFailureCount();

    fail('10.8.1.1');
    // 지난 50개가 걷히고 새 것 하나만 남는다 → 개수가 줄어야 한다
    expect(trackedFailureCount()).toBeLessThan(before);
  });

  it('잠긴 주소는 상한 정리 중에도 살아 있어야 한다 (같은 주소로 계속 두드릴 때)', () => {
    const attacker = '192.168.1.99';
    for (let i = 0; i < 8; i++) fail(attacker);
    expect(lockedFor(attacker)).toBeGreaterThan(0);

    // 다른 주소가 조금 섞여도 그 잠금은 유지된다
    for (let i = 0; i < 100; i++) fail(`10.7.0.${i}`);
    expect(lockedFor(attacker)).toBeGreaterThan(0);
  });
});

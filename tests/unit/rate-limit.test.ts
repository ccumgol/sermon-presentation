/**
 * 요청 수 제한 (보안 감사 L-2).
 *
 * **이 PC 는 세지 않는다** — 그 판단은 부르는 쪽(`server/app.ts`)에 있고,
 * 여기서는 세는 규칙만 본다.
 */

import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../../lib/rate-limit.ts';

describe('한 창 안에서 한도를 넘으면 막는다', () => {
  it('한도까지는 통과한다', () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 1000 });
    for (let i = 0; i < 3; i++) {
      expect(limiter.hit('a', 0).ok, `${i + 1}번째`).toBe(true);
    }
    expect(limiter.hit('a', 0).ok).toBe(false);
  });

  it('막을 때 몇 초 뒤에 오라고 알려 준다', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    limiter.hit('a', 0);
    const verdict = limiter.hit('a', 10_000);
    expect(verdict.ok).toBe(false);
    expect(verdict.retryAfterSec).toBe(50);
  });

  it('창이 지나면 다시 통과한다', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.hit('a', 0).ok).toBe(true);
    expect(limiter.hit('a', 500).ok).toBe(false);
    expect(limiter.hit('a', 1000).ok).toBe(true);
  });

  it('주소마다 따로 센다 — 한 기기가 다른 기기를 막지 않는다', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.hit('a', 0).ok).toBe(true);
    expect(limiter.hit('a', 0).ok).toBe(false);
    expect(limiter.hit('b', 0).ok).toBe(true);
  });
});

describe('표가 자라지 않는다', () => {
  it('주소를 바꿔 가며 두드려도 상한을 넘지 않는다', () => {
    const limiter = createRateLimiter({ limit: 10, windowMs: 60_000, maxKeys: 100 });
    for (let i = 0; i < 500; i++) limiter.hit(`10.0.0.${i}`, 0);
    expect(limiter.size()).toBeLessThanOrEqual(100);
  });

  it('창이 지난 항목은 걷힌다', () => {
    const limiter = createRateLimiter({ limit: 10, windowMs: 1000 });
    for (let i = 0; i < 50; i++) limiter.hit(`10.0.1.${i}`, 0);
    const before = limiter.size();
    limiter.hit('10.0.2.1', 5000);
    expect(limiter.size()).toBeLessThan(before);
  });
});

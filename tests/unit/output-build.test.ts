/**
 * 출력 페이지 '옛 판' 판정.
 *
 * 이 판정이 틀리면 두 가지로 나타난다.
 *  - 못 잡으면: 새 슬라이드 종류가 OBS 화면에 **조용히 안 나온다** (실제로 겪은 문제)
 *  - 헛 잡으면: 예배 직전에 쓸데없는 경고가 떠 불안해진다
 * 그래서 '모르면 경고하지 않는다'를 기본으로 둔다.
 */

import { describe, expect, it } from 'vitest';

import { isOutputStale, STALE_GRACE_MS } from '../../server/output-build.ts';

const BUILD = 1_000_000;

describe('isOutputStale', () => {
  it('파일보다 먼저 로드된 페이지는 옛 판이다', () => {
    expect(isOutputStale(BUILD - 60_000, BUILD)).toBe(true);
  });

  it('파일보다 나중에 로드된 페이지는 최신이다', () => {
    expect(isOutputStale(BUILD + 1, BUILD)).toBe(false);
  });

  it('여유 시간 안쪽이면 경고하지 않는다 — 방금 새로고침한 페이지가 걸리면 안 된다', () => {
    expect(isOutputStale(BUILD - STALE_GRACE_MS + 1, BUILD)).toBe(false);
    // 여유를 넘어서면 잡는다
    expect(isOutputStale(BUILD - STALE_GRACE_MS - 1, BUILD)).toBe(true);
  });

  it('로드 시각을 모르면 경고하지 않는다 (옛 출력 페이지·수동 접속)', () => {
    for (const value of [undefined, null, 'x', Number.NaN, Infinity]) {
      expect(isOutputStale(value, BUILD)).toBe(false);
    }
  });

  it('파일 시각을 못 읽으면 판정을 포기한다', () => {
    expect(isOutputStale(1, 0)).toBe(false);
  });
});

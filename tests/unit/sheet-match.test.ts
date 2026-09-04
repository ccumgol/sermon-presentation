/**
 * 슬라이드 ↔ 악보 단 맞추기.
 *
 * **정확한 대응은 불가능하다** — DB 의 줄 나눔과 악보의 단 나눔이 다른 기준이다
 * (`lib/sheet-match.ts` 머리말의 실측 참고). 여기서 지키는 것은 '비례 배분이
 * 예배를 망치지 않는 성질' 이다:
 *  - 어떤 슬라이드도 악보 밖을 가리키지 않는다
 *  - 절이 바뀌면 단도 되돌아가거나 넘어간다 (모양에 따라)
 *  - 슬라이드 순서와 단 순서가 뒤집히지 않는다
 */

import { describe, expect, it } from 'vitest';

import { guessLayout, matchSlidesToSystems, sectionRanges } from '../../lib/sheet-match.ts';

describe('악보 모양 짐작', () => {
  it('단 수가 한 절의 줄 수에 가까우면 절이 겹쳐 적힌 것이다', () => {
    // 실제 7번: 단 4 · 1절(4줄) 2절(4줄)
    expect(guessLayout([4, 4], 4)).toBe('shared');
  });

  it('단 수가 모든 절을 합한 줄 수에 가까우면 이어 적힌 것이다', () => {
    // 실제 11번: 단 8 · 1절(4줄) 2절(4줄)
    expect(guessLayout([4, 4], 8)).toBe('sequential');
  });

  /**
   * 겹쳐 적힌 악보를 'sequential' 로 보면 2절이 **악보 밖**을 가리켜 아무것도
   * 못 보여 준다. 반대는 가사만 어긋나고 가락은 맞다 — 그쪽이 덜 나쁘다.
   */
  it('어느 쪽도 아니면 shared 로 떨어뜨린다 — 안전한 쪽이다', () => {
    // 실제 5번: 단 6 · 3절×4줄 (합 12) — 6 은 4 에도 12 에도 안 맞는다
    expect(guessLayout([4, 4, 4], 6)).toBe('shared');
    // 실제 181번: 단 6 · 3절×3줄 (합 9)
    expect(guessLayout([3, 3, 3], 6)).toBe('shared');
  });

  it('절이 하나면 늘 shared — 나눌 것이 없다', () => {
    expect(guessLayout([7], 4)).toBe('shared');
    expect(guessLayout([], 4)).toBe('shared');
  });

  it('단이 없으면 shared — 판단 근거가 없다', () => {
    expect(guessLayout([4, 4], 0)).toBe('shared');
  });
});

describe('섹션별 단 범위', () => {
  it('겹쳐 적힌 악보는 모든 절이 전체를 쓴다', () => {
    expect(sectionRanges([4, 4], 4, 'shared')).toEqual([
      { from: 0, to: 4 },
      { from: 0, to: 4 },
    ]);
  });

  it('이어 적힌 악보는 줄 수에 비례해 나눈다', () => {
    expect(sectionRanges([4, 4], 8, 'sequential')).toEqual([
      { from: 0, to: 4 },
      { from: 4, to: 8 },
    ]);
  });

  it('절 길이가 다르면 긴 절이 더 많이 가져간다', () => {
    const ranges = sectionRanges([2, 6], 8, 'sequential');
    expect(ranges[0]!.to - ranges[0]!.from).toBeLessThan(ranges[1]!.to - ranges[1]!.from);
  });

  /** 빈 범위를 주면 그 절에서 악보가 통째로 사라진다 */
  it('단이 절보다 적어도 절마다 하나씩은 준다', () => {
    const ranges = sectionRanges([2, 2, 2, 2], 2, 'sequential');
    expect(ranges).toHaveLength(4);
    for (const range of ranges) expect(range.to).toBeGreaterThan(range.from);
  });

  it('범위가 빈틈없이 이어진다', () => {
    const ranges = sectionRanges([3, 5, 2], 10, 'sequential');
    expect(ranges[0]!.from).toBe(0);
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.from).toBe(ranges[i - 1]!.to);
    expect(ranges[ranges.length - 1]!.to).toBe(10);
  });
});

describe('슬라이드마다 단 고르기', () => {
  it('한 절 안에서 비례로 흩는다', () => {
    // 슬라이드 3개 · 단 6개 → 0·2·4
    expect(matchSlidesToSystems([0, 0, 0], [3], 6, 'shared')).toEqual([0, 2, 4]);
  });

  it('슬라이드가 단보다 많으면 몇몇이 같은 단을 가리킨다', () => {
    expect(matchSlidesToSystems([0, 0, 0, 0], [4], 2, 'shared')).toEqual([0, 0, 1, 1]);
  });

  /** 이것이 이 기능의 핵심 — 1절 3번째와 2절 3번째가 **같은 단**이어야 한다 */
  it('겹쳐 적힌 악보에서는 절이 바뀌면 단이 처음으로 되돌아간다', () => {
    const matched = matchSlidesToSystems([0, 0, 0, 1, 1, 1], [3, 3], 6, 'shared');
    expect(matched).toEqual([0, 2, 4, 0, 2, 4]);
  });

  it('이어 적힌 악보에서는 절이 바뀌면 뒤로 넘어간다', () => {
    const matched = matchSlidesToSystems([0, 0, 1, 1], [2, 2], 4, 'sequential');
    expect(matched).toEqual([0, 1, 2, 3]);
  });

  it('한 절 안에서 단이 뒤로 가지 않는다', () => {
    const matched = matchSlidesToSystems([0, 0, 0, 0, 0], [5], 7, 'shared');
    for (let i = 1; i < matched.length; i++) expect(matched[i]!).toBeGreaterThanOrEqual(matched[i - 1]!);
  });
});

describe('망가뜨리지 않는다', () => {
  it('어떤 슬라이드도 악보 밖을 가리키지 않는다', () => {
    for (const systems of [1, 2, 3, 5, 10]) {
      for (const layout of ['shared', 'sequential'] as const) {
        const matched = matchSlidesToSystems([0, 0, 1, 1, 2], [2, 2, 1], systems, layout);
        for (const index of matched) {
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThan(systems);
        }
      }
    }
  });

  it('단이 없으면 -1 을 준다 — 부르는 쪽이 악보를 감춘다', () => {
    expect(matchSlidesToSystems([0, 0], [2], 0, 'shared')).toEqual([-1, -1]);
  });

  it('슬라이드가 없으면 빈 목록', () => {
    expect(matchSlidesToSystems([], [2], 4, 'shared')).toEqual([]);
  });

  /**
   * 섹션 번호가 범위를 벗어나도 -1 을 주지 않는다. 예배 중에는 **틀린 단이라도
   * 보이는 편**이 화면이 비는 것보다 낫다.
   */
  it('없는 섹션 번호는 첫 섹션으로 본다', () => {
    const matched = matchSlidesToSystems([9], [2], 4, 'shared');
    expect(matched[0]).toBeGreaterThanOrEqual(0);
  });
});

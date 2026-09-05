/**
 * 열 너비 셈.
 *
 * 잘못 자르면 **열 하나가 사라져 조작을 못 하게 된다** — 예배 중에 그렇게 되면
 * 되돌릴 방법을 찾느라 진행이 멈춘다. 그래서 경계를 눈이 아니라 검사로 잡는다.
 */

import { describe, expect, it } from 'vitest';

import { clampSplit, parseSplit, widthAfterDrag } from '../../lib/column-split.ts';

const bounds = { min: 260, minNeighbor: 320 };

describe('끌어 놓은 폭 다듬기', () => {
  it('가운데 값은 그대로 (반올림해서 소수를 남기지 않는다)', () => {
    expect(clampSplit(500.4, 1280, bounds)).toBe(500);
  });

  it('너무 좁게 끌면 min 에서 멈춘다', () => {
    expect(clampSplit(10, 1280, bounds)).toBe(260);
    expect(clampSplit(-500, 1280, bounds)).toBe(260);
  });

  /** 끝까지 끌어 이웃이 0이 되면 그 안의 단추를 누를 수 없다 */
  it('이웃 칸 자리를 반드시 남긴다', () => {
    expect(clampSplit(1280, 1280, bounds)).toBe(960); // 1280 - 320
  });

  /**
   * 창이 아주 좁아 둘 다 만족할 수 없으면 **min 이 이긴다.**
   * 조절하는 칸이 0이 되면 잡이마저 사라져 되돌릴 길이 없어진다.
   */
  it('둘 다 만족할 수 없으면 min 이 이긴다', () => {
    expect(clampSplit(400, 500, bounds)).toBe(260); // 500 - 320 = 180 < 260
    expect(clampSplit(100, 500, bounds)).toBe(260);
  });

  it('창 폭이 0 이어도 무너지지 않는다 (첫 그리기·숨은 탭)', () => {
    expect(clampSplit(400, 0, bounds)).toBe(260);
  });
});

describe('저장된 값 읽기', () => {
  it('숫자면 쓴다', () => {
    expect(parseSplit('420')).toBe(420);
    expect(parseSplit('420.5')).toBe(420.5);
  });

  /**
   * 없으면 `undefined` — **CSS 에 적힌 기본 너비가 그대로 쓰인다.**
   * 기본값을 코드에도 적으면 두 곳이 어긋난다.
   */
  it('없거나 이상하면 undefined 라 CSS 기본값이 산다', () => {
    expect(parseSplit(null)).toBeUndefined();
    expect(parseSplit(undefined)).toBeUndefined();
    expect(parseSplit('')).toBeUndefined();
    expect(parseSplit('넓게')).toBeUndefined();
    expect(parseSplit('0')).toBeUndefined();
    expect(parseSplit('-20')).toBeUndefined();
    expect(parseSplit('Infinity')).toBeUndefined();
  });
});

describe('끄는 방향', () => {
  it('왼쪽 칸을 조절하면 오른쪽으로 끌 때 넓어진다', () => {
    expect(widthAfterDrag(400, 60, 'start')).toBe(460);
    expect(widthAfterDrag(400, -60, 'start')).toBe(340);
  });

  /** 오른쪽 열(미리보기)은 반대다 — 오른쪽으로 끌면 좁아진다 */
  it('오른쪽 칸을 조절하면 오른쪽으로 끌 때 좁아진다', () => {
    expect(widthAfterDrag(380, 60, 'end')).toBe(320);
    expect(widthAfterDrag(380, -60, 'end')).toBe(440);
  });
});

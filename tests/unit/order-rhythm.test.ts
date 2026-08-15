/**
 * 순서 표시 글자별 크기·높낮이.
 *
 * ⚠️ 같은 계산이 public/output/output.js 에도 한 벌 있다(의존성 0 원칙 때문에 가져다
 * 쓸 수 없다). 값이 어긋나면 **패널의 슬라이더 눈금과 실제 화면이 달라지므로**,
 * 여기 숫자를 바꿀 때는 출력 페이지도 함께 고쳐야 한다.
 */

import { describe, expect, it } from 'vitest';

import {
  adjustableChars, autoDy, autoScale, CHAR_DY_MAX, CHAR_SIZE_MAX, CHAR_SIZE_MIN,
  normalizeCharStyles, normalizePresenterScale,
  normalizeStroke, PRESENTER_SCALE_MAX, PRESENTER_SCALE_MIN, STROKE_MAX, STROKE_MIN,
} from '../../lib/order-rhythm.ts';

describe('AUTO_PATTERN — 사용자가 정한 네 글자 표', () => {
  it('배율 1 이면 정한 값이 그대로 나온다', () => {
    // 2026-08-15 사용자 지정: 100% / 96%·↑19% / 90%·↓10% / 90%·↑5%
    expect([0, 1, 2, 3].map((i) => autoScale(i, 1))).toEqual([1, 0.96, 0.9, 0.9]);
    expect([0, 1, 2, 3].map((i) => autoDy(i, 1))).toEqual([0, -0.19, 0.1, -0.05]);
  });

  it('표는 네 글자까지 — 다섯째 글자부터는 흔들지 않는다', () => {
    // 다섯 글자 이상('찬양과경배' 같은 XX와XX 꼴)은 이름마다 어울리는 모양이 달라
    // 자동으로 정하면 어색해진다. 글자별 조정으로 직접 맞춘다.
    for (const i of [4, 5, 6, 10]) {
      expect(autoScale(i, 1)).toBe(1);
      expect(autoDy(i, 1)).toBe(0);
    }
  });

  it("두 글자·세 글자는 네 글자의 앞부분을 그대로 따른다", () => {
    // '축도'(2자) '축복송'(3자) 은 '예배부름'(4자) 의 앞 두세 글자와 같아야 한다
    expect([0, 1].map((i) => autoScale(i, 1))).toEqual([1, 0.96]);
    expect([0, 1, 2].map((i) => autoDy(i, 1))).toEqual([0, -0.19, 0.1]);
  });

  it('2자 어절에서도 크기가 달라진다', () => {
    expect(autoScale(0, 1)).not.toBe(autoScale(1, 1));
  });

  it('배율 0 이면 모두 기준 크기이고 움직이지 않는다', () => {
    for (const i of [0, 1, 2, 3]) {
      expect(autoScale(i, 0)).toBe(1);
      expect(autoDy(i, 0)).toBe(0);
    }
  });

  it('배율 2 면 편차가 두 배', () => {
    expect(autoScale(1, 2)).toBeCloseTo(0.92, 6);
    expect(autoDy(1, 2)).toBeCloseTo(-0.38, 6);
  });
});

describe('normalizeCharStyles', () => {
  it('범위를 넘으면 자른다', () => {
    const out = normalizeCharStyles([{ size: 99 }, { size: -5 }, { dy: 9 }])!;
    expect(out[0]!.size).toBe(CHAR_SIZE_MAX);
    expect(out[1]!.size).toBe(CHAR_SIZE_MIN);
    expect(out[2]!.dy).toBe(CHAR_DY_MAX);
  });

  it('숫자가 아닌 값과 이상한 항목은 버린다', () => {
    const out = normalizeCharStyles([{ size: 'x' }, null, { size: 1.2 }])!;
    expect(out[0]).toEqual({});
    expect(out[1]).toEqual({});
    expect(out[2]!.size).toBe(1.2);
  });

  it('아무도 만지지 않았으면 저장하지 않는다', () => {
    expect(normalizeCharStyles([{}, {}, {}])).toBeUndefined();
    expect(normalizeCharStyles([])).toBeUndefined();
    expect(normalizeCharStyles('x')).toBeUndefined();
  });
});

describe('normalizePresenterScale', () => {
  it('범위를 넘으면 자른다', () => {
    expect(normalizePresenterScale(99)).toBe(PRESENTER_SCALE_MAX);
    expect(normalizePresenterScale(0)).toBe(PRESENTER_SCALE_MIN);
  });

  it('기본값(1)은 저장하지 않는다 — 나중에 기본을 바꿀 수 있어야 한다', () => {
    expect(normalizePresenterScale(1)).toBeUndefined();
  });

  it('숫자가 아니면 버린다', () => {
    expect(normalizePresenterScale('1.5')).toBeUndefined();
    expect(normalizePresenterScale(Number.NaN)).toBeUndefined();
    expect(normalizePresenterScale(undefined)).toBeUndefined();
  });
});

describe('normalizeStroke', () => {
  it('0 은 버리지 않는다 — 이 항목만 테두리를 끄겠다는 지정이다', () => {
    expect(normalizeStroke(0)).toBe(0);
  });

  it('범위를 넘으면 자른다', () => {
    expect(normalizeStroke(-5)).toBe(STROKE_MIN);
    expect(normalizeStroke(999)).toBe(STROKE_MAX);
  });

  it('값이 없으면 템플릿을 따른다 (undefined)', () => {
    expect(normalizeStroke(undefined)).toBeUndefined();
    expect(normalizeStroke('3')).toBeUndefined();
    expect(normalizeStroke(Number.NaN)).toBeUndefined();
  });
});

describe('adjustableChars', () => {
  it('공백을 빼고 글자만 센다 — 제목의 띄어쓰기를 고쳐도 조정이 따라간다', () => {
    expect(adjustableChars('예배 부름')).toEqual(['예', '배', '부', '름']);
    expect(adjustableChars('예배부름')).toEqual(['예', '배', '부', '름']);
  });
});

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
  normalizeCharStyles, rhythmWave,
} from '../../lib/order-rhythm.ts';

describe('rhythmWave — 세 글자 주기', () => {
  it('큰 · 작은 · 작은 이 되풀이된다', () => {
    expect(rhythmWave(0)).toBeCloseTo(1, 6);
    expect(rhythmWave(1)).toBeCloseTo(-0.5, 6);
    expect(rhythmWave(2)).toBeCloseTo(-0.5, 6);
    expect(rhythmWave(3)).toBeCloseTo(1, 6);
  });

  it('2자 어절에서도 크기가 달라진다 — 길이로 나누면 여기서 리듬이 사라졌다', () => {
    expect(autoScale(0, 0.18)).not.toBeCloseTo(autoScale(1, 0.18), 6);
  });
});

describe('autoScale / autoDy', () => {
  it('리듬이 0 이면 모두 기준 크기이고 내려가지 않는다', () => {
    for (const i of [0, 1, 2, 3]) {
      expect(autoScale(i, 0)).toBe(1);
      expect(autoDy(i, 0)).toBe(0);
    }
  });

  it('큰 글자는 내려가지 않고, 작은 글자가 내려간다', () => {
    expect(autoDy(0, 0.2)).toBeCloseTo(0, 6);
    expect(autoDy(1, 0.2)).toBeCloseTo(0.15, 6);
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

describe('adjustableChars', () => {
  it('공백을 빼고 글자만 센다 — 제목의 띄어쓰기를 고쳐도 조정이 따라간다', () => {
    expect(adjustableChars('예배 부름')).toEqual(['예', '배', '부', '름']);
    expect(adjustableChars('예배부름')).toEqual(['예', '배', '부', '름']);
  });
});

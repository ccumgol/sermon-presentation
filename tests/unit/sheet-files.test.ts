/**
 * 악보 파일 이름 규칙.
 *
 * 여기서 틀리면 **엉뚱한 곡에 악보가 붙는다** — 예배 중 화면에 다른 곡의 악보가
 * 나가는 것이라 조용히 넘어갈 수 없다. 반입 스크립트와 서버가 이 한 곳을 함께 쓴다.
 */

import { describe, expect, it } from 'vitest';

import { sheetFileName, sheetNumberOf } from '../../lib/sheet-files.ts';

describe('파일 이름에서 곡 번호 읽기', () => {
  it('원본의 두 형식을 모두 읽는다', () => {
    // 실제 자료가 이렇게 섞여 있다 — 0001~1888 은 맨숫자, 1889~2062 는 괄호
    expect(sheetNumberOf('0001.bmp')).toBe(1);
    expect(sheetNumberOf('1888.bmp')).toBe(1888);
    expect(sheetNumberOf('(1889).bmp')).toBe(1889);
    expect(sheetNumberOf('(2062).bmp')).toBe(2062);
  });

  it('앞의 0 을 값으로 세지 않는다 — 0305 는 305 다', () => {
    expect(sheetNumberOf('0305.bmp')).toBe(305);
    expect(sheetNumberOf('0007.webp')).toBe(7);
  });

  it('변환 결과(.webp)도 같은 규칙으로 읽는다', () => {
    expect(sheetNumberOf('0305.webp')).toBe(305);
  });

  it('경로가 붙어 있어도 파일 이름만 본다', () => {
    expect(sheetNumberOf('/data/sheets/chanmi2000/0042.webp')).toBe(42);
    expect(sheetNumberOf('찬미예수 2000 악보/(1889).bmp')).toBe(1889);
  });

  /**
   * **숫자 덩이가 둘 이상이면 포기한다.** 내려받기가 만든 사본(`1255 (2).bmp`)이나
   * 사람이 붙인 꼬리를 짐작으로 고르면 다른 곡의 악보가 붙는다. 모르면 모른다고 한다.
   */
  it('숫자가 둘 이상이면 undefined — 짐작하지 않는다', () => {
    expect(sheetNumberOf('1255 (2).bmp')).toBeUndefined();
    expect(sheetNumberOf('2절-0305.bmp')).toBeUndefined();
    expect(sheetNumberOf('0305_v2.webp')).toBeUndefined();
  });

  it('숫자가 없거나 0 이면 undefined', () => {
    expect(sheetNumberOf('Thumbs.db')).toBeUndefined();
    expect(sheetNumberOf('표지.bmp')).toBeUndefined();
    expect(sheetNumberOf('0000.bmp')).toBeUndefined();
    expect(sheetNumberOf('')).toBeUndefined();
  });

  it('확장자 안의 숫자에 속지 않는다', () => {
    // 확장자를 떼고 보므로 `.bmp2` 같은 것이 번호로 읽히면 안 된다
    expect(sheetNumberOf('0305.bmp2')).toBe(305);
  });
});

describe('곡 번호 → 파일 이름', () => {
  it('네 자리로 채운다', () => {
    expect(sheetFileName(1)).toBe('0001.webp');
    expect(sheetFileName(42)).toBe('0042.webp');
    expect(sheetFileName(305)).toBe('0305.webp');
    expect(sheetFileName(2062)).toBe('2062.webp');
  });

  it('네 자리를 넘으면 그대로 둔다 — 자르면 다른 곡이 된다', () => {
    expect(sheetFileName(12345)).toBe('12345.webp');
  });

  /** 둘이 서로의 역이어야 한다 — 반입과 조회가 같은 파일을 가리키는 근거다 */
  it('번호 → 이름 → 번호 가 제자리로 돌아온다', () => {
    for (const number of [1, 7, 42, 305, 1888, 1889, 2062]) {
      expect(sheetNumberOf(sheetFileName(number))).toBe(number);
    }
  });
});

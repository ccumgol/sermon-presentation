/**
 * 폰트 체인 파싱.
 *
 * 이름을 적어 넣어도 그대로 잡히지 않는 일이 잦다(바른바탕 사고). 실제로 어느 폰트가
 * 쓰였는지 재려면 먼저 체인을 이름 목록으로 정확히 쪼갤 수 있어야 한다.
 */

import { describe, expect, it } from 'vitest';

import { hasRealFallback, isGenericFamily, parseFontChain } from '../../lib/font-chain.ts';
import { BUILTIN_TEMPLATES } from '../../lib/template-presets.ts';

describe('parseFontChain', () => {
  it('따옴표와 공백을 벗겨 이름만 남긴다', () => {
    expect(parseFontChain('"Noto Serif KR", "Batang" , serif')).toEqual([
      'Noto Serif KR',
      'Batang',
      'serif',
    ]);
  });

  it("작은따옴표도 받는다", () => {
    expect(parseFontChain("'Apple SD Gothic Neo', sans-serif")).toEqual([
      'Apple SD Gothic Neo',
      'sans-serif',
    ]);
  });

  it('빈 항목과 이상한 입력을 버린다', () => {
    expect(parseFontChain('a,,  ,b')).toEqual(['a', 'b']);
    expect(parseFontChain('')).toEqual([]);
    expect(parseFontChain(undefined as unknown as string)).toEqual([]);
  });
});

describe('isGenericFamily', () => {
  it('총칭 키워드를 알아본다 (대소문자 무관)', () => {
    expect(isGenericFamily('serif')).toBe(true);
    expect(isGenericFamily('SANS-SERIF')).toBe(true);
    expect(isGenericFamily('system-ui')).toBe(true);
    expect(isGenericFamily('Noto Serif KR')).toBe(false);
  });
});

describe('hasRealFallback', () => {
  it('총칭만 있으면 거짓 — 글자별 대체가 일어날 수 있다', () => {
    expect(hasRealFallback('serif')).toBe(false);
    expect(hasRealFallback('sans-serif, serif')).toBe(false);
  });

  it('실제 폰트가 하나라도 있으면 참', () => {
    expect(hasRealFallback('"Batang", serif')).toBe(true);
  });

  it('내장 프리셋의 모든 폰트 체인은 총칭 앞에 실제 폰트를 둔다', () => {
    // PLAN 3.4 — 총칭으로만 끝나면 다음절 헬라어가 글자마다 다른 폰트로 대체됐다
    for (const template of BUILTIN_TEMPLATES) {
      for (const [role, style] of Object.entries(template.text)) {
        expect(hasRealFallback(style.fontFamily), `${template.name} / ${role}`).toBe(true);
      }
    }
  });
});

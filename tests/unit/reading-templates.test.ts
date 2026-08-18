/**
 * 교독문·전례문 템플릿의 **약속**을 고정한다.
 *
 * 크기 값 자체는 1920×1080 에서 실제로 재서 정했다(프리셋 주석의 표 참고).
 * 여기서 지키는 것은 사용자가 지정한 규칙이다 — 어긋나면 예배 화면이 달라진다.
 */

import { describe, expect, it } from 'vitest';

import { BUILTIN_TEMPLATES, getBuiltinTemplate } from '../../lib/template-presets.ts';

const READING = getBuiltinTemplate(-10)!;
const LITURGY = getBuiltinTemplate(-11)!;

describe('교독문 템플릿 (-10)', () => {
  it('있고, 종류가 교독문이다', () => {
    expect(READING).toBeDefined();
    expect(READING.kind).toBe('reading');
    expect(READING.name).toContain('교독문');
  });

  /** 사용자 지정: 위 흰색 · 아래 노란색 · **크기는 동일** */
  it('인도자와 회중의 글자 크기가 같다', () => {
    expect(READING.text.secondary.fontSize).toBe(READING.text.primary.fontSize);
  });

  it('위는 흰색, 아래는 노란색이다', () => {
    expect(READING.text.primary.color.toLowerCase()).toBe('#ffffff');
    // 노란 계열 — 빨강·초록이 높고 파랑이 낮다
    const yellow = READING.text.secondary.color.toLowerCase();
    expect(yellow).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(yellow.slice(i, i + 2), 16));
    expect(r!).toBeGreaterThan(200);
    expect(g!).toBeGreaterThan(180);
    expect(b!).toBeLessThan(150);
  });

  /** 배경 그림 위에 얹힌다 — 테두리가 없으면 밝은 사진에서 흰 글씨가 사라진다 */
  it('두 줄 모두 테두리와 그림자가 있다', () => {
    for (const style of [READING.text.primary, READING.text.secondary]) {
      expect(style.stroke?.width ?? 0).toBeGreaterThanOrEqual(5);
      expect(style.shadow).not.toBeNull();
    }
  });

  it('위아래를 벌려 누가 읽을 차례인지 보이게 한다', () => {
    // 글자 크기만큼 벌린다 — 이보다 좁으면 두 줄이 한 덩어리로 보인다
    expect(READING.layout.gap).toBeGreaterThanOrEqual(READING.text.primary.fontSize * 0.7);
  });

  it('배경 위 중앙에 놓이고, 무엇을 읽는지 아래에 표시한다', () => {
    expect(READING.layout.anchor).toBe('center');
    expect(READING.layout.verticalAlign).toBe('middle');
    expect(READING.behavior.showReference).toBe('bottom');
    expect(READING.behavior.showVerseNumbers).toBe(false);
  });
});

describe('주기도문·사도신경 템플릿 (-11)', () => {
  it('있고, 종류가 교독문 계열이다', () => {
    expect(LITURGY).toBeDefined();
    expect(LITURGY.kind).toBe('reading');
  });

  /**
   * '전체가 텍스트로 채워지도록' — 실측으로 84px 을 골랐다.
   * 6줄씩에서 95%(넘치지 않음), 90px 부터 넘친다.
   */
  it('화면을 채울 만큼 크다', () => {
    expect(LITURGY.text.primary.fontSize).toBeGreaterThanOrEqual(80);
    // 21자 최장 줄이 안전 영역(1680px)에 들어가야 한다 — 감기면 호흡이 어긋난다
    expect(LITURGY.text.primary.fontSize).toBeLessThanOrEqual(90);
  });

  it('본문만 나간다 — 참조·머리글·절 번호가 없다', () => {
    expect(LITURGY.behavior.showReference).toBe('none');
    expect(LITURGY.behavior.showHeadings).toBe(false);
    expect(LITURGY.behavior.showVerseNumbers).toBe(false);
    expect(LITURGY.behavior.showCredit).toBe(false);
  });

  it('배경 위에서 읽히도록 테두리가 있다', () => {
    expect(LITURGY.text.primary.stroke?.width ?? 0).toBeGreaterThanOrEqual(6);
    expect(LITURGY.text.primary.color.toLowerCase()).toBe('#ffffff');
  });

  it('넘치면 줄이지만 너무 작아지지는 않는다', () => {
    expect(LITURGY.behavior.autoFit).toBe(true);
    expect(LITURGY.behavior.autoFitMinScale).toBeGreaterThanOrEqual(0.5);
  });
});

describe('프리셋 전체', () => {
  it('id 가 겹치지 않는다', () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('교독문 종류가 둘뿐이다 — 교독문용·전례문용', () => {
    // 숫자 배열의 .sort() 는 문자열 비교라 음수에서 어긋난다 — 비교 함수를 준다
    const ids = BUILTIN_TEMPLATES.filter((t) => t.kind === 'reading')
      .map((t) => t.id)
      .sort((a, b) => a - b);
    expect(ids).toEqual([-11, -10]);
  });
});

import { describe, expect, it } from 'vitest';

import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, getBuiltinTemplate } from '../../lib/template-presets.ts';
import { anchorToAlignment, diffCssVars, overrideVarsFor, templateToCssVars, withAlpha } from '../../lib/template-css.ts';
import type { Anchor, Template } from '../../shared/types.ts';

function base(): Template {
  return getBuiltinTemplate(DEFAULT_TEMPLATE_ID)!;
}

describe('anchorToAlignment', () => {
  const cases: Array<[Anchor, string, string]> = [
    ['top-left', 'start', 'start'],
    ['bottom-center', 'center', 'end'],
    ['center', 'center', 'center'],
    ['mid-right', 'end', 'center'],
  ];

  for (const [anchor, justify, align] of cases) {
    it(`${anchor} → ${justify}/${align}`, () => {
      expect(anchorToAlignment(anchor)).toEqual({ justify, align });
    });
  }

  it('알 수 없는 값은 하단 중앙으로 떨어진다', () => {
    expect(anchorToAlignment('nonsense' as Anchor)).toEqual({ justify: 'center', align: 'end' });
  });
});

describe('withAlpha', () => {
  it('#RRGGBB 에 알파를 붙인다', () => {
    expect(withAlpha('#000000', 0.5)).toBe('rgba(0, 0, 0, 0.5)');
    expect(withAlpha('#ffffff', 1)).toBe('rgba(255, 255, 255, 1)');
  });

  it('알파를 0~1 로 제한한다', () => {
    expect(withAlpha('#000000', -1)).toBe('rgba(0, 0, 0, 0)');
    expect(withAlpha('#000000', 5)).toBe('rgba(0, 0, 0, 1)');
  });

  it('hex 가 아니면 그대로 둔다', () => {
    expect(withAlpha('rgba(1,2,3,0.4)', 0.5)).toBe('rgba(1,2,3,0.4)');
  });
});

describe('templateToCssVars', () => {
  it('출력 페이지가 참조하는 변수를 모두 만든다', () => {
    const vars = templateToCssVars(base());

    // output.css 가 실제로 읽는 변수들 — 하나라도 빠지면 화면이 기본값으로 떨어진다
    for (const key of [
      '--canvas-bg', '--safe-top', '--safe-bottom', '--justify', '--align',
      '--offset-x', '--block-width', '--text-align', '--flow-direction', '--block-gap',
      '--primary-size', '--primary-color', '--primary-stroke', '--primary-shadow', '--primary-word-break',
      '--secondary-size', '--secondary-color', '--versenum-color', '--reference-size',
      '--heading-color', '--credit-size', '--transition-duration',
    ]) {
      expect(vars[key], `${key} 가 없습니다`).toBeDefined();
    }
  });

  it('길이 값에 px 를 붙이고 배수는 그대로 둔다', () => {
    const vars = templateToCssVars(base());
    expect(vars['--primary-size']).toMatch(/^\d+px$/);
    expect(vars['--primary-line-height']).not.toMatch(/px/);
    expect(vars['--primary-opacity']).not.toMatch(/px/);
  });

  it('투명 배경은 transparent 로 나온다', () => {
    expect(templateToCssVars(base())['--canvas-bg']).toBe('transparent');
  });

  it('반투명 단색 배경은 rgba 로 합쳐진다', () => {
    const template: Template = {
      ...base(),
      canvas: { ...base().canvas, background: { mode: 'color', color: '#000000', opacity: 0.4 } },
    };
    expect(templateToCssVars(template)['--canvas-bg']).toBe('rgba(0, 0, 0, 0.4)');
  });

  it('크로마키 배경은 지정 색을 그대로 쓴다', () => {
    const template: Template = {
      ...base(),
      canvas: { ...base().canvas, background: { mode: 'chroma', color: '#1eff00' } },
    };
    expect(templateToCssVars(template)['--canvas-bg']).toBe('#1eff00');
  });

  it('외곽선·그림자가 없으면 none', () => {
    const template: Template = {
      ...base(),
      text: { ...base().text, primary: { ...base().text.primary, stroke: null, shadow: null } },
    };
    const vars = templateToCssVars(template);
    expect(vars['--primary-stroke']).toBe('none');
    expect(vars['--primary-shadow']).toBe('none');
  });

  it('두께 0 인 외곽선도 none 으로 본다', () => {
    const template: Template = {
      ...base(),
      text: { ...base().text, primary: { ...base().text.primary, stroke: { width: 0, color: '#000' } } },
    };
    expect(templateToCssVars(template)['--primary-stroke']).toBe('none');
  });

  it("width 'auto' 는 키워드로 나가고 maxHeight 는 none 이 된다", () => {
    const vars = templateToCssVars(base());
    expect(vars['--block-width']).toBe('auto');
    expect(vars['--block-max-height']).toBe('none');
  });

  it('전환 효과가 none 이면 지속 시간을 0 으로 만든다', () => {
    const template: Template = {
      ...base(),
      behavior: { ...base().behavior, transition: { type: 'none', durationMs: 500 } },
    };
    expect(templateToCssVars(template)['--transition-duration']).toBe('0ms');
  });

  it('원본 템플릿을 변형하지 않는다', () => {
    const template = base();
    const snapshot = JSON.parse(JSON.stringify(template));
    templateToCssVars(template);
    expect(template).toEqual(snapshot);
  });
});

describe('overrideVarsFor', () => {
  it('해당 언어·역본 지정이 없으면 빈 객체', () => {
    expect(overrideVarsFor(base(), 'primary', 'nkrv', 'ko')).toEqual({});
  });

  it('언어별 지정을 적용한다', () => {
    const vars = overrideVarsFor(base(), 'secondary', 'niv', 'en');
    expect(vars['--secondary-font']).toContain('Inter');
    expect(vars['--secondary-word-break']).toBe('normal');
  });

  it('역본 지정이 언어 지정을 덮는다 (더 구체적이므로)', () => {
    const template: Template = {
      ...base(),
      overridesByLang: { en: { color: '#111111' } },
      overridesByTranslation: { niv: { color: '#222222' } },
    };
    expect(overrideVarsFor(template, 'secondary', 'niv', 'en')['--secondary-color']).toBe('#222222');
  });

  it('원어 폰트가 프리셋에 들어 있다', () => {
    expect(overrideVarsFor(base(), 'primary', 'grk', 'grc')['--primary-font']).toContain('SBL Greek');
    expect(overrideVarsFor(base(), 'primary', 'heb', 'heb')['--primary-font']).toContain('SBL Hebrew');
  });
});

describe('diffCssVars', () => {
  it('바뀐 것만 추린다', () => {
    expect(diffCssVars({ a: '1', b: '2' }, { a: '1', b: '3' })).toEqual({ b: '3' });
  });

  it('새로 생긴 키도 포함한다', () => {
    expect(diffCssVars({}, { a: '1' })).toEqual({ a: '1' });
  });

  it('변화가 없으면 빈 객체', () => {
    expect(diffCssVars({ a: '1' }, { a: '1' })).toEqual({});
  });
});

describe('내장 프리셋', () => {
  it('8종이 있고 id 가 겹치지 않는다', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(8);
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('프리셋 id 는 모두 음수다 (사용자 템플릿과 절대 충돌하지 않게)', () => {
    for (const t of BUILTIN_TEMPLATES) expect(t.id).toBeLessThan(0);
  });

  it('모두 isBuiltin 이고 CSS 변환이 통과한다', () => {
    for (const t of BUILTIN_TEMPLATES) {
      expect(t.isBuiltin).toBe(true);
      expect(() => templateToCssVars(t)).not.toThrow();
      expect(templateToCssVars(t)['--canvas-bg']).toBeDefined();
    }
  });

  it('기본 템플릿이 존재한다', () => {
    expect(getBuiltinTemplate(DEFAULT_TEMPLATE_ID)).toBeDefined();
  });

  it('성경 프리셋은 한국어 어절 단위 줄바꿈을 쓴다', () => {
    for (const t of BUILTIN_TEMPLATES.filter((x) => x.kind === 'bible')) {
      expect(t.text.primary.wordBreak).toBe('keep-all');
    }
  });

  it('모든 프리셋이 투명 배경으로 시작한다 (OBS 합성 기본)', () => {
    for (const t of BUILTIN_TEMPLATES) expect(t.canvas.background.mode).toBe('transparent');
  });
});

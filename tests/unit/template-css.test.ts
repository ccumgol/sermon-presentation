import { describe, expect, it } from 'vitest';

import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, getBuiltinTemplate } from '../../lib/template-presets.ts';
import {
  anchorToAlignment, clampRhythm, diffCssVars, MAX_TITLE_RHYTHM, overrideVarsFor, templateToCssVars, withAlpha,
} from '../../lib/template-css.ts';
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

  it('그림·동영상 배경은 페이지 배경을 투명으로 둔다 (#backdrop 요소가 그린다)', () => {
    // 파일이 없거나 못 읽어도 투명 송출이 그대로 유지돼야 한다 —
    // 페이지 배경에 색을 깔면 배경 실패가 곧 '검은 화면'이 된다.
    for (const background of [
      { mode: 'image' as const, src: 'sunrise.jpg', fit: 'cover' as const, opacity: 1 },
    ]) {
      const template: Template = { ...base(), canvas: { ...base().canvas, background } };
      expect(templateToCssVars(template)['--canvas-bg']).toBe('transparent');
    }
  });

  it('배경 파일은 backdrop 키로, 맞춤·불투명도는 CSS 변수로 나간다', () => {
    const template: Template = {
      ...base(),
      canvas: {
        ...base().canvas,
        background: { mode: 'image', src: 'sanctuary.png', fit: 'contain', opacity: 0.6 },
      },
    };
    const vars = templateToCssVars(template);
    // 편집 중 style:set 만으로도 미리보기에 반영되려면 이 키가 함께 나가야 한다
    expect(vars['backdrop']).toBe('{"mode":"image","src":"sanctuary.png"}');
    expect(vars['--backdrop-fit']).toBe('contain');
    expect(vars['--backdrop-opacity']).toBe('0.6');
  });

  it('배경이 파일이 아니면 backdrop 은 빈 문자열 (요소를 지운다)', () => {
    const vars = templateToCssVars(base());
    expect(vars['backdrop']).toBe('');
    expect(vars['--backdrop-fit']).toBe('cover');
    expect(vars['--backdrop-opacity']).toBe('1');
  });

  it('파일 이름이 비면 배경을 켜지 않는다', () => {
    const template: Template = {
      ...base(),
      canvas: { ...base().canvas, background: { mode: 'image', src: '' } },
    };
    expect(templateToCssVars(template)['backdrop']).toBe('');
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
  it('11종이 있고 id 가 겹치지 않는다', () => {
    expect(BUILTIN_TEMPLATES).toHaveLength(11);
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

describe('언어별 폰트 체인', () => {
  const presets = BUILTIN_TEMPLATES;

  it('원어 폰트 체인이 총칭 키워드로만 끝나지 않는다', () => {
    // 총칭(serif)만 두면 그 폰트가 다음절 그리스어를 못 덮을 때 브라우저가
    // 글자마다 다른 폰트로 대체해 자간이 벌어진다 (실측 819.6px vs 526.6px)
    for (const preset of presets) {
      for (const lang of ['grc', 'heb'] as const) {
        const chain = preset.overridesByLang?.[lang]?.fontFamily;
        if (!chain) continue;

        const families = chain.split(',').map((f) => f.trim().replace(/^["']|["']$/g, ''));
        const generics = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']);
        const concrete = families.filter((f) => !generics.has(f));

        // 총칭 바로 앞에 실제 폰트가 최소 하나는 있어야 한다
        const lastGenericIndex = families.findIndex((f) => generics.has(f));
        expect(lastGenericIndex, `${preset.name}/${lang}`).toBeGreaterThan(0);
        expect(concrete.length, `${preset.name}/${lang}`).toBeGreaterThan(0);
      }
    }
  });

  it('어느 PC 에나 있는 폰트를 폴백으로 둔다', () => {
    // 전용 폰트가 설치되지 않은 볼런티어 PC 에서도 한 폰트로 그려져야 한다
    const common = ['Times New Roman', 'Arial', 'Georgia', 'Baskerville', 'Arial Hebrew'];
    for (const preset of presets) {
      for (const lang of ['grc', 'heb'] as const) {
        const chain = preset.overridesByLang?.[lang]?.fontFamily;
        if (!chain) continue;
        expect(common.some((f) => chain.includes(f)), `${preset.name}/${lang}: ${chain}`).toBe(true);
      }
    }
  });
});

describe('순서 표시 리듬', () => {
  it('기본은 0 — 켜지 않으면 모든 글자가 같은 크기', () => {
    expect(templateToCssVars(base())['--title-rhythm']).toBe('0');
  });

  it('지정한 값을 CSS 변수로 내보낸다 (편집 중에도 미리보기에 반영되도록)', () => {
    const template: Template = { ...base(), behavior: { ...base().behavior, titleRhythm: 1 } };
    expect(templateToCssVars(template)['--title-rhythm']).toBe('1');
  });

  it('크기와 높낮이를 따로 내보낸다', () => {
    // 크기만 흔들거나(높낮이 0), 크기는 두고 높낮이만 흔드는 배치가 각각 쓸모가 있다
    const template: Template = {
      ...base(),
      behavior: { ...base().behavior, titleRhythm: 0.2, titleRhythmY: 0.05 },
    };
    const vars = templateToCssVars(template);
    expect(vars['--title-rhythm']).toBe('0.2');
    expect(vars['--title-rhythm-y']).toBe('0.05');
  });

  it('높낮이 기본은 0 — 아랫선이 가지런하다', () => {
    expect(templateToCssVars(base())['--title-rhythm-y']).toBe('0');
  });

  it('범위를 벗어난 값은 잘라 낸다 — 글자가 화면 밖으로 튀면 안 된다', () => {
    expect(clampRhythm(5)).toBe(MAX_TITLE_RHYTHM);
    expect(clampRhythm(-1)).toBe(0);
    expect(clampRhythm(Number.NaN)).toBe(0);
    expect(clampRhythm(undefined)).toBe(0);
  });

  it('명조 프리셋은 리듬이 켜져 있고 한글 명조 체인을 쓴다', () => {
    const preset = BUILTIN_TEMPLATES.find((t) => t.kind === 'order')!;
    expect(preset.behavior.titleRhythm).toBeGreaterThan(0);
    expect(preset.behavior.titleRhythmY).toBeGreaterThan(0);
    // 2026-08-15 사용자가 정한 기본값
    expect(preset.behavior.titleRhythm).toBe(1);
    expect(preset.behavior.presenterScale).toBe(0.8);
    expect(preset.text.primary.stroke?.width).toBe(12);
    expect(preset.text.secondary.stroke?.width).toBe(10);
    // 총칭 serif 앞에 실제 폰트가 있어야 글자별 대체가 일어나지 않는다 (PLAN 3.4)
    expect(preset.text.primary.fontFamily).toMatch(/Batang|Myeongjo|Myungjo/);
    expect(preset.text.primary.fontFamily.endsWith('serif')).toBe(true);
  });
});

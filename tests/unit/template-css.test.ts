import { describe, expect, it } from 'vitest';

import { BUILTIN_TEMPLATES, SHARED_PRESET_IDS, DEFAULT_TEMPLATE_ID, getBuiltinTemplate } from '../../lib/template-presets.ts';
import { MAX_TITLE_RHYTHM, anchorToAlignment, clampRhythm, diffCssVars, isAllowedStyleKey, overrideVarsFor, templateToCssVars, withAlpha } from '../../lib/template-css.ts';
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
  it('8종이 있고 id 가 겹치지 않는다', () => {
    /*
     * 2026-08-19: 11 → 8 로 정리했다 (사용자 요청).
     * '단일/이중' 과 '본문/찬양' 은 아무것도 가르지 않았다 — 역할은 내용이 정하고
     * 템플릿은 모양만 정한다. 그래서 넷(-1·-2·-4·-5)을 '하단' 하나로 합쳤다.
     */
    expect(BUILTIN_TEMPLATES).toHaveLength(8);
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('성경·찬송 겸용 셋과 전용 셋으로 나뉜다', () => {
    const names = BUILTIN_TEMPLATES.map((t) => t.name);
    // 겸용 — 이름에 겸용임을 밝힌다 (kind 는 라벨일 뿐이라 이름이 유일한 안내다)
    expect(names.filter((n) => n.includes('겸용'))).toHaveLength(3);
    expect(names[0]).toContain('하단');
  });

  it('없어진 프리셋 id 를 다시 쓰지 않는다 — 옛 백업이 엉뚱한 자리에 들어가지 않게', () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.id);
    for (const gone of [-2, -4, -5]) expect(ids).not.toContain(gone);
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

describe('성경·찬양 탭에서 고를 수 있는 프리셋', () => {
  it('셋뿐이다 — 하단·전체·좌우', () => {
    expect(SHARED_PRESET_IDS).toEqual([-1, -8, -3]);
  });

  it('모두 실제로 있는 프리셋이다', () => {
    for (const id of SHARED_PRESET_IDS) {
      expect(BUILTIN_TEMPLATES.some((t) => t.id === id), `프리셋 ${id}`).toBe(true);
    }
  });

  it('셋 다 이름에 겸용임을 밝힌다 — 고를 때 그것이 안내가 된다', () => {
    for (const id of SHARED_PRESET_IDS) {
      expect(BUILTIN_TEMPLATES.find((t) => t.id === id)!.name).toContain('겸용');
    }
  });

  it('항목 전용 프리셋은 들어 있지 않다', () => {
    // 순서 표시(-9)·교독문(-10)·전례문(-11)·로우서드(-6)·공백(-7)
    for (const id of [-9, -10, -11, -6, -7]) expect(SHARED_PRESET_IDS).not.toContain(id);
  });
});

/**
 * 템플릿 탭에서 새로 편집할 수 있게 된 값들 (§4.6 B, 2026-09-03).
 *
 * 렌더는 전부터 되어 있었고 프리셋만 쓰고 있었다. 화면에 컨트롤을 붙이면서
 * **끄는 길**이 필요해졌는데, 거기 함정이 하나 있다 — 아래 첫 테스트가 그것이다.
 */
describe('화면에서 새로 만질 수 있는 글자 값', () => {
  function withPrimary(patch: Partial<Template['text']['primary']>): Record<string, string> {
    const template = base();
    return templateToCssVars({ ...template, text: { ...template.text, primary: { ...template.text.primary, ...patch } } });
  }

  /**
   * **끄기는 `null` 이어야 한다.**
   *
   * `undefined` 로 끄면 `JSON.stringify` 가 그 키를 지워서 서버(`mergeTemplate`)에는
   * 필드가 아예 오지 않는다 → 옛 값이 그대로 남아 화면에서 끌 수 없다.
   * 그래서 `lineGapPx` 는 `number | null` 이고, 둘 다 '안 쓴다' 로 읽어야 한다.
   */
  it('절대 행간: null 도 undefined 처럼 배수로 돌아간다', () => {
    expect(withPrimary({ lineGapPx: 20, lineHeight: 1.4 })['--primary-line-height']).toBe('calc(1em + 20px)');
    expect(withPrimary({ lineGapPx: null, lineHeight: 1.4 })['--primary-line-height']).toBe('1.4');
    expect(withPrimary({ lineGapPx: undefined, lineHeight: 1.4 })['--primary-line-height']).toBe('1.4');
    // 0 은 '여백 없음' 이라는 뜻이 있는 값이다 — 끈 것으로 보면 안 된다
    expect(withPrimary({ lineGapPx: 0, lineHeight: 1.4 })['--primary-line-height']).toBe('calc(1em + 0px)');
  });

  it('자간·대문자화·투명도가 변수로 나간다', () => {
    const vars = withPrimary({ letterSpacing: 2.5, textTransform: 'uppercase', opacity: 0.8 });
    expect(vars['--primary-spacing']).toBe('2.5px');
    expect(vars['--primary-transform']).toBe('uppercase');
    expect(vars['--primary-opacity']).toBe('0.8');
  });

  it('글자 뒤 상자를 켜면 네 값이 함께 나간다', () => {
    const on = withPrimary({ bgBox: { color: 'rgba(0,0,0,0.55)', paddingX: 28, paddingY: 14, radius: 10 } });
    expect(on['--primary-box-bg']).toBe('rgba(0,0,0,0.55)');
    expect(on['--primary-box-pad-x']).toBe('28px');
    expect(on['--primary-box-pad-y']).toBe('14px');
    expect(on['--primary-box-radius']).toBe('10px');
  });

  it('끄면 상자가 투명하고 여백이 0 이다 — 껐는데 자리를 차지하면 안 된다', () => {
    const off = withPrimary({ bgBox: null });
    expect(off['--primary-box-bg']).toBe('transparent');
    expect(off['--primary-box-pad-x']).toBe('0px');
    expect(off['--primary-box-pad-y']).toBe('0px');
    expect(off['--primary-box-radius']).toBe('0px');
  });

  /**
   * 절 번호·참조·소제목은 `simpleStyleVars` 를 타서 이 변수들이 **나가지 않는다.**
   * 그래서 템플릿 탭이 거기에는 컨트롤을 두지 않는다(`full` 프롭). 여기가 바뀌면
   * 화면도 함께 바뀌어야 하므로 못을 박아 둔다.
   */
  it('절 번호·참조·소제목에는 자간·상자 변수가 없다 (투명도는 있다)', () => {
    const vars = templateToCssVars(base());
    for (const prefix of ['versenum', 'reference', 'heading', 'credit']) {
      expect(vars[`--${prefix}-opacity`]).toBeDefined();
      expect(vars[`--${prefix}-spacing`]).toBeUndefined();
      expect(vars[`--${prefix}-transform`]).toBeUndefined();
      expect(vars[`--${prefix}-box-bg`]).toBeUndefined();
    }
  });
});

/**
 * 출력 화면에 넣어도 되는 키인가 (점검 S-3 · 감사 L-1).
 *
 * 여기가 느슨해지면 `{display:'none'}` 한 줄로 송출 화면이 사라진다. 그리고
 * 템플릿을 다시 보내도 복구되지 않는다 — `--` 변수만 덮으므로.
 */
describe('isAllowedStyleKey', () => {
  it('CSS 변수는 받는다', () => {
    for (const key of ['--primary-size', '--backdrop-opacity', '--모르는이름']) {
      expect(isAllowedStyleKey(key), key).toBe(true);
    }
  });

  it('변수가 아닌 두 키만 예외로 받는다 — 출력 페이지가 직접 해석한다', () => {
    expect(isAllowedStyleKey('backdrop')).toBe(true);
    expect(isAllowedStyleKey('anchor')).toBe(true);
  });

  it('진짜 CSS 속성은 막는다 — 화면 자체를 바꿀 수 있다', () => {
    for (const key of ['display', 'opacity', 'position', 'visibility', 'transform', 'color', 'all']) {
      expect(isAllowedStyleKey(key), key).toBe(false);
    }
  });

  it('변수처럼 보이게 꾸민 것도 막는다', () => {
    for (const key of [' --primary-size', 'x--primary-size', '-display', '']) {
      expect(isAllowedStyleKey(key), JSON.stringify(key)).toBe(false);
    }
  });

  it('프리셋 8종이 내는 키를 하나도 막지 않는다 — 여기가 막히면 화면이 깨진다', () => {
    for (const preset of BUILTIN_TEMPLATES) {
      for (const key of Object.keys(templateToCssVars(preset))) {
        expect(isAllowedStyleKey(key), `${preset.name} 의 ${key}`).toBe(true);
      }
    }
  });
});

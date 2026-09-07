/**
 * **항목이 어느 템플릿으로 나가는가** (`lib/plan-item-template.ts`).
 *
 * ## 왜 값이 있는가
 *
 * 이것이 틀리면 **예배 화면에 엉뚱한 판이 나간다** — 성경 본문이 로우서드
 * (설교자 이름용 띠)로 나가는 식이다. 그런데 이 넷은 2026-09-07 까지
 * `PlanPanel`(2,549줄) 안의 함수 선언이라 검사가 없었다.
 *
 * 검사가 없는 동안 실제로 사고가 났다: `sendItem` 의 의존성에 `plan` 이 없어서
 * **기본 템플릿을 바꾼 직후 ▶ 를 누르면 이전 값이 나갔다.** 격리 서버 7830 에서
 * 재현했다 — -8 로 바꿨는데 -1 이 나갔고, 항목을 옮겨 `sendItem` 이 다시 만들어진
 * 뒤에야 -8 이 나갔다. 값을 **인자로** 받게 바꿨으니 이제 그럴 수가 없다.
 *
 * 프리셋(`BUILTIN_TEMPLATES`)을 그대로 쓴다 — 가짜 픽스처를 만들면 실제 값과
 * 어긋난 채로 통과할 수 있다.
 */

import { describe, expect, it } from 'vitest';

import {
  baseFontSizeFor,
  defaultsKeyFor,
  itemTemplateFor,
  templateIdFor,
  type TemplateChoice,
} from '../../lib/plan-item-template.ts';
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from '../../lib/template-presets.ts';
import type { CueItem } from '../../shared/types.ts';

/** 실제 프리셋 — 하단(68) · 전체(96) · 좌우(46) · 로우서드(40) */
const BOTTOM = getBuiltinTemplate(-1)!;
const FULL = getBuiltinTemplate(-8)!;
const SPLIT = getBuiltinTemplate(-3)!;

const choice = (patch: Partial<TemplateChoice> = {}): TemplateChoice => ({
  styleTemplates: BUILTIN_TEMPLATES,
  template: BOTTOM,
  ...patch,
});

const bible = (patch: Partial<Extract<CueItem, { type: 'bible' }>> = {}): CueItem =>
  ({ id: 'b1', type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [], ...patch }) as CueItem;
const song = (patch: Record<string, unknown> = {}): CueItem =>
  ({ id: 's1', type: 'song', songId: 1, title: '주 사랑', langs: ['ko'], ...patch }) as unknown as CueItem;
const text = (variant: string): CueItem =>
  ({ id: 't1', type: 'text', variant, content: '설교 제목' }) as unknown as CueItem;

describe('기본 설정의 어느 칸을 보는가', () => {
  it('성경 · 찬양은 제 칸이다', () => {
    expect(defaultsKeyFor(bible())).toBe('bible');
    expect(defaultsKeyFor(song())).toBe('song');
  });

  it("★ 순서 표시는 'order', 나머지 글자(광고·인용구)는 'text' 다 — 한 칸에 묶으면 함께 바뀐다", () => {
    expect(defaultsKeyFor(text('order'))).toBe('order');
    expect(defaultsKeyFor(text('notice'))).toBe('text');
    expect(defaultsKeyFor(text('quote'))).toBe('text');
  });

  it('해당 칸이 없는 종류는 null — 기본 설정이 끼어들지 않는다', () => {
    for (const type of ['blank', 'divider', 'liturgy', 'reading', 'slideshow'] as const) {
      expect(defaultsKeyFor({ id: 'x', type } as unknown as CueItem)).toBeNull();
    }
  });
});

describe('★ 고르는 순서 — 항목 지정 → 예배 기본 설정 → 지금 것 유지', () => {
  it('항목이 지정한 것이 가장 세다', () => {
    const c = choice({ defaults: { templates: { bible: -3 } } });
    expect(templateIdFor(bible({ templateId: -8 }), c)).toBe(-8);
  });

  it('항목이 지정하지 않았으면 예배 기본 설정을 쓴다', () => {
    const c = choice({ defaults: { templates: { bible: -3 } } });
    expect(templateIdFor(bible(), c)).toBe(-3);
  });

  it("★ 둘 다 없으면 undefined — '지금 것 유지' 라는 뜻이다 (부르는 쪽이 template:set 을 안 보낸다)", () => {
    expect(templateIdFor(bible(), choice())).toBeUndefined();
    expect(templateIdFor(bible(), choice({ defaults: {} }))).toBeUndefined();
  });

  it('★ 성경 기본값은 찬양에 옮겨붙지 않는다 — 칸이 갈려 있어야 하는 이유', () => {
    const c = choice({ defaults: { templates: { bible: -3 } } });
    expect(templateIdFor(song(), c)).toBeUndefined();
  });

  it('id 0 도 지정으로 본다 — 0 을 "없음" 으로 쓰면 그 템플릿을 고를 수 없다', () => {
    expect(templateIdFor(bible({ templateId: 0 }), choice())).toBe(0);
  });
});

describe('실제 템플릿 객체로 바꿀 때', () => {
  it('지정한 id 의 템플릿을 준다', () => {
    expect(itemTemplateFor(bible({ templateId: -8 }), choice())?.id).toBe(-8);
  });

  it('지정이 없으면 지금 것을 준다', () => {
    expect(itemTemplateFor(bible(), choice())?.id).toBe(BOTTOM.id);
  });

  it('★ 지운 템플릿을 가리키고 있으면 지금 것으로 물러난다 — null 을 주면 화면이 빈다', () => {
    // 사용자가 템플릿을 지웠는데 순서표에는 그 id 가 남아 있는 상황
    expect(itemTemplateFor(bible({ templateId: 9999 }), choice())?.id).toBe(BOTTOM.id);
  });

  it('지금 것도 없으면 null — 부르는 쪽이 분기한다', () => {
    expect(itemTemplateFor(bible(), choice({ template: null }))).toBeNull();
  });
});

describe('★ 줄 감김 어림에 쓰는 글자 크기', () => {
  it('항목이 지정한 템플릿의 크기를 쓴다 — 지금 것을 쓰면 어림이 틀린다', () => {
    // 실측에서 140% 인데도 경고가 안 떴던 것이 이 자리다
    expect(baseFontSizeFor(bible({ templateId: -8 }), 64, choice())).toBe(FULL.text.primary.fontSize);
    expect(baseFontSizeFor(bible({ templateId: -3 }), 64, choice())).toBe(SPLIT.text.primary.fontSize);
    // 하단(68)과 전체(96)는 실제로 다르다 — 이 검사가 헛돌지 않는다는 확인
    expect(FULL.text.primary.fontSize).not.toBe(BOTTOM.text.primary.fontSize);
  });

  it('기본 설정으로 정한 템플릿도 따른다', () => {
    const c = choice({ defaults: { templates: { bible: -8 } } });
    expect(baseFontSizeFor(bible(), 64, c)).toBe(FULL.text.primary.fontSize);
  });

  it('지정이 없으면 지금 템플릿의 크기다', () => {
    expect(baseFontSizeFor(bible(), 64, choice())).toBe(BOTTOM.text.primary.fontSize);
  });

  it('아무 템플릿도 없으면 받은 fallback 을 쓴다 — 0 으로 나눠 NaN 이 되지 않게', () => {
    expect(baseFontSizeFor(bible(), 64, { template: null })).toBe(64);
    expect(baseFontSizeFor(bible({ templateId: 9999 }), 64, { template: null })).toBe(64);
  });
});

describe('부르는 쪽이 값을 넣는다 — 오래된 값을 읽을 수 없다', () => {
  it('★ 같은 항목이라도 넣어 준 기본 설정에 따라 결과가 갈린다', () => {
    const item = bible();
    expect(templateIdFor(item, choice({ defaults: { templates: { bible: -1 } } }))).toBe(-1);
    expect(templateIdFor(item, choice({ defaults: { templates: { bible: -8 } } }))).toBe(-8);
    // 이것이 PlanPanel 안의 함수 선언이던 동안, 바꾼 직후 이전 값이 나갔다
    // (2026-09-07 격리 서버 7830 실측). 인자로 받으면 그럴 자리가 없다.
  });
});

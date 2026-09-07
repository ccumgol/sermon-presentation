/**
 * **항목이 실제로 쓸 템플릿을 고른다.**
 *
 * 순서: 항목이 지정한 것 → 예배 기본 설정 → (없으면) 지금 템플릿 유지.
 * 기본 설정을 두는 이유는 한 예배 안에서 성경·찬양 템플릿이 대개 그대로 가기
 * 때문이다. 항목마다 고르게 하면 하나 빠뜨렸을 때 **그 항목만 다르게 나간다.**
 *
 * `PlanPanel` 안에 있던 것을 꺼냈다(2026-09-07 R-4). 꺼낸 이유가 둘이다:
 *
 *  1. **틀리면 예배 화면에 엉뚱한 판이 나간다.** 검사가 붙어야 하는 자리인데
 *     2,500줄짜리 컴포넌트 안에서는 화면을 다 띄워야 부를 수 있었다.
 *  2. 컴포넌트 안의 함수 선언이라 **오래된 값을 읽는 사고가 실제로 났다** —
 *     `sendItem` 의 의존성에 `plan` 이 없어서, 기본 템플릿을 바꾼 직후 ▶ 를
 *     누르면 **이전 값이 나갔다** (2026-09-07 격리 서버 7830 실측:
 *     -8 로 바꾼 뒤 눌렀는데 -1 이 나갔고, 항목을 옮겨 `sendItem` 이 다시
 *     만들어진 뒤에야 -8 이 나갔다). 값을 인자로 받으면 그럴 수가 없다.
 */

import type { CueItem, PlanDefaults, Template } from '../shared/types.ts';

/** 템플릿을 고르는 데 필요한 것들. 부르는 쪽이 **지금 값**을 넣어 준다 */
export interface TemplateChoice {
  /** 예배 기본 설정 (순서표에 저장된 것) */
  defaults?: PlanDefaults | undefined;
  /** 항목이 고를 수 있는 표시 템플릿 목록 */
  styleTemplates?: readonly Template[] | undefined;
  /** 지금 화면이 쓰는 템플릿 — 지정이 없으면 이것을 유지한다 */
  template?: Template | null | undefined;
}

/** 기본 설정에서 이 항목이 어느 칸에 해당하는지 (해당 칸이 없으면 `null`) */
export function defaultsKeyFor(item: CueItem): 'bible' | 'song' | 'order' | 'text' | null {
  if (item.type === 'bible') return 'bible';
  if (item.type === 'song') return 'song';
  if (item.type === 'text') return item.variant === 'order' ? 'order' : 'text';
  return null;
}

/**
 * 이 항목이 실제로 쓸 템플릿 id.
 *
 * `undefined` 는 **'지정 없음 = 지금 것을 유지'** 라는 뜻이다 — 부르는 쪽은
 * 이때 `template:set` 을 보내지 않는다. 0 을 쓰지 않는 이유는 그것도 id 가
 * 될 수 있기 때문이다.
 */
export function templateIdFor(item: CueItem, choice: TemplateChoice): number | undefined {
  const own = 'templateId' in item ? item.templateId : undefined;
  if (typeof own === 'number') return own;
  const key = defaultsKeyFor(item);
  return key ? choice.defaults?.templates?.[key] : undefined;
}

/** 이 항목이 실제로 쓸 템플릿 — 지정이 없으면 기본 설정, 그것도 없으면 지금 것 */
export function itemTemplateFor(item: CueItem, choice: TemplateChoice): Template | null {
  const fallback = choice.template ?? null;
  const id = templateIdFor(item, choice);
  if (typeof id !== 'number') return fallback;
  return choice.styleTemplates?.find((t) => t.id === id) ?? fallback;
}

/**
 * 이 항목이 실제로 쓸 템플릿의 기본 글자 크기.
 *
 * 지금 활성 템플릿을 쓰면 안 된다 — 항목이 다른 템플릿을 지정했으면 크기가 달라
 * **줄 감김 어림이 틀린다** (실측에서 140% 인데도 경고가 안 떴다).
 */
export function baseFontSizeFor(item: CueItem, fallback: number, choice: TemplateChoice): number {
  const id = templateIdFor(item, choice);
  if (typeof id === 'number') {
    const found = choice.styleTemplates?.find((t) => t.id === id);
    if (found) return found.text.primary.fontSize;
  }
  return choice.template?.text.primary.fontSize ?? fallback;
}

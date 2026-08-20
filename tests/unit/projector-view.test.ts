/**
 * 프로젝터 화면이 쓰는 템플릿.
 *
 * OBS 로 나가는 화면과 **다른 배치**를 동시에 쓴다 — OBS 는 카메라 위 하단 두 줄,
 * 프로젝터는 전체화면 큰 글씨. 그래서 프로젝터 layer 에만 다른 템플릿을 보낸다.
 */

import { describe, expect, it } from 'vitest';

import { PROJECTOR_TEMPLATE_ID, projectorTemplate } from '../../lib/projector-view.ts';
import { BUILTIN_TEMPLATES, getBuiltinTemplate } from '../../lib/template-presets.ts';

const FULL = getBuiltinTemplate(PROJECTOR_TEMPLATE_ID);

describe('바탕이 되는 프리셋', () => {
  it("'전체 — 성경·찬송 겸용' 을 쓴다 (사용자가 지정한 것)", () => {
    expect(FULL).toBeDefined();
    expect(FULL?.name).toContain('전체');
  });

  it('그 프리셋은 실제로 목록에 있다', () => {
    expect(BUILTIN_TEMPLATES.some((preset) => preset.id === PROJECTOR_TEMPLATE_ID)).toBe(true);
  });
});

describe('프로젝터용으로 고치는 것', () => {
  it('autoFit 을 끈다 — 켜 두면 + 로 키운 만큼 되돌려 깎는다', () => {
    const view = projectorTemplate(FULL!);
    expect(view.behavior.autoFitMinScale).toBe(1);
  });

  it('바탕 프리셋을 바꾸지 않는다 (불변)', () => {
    const before = JSON.stringify(FULL);
    projectorTemplate(FULL!);
    expect(JSON.stringify(FULL)).toBe(before);
  });

  it('배치·글자 크기는 바탕 그대로 둔다 — 사용자가 그 템플릿을 고치면 따라간다', () => {
    const view = projectorTemplate(FULL!);
    expect(view.layout.anchor).toBe(FULL!.layout.anchor);
    expect(view.text.primary.fontSize).toBe(FULL!.text.primary.fontSize);
    expect(view.behavior.maxCharsPerLine).toBe(FULL!.behavior.maxCharsPerLine);
  });

  it('사용자가 고친 템플릿을 넘겨도 그것을 바탕으로 쓴다', () => {
    const edited = {
      ...FULL!,
      text: { ...FULL!.text, primary: { ...FULL!.text.primary, fontSize: 120 } },
    };
    expect(projectorTemplate(edited).text.primary.fontSize).toBe(120);
  });

  it('참조·소제목은 바탕 프리셋대로 꺼져 있다 — 요청: 타이틀 삭제', () => {
    const view = projectorTemplate(FULL!);
    expect(view.behavior.showReference).toBe('none');
    expect(view.behavior.showHeadings).toBe(false);
    expect(view.behavior.showCredit).toBe(false);
  });
});

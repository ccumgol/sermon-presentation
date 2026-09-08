// @vitest-environment jsdom
/**
 * **이 예배의 기본 설정** (`src/control/components/plan/PlanDefaultsCard.tsx`).
 *
 * ## 왜 값이 있는가
 *
 * 이 카드의 값들은 **순서표 안에 함께 담긴다**(`service_plans.defaults`). 따로
 * 저장되는 곳이 없어서, 여기서 잘못 담기면 **저장할 때까지 아무도 모르고**
 * 다음 주에 다른 값으로 예배가 돈다.
 *
 * 규칙 셋이 이 화면에 있다:
 *
 * | | |
 * |---|---|
 * | 템플릿 | **이미 만든 항목에도** 곧바로 적용된다 |
 * | 역본·언어 | **앞으로 넣는 항목**에만 채워진다 (이미 넣은 것을 몰래 바꾸면 놀란다) |
 * | 기본 역본을 바꾸면 | **추가 바도 따라간다** — 두 곳이 다르면 방금 정한 값이 안 먹은 것으로 보인다 |
 *
 * ## 틀(harness)
 *
 * 훅 객체를 가짜로 넣는다. `patchDefaults` 는 실제 훅과 같은 모양
 * (`(current) => next`)인데, **넘어온 함수를 그 자리에서 바로 적용해** 쌓아 둔다.
 *
 * ⚠️ **나중에 적용하면 안 된다.** 컴포넌트의 `onChange` 는 `e.target.value` 를
 * 그 함수 **안에서** 읽는다. 이벤트가 끝난 뒤에 부르면, React 가 제어 컴포넌트의
 * DOM 값을 원래대로 되돌려 놓은 뒤라 **바꾸기 전 값**이 읽힌다(실제로 겪었다).
 * 진짜 훅은 상태 갱신 중에 즉시 부르므로 이 문제가 없다 — 가짜도 그렇게 맞춘다.
 *
 * ⚠️ `styleTemplates` 를 비우면 `<option>` 이 없어 `<select>` 의 `value` 가
 * 반영되지 않는다(React 동작). **프리셋 실물**을 쓴다.
 *
 * ⚠️ 이 카드의 `<label>` 은 컨트롤과 **연결돼 있지 않다**(`htmlFor` 없음). 그래서
 * `getByLabelText` 가 듣지 않는다. 여기서는 같은 줄(`.row`) 안의 컨트롤을 찾는다 —
 * 검사 편의를 위해 화면에 id 를 뿌리지 않는다. (연결해 두면 레이블을 눌러 컨트롤로
 * 갈 수 있어 실제로도 낫다. 지금 범위 밖이라 기록만 남긴다.)
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_SECONDARY } from '../../lib/plan-item-view.ts';
import { BUILTIN_TEMPLATES } from '../../lib/template-presets.ts';
import { PlanDefaultsCard } from '../../src/control/components/plan/PlanDefaultsCard.tsx';
import type { PlanDefaults, ServicePlan, Translation } from '../../shared/types.ts';
import type { PlanAdd } from '../../src/control/hooks/usePlanAdd.ts';
import type { PlanBackgrounds } from '../../src/control/hooks/usePlanBackgrounds.ts';
import type { PlanDraft } from '../../src/control/hooks/usePlanDraft.ts';
import type { PlanFeedback } from '../../src/control/hooks/usePlanFeedback.ts';
import type { PlanPreview } from '../../src/control/hooks/usePlanPreview.ts';
import type { PlanStorage } from '../../src/control/hooks/usePlanStorage.ts';

afterEach(cleanup);

const TRANSLATIONS = [
  { id: 'nkrv', name: '개역개정', shortName: '개정' },
  { id: 'niv', name: 'NIV', shortName: 'NIV' },
  { id: 'esv', name: 'ESV', shortName: 'ESV' },
  { id: 'kjv', name: 'KJV', shortName: 'KJV' },
] as unknown as Translation[];

const spies = {
  patchDefaults: vi.fn(), saveCurrent: vi.fn(),
  setAddPrimary: vi.fn(), setAddSecondary: vi.fn(),
};

/** 화면이 담은 값이 쌓이는 곳 — 진짜 훅의 상태 자리다 */
let stored: PlanDefaults = {};

function setup(o: { defaults?: PlanDefaults; dirty?: boolean; busy?: boolean } = {}) {
  cleanup();
  vi.clearAllMocks();
  const defaults = o.defaults ?? {};
  stored = defaults;
  spies.patchDefaults.mockImplementation((mutate: (c: PlanDefaults) => PlanDefaults) => {
    stored = mutate(stored);
  });
  const plan = { id: 1, name: '주일예배', kind: 'plan', items: [], defaults } as unknown as ServicePlan;

  render(
    <PlanDefaultsCard
      plan={plan}
      storage={{
        saveCurrent: spies.saveCurrent, saveLabel: '저장하기', planNoun: '순서표',
        templates: [],
      } as unknown as PlanStorage}
      draft={{ dirty: o.dirty ?? false, patchDefaults: spies.patchDefaults } as unknown as PlanDraft}
      add={{ setAddPrimary: spies.setAddPrimary, setAddSecondary: spies.setAddSecondary } as unknown as PlanAdd}
      preview={{ styleTemplates: BUILTIN_TEMPLATES } as unknown as PlanPreview}
      backgrounds={{ library: [], files: [] } as unknown as PlanBackgrounds}
      feedback={{ busy: o.busy ?? false } as unknown as PlanFeedback}
      translations={TRANSLATIONS}
      defaultTranslation="nkrv"
    />,
  );
  return { defaults };
}

/** 화면이 실제로 담은 값. 함수가 불렸는지만 보면 무엇이 담기는지는 모른다 */
function applied(): PlanDefaults {
  expect(spies.patchDefaults).toHaveBeenCalled();
  return stored;
}

/**
 * 그 레이블과 **같은 줄**에 있는 `<select>`.
 *
 * 한 줄에 여러 컨트롤이 있는 경우가 있어(성경 넘김·표시 언어·찬양 넘김이 한 줄),
 * 레이블 **뒤에 오는 첫 select** 를 고른다.
 */
function selectFor(labelText: string): HTMLSelectElement {
  const label = screen.getByText(labelText, { selector: 'label' });
  const row = label.closest('.row');
  if (!row) throw new Error(`'${labelText}' 의 줄을 찾지 못했다`);

  const after = [...row.children];
  const start = after.indexOf(label);
  for (const node of after.slice(start + 1)) {
    if (node instanceof HTMLSelectElement) return node;
  }
  throw new Error(`'${labelText}' 뒤에 select 가 없다`);
}

/** 그 레이블 뒤에 오는 단추 묶음(`.candidates`) */
function buttonsFor(labelText: string): HTMLButtonElement[] {
  const label = screen.getByText(labelText, { selector: 'label' });
  const row = label.closest('.row')!;
  const children = [...row.children];
  for (const node of children.slice(children.indexOf(label) + 1)) {
    if (node.classList.contains('candidates')) {
      return [...node.querySelectorAll('button')] as HTMLButtonElement[];
    }
  }
  throw new Error(`'${labelText}' 뒤에 단추 묶음이 없다`);
}

/** 이름으로 그 묶음 안의 단추 하나 */
function buttonIn(labelText: string, name: string): HTMLButtonElement {
  const found = buttonsFor(labelText).find((one) => one.textContent === name);
  if (!found) throw new Error(`'${labelText}' 에 '${name}' 단추가 없다`);
  return found;
}

// ─────────────────────────────────────────────────────────────
describe('템플릿 넷', () => {
  it('종류마다 고르는 칸이 있다', () => {
    setup();
    for (const label of ['성경 템플릿', '찬양 템플릿', '순서 표시 템플릿', '광고·인용구 템플릿']) {
      expect(selectFor(label)).toBeDefined();
    }
  });

  it('저장된 값이 골라져 있다', () => {
    setup({ defaults: { templates: { bible: -1 } } });
    expect(selectFor('성경 템플릿').value).toBe('-1');
  });

  it('고르면 그 종류만 담긴다', () => {
    setup({ defaults: { templates: { song: -2 } } });
    fireEvent.change(selectFor('성경 템플릿'), { target: { value: '-3' } });

    expect(applied().templates).toEqual({ song: -2, bible: -3 });
  });

  /** '지정 안 함' 은 값을 지우는 것이다 — 0 이나 빈 문자열이 담기면 안 된다 */
  it("'지정 안 함' 을 고르면 undefined 가 담긴다", () => {
    setup({ defaults: { templates: { bible: -1 } } });
    fireEvent.change(selectFor('성경 템플릿'), { target: { value: '' } });

    expect(applied().templates?.bible).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
describe('성경 역본', () => {
  it('기본 역본이 없으면 서버 기본값이 골라져 있다', () => {
    setup();
    expect(selectFor('성경 역본').value).toBe('nkrv');
  });

  /**
   * **추가 바도 함께 바뀌어야 한다.** 두 곳이 다르면 방금 정한 값이 안 먹은
   * 것으로 보인다.
   */
  it('주 역본을 바꾸면 추가 바도 따라간다', () => {
    setup();
    fireEvent.change(selectFor('성경 역본'), { target: { value: 'niv' } });

    expect(applied().bible?.primary).toBe('niv');
    expect(spies.setAddPrimary).toHaveBeenCalledWith('niv');
  });

  /** 주 역본으로 올라간 것이 대조 목록에 남아 있으면 같은 본문이 두 번 나간다 */
  it('주 역본이 된 것은 대조 목록에서 빠진다', () => {
    setup({ defaults: { bible: { primary: 'nkrv', secondary: ['niv', 'esv'] } } });
    fireEvent.change(selectFor('성경 역본'), { target: { value: 'niv' } });

    expect(applied().bible?.secondary).toEqual(['esv']);
  });

  it('주 역본은 대조 후보에 나오지 않는다', () => {
    setup({ defaults: { bible: { primary: 'nkrv' } } });
    const names = buttonsFor('성경 역본').map((one) => one.textContent);
    expect(names).not.toContain('개정');
    expect(names).toContain('NIV');
  });

  it('대조 역본을 켜고 끈다', () => {
    setup({ defaults: { bible: { primary: 'nkrv', secondary: [] } } });
    fireEvent.click(buttonIn('성경 역본', 'NIV'));
    expect(applied().bible?.secondary).toEqual(['niv']);

    setup({ defaults: { bible: { primary: 'nkrv', secondary: ['niv'] } } });
    fireEvent.click(buttonIn('성경 역본', 'NIV'));
    expect(applied().bible?.secondary).toEqual([]);
  });

  /** 화면 폭이 정해져 있다 — 셋을 겹쳐 놓으면 글자가 뭉갠다 */
  it(`대조는 ${MAX_SECONDARY}개까지 — 넘으면 단추가 잠긴다`, () => {
    setup({ defaults: { bible: { primary: 'nkrv', secondary: ['niv', 'esv'] } } });
    expect(buttonIn('성경 역본', 'KJV').disabled).toBe(true);
    // 이미 켜진 것은 끌 수 있어야 한다 — 잠기면 되돌릴 길이 없다
    expect(buttonIn('성경 역본', 'NIV').disabled).toBe(false);
  });

  it('대조를 바꾸면 추가 바도 따라간다', () => {
    setup({ defaults: { bible: { primary: 'nkrv', secondary: [] } } });
    fireEvent.click(buttonIn('성경 역본', 'ESV'));
    expect(spies.setAddSecondary).toHaveBeenCalledWith(['esv']);
  });
});

// ─────────────────────────────────────────────────────────────
describe('화면 넘김과 표시 언어', () => {
  it('성경 넘김 기본은 1절씩', () => {
    setup();
    expect(selectFor('성경 화면 넘김').value).toBe('verse');
  });

  it('성경 넘김을 바꾼다', () => {
    setup();
    fireEvent.change(selectFor('성경 화면 넘김'), { target: { value: 'pair' } });
    expect(applied().bible?.paging).toBe('pair');
  });

  it('찬양 넘김 기본은 2줄씩', () => {
    setup();
    expect(selectFor('찬양 화면 넘김').value).toBe('2');
  });

  it('찬양 넘김을 바꾼다', () => {
    setup();
    fireEvent.change(selectFor('찬양 화면 넘김'), { target: { value: 'section' } });
    expect(applied().song?.lines).toBe('section');
  });

  /** 한/영 병기가 상시 요구다 — 언어를 겹쳐 켤 수 있어야 한다 */
  it('표시 언어를 켜고 끈다', () => {
    setup({ defaults: { song: { langs: ['ko'] } } });
    fireEvent.click(buttonIn('찬양 표시 언어', 'English'));
    expect(applied().song?.langs).toEqual(['ko', 'en']);
  });
});

// ─────────────────────────────────────────────────────────────
describe('항목을 누르면 제목 띄우기', () => {
  /** 값이 없으면 **켠 것으로 본다** — 요청받은 기능이 기본으로 동작해야 한다 */
  it('값이 없으면 켬이 골라져 있다', () => {
    setup();
    expect(buttonIn('항목을 누르면 제목 띄우기', '켬').className).toContain('primary');
  });

  it('끄면 false 가 담긴다', () => {
    setup();
    fireEvent.click(buttonIn('항목을 누르면 제목 띄우기', '끔'));
    expect(applied().titleOnSelect).toBe(false);
  });

  it('꺼 둔 상태가 화면에 보인다', () => {
    setup({ defaults: { titleOnSelect: false } });
    expect(buttonIn('항목을 누르면 제목 띄우기', '끔').className).toContain('primary');
    expect(buttonIn('항목을 누르면 제목 띄우기', '켬').className).not.toContain('primary');
  });
});

// ─────────────────────────────────────────────────────────────
/**
 * **저장 버튼을 여기에도 둔 이유**: 이 값들은 순서표 안에 담기므로 저장하는 곳이
 * 위의 버튼 하나뿐이다. 그런데 그 버튼은 '순서를 저장하는 것' 으로 보여
 * '기본 설정 저장 버튼은 어디 있나' 를 찾게 됐다 (2026-09-03 사용자 보고).
 */
describe('저장', () => {
  it('저장하지 않은 상태를 알린다', () => {
    setup({ dirty: true });
    expect(screen.getByText(/아직 저장되지 않았습니다/)).toBeDefined();
  });

  it('저장된 상태면 어디에 담겼는지 알린다', () => {
    setup({ dirty: false });
    expect(screen.getByText(/'주일예배' 에 저장된 상태입니다/)).toBeDefined();
  });

  it('누르면 저장한다', () => {
    setup({ dirty: true });
    fireEvent.click(screen.getByRole('button', { name: '저장하기' }));
    expect(spies.saveCurrent).toHaveBeenCalled();
  });

  /** 저장 중에 또 누르면 같은 것이 두 번 간다 */
  it('작업 중에는 잠긴다', () => {
    setup({ busy: true });
    expect((screen.getByRole('button', { name: '저장하기' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

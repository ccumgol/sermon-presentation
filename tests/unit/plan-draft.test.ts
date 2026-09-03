/**
 * 예배 순서 편집 초안 — 탭을 옮겨도 짜던 순서를 잃지 않는다.
 *
 * 왜: 탭은 조건부 렌더라 '찬양' 으로 옮기는 순간 PlanPanel 이 언마운트되고 useState 가
 * 사라진다. 돌아오면 '아무것도 열지 않았으면 첫 유형을 연다' 규칙이 다시 돌아
 * **기본 유형으로 되돌아갔다** (2026-09-03 사용자 보고).
 *
 * 여기서 지키는 것은 세 가지다 — 담고 되살린다 / 형태가 다른 옛 초안은 버린다 /
 * 저장이 막힌 브라우저에서도 던지지 않는다 (시크릿 창·용량 초과).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CueItem, ServicePlan } from '../../shared/types.ts';
import { clearPlanDraft, readPlanDraft, writePlanDraft } from '../../src/control/panels/plan-draft.ts';

const KEY = 'sermon.plan-draft.v1';

/** vitest 환경은 node 라서 sessionStorage 가 없다 — 최소 구현을 끼운다 */
function installStorage(store = new Map<string, string>()): Map<string, string> {
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

const plan: ServicePlan = {
  id: 7,
  kind: 'template',
  name: '주일예배',
  items: [],
};

const items: CueItem[] = [
  { id: 'a', type: 'divider', label: '예배 전' },
  { id: 'b', type: 'song', songId: 42, songTitle: '은혜', langs: ['ko', 'en'] },
];

let store: Map<string, string>;

beforeEach(() => {
  store = installStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'sessionStorage');
});

describe('담고 되살린다', () => {
  it('넣은 그대로 돌려준다', () => {
    writePlanDraft({ plan, items, dirty: true, cursor: 3, expandedId: 'b' });
    expect(readPlanDraft()).toEqual({ plan, items, dirty: true, cursor: 3, expandedId: 'b' });
  });

  it('아무것도 없으면 null — 그러면 패널이 첫 유형을 연다', () => {
    expect(readPlanDraft()).toBeNull();
  });

  it('지우면 없어진다 (편집 중인 유형을 삭제한 경우)', () => {
    writePlanDraft({ plan, items, dirty: true, cursor: 0, expandedId: null });
    clearPlanDraft();
    expect(readPlanDraft()).toBeNull();
  });
});

describe('망가진 초안', () => {
  it('JSON 이 아니면 null', () => {
    store.set(KEY, '{내용이 아님');
    expect(readPlanDraft()).toBeNull();
  });

  it('형태가 다르면 버리고 지운다 — 판이 바뀐 옛 초안이 패널을 깨뜨리지 않게', () => {
    store.set(KEY, JSON.stringify({ plan: { name: '이름만' }, items: [] }));
    expect(readPlanDraft()).toBeNull();
    expect(store.has(KEY)).toBe(false);
  });

  it('items 가 배열이 아니면 버린다', () => {
    store.set(KEY, JSON.stringify({ plan, items: '두 개', dirty: false, cursor: 0, expandedId: null }));
    expect(readPlanDraft()).toBeNull();
  });
});

describe('저장이 막힌 브라우저', () => {
  it('던지지 않는다 — 초안을 못 담는 것이 예배를 막을 이유는 없다', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('접근 거부');
        },
        setItem: () => {
          throw new Error('용량 초과');
        },
        removeItem: () => {
          throw new Error('접근 거부');
        },
      },
    });

    expect(() => writePlanDraft({ plan, items, dirty: true, cursor: 0, expandedId: null })).not.toThrow();
    expect(readPlanDraft()).toBeNull();
    expect(() => clearPlanDraft()).not.toThrow();
  });
});

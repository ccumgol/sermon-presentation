// @vitest-environment jsdom
/**
 * **관리자 패널 글자 크기** (`useUiScale`).
 *
 * ## 왜 검사하는가
 *
 * 이 훅이 틀리면 **글자가 안 커지는 것으로 끝나지 않는다.** 배율은 `:root` 의 `zoom`
 * 이라 화면 전체의 레이아웃이 걸려 있다 — 엉뚱한 값이 들어가면 예배 중에 패널이
 * 통째로 일그러진다. 그래서 '어떤 값이 밖으로 나가는가' 를 못 박는다.
 *
 * | | 왜 |
 * |---|---|
 * | 100% 면 변수를 **지운다** | 한 번도 안 만진 사람에게는 이 기능이 없던 때와 같아야 한다 |
 * | 저장된 쓰레기 값을 안 믿는다 | `localStorage` 는 사람이 손댈 수 있는 곳이다 |
 * | `localStorage` 가 막혀도 동작한다 | 사생활 보호 모드에서 읽기·쓰기가 던진다 |
 * | 순환이 처음으로 돌아온다 | 단추 하나뿐이라 되돌아올 길이 여기밖에 없다 |
 *
 * ## ⚠️ jsdom 에는 `localStorage` 가 없다
 *
 * `window.sessionStorage` 는 멀쩡한데 **`window.localStorage` 는 `undefined`** 다 —
 * Node 자체의 실험적 전역이 jsdom 것을 가리는데, `--localstorage-file` 없이는 값이
 * 없기 때문이다 (`plan-add.test.tsx` 가 겪은 것과 같은 함정의 반대편이다).
 * 그래서 여기서 **가짜 저장소를 끼운다.** 훅이 맨몸 `localStorage` 를 부르고
 * jsdom 에서는 전역 객체가 곧 `window` 이므로 이렇게 끼우면 훅이 그것을 본다.
 *
 * 틀(harness)은 `use-live-state.test.tsx` 와 같다 — 이 파일만 jsdom 이고
 * `cleanup` 은 파일마다 명시한다.
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UI_SCALES, useUiScale } from '../../src/control/hooks/useUiScale.ts';

const KEY = 'sermon.uiScale';

/** jsdom 에 없는 `localStorage` 를 대신한다 (머리말 참고) */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  } as Storage;
}

function installStorage(value: Storage): void {
  Object.defineProperty(window, 'localStorage', { value, configurable: true, writable: true });
}

/** `zoom` 이 실제로 읽는 값 — 훅의 유일한 바깥 출력이다 */
function zoomVar(): string {
  return document.documentElement.style.getPropertyValue('--ui-scale');
}

beforeEach(() => {
  installStorage(fakeStorage());
  document.documentElement.removeAttribute('style');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useUiScale', () => {
  it('기본은 100% 이고 변수를 얹지 않는다', () => {
    const { result } = renderHook(() => useUiScale());

    expect(result.current.scale).toBe(100);
    // 얹으면 `zoom: 1` 이 걸린다 — 값은 같아도 그리기 경로가 달라진다
    expect(zoomVar()).toBe('');
  });

  it('고른 값을 배율(1 기준)로 바꿔 얹는다', () => {
    const { result } = renderHook(() => useUiScale());

    act(() => result.current.setScale(130));

    expect(result.current.scale).toBe(130);
    expect(zoomVar()).toBe('1.3');
    expect(window.localStorage.getItem(KEY)).toBe('130');
  });

  it('100% 로 돌아오면 변수를 다시 지운다', () => {
    const { result } = renderHook(() => useUiScale());

    act(() => result.current.setScale(150));
    expect(zoomVar()).toBe('1.5');

    act(() => result.current.setScale(100));
    expect(zoomVar()).toBe('');
  });

  it('저장된 값을 켤 때 그대로 되살린다', () => {
    window.localStorage.setItem(KEY, '115');

    const { result } = renderHook(() => useUiScale());

    expect(result.current.scale).toBe(115);
    expect(zoomVar()).toBe('1.15');
  });

  it('목록에 없는 값이 저장돼 있으면 기본값으로 둔다', () => {
    // 사람이 손으로 고쳤거나 옛 판이 남긴 값. 그대로 믿으면 zoom 에 아무 수나 들어간다
    for (const junk of ['300', '0', '-1', 'abc', '']) {
      window.localStorage.setItem(KEY, junk);
      const { result } = renderHook(() => useUiScale());
      expect(result.current.scale, `저장값 ${JSON.stringify(junk)}`).toBe(100);
      cleanup();
    }
  });

  it('순환은 목록을 돌아 처음으로 온다', () => {
    const { result } = renderHook(() => useUiScale());

    const seen = [result.current.scale];
    for (let i = 0; i < UI_SCALES.length; i += 1) {
      act(() => result.current.cycle());
      seen.push(result.current.scale);
    }

    // 100 → 115 → 130 → 150 → 100
    expect(seen).toEqual([...UI_SCALES, UI_SCALES[0]]);
  });

  it('localStorage 가 막혀 있어도 이번 세션에는 적용된다', () => {
    // 사생활 보호 모드 — 읽기도 쓰기도 던진다
    const blocked = fakeStorage();
    vi.spyOn(blocked, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(blocked, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    installStorage(blocked);

    const { result } = renderHook(() => useUiScale());
    expect(result.current.scale).toBe(100);

    act(() => result.current.setScale(130));

    expect(result.current.scale).toBe(130);
    expect(zoomVar()).toBe('1.3');
  });
});

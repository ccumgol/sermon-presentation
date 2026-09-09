// @vitest-environment jsdom
/**
 * **화면에 알리는 배너 셋** (`src/control/hooks/useFeedback.ts`).
 *
 * ## 왜 이 작은 훅에 검사를 붙이나
 *
 * 2026-09-09 실측에서 이 파일은 **0%** 였다. 예배 순서 탭·찬양 탭 양쪽이 쓰는데도
 * 그렇다 — 검사들이 이 훅 대신 **가짜를 넣어** 화면만 보았기 때문이다. 가짜가
 * 진짜와 어긋나도 아무도 모른다.
 *
 * 여기서 못 박는 것은 훅이 스스로 약속한 두 가지다.
 *
 * | | 어기면 |
 * |---|---|
 * | 실패와 알림을 **가른다** | 알림 하나가 실패 배너를 덮어 사람이 할 일을 놓친다 |
 * | 세터가 **늘 같은 것**이다 | `usePlanSend` 가 이것을 의존성으로 쓴다 — 매 렌더 바뀌면 송출 함수가 통째로 다시 만들어지고 `memo` 가 헛돈다 |
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';

import { useFeedback } from '../../src/control/hooks/useFeedback.ts';

afterEach(cleanup);

describe('배너 셋', () => {
  it('처음에는 아무 배너도 없다 — 뜬금없는 배너로 시작하지 않는다', () => {
    const { result } = renderHook(() => useFeedback());
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.notice).toBeNull();
  });

  it('실패와 알림은 서로를 지우지 않는다', () => {
    const { result } = renderHook(() => useFeedback());

    act(() => {
      result.current.setError('저장하지 못했습니다');
      result.current.setNotice('항목 둘을 건너뛰었습니다');
      result.current.setBusy(true);
    });

    expect(result.current.error).toBe('저장하지 못했습니다');
    expect(result.current.notice).toBe('항목 둘을 건너뛰었습니다');
    expect(result.current.busy).toBe(true);
  });

  /** 예배 중에 배너가 화면을 덮으면 안 된다 — 사람이 닫을 수 있어야 한다 */
  it('null 로 되돌려 닫을 수 있다', () => {
    const { result } = renderHook(() => useFeedback());
    act(() => result.current.setError('무엇'));
    act(() => result.current.setError(null));
    expect(result.current.error).toBeNull();
  });
});

/**
 * **이 검사가 이 파일의 핵심이다.**
 *
 * 세터를 `useCallback` 없이 그대로 돌려주는 것은 `useState` 세터가 늘 같은 것이기
 * 때문이다. 누군가 그 자리에 화살표 함수를 끼워 넣으면 (예: `setError: (v) => setError(v)`)
 * 코드는 그대로 도는 것처럼 보이지만 **송출 경로의 memo 가 전부 헛돈다.**
 * 눈에 보이지 않는 고장이라 검사로 못 박는다.
 */
describe('세터는 렌더가 바뀌어도 같은 것이다', () => {
  it('상태가 바뀌어도 세터 셋이 그대로다', () => {
    const { result } = renderHook(() => useFeedback());
    const before = {
      setBusy: result.current.setBusy,
      setError: result.current.setError,
      setNotice: result.current.setNotice,
    };

    act(() => result.current.setBusy(true));
    act(() => result.current.setError('바뀌었다'));

    // 값은 바뀌었는데
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBe('바뀌었다');
    // 세터는 그대로여야 한다
    expect(result.current.setBusy).toBe(before.setBusy);
    expect(result.current.setError).toBe(before.setError);
    expect(result.current.setNotice).toBe(before.setNotice);
  });

  it('부모가 다시 그려도 그대로다', () => {
    const { result, rerender } = renderHook(() => useFeedback());
    const setError = result.current.setError;
    rerender();
    rerender();
    expect(result.current.setError).toBe(setError);
  });
});

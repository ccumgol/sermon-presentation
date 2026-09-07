// @vitest-environment jsdom
/**
 * **자동 분할 실측 훅** — 이미 한 번 사고가 난 자리다.
 *
 * `useMeasure` 는 반환 객체를 `useMemo` 로 고정해 둔다. 그것을 풀면 매 렌더마다
 * 새 객체가 나오고, **이걸 의존성으로 쓰는 effect 가 끝없이 다시 돈다** —
 * 예배 순서 탭에서 미리보기 요청이 시작되자마자 취소돼 **오른쪽이 비어 있었다**
 * (2026-08-15, §3.6 에서 고친 버그 셋 중 하나). 협력 보고서 5장이 그 파일에
 * "풀면 무한 재실행된다" 고 경고까지 달아 두었는데, **검사가 없어 규칙이 주석에만
 * 있었다.** 여기서 못을 박는다.
 *
 * ## 함께 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 준비되기 전 요청은 **'넘치지 않음'** 으로 답한다 | 분할이 거칠어질 뿐이고, 출력 페이지의 자동 축소가 받쳐 준다. 던지면 예배 준비가 멈춘다 |
 * | 답이 안 오면 시간 제한 뒤 스스로 답한다 | 영원히 기다리면 화면이 멈춘 것처럼 보인다 |
 * | 측정 틀을 **화면 밖으로 밀어 둔다**(`display:none` 아님) | 숨기면 크기가 0 이 되어 `scrollHeight` 가 의미를 잃는다 |
 * | 떼어낼 때 틀과 리스너를 치운다 | 탭을 옮길 때마다 iframe 이 쌓인다 |
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useMeasure } from '../../src/control/hooks/useMeasure.ts';
import type { SlidePayload } from '../../shared/types.ts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SLIDE: SlidePayload = { kind: 'verse', lines: ['한 줄'] } as unknown as SlidePayload;

/** 화면에 붙은 측정 틀 */
const frame = (): HTMLIFrameElement | null =>
  document.querySelector('iframe[title="자동 분할 측정"]');

describe('★ 반환 객체가 렌더마다 새로 만들어지지 않는다', () => {
  it('아무것도 안 바뀌면 같은 객체다 — 이걸 어기면 effect 가 무한히 다시 돈다', () => {
    const { result, rerender } = renderHook(() => useMeasure());
    const first = result.current;

    rerender();
    rerender();

    expect(result.current).toBe(first);
  });

  it('`measure` 함수도 같은 것이 유지된다', () => {
    const { result, rerender } = renderHook(() => useMeasure());
    const first = result.current.measure;
    rerender();
    expect(result.current.measure).toBe(first);
  });

  it('준비 상태가 바뀔 때만 새 객체가 된다', () => {
    const { result } = renderHook(() => useMeasure());
    const before = result.current;
    expect(before.ready).toBe(false);

    act(() => frame()!.dispatchEvent(new Event('load')));

    expect(result.current.ready).toBe(true);
    expect(result.current).not.toBe(before);
  });
});

describe('측정 틀', () => {
  it('출력 페이지를 measure 층으로 띄운다 — 측정기와 송출기가 갈라지지 않게', () => {
    renderHook(() => useMeasure());
    expect(frame()?.getAttribute('src')).toBe('/output/?layer=measure&measure=1');
  });

  it('★ 숨기지 않고 화면 밖으로 민다 (숨기면 높이가 0 이 되어 측정이 무의미해진다)', () => {
    renderHook(() => useMeasure());
    const style = frame()!.style;
    expect(style.display).not.toBe('none');
    expect(style.position).toBe('fixed');
    expect(Number.parseInt(style.left, 10)).toBeLessThan(-1000);
    // 1920×1080 으로 재야 실제 화면과 같은 결과가 나온다
    expect(style.width).toBe('1920px');
    expect(style.height).toBe('1080px');
  });

  it('보조 기술에는 감춘다 — 사람이 읽을 내용이 아니다', () => {
    renderHook(() => useMeasure());
    expect(frame()?.getAttribute('aria-hidden')).toBe('true');
  });

  it('떼어내면 치운다 — 탭을 옮길 때마다 쌓이면 안 된다', () => {
    const hook = renderHook(() => useMeasure());
    expect(frame()).not.toBeNull();
    hook.unmount();
    expect(frame()).toBeNull();
  });
});

describe('재는 동안 예배 준비가 멈추지 않는다', () => {
  it('★ 준비되기 전에 재려 하면 "넘치지 않음" 으로 답한다 (던지지 않는다)', async () => {
    const { result } = renderHook(() => useMeasure());
    // jsdom 의 iframe 은 contentWindow 가 없다 — 실제로도 뜨기 전에는 없다
    await expect(result.current.measure(SLIDE)).resolves.toEqual({ overflow: false, height: 0 });
  });

  it('★ 답이 오지 않으면 시간 제한 뒤 스스로 답한다', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMeasure());

    // 답하지 않는 창을 끼운다
    const posted: unknown[] = [];
    Object.defineProperty(frame()!, 'contentWindow', {
      value: { postMessage: (msg: unknown) => posted.push(msg) },
      configurable: true,
    });

    const promise = result.current.measure(SLIDE);
    expect(posted).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await expect(promise).resolves.toEqual({ overflow: false, height: 0 });
  });

  it('답이 오면 그 값을 쓴다', async () => {
    const { result } = renderHook(() => useMeasure());

    let sentId: number | undefined;
    Object.defineProperty(frame()!, 'contentWindow', {
      value: {
        postMessage: (msg: { id: number }) => {
          sentId = msg.id;
        },
      },
      configurable: true,
    });

    const promise = result.current.measure(SLIDE);
    expect(sentId).toBeDefined();

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { t: 'measure:result', id: sentId, payload: { overflow: true, height: 1234 } },
        }),
      );
    });

    await expect(promise).resolves.toEqual({ overflow: true, height: 1234 });
  });

  it('엉뚱한 메시지에는 답하지 않는다 (다른 iframe·확장 프로그램이 보낸 것)', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMeasure());
    Object.defineProperty(frame()!, 'contentWindow', {
      value: { postMessage: () => undefined },
      configurable: true,
    });

    const promise = result.current.measure(SLIDE);
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { t: '다른것', id: 1 } }));
      window.dispatchEvent(new MessageEvent('message', { data: 'JSON 아님' }));
      window.dispatchEvent(new MessageEvent('message', { data: { t: 'measure:result', id: 9999 } }));
    });

    // 여전히 기다리다가 시간 제한으로 끝난다
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    await expect(promise).resolves.toEqual({ overflow: false, height: 0 });
  });
});

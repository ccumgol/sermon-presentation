/**
 * 세로 열 너비를 **마우스로 끌어** 정한다 (사용자 요청 2026-09-04).
 *
 * ## 왜 필요한가
 *
 * 열 비율이 CSS 에 박혀 있었다. 그런데 쓰는 화면이 사람마다 다르다 — 방송실의
 * 넓은 모니터에서는 오른쪽 미리보기를 키우고 싶고, 랩탑에서는 목록이 넓어야 한다.
 *
 * ## 값이 없으면 CSS 기본값을 그대로 쓴다
 *
 * 기본 너비를 코드에도 적으면 **두 곳이 어긋난다** (CSS 를 고쳐도 코드가 옛 값을
 * 밀어 넣는다). 그래서 저장된 값이 없으면 아무 것도 얹지 않고, 끌기 시작하는 순간
 * 실제 폭을 재서 거기서 이어 간다.
 *
 * ## localStorage 에 둔다
 *
 * `useTheme` 과 같은 이유다 — 서버 설정이 아니라 **이 PC 의 취향**이다. 같은
 * 순서표를 태블릿에서 열면 그 화면에 맞는 너비여야 한다.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';

import { clampSplit, parseSplit, widthAfterDrag, type SplitBounds, type SplitEdge } from '../../../lib/column-split.ts';

/** 키보드 화살표 한 번에 움직이는 폭 — 눈에 보일 만큼은 되어야 한다 */
const STEP = 16;

function storageKey(name: string): string {
  return `sermon.split.${name}`;
}

function readStored(name: string): number | undefined {
  try {
    return parseSplit(localStorage.getItem(storageKey(name)));
  } catch {
    // 사생활 보호 모드 등에서 막힐 수 있다 — 기본 너비로 둔다
    return undefined;
  }
}

export interface ColumnSplitOptions extends SplitBounds {
  edge: SplitEdge;
  /**
   * 어느 쪽으로 끄는가 — `x` 는 **열 너비**, `y` 는 **칸 높이**. 기본은 `x`.
   *
   * 셈(`lib/column-split.ts`)은 둘이 똑같다 — '한 칸을 키우면 이웃이 줄어든다' 뿐이라
   * 가로세로를 가리지 않는다. 여기서 달라지는 것은 **무엇을 재고 무엇을 듣는가**다:
   * 폭이냐 높이냐, `clientX` 냐 `clientY` 냐, ←→ 냐 ↑↓ 냐.
   */
  axis?: 'x' | 'y';
  /** 화면 낭독기와 도움말에 쓰는 이름 — '오른쪽 열' 처럼 */
  label: string;
}

export interface ColumnSplit {
  /** 격자 요소에 얹는다. 저장된 값이 없으면 빈 객체다 */
  style: CSSProperties;
  /** `<ColumnResizer {...split.resizer} />` */
  resizer: ResizerHandlers;
}

export interface ResizerHandlers {
  label: string;
  width: number | undefined;
  /** 가로 잡이인가 세로 잡이인가 — 잡이가 모양과 낭독 문구를 가른다 */
  axis: 'x' | 'y';
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}

export function useColumnSplit(name: string, options: ColumnSplitOptions): ColumnSplit {
  const [width, setWidth] = useState<number | undefined>(() => readStored(name));
  const { edge, min, minNeighbor, label, axis = 'x' } = options;

  /** 끌기 도중에는 저장하지 않는다 — 놓을 때 한 번만 쓴다 */
  const store = useCallback(
    (next: number | undefined) => {
      try {
        if (next === undefined) localStorage.removeItem(storageKey(name));
        else localStorage.setItem(storageKey(name), String(next));
      } catch {
        // 저장에 실패해도 이번 세션에는 적용된다
      }
    },
    [name],
  );

  /**
   * 잡이가 붙은 칸의 지금 폭을 잰다.
   *
   * 저장된 값이 없어도 끌기를 이어 갈 수 있어야 한다 — 그래서 기본값을 코드에
   * 적는 대신 **화면에서 읽는다.**
   *
   * 이미 정해 둔 값이 있으면 그쪽이 기준이다(`widthRef`). 화면을 다시 재면
   * 화살표를 빠르게 눌렀을 때 **아직 그려지지 않은 옛 폭**을 읽어, 여러 번 눌러도
   * 한 칸만 움직인다.
   */
  const measure = useCallback(
    (handle: HTMLElement): { pane: number; container: number; zoom: number } | undefined => {
      const pane = edge === 'start' ? handle.previousElementSibling : handle.nextElementSibling;
      const container = handle.parentElement;
      if (!(pane instanceof HTMLElement) || !(container instanceof HTMLElement)) return undefined;

      /*
       * **`offsetWidth` 를 쓴다 — `getBoundingClientRect` 가 아니다** (2026-09-16).
       *
       * 글자 크기 배율(`useUiScale` 의 `zoom`)이 걸리면 둘이 갈린다:
       * `offsetWidth` 는 **이 요소가 사는 좌표계의 CSS px**, `getBoundingClientRect` 는
       * 배율이 곱해진 **화면 px** 이다. 우리가 저장하고 되돌려 놓는 값은 CSS px 이므로
       * 여기서 화면 px 을 읽으면 배율 130% 일 때 열이 끌 때마다 1.3배씩 벌어진다.
       *
       * 배율 자체는 두 값의 비로 잰다 — 변수 이름을 알 필요가 없고,
       * 나중에 배율을 다른 방식으로 걸어도 저절로 따라온다.
       */
      const box = container.getBoundingClientRect();
      const cssSize = axis === 'y' ? container.offsetHeight : container.offsetWidth;
      const screenSize = axis === 'y' ? box.height : box.width;
      const zoom = cssSize > 0 && screenSize > 0 ? screenSize / cssSize : 1;

      return axis === 'y'
        ? { pane: pane.offsetHeight, container: container.offsetHeight, zoom }
        : { pane: pane.offsetWidth, container: container.offsetWidth, zoom };
    },
    [axis, edge],
  );

  /** 끌기를 시작한 지점 — 세로 잡이면 `clientY` 가 들어온다 */
  const drag = useRef<{ startPos: number; startWidth: number; container: number; zoom: number } | null>(
    null,
  );

  /**
   * 지금 값. **이벤트 처리기는 이쪽을 본다.**
   *
   * `useState` 값은 다음 그리기에나 반영된다. 화살표를 꾹 눌러 연달아 들어오면
   * 처리기마다 아직 안 바뀐 옛 값을 읽어 **여러 번 눌러도 한 칸만 움직인다.**
   * 그래서 정한 값을 여기에 곧바로 적고, `setWidth` 는 화면을 다시 그리는 용도로만 쓴다.
   */
  const widthRef = useRef<number | undefined>(width);

  const apply = useCallback((next: number | undefined) => {
    widthRef.current = next;
    setWidth(next);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // 왼쪽 단추(또는 손가락)만. 오른쪽 클릭으로 끌기가 걸리면 놓을 길이 없다
      if (event.button !== 0) return;
      const measured = measure(event.currentTarget);
      if (!measured) return;

      drag.current = {
        startPos: axis === 'y' ? event.clientY : event.clientX,
        startWidth: widthRef.current ?? measured.pane,
        container: measured.container,
        zoom: measured.zoom,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [axis, measure],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // 마우스 없이도 되돌릴 수 있어야 한다 — Home 이 기본값이다
      if (event.key === 'Home') {
        apply(undefined);
        store(undefined);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      /*
       * 세로 잡이는 ↑↓ 로 움직인다. 이름을 '키우기/줄이기' 로 두지 않는 이유:
       * **어느 쪽이 커지는지는 `edge` 가 정한다** (아래 칸을 조절하면 위로 끌 때 커진다).
       * 여기서는 '잡이를 어느 방향으로 옮겼나' 만 말하고, 셈은 `widthAfterDrag` 에 맡긴다.
       */
      const plus = axis === 'y' ? 'ArrowDown' : 'ArrowRight';
      const minus = axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
      if (event.key !== plus && event.key !== minus) return;

      const measured = measure(event.currentTarget);
      if (!measured) return;
      const dx = event.key === plus ? STEP : -STEP;
      const base = widthRef.current ?? measured.pane;
      const next = clampSplit(widthAfterDrag(base, dx, edge), measured.container, { min, minNeighbor });
      apply(next);
      store(next);
      event.preventDefault();
      /*
       * **더 위로 올리지 않는다** (2026-09-12 실측으로 발견).
       *
       * 예배 순서 탭은 ↑↓ 로 **줄을 옮긴다.** 잡이에 focus 를 둔 채 ↑ 를 누르면
       * 높이도 바뀌고 **고른 항목까지 바뀌었다** — 무엇을 건드렸는지 알 수 없게 된다.
       * 가로 잡이는 ←→ 라 부딪히지 않아 여태 드러나지 않았다.
       */
      event.stopPropagation();
    },
    [apply, axis, edge, measure, min, minNeighbor, store],
  );

  /** 더블클릭으로 기본 너비로 되돌린다 — 잘못 끌었을 때 찾아 헤매지 않게 */
  const onDoubleClick = useCallback(() => {
    apply(undefined);
    store(undefined);
  }, [apply, store]);

  /**
   * 움직임과 놓기는 **창(window)** 에서 듣는다.
   *
   * 잡이 위에서만 들으면 마우스가 잡이를 앞질렀을 때 끌기가 끊긴다.
   * 포인터 캡처를 걸어 두었으므로 이벤트는 계속 오지만, 캡처가 풀리는 경우
   * (다른 창으로 전환 등)까지 생각하면 창에서 듣는 편이 안전하다.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const onMove = (event: globalThis.PointerEvent): void => {
      const state = drag.current;
      if (!state) return;
      const now = axis === 'y' ? event.clientY : event.clientX;
      /*
       * 포인터 좌표는 **화면 px** 이고 우리가 다루는 폭은 **CSS px** 이다.
       * 배율이 걸리면 마우스를 100px 움직였을 때 열은 100/1.3 만큼만 움직여야
       * 잡이가 손끝을 따라온다 (안 나누면 열이 앞서 달아난다).
       */
      const moved = (now - state.startPos) / state.zoom;
      const raw = widthAfterDrag(state.startWidth, moved, edge);
      apply(clampSplit(raw, state.container, { min, minNeighbor }));
    };
    const onUp = (): void => {
      if (!drag.current) return;
      drag.current = null;
      // 놓을 때 한 번만 저장한다 — 끌 때마다 쓰면 localStorage 를 수백 번 두드린다
      store(widthRef.current);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [apply, axis, edge, min, minNeighbor, store]);

  return {
    /**
     * 변수 이름에 **열쇠를 넣는다** (`--split-side` · `--split-song`).
     *
     * CSS 변수는 자식에게 물려 내려간다. 이름이 하나뿐이면 바깥 껍데기가 정한
     * 오른쪽 열 너비가 탭 **안쪽** 격자까지 흘러가, 아무도 끌지 않은 열이
     * 제멋대로 넓어진다.
     */
    style: width === undefined ? {} : ({ [`--split-${name}`]: `${width}px` } as CSSProperties),
    resizer: { label, width, axis, onPointerDown, onKeyDown, onDoubleClick },
  };
}

/**
 * 자동 분할용 실측 훅.
 *
 * 실제 출력 페이지를 1920×1080 크기의 숨긴 iframe 으로 띄워 재고, 그 결과로 나눈다.
 * 별도 측정용 렌더러를 만들지 않는 이유는 미리보기와 같다 — 측정기와 송출기가
 * 갈라지면 "재 봤을 때는 맞았는데 화면에선 넘친다"가 생긴다.
 *
 * `display:none` 이 아니라 화면 밖으로 밀어 둔다. 숨기면 레이아웃 크기가 0 이 되어
 * scrollHeight 가 의미를 잃는다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SlidePayload, Template } from '../../../shared/types.ts';

const CANVAS = { width: 1920, height: 1080 };
const MEASURE_TIMEOUT_MS = 2000;

export interface MeasureResult {
  overflow: boolean;
  height: number;
}

export interface Measurer {
  ready: boolean;
  measure: (slide: SlidePayload, template?: Template) => Promise<MeasureResult>;
}

export function useMeasure(): Measurer {
  const [ready, setReady] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const seqRef = useRef(0);
  const pendingRef = useRef(new Map<number, (result: MeasureResult | null) => void>());

  useEffect(() => {
    const frame = document.createElement('iframe');
    frame.src = '/output/?layer=measure&measure=1';
    frame.title = '자동 분할 측정';
    frame.setAttribute('aria-hidden', 'true');
    Object.assign(frame.style, {
      position: 'fixed',
      left: '-99999px',
      top: '0',
      width: `${CANVAS.width}px`,
      height: `${CANVAS.height}px`,
      border: '0',
      pointerEvents: 'none',
    });

    frame.addEventListener('load', () => setReady(true));
    document.body.appendChild(frame);
    frameRef.current = frame;

    function onMessage(event: MessageEvent): void {
      const msg = event.data as { t?: string; id?: number; payload?: MeasureResult | null };
      if (msg?.t !== 'measure:result' || typeof msg.id !== 'number') return;
      const resolve = pendingRef.current.get(msg.id);
      if (!resolve) return;
      pendingRef.current.delete(msg.id);
      resolve(msg.payload ?? null);
    }

    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener('message', onMessage);
      frame.remove();
      frameRef.current = null;
      pendingRef.current.clear();
    };
  }, []);

  const measure = useCallback(
    (slide: SlidePayload, template?: Template): Promise<MeasureResult> => {
      const frame = frameRef.current;
      const target = frame?.contentWindow;

      // 측정기가 아직 준비되지 않았으면 '넘치지 않음'으로 답한다 —
      // 분할이 거칠어질 뿐이고, 출력 페이지의 자동 축소가 뒤를 받쳐 준다.
      if (!target) return Promise.resolve({ overflow: false, height: 0 });

      const id = ++seqRef.current;
      return new Promise<MeasureResult>((resolve) => {
        const timer = setTimeout(() => {
          pendingRef.current.delete(id);
          resolve({ overflow: false, height: 0 });
        }, MEASURE_TIMEOUT_MS);

        pendingRef.current.set(id, (result) => {
          clearTimeout(timer);
          resolve(result ?? { overflow: false, height: 0 });
        });

        target.postMessage({ t: 'measure', id, payload: slide, template }, '*');
      });
    },
    [],
  );

  return { ready, measure };
}

import { useEffect, useRef, useState } from 'react';

import type { Deck, LiveState } from '../../../shared/types.ts';

const CANVAS_WIDTH = 1920;

interface Props {
  state: LiveState | null;
  deck: Deck | null;
}

/**
 * 실제 출력 페이지를 iframe 으로 띄운 미리보기.
 *
 * 별도 렌더러를 만들지 않는다 — 미리보기와 송출 화면이 갈라지면
 * "미리보기에선 괜찮았는데 화면에선 다르다"가 생긴다.
 * `layer=preview` 로 접속하므로 '출력 연결됨' 집계에는 잡히지 않는다.
 */
export function LivePreview({ state, deck }: Props): React.JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.2);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setScale(width / CANVAS_WIDTH);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const index = deck?.index ?? 0;
  const total = deck?.slides.length ?? 0;
  const nextLabel = total > 0 && index < total - 1 ? deck?.labels[index + 1] : null;

  return (
    <>
      <div className="card">
        <h2>라이브 미리보기</h2>
        <div className="preview-frame" ref={boxRef}>
          <iframe
            src="/output/?layer=preview&preview=1"
            title="출력 미리보기"
            style={{ transform: `scale(${scale})` }}
          />
        </div>

        <div className="next-hint">
          {state?.blank && <div style={{ color: 'var(--live)' }}>■ 블랙 — 화면에 아무것도 나오지 않습니다</div>}
          {nextLabel ? (
            <>
              다음 ▸ <b>{nextLabel}</b>
            </>
          ) : total > 0 ? (
            '마지막 슬라이드입니다'
          ) : (
            '송출 중인 내용이 없습니다'
          )}
        </div>
      </div>
    </>
  );
}

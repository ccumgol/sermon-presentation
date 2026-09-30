import { useEffect, useRef, useState } from 'react';

import type { ClientMsg, Deck, LiveState } from '../../../shared/types.ts';
import type { VideoStatus } from '../hooks/useLiveState.ts';

const CANVAS_WIDTH = 1920;

interface Props {
  state: LiveState | null;
  deck: Deck | null;
  /** OBS 화면의 동영상 상태 — 없으면 줄이 안 나온다 */
  video?: VideoStatus | null;
  send?: (msg: ClientMsg) => boolean;
  connected?: boolean;
}

/** 초를 `1:23` 으로. 길이를 모르면 시간만 */
function clock(seconds: number | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '--:--';
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * 실제 출력 페이지를 iframe 으로 띄운 미리보기.
 *
 * 별도 렌더러를 만들지 않는다 — 미리보기와 송출 화면이 갈라지면
 * "미리보기에선 괜찮았는데 화면에선 다르다"가 생긴다.
 * `layer=preview` 로 접속하므로 '출력 연결됨' 집계에는 잡히지 않는다.
 */
export function LivePreview({ state, deck, video, send, connected }: Props): React.JSX.Element {
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
      <div className="card preview-card">
        <h2>라이브 미리보기</h2>
        <div className="preview-frame" ref={boxRef}>
          <iframe
            src="/output/?layer=preview&preview=1"
            title="출력 미리보기"
            style={{ transform: `scale(${scale})` }}
          />
        </div>

        {/*
          동영상 상태 (2026-09-29). **소리가 실제로 OBS 로 나가는지**를 보여 주는 것이
          이 줄의 요점이다 — 화면만 봐서는 알 수 없고, 예배 전에 확인할 길이 여기뿐이다.
        */}
        {/*
          어떤 거부인지 **가려서** 쓴다 (2026-09-29 실측에서 걸렸다).

          크롬은 창이 가려지면 소리 없는 영상을 스스로 멈춘다(전력 절약) — 조작 화면의
          작은 미리보기에서 늘 일어난다. 그것까지 '자동 재생이 막혔습니다' 로 띄우면
          **멀쩡한데 고장 난 줄 알고**, 게다가 재생 단추까지 사라졌다.

          사람이 손볼 데가 있는 것은 `NotAllowedError`(자동 재생 정책) 하나뿐이다.
        */}
        {video && video.event !== 'ended' && (() => {
          const policyBlocked = video.event === 'blocked' && video.reason === 'NotAllowedError';
          const failed = policyBlocked || video.event === 'error';
          return (
          <div className={`video-line${failed ? ' bad' : ''}`}>
            {/*
              재생 조작 (2026-09-29 사용자 요청). **미리보기 바로 아래**에 둔다 —
              영상을 틀 때 사람이 이미 이 자리를 보고 있다.

              '멈춤' 은 처음으로 되감으므로 **빨간 글씨**로 둔다. 예배 중에
              '일시정지' 를 누르려다 이것을 누르면 회중 화면이 처음으로 돌아간다.
            */}
            {send && !failed && (
              <span className="video-buttons">
                <button
                  type="button"
                  onClick={() => send({ t: 'video:control', action: video.paused ? 'play' : 'pause' })}
                  disabled={connected === false}
                  title={video.paused ? '이어서 재생합니다' : '그 자리에 세웁니다'}
                >
                  {video.paused ? '▶ 재생' : '⏸ 일시정지'}
                </button>
                <button
                  type="button"
                  className="stop"
                  onClick={() => send({ t: 'video:control', action: 'stop' })}
                  disabled={connected === false}
                  title="세우고 처음으로 되감습니다"
                >
                  ⏹ 멈춤
                </button>
              </span>
            )}
            {policyBlocked ? (
              <>🚫 자동 재생이 막혔습니다 — OBS 브라우저 소스 속성에서 「OBS 를 통해 오디오 제어」를 켜 보세요</>
            ) : video.event === 'error' ? (
              <>🚫 동영상을 열지 못했습니다 — 파일 형식을 확인하세요 (MP4 가 안전합니다)</>
            ) : (
              <>
                🎬 {clock(video.at)} / {clock(video.duration)}
                {' · '}
                {video.muted ? (
                  <b style={{ color: 'var(--warn)' }}>소리 없음</b>
                ) : (
                  <b style={{ color: 'var(--ok)' }}>소리 OBS 로 나감</b>
                )}
              </>
            )}
          </div>
          );
        })()}

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

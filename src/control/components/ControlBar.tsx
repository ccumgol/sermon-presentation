import type { Deck, LiveState } from '../../../shared/types.ts';

interface Props {
  state: LiveState | null;
  deck: Deck | null;
  connected: boolean;
  onPrev: () => void;
  onNext: () => void;
  onBlank: () => void;
  onRestore: () => void;
  onClear: () => void;
}

/**
 * 예배 중 실제로 쓰는 버튼들.
 *
 * **오른쪽 열 아래에 둔다** (2026-08-18 사용자 요청으로 옮겼다).
 * 전에는 화면 전체 폭에 84px 짜리 바로 깔려 있었는데, 오른쪽 열 아래가 비어 있는데도
 * 왼쪽 순서 목록의 높이를 84px 빼앗고 있었다. 랩탑(높이 900px)에서 목록이 특히 좁았다.
 *
 * 좁은 화면(<900px)에서는 오른쪽 열이 사라지므로 **아래쪽 띠로 돌아간다** —
 * 이 버튼들이 없어지면 예배 중 손을 쓸 수 없다 (CSS 의 `@media` 참고).
 *
 * 연결이 끊기면 전부 잠근다 — 눌렀는데 반영되지 않은 것을 모르는 상황이 더 위험하다.
 */
export function ControlBar({
  state,
  deck,
  connected,
  onPrev,
  onNext,
  onBlank,
  onRestore,
  onClear,
}: Props): React.JSX.Element {
  const index = deck?.index ?? 0;
  const total = deck?.slides.length ?? 0;
  const blanked = state?.blank ?? false;

  return (
    <div className="transport">
      <div className="transport-row transport-nav">
        <button type="button" className="nav" onClick={onPrev} disabled={!connected || index <= 0}>
          ◀ 이전
        </button>
        <button
          type="button"
          className="nav primary"
          onClick={onNext}
          disabled={!connected || total === 0 || index >= total - 1}
        >
          다음 ▶
        </button>
      </div>

      <div className="transport-row transport-meta">
        <span className="counter">{total > 0 ? `${index + 1} / ${total}` : '—'}</span>
        {blanked && <span className="blank-tag">■ 블랙</span>}
      </div>

      <div className="transport-row">
        <button
          type="button"
          className={`danger${blanked ? ' active' : ''}`}
          onClick={onBlank}
          disabled={!connected}
          title="텍스트만 숨깁니다. 상태는 유지되므로 즉시 되돌릴 수 있습니다."
        >
          {blanked ? '블랙 해제' : '블랙'}
        </button>
        <button type="button" onClick={onRestore} disabled={!connected} title="마지막 화면으로 되돌립니다">
          복구
        </button>
        <button type="button" onClick={onClear} disabled={!connected} title="화면을 비웁니다">
          비우기
        </button>
      </div>

      <p className="transport-keys">← → 이동 · Space 다음 · B 블랙 · Esc 복구</p>
    </div>
  );
}

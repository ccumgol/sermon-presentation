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
 * 예배 중 실제로 쓰는 버튼들. 항상 같은 자리에 크게 둔다 (계획서 §6.1).
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
    <div className="controlbar">
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

      <span className="hint">
        {total > 0 ? `${index + 1} / ${total}` : '—'}
      </span>

      <span className="spacer" />

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

      <span className="hint">← → 이동 · Space 다음 · B 블랙 · Esc 복구</span>
    </div>
  );
}

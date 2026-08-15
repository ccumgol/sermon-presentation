import type { Anchor } from '../../../shared/types.ts';

const ANCHORS: readonly Anchor[] = [
  'top-left', 'top-center', 'top-right',
  'mid-left', 'center', 'mid-right',
  'bottom-left', 'bottom-center', 'bottom-right',
];

const LABELS: Record<Anchor, string> = {
  'top-left': '좌상', 'top-center': '상단', 'top-right': '우상',
  'mid-left': '좌측', center: '중앙', 'mid-right': '우측',
  'bottom-left': '좌하', 'bottom-center': '하단', 'bottom-right': '우하',
};

interface Props {
  value: Anchor;
  onChange: (anchor: Anchor) => void;
}

/** 9분할 앵커 그리드 — 클릭으로 위치를 즉시 지정한다 (계획서 §5.5) */
export function AnchorGrid({ value, onChange }: Props): React.JSX.Element {
  return (
    <div className="anchor-grid" role="group" aria-label="위치">
      {ANCHORS.map((anchor) => (
        <button
          key={anchor}
          type="button"
          className={`anchor-cell${anchor === value ? ' active' : ''}`}
          onClick={() => onChange(anchor)}
          aria-pressed={anchor === value}
          title={LABELS[anchor]}
        >
          {LABELS[anchor]}
        </button>
      ))}
    </div>
  );
}

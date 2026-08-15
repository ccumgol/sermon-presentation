import type { Deck, SlidePayload } from '../../../shared/types.ts';

interface Props {
  deck: Deck | null;
  currentIndex: number;
  onSelect: (index: number) => void;
  disabled: boolean;
}

/** 슬라이드 한 장의 내용을 짧게 보여준다 — 오퍼레이터가 눈으로 확인할 수 있게 */
function SlidePreviewText({ slide }: { slide: SlidePayload }): React.JSX.Element | null {
  if (slide.kind !== 'bible') return null;

  const blocks = slide.blocks.filter((b) => b.verses.length > 0);
  if (blocks.length === 0) return <span className="secondary">(본문 없음)</span>;

  return (
    <>
      {blocks.map((block, index) => (
        <div key={block.translationId} className={index === 0 ? undefined : 'secondary'} dir={block.direction}>
          {block.verses.map((verse) => (
            <span key={`${verse.chapter}:${verse.verse}`}>
              <span className="vnum">{verse.verse}</span>
              {verse.text}{' '}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}

export function SlideList({ deck, currentIndex, onSelect, disabled }: Props): React.JSX.Element {
  if (!deck || deck.slides.length === 0) {
    return <p className="hintline muted">본문을 조회하면 슬라이드가 여기 나옵니다.</p>;
  }

  return (
    <div className="slides">
      {deck.slides.map((slide, index) => (
        <button
          key={index}
          type="button"
          className={`slide-item${index === currentIndex ? ' current' : ''}`}
          onClick={() => onSelect(index)}
          disabled={disabled}
          aria-current={index === currentIndex}
        >
          <span className="label">
            {index === currentIndex ? '▶ ' : ''}
            {deck.labels[index] || index + 1}
          </span>
          <span className="text">
            <SlidePreviewText slide={slide} />
          </span>
        </button>
      ))}
    </div>
  );
}

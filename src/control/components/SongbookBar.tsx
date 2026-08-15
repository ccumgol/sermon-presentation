import type { Songbook } from '../../../shared/types.ts';

const QUICK_SLOTS = [1, 2, 3, 4] as const;

interface Props {
  songbooks: Songbook[];
  /** 선택된 곡집. null = 통합 검색 */
  selected: string | null;
  onSelect: (songbookId: string | null) => void;
  onManage: () => void;
}

/**
 * 곡집 바 — 바로가기 버튼 4개 + 드롭다운.
 *
 * 예배 중 곡집을 바꾸는 동작은 손이 가장 빨라야 하므로,
 * 자주 쓰는 4개는 대표 한 글자 버튼으로 즉시 누를 수 있게 둔다.
 * 나머지는 드롭다운에서 고른다.
 */
export function SongbookBar({ songbooks, selected, onSelect, onManage }: Props): React.JSX.Element {
  const quick = QUICK_SLOTS.map((slot) => songbooks.find((book) => book.quickSlot === slot));
  const inQuick = new Set(quick.filter(Boolean).map((book) => book!.id));
  const rest = songbooks.filter((book) => !inQuick.has(book.id));

  return (
    <div className="songbook-bar">
      <button
        type="button"
        className={`book-quick all${selected === null ? ' active' : ''}`}
        onClick={() => onSelect(null)}
        title="전체에서 통합 검색"
      >
        전체
      </button>

      {quick.map((book, index) =>
        book ? (
          <button
            key={book.id}
            type="button"
            className={`book-quick${selected === book.id ? ' active' : ''}`}
            onClick={() => onSelect(book.id)}
            title={`${book.name} (${book.songCount}곡)`}
          >
            {book.shortLabel}
          </button>
        ) : (
          <button
            key={`empty-${QUICK_SLOTS[index]}`}
            type="button"
            className="book-quick empty"
            onClick={onManage}
            title={`바로가기 ${QUICK_SLOTS[index]}번이 비어 있습니다 — 곡집 관리에서 지정하세요`}
          >
            +
          </button>
        ),
      )}

      <select
        className="book-select"
        value={selected && !inQuick.has(selected) ? selected : ''}
        onChange={(e) => onSelect(e.target.value === '' ? null : e.target.value)}
        aria-label="곡집 선택"
      >
        <option value="">다른 곡집…</option>
        {rest.map((book) => (
          <option key={book.id} value={book.id}>
            {book.name} ({book.songCount})
          </option>
        ))}
      </select>

      <button type="button" className="book-manage" onClick={onManage} title="곡집 가져오기·생성·관리">
        곡집 관리
      </button>
    </div>
  );
}

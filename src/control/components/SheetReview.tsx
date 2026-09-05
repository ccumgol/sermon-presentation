/**
 * **악보 단 경계 검토** — 자동으로 잡은 단이 맞는지 사람이 눈으로 확인한다 (D-6 ⑥).
 *
 * ## 왜 필요한가
 *
 * 오선을 다섯 줄 찾지 못한 장이 **155장**(2,061장의 7.5%) 있다. 이 표시는
 * '틀렸다' 가 아니라 **'봐야 한다'** 는 뜻이다 — 마지막 단의 한 줄이 흐리거나
 * 가사 밑줄이 한 줄 더 잡힌 경우가 대부분이라, 실제로는 멀쩡한 장이 많다.
 *
 * 그래서 이 화면이 할 일은 고치는 것보다 **빠르게 넘기는 것**이다. 사람은
 * '괜찮다' 를 연달아 누르다가, 정말 이상한 것만 골라 표시한다.
 *
 * ## 그림 위에 경계를 겹쳐 그린다 — 이게 핵심이다
 *
 * 숫자만 보여 주면(‘6번째 단이 4줄’) 맞는지 알 수 없다. 잘린 자리를 그림 위에
 * 얹어야 눈이 한 번에 판단한다. 이상한 단은 다르게 칠해 어디를 볼지 알려 준다.
 *
 * ## 손버릇을 가사 검토와 맞춘다
 *
 * `Enter` 괜찮다 + 다음 · `↑↓` 이동. 두 검토가 다른 손놀림을 요구하면 155장을
 * 훑는 동안 계속 헷갈린다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { SheetReviewState, SheetSystem } from '../../../shared/types.ts';
import { api, ApiError, type SheetReviewItem, type SheetReviewList } from '../api.ts';
import { ColumnResizer } from './ColumnResizer.tsx';
import { useColumnSplit } from '../hooks/useColumnSplit.ts';

/** 오선은 다섯 줄이다. 여기서 벗어난 단이 사람이 볼 곳이다 */
const STAFF_LINES = 5;

function isOdd(system: SheetSystem): boolean {
  return system.lineCount !== STAFF_LINES;
}

/** '6단 중 6번째가 4줄' — 목록에서 무엇이 이상한지 한 줄로 */
function describeOdd(systems: readonly SheetSystem[]): string {
  const odd = systems
    .map((system, index) => ({ system, index }))
    .filter(({ system }) => isOdd(system));
  if (odd.length === 0) return `${systems.length}단 · 이상 없음`;
  const parts = odd.map(({ system, index }) => `${index + 1}번째 ${system.lineCount}줄`);
  return `${systems.length}단 · ${parts.join(' · ')}`;
}

const STATE_LABEL: Record<SheetReviewState, string> = { ok: '괜찮음', bad: '다시 봐야 함' };

export function SheetReview(): React.JSX.Element {
  const [list, setList] = useState<SheetReviewList | null>(null);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const split = useColumnSplit('sheet-review', {
    edge: 'start',
    min: 240,
    minNeighbor: 320,
    label: '악보 목록',
  });

  const load = useCallback(async () => {
    try {
      setList(await api.sheetsToReview());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '악보 목록을 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const items = list?.items ?? [];
  const current: SheetReviewItem | undefined = items[cursor];

  /**
   * 판정을 보내고 **목록의 그 줄만 고친다.**
   *
   * 통째로 다시 받아 오면 순서가 바뀌어(본 것은 뒤로 간다) 방금 누른 줄이
   * 눈앞에서 사라지고 커서가 엉뚱한 곡을 가리킨다.
   */
  const judge = useCallback(
    async (state: SheetReviewState | null, advance: boolean) => {
      if (!current || busy) return;
      setBusy(true);
      setError(null);
      try {
        await api.setSheetReview(current.songbookId, current.number, state);
        // 답한 장이 하나 늘거나(처음 답할 때) 줄어든다(취소할 때). 그대로 두면
        // 155장을 훑는 내내 진행 막대가 0 에 머물러 일이 쌓이는 것이 안 보인다
        const delta = (state ? 1 : 0) - (current.reviewState ? 1 : 0);
        setList((prev) =>
          prev === null
            ? prev
            : {
                counts: { ...prev.counts, reviewed: prev.counts.reviewed + delta },
                items: prev.items.map((item, index) =>
                  index === cursor
                    ? { ...item, ...(state ? { reviewState: state } : { reviewState: undefined }) }
                    : item,
                ),
              },
        );
        if (advance) setCursor((index) => Math.min(index + 1, items.length - 1));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '판정을 저장하지 못했습니다');
      } finally {
        setBusy(false);
      }
    },
    [busy, cursor, current, items.length],
  );

  // 목록에서 커서가 화면 밖으로 나가지 않게 따라 스크롤한다
  useEffect(() => {
    listRef.current?.querySelector('.review-row.current')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // 글자를 치는 중에는 가로채지 않는다
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.key === 'ArrowDown') {
        setCursor((index) => Math.min(index + 1, items.length - 1));
        event.preventDefault();
      } else if (event.key === 'ArrowUp') {
        setCursor((index) => Math.max(index - 1, 0));
        event.preventDefault();
      } else if (event.key === 'Enter') {
        void judge('ok', true);
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, judge]);

  const counts = list?.counts;
  const remaining = counts ? counts.needsReview - counts.reviewed : 0;
  const percent = counts && counts.needsReview > 0
    ? Math.round((counts.reviewed / counts.needsReview) * 100)
    : 0;

  return (
    <>
      {error && (
        <div className="banner error">
          <button type="button" className="close" onClick={() => setError(null)}>닫기</button>
          {error}
        </div>
      )}

      <div className="card review-header">
        <h2>악보 단 경계 검토</h2>
        <p className="hintline muted">
          오선을 다섯 줄 찾지 못한 장입니다. <b>대부분은 멀쩡합니다</b> — 마지막 단의 한 줄이
          흐리거나 가사 밑줄이 한 줄 더 잡힌 경우입니다. 그림 위의 <b>파란 칸</b>이 잘리는
          자리이니, 가사가 잘려 나가지 않으면 <b>괜찮음</b>입니다.
        </p>
        <p className="hintline muted">
          <b>Enter</b> 괜찮음 + 다음 · <b>↑↓</b> 이동
        </p>

        {counts && (
          <div className="progress-line">
            <div className="progress-bar"><div className="fill" style={{ width: `${percent}%` }} /></div>
            <span className="progress-text">
              확인 {counts.reviewed}장 · 남음 {remaining}장 · 봐야 할 장 {counts.needsReview}장
              (전체 악보 {counts.total}장의 {Math.round((counts.needsReview / Math.max(1, counts.total)) * 100)}%)
            </span>
          </div>
        )}
      </div>

      <div className="review-split" style={split.style}>
        <div className="card review-list" ref={listRef}>
          <h2>목록 ({items.length}장)</h2>
          {list !== null && items.length === 0 && (
            <p className="hintline ok">볼 것이 없습니다 — 모든 악보가 제대로 잡혔습니다.</p>
          )}

          {items.map((item, index) => (
            <button
              key={`${item.songbookId}:${item.number}`}
              type="button"
              className={`review-row${index === cursor ? ' current' : ''}${item.reviewState ? ' done' : ''}`}
              onClick={() => setCursor(index)}
            >
              <span className="num">{item.number}</span>
              <span className="body">
                <span className="title">{item.titles.join(' · ') || '(제목 없음)'}</span>
                <span className="meta">
                  {describeOdd(item.systems)}
                  {item.reviewState && (
                    <span className={`warn-chip${item.reviewState === 'ok' ? ' ok' : ''}`}>
                      {STATE_LABEL[item.reviewState]}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>

        <ColumnResizer {...split.resizer} />

        <div className="card review-detail sheet-detail">
          {!current && <p className="hintline muted">왼쪽에서 악보를 고르세요.</p>}

          {current && (
            <>
              <h2>
                {current.number}번 {current.titles.join(' · ')}
              </h2>

              <div className="row">
                <button type="button" className="primary" disabled={busy} onClick={() => void judge('ok', true)}>
                  괜찮음 (Enter)
                </button>
                <button type="button" disabled={busy} onClick={() => void judge('bad', true)}>
                  다시 봐야 함
                </button>
                {current.reviewState && (
                  <button type="button" disabled={busy} onClick={() => void judge(null, false)}>
                    판정 취소
                  </button>
                )}
              </div>

              <SheetImage item={current} />
            </>
          )}
        </div>
      </div>
    </>
  );
}

/**
 * 악보 그림 + 잡힌 단 경계.
 *
 * 경계를 **퍼센트로** 얹는다 — 그림이 화면 폭에 맞춰 줄어들어도 자리가 따라간다.
 * 픽셀로 두면 창 크기마다 어긋나고, 그 어긋남을 검출 오류로 오해하게 된다.
 */
function SheetImage({ item }: { item: SheetReviewItem }): React.JSX.Element {
  return (
    <div className="sheet-canvas">
      <img src={item.src} alt={`${item.number}번 악보`} />
      {item.systems.map((system, index) => (
        <div
          key={`${system.from}-${system.to}`}
          className={`sheet-band${isOdd(system) ? ' odd' : ''}`}
          style={{
            top: `${(system.from / item.height) * 100}%`,
            height: `${((system.to - system.from + 1) / item.height) * 100}%`,
          }}
        >
          <span className="tag">
            {index + 1}
            {isOdd(system) && ` · ${system.lineCount}줄`}
          </span>
        </div>
      ))}
    </div>
  );
}

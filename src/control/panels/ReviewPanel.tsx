/**
 * 줄나눔 검토 화면.
 *
 * 자동 정렬은 **제안**이다. 1,202곡을 사람이 한 번 훑고 승인해야 확정된다.
 * 승인한 곡은 `lines_source = manual` 이 되어 이후 어떤 자동 작업도 건드리지
 * 않으므로, 여기서 승인한 것은 영구히 보존된다.
 *
 * 설계 기준은 **손이 멈추지 않는 것**이다. 1,000곡 넘게 봐야 하므로 마우스로
 * 오가면 끝나지 않는다. Enter 로 승인하고 자동으로 다음 곡으로 넘어간다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { formatLyrics } from '../../../lib/lyrics-parser.ts';
import type { ClientMsg, ReviewItem, Song, Songbook, Template } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { ColumnResizer } from '../components/ColumnResizer.tsx';
import { SheetReview } from '../components/SheetReview.tsx';
import { useColumnSplit } from '../hooks/useColumnSplit.ts';

interface Props {
  connected: boolean;
  template: Template | null;
  send: (msg: ClientMsg) => boolean;
}

const SORTS: ReadonlyArray<{ value: 'number' | 'usage' | 'attention'; label: string; hint: string }> = [
  { value: 'number', label: '곡집·번호 순', hint: '전체를 빠짐없이 훑을 때' },
  { value: 'usage', label: '자주 쓴 곡 순', hint: '시간이 없을 때 — 실제 쓰는 곡부터' },
  {
    value: 'attention',
    label: '손봐야 할 곡 순',
    hint: '절이 하나뿐이라 자동 정렬을 못 한 곡, 홀수 행이 남은 곡부터',
  },
];

const PAGE_SIZE = 100;

export function ReviewPanel({ connected, template, send }: Props): React.JSX.Element {
  const [sort, setSort] = useState<'number' | 'usage' | 'attention'>('attention');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [book, setBook] = useState('');
  const [songbooks, setSongbooks] = useState<Songbook[]>([]);

  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [confirmedCount, setConfirmedCount] = useState(0);
  const [offset, setOffset] = useState(0);

  const [cursor, setCursor] = useState(0);
  const [song, setSong] = useState<Song | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 여기서 바로 고친다 — 찬양 탭으로 옮겨 다니면 1,200곡을 볼 수 없다
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  /**
   * 이 draft 가 **어느 곡의 것인지**.
   *
   * 곡 읽기는 비동기다. 커서를 빠르게 옮기면 `current` 가 먼저 바뀌고 draft 는
   * 아직 이전 곡의 가사인 순간이 생긴다. 그때 저장하면 **다른 곡의 가사를
   * 덮어쓴다.** id 를 함께 들고 다니며 일치할 때만 저장한다.
   */
  const [draftFor, setDraftFor] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);

  /** 무엇을 검토하는가 — 가사 줄나눔이 기본이다 (곡 4,529개 대 악보 155장) */
  const [mode, setMode] = useState<ReviewMode>('lyrics');

  /** 왼쪽 목록 열 너비 — 제목이 긴 곡집을 볼 때와 가사를 볼 때가 다르다 */
  const split = useColumnSplit('review', { edge: 'start', min: 240, minNeighbor: 320, label: '검토 목록' });

  useEffect(() => {
    void api.songbooks().then(setSongbooks).catch(() => setSongbooks([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const queue = await api.reviewQueue({ sort, pendingOnly, book: book || undefined, offset, limit: PAGE_SIZE });
      setItems(queue.items);
      setTotal(queue.total);
      setConfirmedCount(queue.confirmed);
      setCursor(0);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '목록을 불러오지 못했습니다');
    }
  }, [sort, pendingOnly, book, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  // 현재 커서의 곡을 읽는다
  const current = items[cursor];
  useEffect(() => {
    if (!current) {
      setSong(null);
      return;
    }
    let cancelled = false;
    void api
      .song(current.id)
      .then((result) => {
        if (cancelled) return;
        setSong(result.song);
        setDraft(formatLyrics(result.song.sections));
        setDraftFor(result.song.id);
      })
      .catch(() => {
        if (!cancelled) setSong(null);
      });
    return () => {
      cancelled = true;
    };
  }, [current?.id]);

  // 곡을 옮기면 편집창을 닫는다 — 열린 채로 넘어가면 다른 곡에 저장할 위험이 있다.
  //
  // 안내(notice)는 여기서 지우지 않는다. 저장하면 곧바로 다음 곡으로 넘어가므로,
  // 곡이 바뀔 때 지우면 '저장했습니다'가 뜨자마자 사라진다.
  useEffect(() => {
    setEditing(false);
  }, [current?.id]);

  const move = useCallback(
    (delta: number) => {
      setCursor((prev) => Math.min(Math.max(0, prev + delta), Math.max(0, items.length - 1)));
    },
    [items.length],
  );

  /** 승인하고 다음 곡으로 — 검토의 기본 동작이다 */
  const approve = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await api.confirmSong(current.id);
      setConfirmedCount((prev) => prev + 1);

      // 미확인만 보고 있으면 목록에서 빼고 커서를 제자리에 둔다 (다음 곡이 올라온다)
      if (pendingOnly) {
        setItems((prev) => prev.filter((item) => item.id !== current.id));
        setTotal((prev) => Math.max(0, prev - 1));
        setCursor((prev) => Math.min(prev, Math.max(0, items.length - 2)));
      } else {
        setItems((prev) => prev.map((item) => (item.id === current.id ? { ...item, confirmed: true } : item)));
        move(1);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '승인하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }, [current, busy, pendingOnly, items.length, move]);

  const unapprove = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await api.unconfirmSong(current.id);
      setItems((prev) => prev.map((item) => (item.id === current.id ? { ...item, confirmed: false } : item)));
      setConfirmedCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '되돌리지 못했습니다');
    } finally {
      setBusy(false);
    }
  }, [current, busy]);

  /**
   * 고친 가사를 저장한다.
   *
   * 저장 경로(`replaceSections`)의 기본값이 `manual` 이므로 저장 자체가 확인이
   * 된다 — 사람이 직접 고친 것보다 확실한 확인은 없다. 그래서 저장 후 목록에서
   * 뺀다(미확인만 보고 있을 때).
   */
  const saveEdit = useCallback(async () => {
    if (!current || busy) return;

    // 아직 이 곡의 가사를 다 읽지 못했다면 저장하지 않는다 — 다른 곡의 가사를
    // 덮어쓰느니 아무것도 하지 않는 편이 낫다
    if (draftFor !== current.id) {
      setError('가사를 아직 읽는 중입니다. 잠시 후 다시 눌러 주세요.');
      return;
    }

    setBusy(true);
    try {
      const { song: updated } = await api.saveLyrics(current.id, draft);
      setSong(updated);
      setDraft(formatLyrics(updated.sections));
      setDraftFor(updated.id);
      setEditing(false);
      setConfirmedCount((prev) => prev + 1);
      setNotice('저장했습니다 — 확인 완료로 표시됩니다.');

      if (pendingOnly) {
        setItems((prev) => prev.filter((item) => item.id !== current.id));
        setTotal((prev) => Math.max(0, prev - 1));
        setCursor((prev) => Math.min(prev, Math.max(0, items.length - 2)));
      } else {
        setItems((prev) => prev.map((item) => (item.id === current.id ? { ...item, confirmed: true } : item)));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }, [current, busy, draft, draftFor, pendingOnly, items.length]);

  /** 실제 화면으로 어떻게 나가는지 — 판단은 송출 결과로 해야 한다 */
  const preview = useCallback(async () => {
    if (!current || !connected) return;
    try {
      const langs = song?.langs.slice(0, 1) ?? ['ko'];
      const result = await api.songDeck(current.id, langs, '2', undefined, template?.behavior.maxCharsPerLine);
      send({ t: 'deck:load', payload: result.deck });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '송출하지 못했습니다');
    }
  }, [current, connected, song, template, send]);

  // 키보드 — 목록이 길어 마우스로는 끝낼 수 없다
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      // 편집 중에는 Enter 가 승인이 아니라 줄바꿈이어야 한다
      if (editing) return;

      if (event.key === 'Enter') {
        event.preventDefault();
        void approve();
      } else if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'p') {
        event.preventDefault();
        void preview();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [approve, move, preview, editing]);

  // 커서가 화면 밖으로 나가지 않게
  useEffect(() => {
    listRef.current?.querySelector('.review-row.current')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // 진행률의 분모는 항상 '전체 곡'이다.
  //
  // total 은 지금 보고 있는 목록의 크기라 필터에 따라 달라진다 — 미확인만 보면
  // 남은 곡 수, 전체를 보면 전체 곡 수다. 그대로 분모로 쓰면 필터를 껐을 때
  // 100% 로 뛴다.
  const grandTotal = pendingOnly ? confirmedCount + total : total;
  const remaining = pendingOnly ? total : Math.max(0, grandTotal - confirmedCount);
  const percent = grandTotal > 0 ? Math.round((confirmedCount / grandTotal) * 100) : 0;

  /**
   * 이 탭은 **자동 결과를 사람이 승인하는 자리**다. 가사 줄나눔과 악보 단 경계는
   * 성격이 같아 여기에 함께 둔다 — 탭을 하나 더 만들면 위 줄이 빽빽해지고,
   * 예배 준비 중에 자주 가는 곳도 아니다.
   */
  if (mode === 'sheet') {
    return (
      <div className="review-panel">
        <ReviewModeBar mode={mode} onChange={setMode} />
        <SheetReview />
      </div>
    );
  }

  return (
    <div className="review-panel">
      <ReviewModeBar mode={mode} onChange={setMode} />
      {error && (
        <div className="banner error">
          <button type="button" className="close" onClick={() => setError(null)}>닫기</button>
          {error}
        </div>
      )}
      {notice && (
        <div className="banner ok">
          <button type="button" className="close" onClick={() => setNotice(null)}>닫기</button>
          {notice}
        </div>
      )}

      <div className="card review-header">
        <h2>줄나눔 검토</h2>
        <p className="hintline muted">
          자동 정렬은 제안입니다. 승인한 곡은 <b>이후 어떤 자동 작업도 건드리지 않습니다</b>.
        </p>

        <div className="progress-line">
          <div className="progress-bar"><div className="fill" style={{ width: `${percent}%` }} /></div>
          <span className="progress-text">
            확인 {confirmedCount}곡 · 남음 {remaining}곡 · 전체 {grandTotal}곡 ({percent}%)
          </span>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <select value={sort} onChange={(e) => { setSort(e.target.value as typeof sort); setOffset(0); }}>
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select value={book} onChange={(e) => { setBook(e.target.value); setOffset(0); }}>
            <option value="">모든 곡집</option>
            {songbooks.map((songbook) => (
              <option key={songbook.id} value={songbook.id}>{songbook.name}</option>
            ))}
          </select>
          <label className="check">
            <input
              type="checkbox"
              checked={pendingOnly}
              onChange={(e) => { setPendingOnly(e.target.checked); setOffset(0); }}
            />
            미확인만
          </label>
        </div>
        <p className="hintline muted">{SORTS.find((option) => option.value === sort)?.hint}</p>
        <p className="hintline muted">
          <b>Enter</b> 승인 + 다음 · <b>↑↓</b> 이동 · <b>P</b> 송출해 보기
        </p>
      </div>

      <div className="review-split" style={split.style}>
        <div className="card review-list" ref={listRef}>
          <h2>목록 {total > 0 && `(${offset + 1}–${Math.min(offset + items.length, offset + PAGE_SIZE)} / ${total})`}</h2>

          {items.length === 0 && (
            <p className="hintline ok">
              {pendingOnly ? '확인할 곡이 없습니다 — 모두 검토했습니다.' : '곡이 없습니다.'}
            </p>
          )}

          {items.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`review-row${index === cursor ? ' current' : ''}${item.confirmed ? ' done' : ''}`}
              onClick={() => setCursor(index)}
            >
              <span className="num">{item.reference || '—'}</span>
              <span className="body">
                <span className="title">{item.title}</span>
                <span className="meta">
                  {item.sectionCount}절 · {item.lineCount}행
                  {item.attentionReasons.map((reason) => (
                    <span key={reason} className="warn-chip">{reason}</span>
                  ))}
                  {item.useCount > 0 && ` · ${item.useCount}회 사용`}
                </span>
              </span>
              {item.confirmed && <span className="check-mark">✓</span>}
            </button>
          ))}

          {total > PAGE_SIZE && (
            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0}>
                ◀ 이전 100곡
              </button>
              <button
                type="button"
                onClick={() => setOffset(offset + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
              >
                다음 100곡 ▶
              </button>
            </div>
          )}
        </div>

        <ColumnResizer {...split.resizer} />

        <div className="card review-detail">
          {!current && <p className="hintline muted">왼쪽에서 곡을 고르세요.</p>}

          {current && (
            <>
              <h2>
                {current.reference && `${current.reference} `}{current.title}
              </h2>

              {song?.sections.map((section) => (
                <div key={section.id} className="review-section">
                  <span className="section-label">{section.label}</span>
                  <ol className="review-lines">
                    {[...new Set(section.lines.map((line) => line.lineIndex))]
                      .sort((a, b) => a - b)
                      .map((lineIndex) => {
                        const group = section.lines.filter((line) => line.lineIndex === lineIndex);
                        const primary = group[0]!;
                        const chars = primary.text.replace(/\s/g, '').length;
                        return (
                          <li key={lineIndex}>
                            <span className="line-text">{primary.text}</span>
                            <span className={`line-chars${chars > 24 ? ' over' : ''}`}>{chars}</span>
                          </li>
                        );
                      })}
                  </ol>
                </div>
              ))}

              <div className="row" style={{ marginTop: 16 }}>
                <button type="button" className="primary" onClick={() => void approve()} disabled={busy || editing}>
                  승인 (Enter)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setNotice(null);
                    setEditing((prev) => !prev);
                  }}
                  disabled={busy || !song || draftFor !== current.id}
                >
                  {editing ? '수정 닫기' : '수정하기'}
                </button>
                <button type="button" onClick={() => void preview()} disabled={!connected || editing}>
                  송출해 보기 (P)
                </button>
                {current.confirmed && (
                  <button type="button" onClick={() => void unapprove()} disabled={busy}>
                    확인 취소
                  </button>
                )}
              </div>

              {editing && (
                <div className="review-editor">
                  <p className="hintline muted">
                    한 줄이 화면의 한 행입니다. <code>[1절]</code> 로 절을 나누고,
                    <code>|</code> 로 시작하면 바로 윗줄의 다른 언어 가사가 됩니다.
                    <b> 저장하면 확인 완료</b>가 됩니다.
                  </p>
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    spellCheck={false}
                    rows={14}
                  />
                  <div className="row">
                    <button type="button" className="primary" onClick={() => void saveEdit()} disabled={busy}>
                      저장 + 확인 완료
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraft(formatLyrics(song?.sections ?? []))}
                      disabled={busy}
                    >
                      되돌리기
                    </button>
                    <button type="button" onClick={() => setEditing(false)} disabled={busy}>
                      닫기
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}


type ReviewMode = 'lyrics' | 'sheet';

const MODES: ReadonlyArray<readonly [ReviewMode, string, string]> = [
  ['lyrics', '가사 줄나눔', '자동 정렬이 제안한 줄 나눔을 승인합니다'],
  ['sheet', '악보 단 경계', '오선을 다섯 줄 찾지 못한 악보를 확인합니다'],
];

/** 두 검토를 오가는 막대. 무엇을 보고 있는지가 **늘 보여야** 한다 */
function ReviewModeBar({ mode, onChange }: { mode: ReviewMode; onChange: (next: ReviewMode) => void }): React.JSX.Element {
  return (
    <div className="review-modes">
      <div className="toggle-row">
        {MODES.map(([key, label, hint]) => (
          <button
            key={key}
            type="button"
            className={`toggle${mode === key ? ' active' : ''}`}
            title={hint}
            onClick={() => onChange(key)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

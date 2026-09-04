/**
 * 곡의 **수록 정보**(어느 곡집 몇 번)와 **대응곡**(가사가 다른 같은 찬송)을 고치는 줄.
 *
 * 둘 다 서버는 처음부터 되어 있었고 화면에만 길이 없었다 — 수록 정보는
 * `PUT /api/songs/:id/entries`, 대응곡은 `POST/DELETE /api/songs/:id/link`
 * (2026-09-03 전수 조사 §4.6 U-3 · U-4).
 *
 * `SongPanel` 에서 떼어 낸 이유는 순전히 크기다 — 붙이고 나니 1,120줄이 되어
 * 이 프로젝트의 상한(800줄)을 넘었다. 이 두 줄은 곡 하나만 알면 되고 송출·가사
 * 편집과 상태를 나누지 않아 경계가 깔끔하다.
 *
 * **동작 방식이 둘 다르다.**
 * - 대응곡은 누르는 즉시 반영한다. 한 번에 하나이고 다시 붙이면 되돌려진다.
 * - 수록 정보는 [저장] 을 받는다. `setEntries` 가 목록을 **통째로 교체**하므로,
 *   줄을 지우는 도중의 상태가 그대로 쓰이면 안 된다.
 */

import { useEffect, useState } from 'react';

import { shortEntryLabel } from '../../../lib/plan-item-view.ts';
import type { Song, Songbook, SongSearchHit } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';

interface Props {
  song: Song;
  songbooks: Songbook[];
  busy: boolean;
  setBusy: (value: boolean) => void;
  /** 서버가 돌려준 갱신된 곡 */
  onSongChange: (song: Song) => void;
  /** 대응곡 칩을 눌렀을 때 — 그 곡을 연다 */
  onOpenSong: (id: number) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  /** 수록 정보가 바뀌면 왼쪽 목록의 번호 표시도 다시 받아야 한다 */
  onEntriesSaved: () => void;
}

export function SongMetaRows({
  song,
  songbooks,
  busy,
  setBusy,
  onSongChange,
  onOpenSong,
  onError,
  onNotice,
  onEntriesSaved,
}: Props): React.JSX.Element {
  /**
   * 대응곡을 붙이는 중이면 검색어. `null` 이면 닫혀 있다.
   *
   * 목록을 늘 펼쳐 두지 않는 이유: 대응곡은 자료를 반입할 때 한 번 정해지고 그 뒤로는
   * 좀처럼 손대지 않는다. 늘 보이면 매번 지나쳐야 하는 줄이 하나 는다.
   */
  const [linking, setLinking] = useState<string | null>(null);
  const [linkHits, setLinkHits] = useState<SongSearchHit[]>([]);
  /**
   * 수록 정보(곡집·번호)를 고치는 중이면 초안. `null` 이면 닫혀 있다.
   *
   * 번호를 **문자열로** 들고 있는 이유: 칸을 비울 수 있어야 한다('번호 없음').
   * 숫자로 두면 지우는 순간 0 이나 NaN 이 되어, 비운 것과 0번을 구분할 수 없다.
   */
  const [entryDraft, setEntryDraft] = useState<Array<{ songbookId: string; number: string }> | null>(null);

  /** 다른 곡을 열면 열어 둔 편집을 닫는다 — 옛 곡의 초안이 새 곡에 남으면 안 된다 */
  useEffect(() => {
    setLinking(null);
    setEntryDraft(null);
  }, [song.id]);


  /**
   * 수록 정보를 저장한다 — **통째로 교체**한다 (`setEntries`).
   *
   * 즉시 반영이 아니라 [저장] 을 두는 이유: 한 줄만 바뀌는 것이 아니라 목록 전체가
   * 갈리는 동작이라, 줄을 지우는 도중의 상태가 그대로 쓰이면 안 된다.
   *
   * 서버는 하나도 남지 않으면 '기타' 로 떨어뜨린다 — 곡이 어느 곡집에도 없어
   * 목록에서 사라지는 일은 생기지 않는다.
   */
  async function saveEntries(): Promise<void> {
    if (!entryDraft) return;
    setBusy(true);
    onError('');
    try {
      const updated = await api.setSongEntries(
        song.id,
        entryDraft.map((row) => ({
          songbookId: row.songbookId,
          // 빈 칸은 '번호 없음'(null) 이다. 번호 체계가 없는 곡집은 서버가 무시한다
          number: row.number.trim() === '' ? null : Number(row.number),
        })),
      );
      onSongChange(updated);
      setEntryDraft(null);
      onNotice('수록 정보를 저장했습니다');
      // 목록의 번호 표시도 함께 바뀐다 — 다시 찾아야 화면과 DB 가 어긋나지 않는다
      onEntriesSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }


  // 붙일 곡 찾기 (디바운스). 자기 자신과 이미 붙은 곡은 목록에서 뺀다
  useEffect(() => {
    if (linking === null || linking.trim().length === 0) {
      setLinkHits([]);
      return;
    }
    const linked = new Set([song.id, ...(song.links ?? []).map((l) => l.id)]);
    const timer = setTimeout(() => {
      void api
        .songs(linking, 12)
        .then((found) => setLinkHits(found.hits.filter((hit) => !linked.has(hit.id))))
        .catch(() => setLinkHits([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [linking, song]);

  /**
   * 대응곡을 붙인다 — 새찬송가 ↔ 통일찬송가처럼 **가사가 다른 같은 찬송**.
   *
   * 서버는 처음부터 되어 있었고 화면에만 길이 없었다. 반입 스크립트가 붙인 연결이
   * 틀렸을 때 앱에서 고칠 방법이 없었다 (§4.6 U-3, 2026-09-03).
   */
  async function linkSong(linkedId: number): Promise<void> {
    setBusy(true);
    onError('');
    try {
      const updated = await api.linkSong(song.id, linkedId);
      onSongChange(updated);
      setLinking(null);
      setLinkHits([]);
      onNotice(`대응곡을 연결했습니다`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '연결하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /** 되돌릴 수 있는 동작이라(다시 붙이면 된다) 확인을 받지 않는다 */
  async function unlinkSong(linkedId: number, label: string): Promise<void> {
    setBusy(true);
    onError('');
    try {
      const updated = await api.unlinkSong(song.id, linkedId);
      onSongChange(updated);
      onNotice(`'${label}' 연결을 풀었습니다`);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : '풀지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/*
        **수록 정보** — 이 곡이 어느 곡집 몇 번인가.
        라우트는 처음부터 있었는데 화면에 길이 없어, '이 곡은 많은물소리 42번'
        을 나중에 붙이려면 DB 를 직접 만져야 했다 (§4.6 U-4).
      */}
      <p className="hintline muted song-links">
        <span>수록</span>
        {song.entries.map((entry) => (
          <span key={entry.songbookId} className="link-chip static">
            <span className="link-inline">
              {entry.songbookName}
              {entry.number !== undefined ? ` ${entry.number}` : ''}
            </span>
          </span>
        ))}
        <button
          type="button"
          className={entryDraft !== null ? 'primary' : undefined}
          disabled={busy}
          onClick={() =>
            setEntryDraft((prev) =>
              prev === null
                ? song.entries.map((entry) => ({
                    songbookId: entry.songbookId,
                    number: entry.number !== undefined ? String(entry.number) : '',
                  }))
                : null,
            )
          }
          title="어느 곡집 몇 번인지 고칩니다"
        >
          {entryDraft !== null ? '닫기' : '고치기'}
        </button>
      </p>

      {entryDraft !== null && (
        <div className="entry-editor">
          {entryDraft.map((row, index) => {
            const book = songbooks.find((b) => b.id === row.songbookId);
            return (
              <div className="row" key={`${row.songbookId}-${index}`}>
                <span className="grow">{book?.name ?? row.songbookId}</span>
                {book?.numbered === false ? (
                  <span className="dim">번호 없음</span>
                ) : (
                  <input
                    type="number"
                    min={1}
                    max={9999}
                    value={row.number}
                    placeholder="번호"
                    aria-label={`${book?.name ?? row.songbookId} 번호`}
                    onChange={(event) =>
                      setEntryDraft((prev) =>
                        (prev ?? []).map((r, i) => (i === index ? { ...r, number: event.target.value } : r)),
                      )
                    }
                  />
                )}
                <button
                  type="button"
                  className="del"
                  onClick={() => setEntryDraft((prev) => (prev ?? []).filter((_, i) => i !== index))}
                  title="이 곡집에서 뺍니다"
                  aria-label="빼기"
                >
                  ✕
                </button>
              </div>
            );
          })}

          {/* 이미 들어 있는 곡집은 고를 수 없다 — 같은 곡집이 두 번이면 하나로 합쳐진다 */}
          {songbooks.some((book) => !entryDraft.some((row) => row.songbookId === book.id)) && (
            <div className="row">
              <select
                className="grow"
                value=""
                aria-label="곡집 추가"
                onChange={(event) => {
                  const id = event.target.value;
                  if (id === '') return;
                  setEntryDraft((prev) => [...(prev ?? []), { songbookId: id, number: '' }]);
                }}
              >
                <option value="">＋ 곡집 추가…</option>
                {songbooks
                  .filter((book) => !entryDraft.some((row) => row.songbookId === book.id))
                  .map((book) => (
                    <option key={book.id} value={book.id}>{book.name}</option>
                  ))}
              </select>
            </div>
          )}

          {entryDraft.length === 0 && (
            <p className="hintline warn">
              하나도 남기지 않으면 <b>'기타'</b> 곡집으로 들어갑니다 — 곡이 사라지지는 않습니다.
            </p>
          )}

          <div className="row">
            <button type="button" className="primary" disabled={busy} onClick={() => void saveEntries()}>
              수록 정보 저장
            </button>
            <button type="button" disabled={busy} onClick={() => setEntryDraft(null)}>
              취소
            </button>
          </div>
        </div>
      )}

      {/*
        **대응곡** — 새찬송가 ↔ 통일찬송가처럼 가사가 다른 같은 찬송.
        전에는 보여 주기만 했다. 반입이 잘못 붙인 연결을 앱에서 고칠 길이 없어
        DB 를 직접 만져야 했다 (§4.6 U-3).
      */}
      <p className="hintline muted song-links">
        <span>대응곡</span>
        {(song.links ?? []).map((link) => (
          <span key={link.id} className="link-chip">
            <button
              type="button"
              className="link-inline"
              onClick={() => onOpenSong(link.id)}
              title="가사가 다른 판본입니다 — 눌러서 엽니다"
            >
              {shortEntryLabel(link.entries) || link.title}
            </button>
            <button
              type="button"
              className="del"
              disabled={busy}
              onClick={() => void unlinkSong(link.id, shortEntryLabel(link.entries) || link.title)}
              title="연결 풀기 (곡은 지워지지 않습니다)"
              aria-label="연결 풀기"
            >
              ✕
            </button>
          </span>
        ))}
        {(song.links ?? []).length === 0 && <span className="dim">없음</span>}
        <button
          type="button"
          className={linking !== null ? 'primary' : undefined}
          disabled={busy}
          onClick={() => setLinking((prev) => (prev === null ? '' : null))}
          title="가사가 다른 같은 찬송을 이어 둡니다 (새 305 ↔ 통 405)"
        >
          {linking !== null ? '닫기' : '＋ 연결'}
        </button>
        {(song.links ?? []).length > 0 && <span className="dim">가사가 다릅니다</span>}
      </p>

      {linking !== null && (
        <div className="link-picker">
          <input
            className="grow"
            autoFocus
            value={linking}
            onChange={(event) => setLinking(event.target.value)}
            placeholder="이어 둘 곡 — 통 405 · 나같은죄인"
            autoComplete="off"
            spellCheck={false}
            aria-label="대응곡 찾기"
          />
          {linkHits.length > 0 && (
            <div className="candidates">
              {linkHits.map((hit) => (
                <button key={hit.id} type="button" disabled={busy} onClick={() => void linkSong(hit.id)}>
                  {shortEntryLabel(hit.entries) ? `${shortEntryLabel(hit.entries)} ` : ''}
                  {hit.title}
                </button>
              ))}
            </div>
          )}
          {linking.trim().length > 0 && linkHits.length === 0 && (
            <p className="hintline muted">이을 곡이 없습니다 (이미 이어진 곡과 자기 자신은 빠집니다).</p>
          )}
        </div>
      )}
    </>
  );
}

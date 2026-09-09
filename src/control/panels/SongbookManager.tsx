import { useCallback, useState } from 'react';

import type { Songbook } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';

interface Props {
  songbooks: Songbook[];
  onChanged: () => void;
  onClose: () => void;
}

const QUICK_SLOTS = [1, 2, 3, 4] as const;

interface ParsePreview {
  songs: Array<{ number?: number; title: string; sectionLabels?: string[] }>;
  skipped: string[];
}

interface IncompleteSong {
  id: number;
  title: string;
  entries: Array<{ songbookShortLabel: string; number?: number }>;
  sectionCount: number;
  lineCount: number;
  reason: string;
}

const REASON_LABELS: Record<string, string> = {
  no_sections: '섹션 없음',
  no_lines: '가사 없음',
  too_few_lines: '한 줄뿐',
};

/**
 * 가사 점검 — 가사가 비었거나 한 줄인 곡을 모아 보여준다.
 *
 * 가져오기가 일부만 됐거나 제목만 들어온 곡을 **예배 전에** 발견하기 위한 것이다.
 * 한 줄짜리 곡은 정상일 수도 있어(짧은 경배송) 자동으로 지우지 않고 목록만 준다.
 */
function LyricsCheckCard({ songbooks }: { songbooks: Songbook[] }): React.JSX.Element {
  const [scope, setScope] = useState('');
  const [items, setItems] = useState<IncompleteSong[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      setItems(await api.incompleteSongs(scope || undefined));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '점검하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>가사 점검</h2>
      <p className="hintline muted">
        가사가 비었거나 한 줄뿐인 곡을 찾습니다. 가져오기가 일부만 됐는지 예배 전에 확인하세요.
        짧은 경배송은 정상일 수 있으니 목록만 보여 드립니다.
      </p>

      <div className="row" style={{ marginTop: 10 }}>
        <div className="field grow">
          <label>범위</label>
          <select value={scope} onChange={(e) => { setScope(e.target.value); setItems(null); }}>
            <option value="">전체</option>
            {songbooks.map((book) => (
              <option key={book.id} value={book.id}>{book.name}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? '점검 중…' : '점검'}
        </button>
      </div>

      {error && <p className="hintline error">{error}</p>}

      {items !== null && (
        <>
          <p className={items.length === 0 ? 'hintline ok' : 'hintline error'}>
            {items.length === 0 ? '문제가 없습니다.' : `${items.length}곡을 확인하세요.`}
          </p>
          {items.length > 0 && (
            <div className="preview-list">
              {items.slice(0, 60).map((item) => (
                <div key={item.id} className="preview-row">
                  <span className="num">
                    {item.entries
                      .filter((e) => e.number !== undefined)
                      .map((e) => `${e.songbookShortLabel}${e.number}`)
                      .join(',') || '—'}
                  </span>
                  <span className="title">{item.title}</span>
                  <span className="meta">
                    {REASON_LABELS[item.reason] ?? item.reason} · 섹션 {item.sectionCount} · 줄 {item.lineCount}
                  </span>
                </div>
              ))}
              {items.length > 60 && <p className="hintline muted">… 외 {items.length - 60}곡</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 곡집 관리 — 생성 · 가져오기 · 바로가기 지정 · 삭제.
 *
 * 가져오기는 **미리보기를 먼저 보여준다.** 형식이 제각각인 복음성가 자료를
 * 잘못 해석해 조용히 넣는 것이 최악이므로, 몇 곡으로 몇 번으로 잡혔는지
 * 확인한 뒤 저장하게 한다.
 */
export function SongbookManager({ songbooks, onChanged, onClose }: Props): React.JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 새 곡집
  const [newName, setNewName] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newNumbered, setNewNumbered] = useState(true);

  // 가져오기
  const [target, setTarget] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [mode, setMode] = useState<'add' | 'replace'>('add');

  const targetBook = songbooks.find((book) => book.id === target);

  const reset = useCallback(() => {
    setText('');
    setPreview(null);
  }, []);

  async function createBook(): Promise<void> {
    if (newName.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createSongbook(newName.trim(), newLabel.trim() || undefined, newNumbered);
      setNewName('');
      setNewLabel('');
      onChanged();
      setTarget(created.id);
      setNotice(`'${created.name}' 곡집을 만들었습니다. 아래에서 곡을 가져오세요.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '만들 수 없습니다');
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(): Promise<void> {
    if (text.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setPreview(await api.parseSongbookText(text, targetBook?.numbered !== false));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '해석하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  async function runImport(): Promise<void> {
    if (!targetBook || text.trim().length === 0) return;

    if (mode === 'replace') {
      const confirmed = window.confirm(
        `'${targetBook.name}' 의 기존 ${targetBook.songCount}곡을 모두 지우고 새로 넣습니다.\n\n` +
          '되돌릴 수 없습니다. 계속하시겠습니까?',
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await api.importSongbook(targetBook.id, text, mode === 'replace' ? 'replace' : 'add');
      onChanged();
      reset();
      setNotice(
        `'${result.songbook.name}' — ${result.added}곡 추가` +
          (result.replaced > 0 ? ` (기존 ${result.replaced}곡 교체)` : '') +
          (result.skipped.length > 0 ? `\n건너뜀 ${result.skipped.length}건: ${result.skipped.slice(0, 5).join(', ')}` : '') +
          (result.missingNumbers.length > 0
            ? `\n빠진 번호 ${result.missingNumbers.length}개: ${result.missingNumbers.slice(0, 12).join(', ')}${result.missingNumbers.length > 12 ? ' …' : ''}`
            : ''),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '가져오지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  async function setQuickSlot(book: Songbook, slot: number | null): Promise<void> {
    setBusy(true);
    try {
      await api.updateSongbook(book.id, { quickSlot: slot });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '바꾸지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  async function removeBook(book: Songbook): Promise<void> {
    const confirmed = window.confirm(
      `'${book.name}' 곡집을 지웁니다.\n\n` +
        `수록곡 ${book.songCount}곡은 사라지지 않고 '기타' 곡집으로 옮겨집니다.\n\n계속하시겠습니까?`,
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const result = await api.deleteSongbook(book.id);
      onChanged();
      setNotice(`'${book.name}' 을 지웠습니다 (${result.movedToMisc}곡을 기타로 옮김)`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div className="banner error">
          <button type="button" className="close" onClick={() => setError(null)}>닫기</button>
          {error}
        </div>
      )}
      {notice && (
        <div className="banner warn">
          <button type="button" className="close" onClick={() => setNotice(null)}>닫기</button>
          <span style={{ whiteSpace: 'pre-wrap' }}>{notice}</span>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>곡집 관리</h2>
          <button type="button" onClick={onClose}>닫기</button>
        </div>

        <div className="book-list" style={{ marginTop: 12 }}>
          {songbooks.map((book) => (
            <div key={book.id} className="book-row">
              <span className="label">{book.shortLabel}</span>
              <span className="body">
                <span className="name">
                  {book.name}
                  {book.isBuiltin && <span className="badge">내장</span>}
                  {!book.numbered && <span className="badge">번호 없음</span>}
                </span>
                <span className="meta">
                  {book.songCount.toLocaleString()}곡
                  {book.importedAt ? ` · ${book.importedAt.slice(0, 10)} 가져옴` : ''}
                </span>
              </span>
              <span className="actions">
                <select
                  value={book.quickSlot ?? ''}
                  onChange={(e) => void setQuickSlot(book, e.target.value === '' ? null : Number(e.target.value))}
                  disabled={busy}
                  aria-label={`${book.name} 바로가기 위치`}
                >
                  <option value="">바로가기 없음</option>
                  {QUICK_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>바로가기 {slot}</option>
                  ))}
                </select>
                {!book.isBuiltin && (
                  <button type="button" onClick={() => void removeBook(book)} disabled={busy} title="곡집 삭제">✕</button>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <LyricsCheckCard songbooks={songbooks} />

      <div className="card">
        <h2>새 곡집 만들기</h2>
        <div className="row">
          <div className="field grow">
            <label>이름</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="많은 물소리"
              spellCheck={false}
            />
          </div>
          <div className="field">
            <label>대표 글자</label>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value.slice(0, 2))}
              placeholder="물"
              style={{ width: 72, textAlign: 'center' }}
              spellCheck={false}
            />
          </div>
          <label className="check">
            <input type="checkbox" checked={newNumbered} onChange={(e) => setNewNumbered(e.target.checked)} />
            번호 체계 사용
          </label>
          <button type="button" className="primary" onClick={() => void createBook()} disabled={busy || newName.trim().length === 0}>
            만들기
          </button>
        </div>
        <p className="hintline muted">
          번호 체계를 끄면 번호 없이 곡을 담습니다 ('기타' 곡집처럼).
          대표 글자를 비우면 이름 첫 글자를 씁니다.
        </p>
      </div>

      <div className="card">
        <h2>곡 가져오기</h2>

        <div className="row">
          <div className="field grow">
            <label>대상 곡집</label>
            <select value={target} onChange={(e) => { setTarget(e.target.value); setPreview(null); }}>
              <option value="">— 선택 —</option>
              {songbooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.name} ({book.songCount}곡){book.numbered ? '' : ' · 번호 없음'}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>방식</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as 'add' | 'replace')}>
              <option value="add">추가</option>
              <option value="replace">교체 (기존 삭제)</option>
            </select>
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>곡 목록 텍스트</label>
          <textarea
            className="lyrics-editor"
            value={text}
            onChange={(e) => { setText(e.target.value); setPreview(null); }}
            placeholder={
              targetBook?.numbered === false
                ? '---\n제목: 주만 바라볼지라\n저자: 김명식\n[1절]\n주만 바라볼지라\n| Look to Jesus only'
                : '42. 주만 바라볼지라\n[1절]\n주만 바라볼지라\n| Look to Jesus only\n\n118. 나의 등뒤에서\n나의 등 뒤에서 나를 도우시는 주'
            }
            rows={12}
            spellCheck={false}
          />
        </div>

        <p className="hintline muted">
          {targetBook?.numbered === false
            ? '번호가 없는 곡집입니다. 곡을 ---(구분선)으로 나누고 제목:·저자: 로 정보를 넣습니다.'
            : '「번호. 제목」 줄이 곡의 시작입니다. 가사는 그 아래에 넣고, [1절]·[후렴]로 섹션을 나눕니다.'}
            {' '}<code>|</code> 로 시작하는 줄은 직전 줄의 번역이 됩니다.
        </p>

        <div className="row" style={{ marginTop: 10 }}>
          <button type="button" onClick={() => void runPreview()} disabled={busy || text.trim().length === 0}>
            미리보기
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => void runImport()}
            disabled={busy || !targetBook || text.trim().length === 0}
          >
            {busy ? '가져오는 중…' : '가져오기'}
          </button>
        </div>

        {preview && (
          <div style={{ marginTop: 12 }}>
            <p className={preview.songs.length > 0 ? 'hintline ok' : 'hintline error'}>
              {preview.songs.length}곡으로 해석됩니다
              {preview.skipped.length > 0 ? ` · 건너뜀 ${preview.skipped.length}건` : ''}
            </p>
            <div className="preview-list">
              {preview.songs.slice(0, 20).map((song, index) => (
                <div key={index} className="preview-row">
                  <span className="num">{song.number ?? '—'}</span>
                  <span className="title">{song.title}</span>
                  <span className="meta">{(song.sectionLabels ?? []).join(' · ')}</span>
                </div>
              ))}
              {preview.songs.length > 20 && (
                <p className="hintline muted">… 외 {preview.songs.length - 20}곡</p>
              )}
            </div>
            {preview.skipped.length > 0 && (
              <p className="hintline error">건너뜀: {preview.skipped.slice(0, 5).join(', ')}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

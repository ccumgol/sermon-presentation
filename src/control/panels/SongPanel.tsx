import { useCallback, useState } from 'react';

import { LANG_LABELS, MAX_LANGS, langChoices } from '../../../lib/lang-select.ts';
import { OutputStyleBar, type OutputStyle } from '../components/OutputStyleBar.tsx';
import { LyricsTwoPane } from '../components/LyricsTwoPane.tsx';
import { SongMetaRows } from '../components/SongMetaRows.tsx';
import { ProjectorSheetToggle } from '../components/ProjectorSheetToggle.tsx';

import type { ClientMsg, Deck, Template } from '../../../shared/types.ts';
import { formatLyrics } from '../../../lib/lyrics-parser.ts';
import { isSectionStart, verseNumberPrefix } from '../../../lib/song-slides.ts';
import { shortEntryLabel } from '../../../lib/plan-item-view.ts';
import { api, ApiError } from '../api.ts';
import { ColumnResizer } from '../components/ColumnResizer.tsx';
import { useColumnSplit } from '../hooks/useColumnSplit.ts';
import { useFeedback } from '../hooks/useFeedback.ts';
import { useSongEditor } from '../hooks/useSongEditor.ts';
import { FAVORITE_SLOTS, useSongSearch } from '../hooks/useSongSearch.ts';
import { isComposing } from '../ime.ts';
import { SongbookBar } from '../components/SongbookBar.tsx';
import { SongbookManager } from './SongbookManager.tsx';

/**
 * 악보 모양 고르기 — 이름·설명을 한 곳에 둔다.
 *
 * '자동' 이 맨 앞이다: 대부분의 곡은 짐작이 맞고(실측 74%), 고칠 곡만 손댄다.
 */
const SHEET_LAYOUT_CHOICES: ReadonlyArray<readonly ['auto' | 'shared' | 'sequential', string, string]> = [
  ['auto', '자동', '가사 줄 수와 단 수를 견줘 스스로 정합니다'],
  ['shared', '겹쳐', '한 단 아래 1절·2절 가사가 겹쳐 적힌 악보'],
  ['sequential', '이어', '1절이 끝나야 2절이 시작하는 악보'],
];

const LINE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '1', label: '1줄씩' },
  { value: '2', label: '2줄씩' },
  { value: '4', label: '4줄씩' },
  { value: 'section', label: '섹션 전체' },
];



interface Props {
  deck: Deck | null;
  currentIndex: number;
  connected: boolean;
  /** 활성 템플릿 — 표시 행 폭(maxCharsPerLine)을 가져온다 */
  template: Template | null;
  send: (msg: ClientMsg) => boolean;
}

/** 수록 정보를 짧게 — '새305 · 통405' */
export function SongPanel({ deck, currentIndex, connected, template, send }: Props): React.JSX.Element {


  /** 왼쪽 '곡집·검색' 열 너비. 곡을 훑을 때와 가사를 고칠 때 원하는 폭이 다르다 */
  const split = useColumnSplit('song', { edge: 'start', min: 260, minNeighbor: 320, label: '곡 목록' });


  /**
   * 배너 셋 — 예배 순서 탭과 **같은 훅**을 쓴다 (`useFeedback`).
   * 이 값들은 화면 블록 여섯 중 다섯에 흩어져 있어, 블록을 자를 때마다
   * 프롭이 1~4개씩 늘어난다. 하나로 묶으면 하나다.
   */
  const feedback = useFeedback();
  const { error, setError, notice, setNotice, busy, setBusy } = feedback;

  /** '＋ 새 곡' 칸이 열려 있나. 열려 있으면 제목을 받는다 */

  /**
   * 격자에 보일 언어. 곡이 가진 언어에 사람이 더 고른 것을 얹는다.
   *
   * 표시 언어(`langs`)와 따로 두는 이유: 표시 언어는 **송출할 것**이고 이것은
   * **편집할 것**이다. 中文 을 넣는 동안 화면에는 한/영만 내보내고 싶을 수 있다.
   */
  /** 이 탭에서 띄울 때 쓸 프리셋·폰트 — 고르지 않으면 지금 템플릿 그대로 */
  const [outputStyle, setOutputStyle] = useState<OutputStyle>({});

  /**
   * 곡 찾기 — 곡집 목록·검색·빠른 칩 줄을 한 덩이로 (`useSongSearch`).
   *
   * 왼쪽 열 블록 하나가 컴포넌트 안 상태 **스물넷**을 쓰고 있었다. 그대로
   * 컴포넌트로 빼면 프롭 스물넷짜리 껍데기가 된다 — 묶으면 객체 하나다.
   */
  const search = useSongSearch(setError);
  const {
    songbooks, reloadSongbooks, managing, setManaging,
    selectedBook, setSelectedBook, query, setQuery, result, searchRef,
    quickPicks, quickMode, setQuickMode, quickIsFallback, reloadQuickPicks,
  } = search;

  // 저장된 운율 행을 이 폭에 맞춰 묶는다 (하단 두 줄 템플릿은 넓게, 큰 글씨는 좁게)
  const maxChars = template?.behavior.maxCharsPerLine;

  /**
   * 고르고 고치는 곡 — 지금 연 곡·표시 설정·가사 편집을 한 덩이로 (`useSongEditor`).
   *
   * 오른쪽 열 블록 하나가 컴포넌트 안 상태 **스물다섯**을 쓰고 있었다.
   */
  const editor = useSongEditor({
    feedback,
    clearResult: search.clearResult,
    setQuery: search.setQuery,
    reloadQuickPicks: search.reloadQuickPicks,
    maxChars,
  });
  const {
    song, setSong, sheet, useSheet, setUseSheet, langs, toggleLang, lines, setLines,
    editing, setEditing, draftLyrics, setDraftLyrics, draftDeck,
    creating, setCreating, newTitle, setNewTitle,
    openSong, createSong, removeSong, toggleFavorite, saveLyrics, chooseSheetLayout,
  } = editor;

  /**
   * 이 탭의 프리셋·폰트를 얹어 보낸다.
   *
   * 템플릿을 **슬라이드보다 먼저** 올린다 — 순서가 반대면 옛 템플릿으로 한 번
   * 그려졌다가 바뀌어 화면이 튄다 (예배 순서 탭의 sendItem 과 같은 규칙).
   *
   * 송출 경로가 둘(고른 곡 송출·번호 즉시 송출)이라 한 곳에 모은다. 두 곳에 적으면
   * 한쪽만 고쳐 '검색해서 띄우면 되는데 번호로 띄우면 안 된다' 가 된다.
   */
  const sendWithStyle = useCallback(
    (deck: Deck): void => {
      if (outputStyle.templateId !== undefined) {
        send({ t: 'template:set', id: outputStyle.templateId });
      }
      const payload =
        outputStyle.style === undefined
          ? deck
          : {
              ...deck,
              slides: deck.slides.map((slide) =>
                slide.kind === 'song' ? { ...slide, style: outputStyle.style } : slide,
              ),
            };
      send({ t: 'deck:load', payload });
    },
    [outputStyle, send],
  );

  const sendDeck = useCallback(
    async (sectionId?: number) => {
      if (!song) return;
      setBusy(true);
      setError(null);
      try {
        const deckResult = await api.songDeck(song.id, langs, lines, sectionId, maxChars, useSheet);
        if (deckResult.deck.slides.length === 0) {
          setError('표시할 가사가 없습니다');
          return;
        }
        if (deckResult.missingLangs.length > 0) {
          const names = deckResult.missingLangs.map((l) => LANG_LABELS[l] ?? l).join(', ');
          setNotice(`이 곡에는 ${names} 가사가 없어 표시되지 않습니다. 편집에서 추가할 수 있습니다.`);
        }
        sendWithStyle(deckResult.deck);
        void reloadQuickPicks();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '송출하지 못했습니다');
      } finally {
        setBusy(false);
      }
    },
    [song, langs, lines, maxChars, useSheet, sendWithStyle, reloadQuickPicks],
  );

  /**
   * 곡을 열고 곧바로 송출한다 — 번호 즉시 송출 경로.
   *
   * 곡집 버튼을 누르고 번호를 치고 Enter 를 누르면 여기로 온다.
   * 예배 중 가장 잦은 동작이라 검색 결과를 클릭하는 단계를 없앴다.
   */
  const openAndSend = useCallback(
    async (id: number) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        // 열면서 이 곡이 가진 언어로 맞춘다 — 없는 언어를 켠 채 보내면 화면이 빈다
        const opened = await editor.openForSend(id);
        if (!opened) return;

        // 번호로 바로 띄우는 길 — 곡을 새로 여는 것이므로 늘 가사다
        const deckResult = await api.songDeck(id, opened.langs, lines, undefined, maxChars, false);
        if (deckResult.deck.slides.length === 0) {
          setError(`'${opened.song.title}' 에 표시할 가사가 없습니다`);
          return;
        }
        sendWithStyle(deckResult.deck);
        void reloadQuickPicks();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '송출하지 못했습니다');
      } finally {
        setBusy(false);
      }
    },
    [editor, lines, maxChars, sendWithStyle, reloadQuickPicks, setBusy, setError, setNotice],
  );





  if (managing) {
    return (
      <SongbookManager
        songbooks={songbooks}
        onChanged={() => {
          void reloadSongbooks();
          // 곡 수가 바뀌었을 수 있으니 목록을 다시 읽는다
          search.refresh();
        }}
        onClose={() => setManaging(false)}
      />
    );
  }

  const selectedBookName = songbooks.find((b) => b.id === selectedBook)?.name;

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
          {notice}
        </div>
      )}

      <div className="song-split" style={split.style}>
        <div className="card song-browse">
        <h2>곡집</h2>
        <SongbookBar
          songbooks={songbooks}
          selected={selectedBook}
          onSelect={(id) => {
            setSelectedBook(id);
            searchRef.current?.focus();
          }}
          onManage={() => setManaging(true)}
        />

        <input
          ref={searchRef}
          className="song-search"
          style={{ marginTop: 12 }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 확정용 Enter 를 걸러낸다 — 안 그러면 한 번 눌러도
            // 두 번 처리돼 엉뚱한 곡이 송출될 수 있다 (ime.ts 참고)
            if (e.key !== 'Enter' || isComposing(e)) return;
            e.preventDefault();
            // 첫 결과를 곧바로 송출한다. 목록이 눈앞에 있으니 예측 가능하다.
            const first = result?.hits[0];
            if (first && connected) void openAndSend(first.id);
          }}
          placeholder={
            selectedBook
              ? `${selectedBookName} 안에서 — 번호·제목·가사`
              : '통합 검색 — 305 · 새 305 · 통 405 · 나 같은 죄인 · 은혜'
          }
          autoComplete="off"
          spellCheck={false}
          aria-label="곡 검색"
        />
        <div className="hintline muted">
          {selectedBook
            ? `${selectedBookName} 목록입니다. 전체 버튼을 누르면 통합 검색으로 돌아갑니다.`
            : '번호·제목·가사를 한 번에 찾습니다. 곡집을 지정하려면 「새 305」처럼 입력하세요.'}
          {' '}<b>Enter</b> 를 누르면 첫 결과를 바로 송출합니다.
        </div>

        {query.trim().length === 0 && (
          <div className="recent-row">
            {/*
              무엇을 보여 줄지 고른다. 줄을 둘로 늘리지 않고 전환으로 둔 이유는
              이 아래가 곧바로 검색 결과라, 한 줄이 늘 때마다 목록이 그만큼 밀리기
              때문이다 (예배 순서 탭에서 겪은 것과 같다).
            */}
            <span className="candidates quick-mode">
              {([['favorite', '즐겨찾기'], ['recent', '최근']] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  className={quickMode === mode ? 'primary' : undefined}
                  onClick={() => setQuickMode(mode)}
                  title={mode === 'recent' ? '최근 송출한 곡 — 지난주에 무엇을 불렀는지' : '★ 로 지정해 둔 곡'}
                >
                  {label}
                </button>
              ))}
            </span>
            {quickIsFallback && (
              <span className="recent-label" title="즐겨찾기가 비어 자주 쓴 곡을 보여 줍니다">
                (자주 쓴 곡)
              </span>
            )}
            {quickPicks.map((hit) => (
              <button
                key={hit.id}
                type="button"
                className="recent-chip"
                onClick={() => void openAndSend(hit.id)}
                disabled={!connected || busy}
                title={`${hit.title}${hit.titleAlt && !hit.title.includes(hit.titleAlt) ? ` (${hit.titleAlt})` : ''} — 바로 송출`}
              >
                <span className="num">{shortEntryLabel(hit.entries) || '—'}</span>
                <span className="title">{hit.title}</span>
              </button>
            ))}
            {quickPicks.length === 0 && (
              <span className="recent-label">
                {quickMode === 'recent'
                  ? '아직 송출한 곡이 없습니다 — 곡을 한 번 띄우면 여기 쌓입니다.'
                  : '★ 를 눌러 매주 쓰는 곡을 지정해 두세요.'}
              </span>
            )}
          </div>
        )}

        {/*
          새 곡 만들기 — **검색 위에 둔다.** 찾다가 없어서 만드는 흐름이므로
          결과 바로 위가 손이 가는 자리다. 곡집은 묻지 않는다 — 손으로 쓴 곡은
          '기타' 로 간다 (번호가 없는 곡집이라 번호를 물을 것도 없다).
        */}
        <div className="row" style={{ marginTop: 8 }}>
          {creating ? (
            <>
              <input
                type="text"
                className="grow"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !isComposing(e)) void createSong();
                  if (e.key === 'Escape') { setCreating(false); setNewTitle(''); }
                }}
                placeholder="곡 제목 — 기타 곡집에 만듭니다"
                aria-label="새 곡 제목"
                autoFocus
              />
              <button type="button" className="primary" onClick={() => void createSong()} disabled={busy || newTitle.trim().length === 0}>
                만들기
              </button>
              <button type="button" onClick={() => { setCreating(false); setNewTitle(''); }}>취소</button>
            </>
          ) : (
            <button type="button" onClick={() => setCreating(true)}>＋ 새 곡</button>
          )}
        </div>

        <div className="song-hits">
          {result && result.hits.length === 0 && <p className="hintline muted">결과가 없습니다.</p>}
          {result?.hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              className={`song-hit${song?.id === hit.id ? ' current' : ''}`}
              onClick={() => void openSong(hit.id)}
            >
              <span className="num">{shortEntryLabel(hit.entries) || '—'}</span>
              <span className="body">
                <span className="title">
                  {hit.title}
                  {hit.confirmed && (
                    <span className="confirm-tag" title="줄나눔을 확인한 곡 — 자동 갱신이 건드리지 않습니다">
                      승인
                    </span>
                  )}
                </span>
                {/*
                  **영어 원제를 보여 준다.** 999곡에 원제가 들어 있는데 화면 어디에도
                  나오지 않아, 영어로는 곡을 찾을 수 없었다 (2026-08-29 사용자).
                  제목이 이미 원제를 품고 있으면(‘한국어 - 영문’) 두 번 적지 않는다.
                */}
                {hit.titleAlt && !hit.title.includes(hit.titleAlt) && (
                  <span className="title-alt">{hit.titleAlt}</span>
                )}
                {hit.snippet && <span className="snippet">{hit.snippet}</span>}
                <span className="meta">
                  {hit.sectionCount}개 섹션 · {hit.langs.map((l) => LANG_LABELS[l] ?? l).join('/')}
                </span>
              </span>
            </button>
          ))}
          {result?.truncated && (
            <p className="hintline muted">
              결과가 많습니다 ({result.total}건 중 {result.hits.length}건 표시) — 검색어를 좁혀 보세요.
            </p>
          )}
        </div>
        </div>

        <ColumnResizer {...split.resizer} />

        <div className="song-detail">
      {!song && <p className="card hintline muted">왼쪽에서 곡을 고르면 여기에 표시 설정이 나옵니다.</p>}
      {song && (
        <>
          <div className="card">
            <h2 className="song-title-row">
              <button
                type="button"
                className={`star${song.isFavorite ? ' on' : ''}`}
                onClick={() => void toggleFavorite()}
                title={song.isFavorite ? '즐겨찾기에서 빼기' : `즐겨찾기에 넣기 (${FAVORITE_SLOTS}칸)`}
                aria-label="즐겨찾기"
              >
                {song.isFavorite ? '★' : '☆'}
              </button>
              <span>
                {song.entries
                  .filter((e) => e.number !== undefined)
                  .map((e) => `${e.songbookName} ${e.number}장`)
                  .join(' · ') || '곡'}{' '}
                — {song.title}
              </span>
              {song.titleAlt && !song.title.includes(song.titleAlt) && (
                <span className="title-alt">{song.titleAlt}</span>
              )}
              {song.confirmed && (
                <span className="confirm-tag" title="줄나눔을 확인한 곡 — 자동 갱신이 건드리지 않습니다">
                  승인
                </span>
              )}
            </h2>

            {/*
              수록 정보(곡집·번호)와 대응곡. SongPanel 이 800줄 상한을 넘어가서
              떼어 냈다 — 이 두 줄은 곡 하나만 알면 되고 송출·가사 편집과 상태를
              나누지 않아 경계가 깔끔하다.
            */}
            <SongMetaRows
              song={song}
              songbooks={songbooks}
              busy={busy}
              setBusy={setBusy}
              onSongChange={setSong}
              onOpenSong={(id) => void openSong(id)}
              onError={setError}
              onNotice={setNotice}
              onEntriesSaved={() => {
                search.refresh();
                void reloadSongbooks();
              }}
            />

            {/*
              **악보 상태.** 프로젝터에 악보가 나가는지, 배분이 흔들리는 곡인지
              조작자가 알아야 한다 — 예배 중에 '악보가 왜 안 나오지?' 를 화면에서
              알 수 없으면 곤란하다.
            */}
            <p className="hintline muted song-links">
              <span>악보</span>
              {sheet ? (
                <>
                  <span className="link-chip static">
                    <span className="link-inline">
                      {shortEntryLabel(song.entries.filter((e) => e.songbookId === sheet.songbookId)) ||
                        `${sheet.songbookId} ${sheet.number}`}
                      {' · '}
                      {sheet.systemCount}단
                    </span>
                  </span>
                  {/*
                    짐작이 틀리는 곡이 26% 다 (lib/sheet-match.ts 실측). 사람이 보고
                    고칠 수 있어야 한다 — '자동' 을 따로 둔 이유는 잘못 고른 것을
                    되돌리기 위해서다.
                  */}
                  <span className="toggle-row sheet-layout">
                    {SHEET_LAYOUT_CHOICES.map(([key, label, hint]) => (
                      <button
                        key={key}
                        type="button"
                        className={`toggle${(sheet.chosen ? sheet.layout : 'auto') === key ? ' active' : ''}`}
                        title={hint}
                        onClick={() => void chooseSheetLayout(key === 'auto' ? null : key)}
                      >
                        {label}
                      </button>
                    ))}
                  </span>
                  <span className="dim">
                    {sheet.layout === 'shared' ? '절이 겹쳐 적힘' : '절이 이어 적힘'}
                    {sheet.chosen ? '' : ' (짐작)'}
                  </span>
                </>
              ) : (
                <span className="dim">없습니다 — 프로젝터에도 가사가 나갑니다</span>
              )}
            </p>

            {/*
              프로젝터에 무엇을 낼지. **기본은 가사**다 — 단 경계 검출이 아직
              불완전해서, 틀린 자리가 벽에 걸리는 것보다 가사가 낫다.
              OBS 화면과 강사 모니터는 이 값과 무관하게 언제나 가사다.
            */}
            <p className="hintline muted song-links">
              <span>프로젝터</span>
              <ProjectorSheetToggle
                value={useSheet}
                hasSheet={sheet !== undefined}
                onChange={setUseSheet}
              />
              <span className="dim">
                {useSheet ? '지금 부르는 줄의 악보 단이 나갑니다' : 'OBS 화면과 같은 가사가 나갑니다'}
              </span>
            </p>

            {sheet?.uncertain && (
              <p className="hintline warn">
                <b>악보 줄맞춤이 흔들릴 수 있습니다.</b> 가사 줄 수와 악보 단 수가 어긋나
                ({song.sections.length}개 섹션 · 악보 {sheet.systemCount}단), 슬라이드에 딸린 단이
                실제와 다를 수 있습니다. 아래 슬라이드 목록의 <b>단 번호</b>를 악보와 견줘 보세요.
              </p>
            )}

            {sheet?.needsReview && (
              <p className="hintline warn">
                이 악보는 <b>단을 자동으로 찾다가 이상한 곳</b>이 있었습니다 (오선이 5줄이 아닌 단).
                잘린 자리가 어긋났을 수 있습니다.
              </p>
            )}

            {/*
              이 탭은 순서를 벗어나 급히 띄우는 자리다 — 예배 중 곡이 갑자기 바뀔 때 쓴다.
              그때 화면 모양을 정할 길이 없었다(지금 활성 템플릿이 무엇이든 그대로 나갔다).
            */}
            <OutputStyleBar value={outputStyle} onChange={setOutputStyle} />

            <div className="row">
              <div className="field">
                <label>표시 언어 (최대 {MAX_LANGS})</label>
                <div className="candidates">
                  {langChoices(song.langs).map((lang) => {
                    const has = song.langs.includes(lang);
                    const active = langs.includes(lang);
                    return (
                      <button
                        key={lang}
                        type="button"
                        className={active ? 'primary' : undefined}
                        onClick={() => toggleLang(lang)}
                        title={has ? '' : '이 곡에는 이 언어 가사가 없습니다'}
                      >
                        {LANG_LABELS[lang] ?? lang}
                        {!has && ' ·'}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="field">
                <label>화면 넘김</label>
                <select value={lines} onChange={(e) => setLines(e.target.value)}>
                  {LINE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {song.hasAmen && (
              <p className="hintline muted">이 곡은 아멘으로 끝납니다 (별도 절로 만들지 않고 속성으로 표시).</p>
            )}

            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="primary" onClick={() => void sendDeck()} disabled={!connected || busy}>
                곡 전체 송출
              </button>
              <button type="button" onClick={() => setEditing((v) => !v)}>
                {editing ? '편집 닫기' : '가사 편집'}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => void removeSong()}
                disabled={busy}
                title="이 곡을 지웁니다 — 되돌릴 수 없습니다"
              >
                곡 삭제
              </button>
            </div>
          </div>

          <div className="card">
            <h2>섹션</h2>
            <div className="section-list">
              {song.sections.map((section) => {
                const primaryLines = section.lines.filter((l) => l.lang === (langs[0] ?? 'ko'));
                return (
                  <button
                    key={section.id}
                    type="button"
                    className={`section-item kind-${section.kind}`}
                    onClick={() => void sendDeck(section.id)}
                    disabled={!connected || busy}
                  >
                    <span className="label">{section.label}</span>
                    <span className="preview">
                      {primaryLines.map((l) => l.text).join(' / ') || '(가사 없음)'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {editing && (
            <div className="card">
              <h2>가사 편집</h2>
              {/*
                **편집 수단은 하나다.** 전에는 넷이었다 — 줄 격자, 'X 가사 전체 지우기',
                '원문으로 편집', '타언어 가사'. 각각 성격이 달라 무엇을 쓸지 고르는 것부터
                일이었고, 타언어 창은 한국어가 읽기 전용이라 한국어를 고치려면 다른
                수단으로 옮겨 가야 했다 (2026-08-29 사용자 요청으로 하나로 합쳤다).
              */}
              <LyricsTwoPane
                text={draftLyrics}
                songId={song.id}
                langs={song.langs}
                onChange={setDraftLyrics}
              />

              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="primary" onClick={() => void saveLyrics()} disabled={busy}>
                  가사 저장
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftLyrics(formatLyrics(song.sections));
                  }}
                >
                  되돌리기
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/*
        편집 중에는 **고치고 있는 곡**을, 아닐 때는 송출 중인 곡을 보여 준다.
        미리보기는 누를 수 없다 — 송출 중인 곡이 아니므로 누르면 라이브 화면이
        엉뚱한 자리로 튄다. 보낼 때는 위의 '곡 전체 송출' 을 쓴다.
      */}
      {(() => {
        const preview = draftDeck !== null;
        const slides = preview ? draftDeck.slides : deck?.slides ?? [];
        const labels = preview ? draftDeck.labels : deck?.labels ?? [];
        if (slides.length === 0) return null;
        return (
        <div className="card">
          <h2>
            슬라이드 — {preview ? `${song?.title ?? ''} (편집 중)` : deck?.reference}
          </h2>
          {preview && (
            <p className="hintline muted">
              저장하기 전 모습입니다. 화면에는 아직 나가지 않았습니다 — 보내려면 위의
              ‘곡 전체 송출’ 을 누르세요.
            </p>
          )}
          <div className="slides">
            {slides.map((slide, index) => (
              <button
                key={index}
                type="button"
                className={`slide-item${!preview && index === currentIndex ? ' current' : ''}`}
                onClick={() => { if (!preview) send({ t: 'goto', index }); }}
                disabled={preview || !connected}
              >
                <span className="label">
                  {!preview && index === currentIndex ? '▶ ' : ''}
                  {labels[index] || index + 1}
                  {/*
                    이 줄이 악보의 몇 번째 단인지. **배분이 맞는지 눈으로 확인하는 유일한
                    자리다** — 퍼센트만으로는 셀 수 없어 숫자로 적는다.
                    편집 미리보기에는 붙지 않는다 (아직 서버가 만든 덱이 아니다).
                  */}
                  {slide.kind === 'song' && slide.sheet && (
                    <span
                      className={`sheet-tag${slide.sheet.uncertain ? ' uncertain' : ''}`}
                      title={
                        slide.sheet.uncertain
                          ? `악보 ${slide.sheet.system}/${slide.sheet.systemCount}단 — 줄맞춤이 흔들릴 수 있습니다`
                          : `악보 ${slide.sheet.system}/${slide.sheet.systemCount}단`
                      }
                    >
                      ♪{slide.sheet.system}
                      {slide.sheet.uncertain ? '?' : ''}
                    </span>
                  )}
                </span>
                <span className="text">
                  {slide.kind === 'song'
                    ? slide.lines.map((group, gi) => (
                        <span key={gi} style={{ display: 'block' }}>
                          {group.map((line, li) => (
                            <span key={li} className={li === 0 ? undefined : 'secondary'} style={{ display: 'block' }}>
                              {/* 몇 절인지 첫 줄 앞에 붙인다 (후렴처럼 번호가 없으면 붙지 않는다) */}
                              {gi === 0 && li === 0 && isSectionStart(slide, slides[index - 1])
                                ? verseNumberPrefix(slide.sectionLabel)
                                : ''}
                              {line.text}
                            </span>
                          ))}
                        </span>
                      ))
                    : null}
                </span>
              </button>
            ))}
          </div>
        </div>
        );
      })()}
        </div>
      </div>
    </>
  );
}

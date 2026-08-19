import { useCallback, useEffect, useRef, useState } from 'react';

import {
  LANG_LABELS, MAX_LANGS, orderLangs, SELECTABLE_LANGS, toggleLang as nextLangs,
} from '../../../lib/lang-select.ts';
import { OutputStyleBar, type OutputStyle } from '../components/OutputStyleBar.tsx';
import { LyricsGrid } from '../components/LyricsGrid.tsx';
import { mergeSecondaryLyrics } from '../../../lib/lyrics-merge.ts';
import { formatLyrics } from '../../../lib/lyrics-parser.ts';
import type {
  ClientMsg, Deck, LangCode, Song, Songbook, SongSearchHit, SongSearchResult, Template,
} from '../../../shared/types.ts';
import { isSectionStart, verseNumberPrefix } from '../../../lib/song-slides.ts';
import { api, ApiError } from '../api.ts';
import { isComposing } from '../ime.ts';
import { SongbookBar } from '../components/SongbookBar.tsx';
import { SongbookManager } from './SongbookManager.tsx';

/** 즐겨찾기 칸 수 — 한 줄에 들어가고 손이 기억할 수 있는 개수 */
const FAVORITE_SLOTS = 5;

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
function entryLabel(hit: Pick<SongSearchHit, 'entries'>): string {
  return hit.entries
    .filter((entry) => entry.number !== undefined)
    .map((entry) => `${entry.songbookShortLabel}${entry.number}`)
    .join(' · ');
}

export function SongPanel({ deck, currentIndex, connected, template, send }: Props): React.JSX.Element {
  const [songbooks, setSongbooks] = useState<Songbook[]>([]);
  const [quickPicks, setQuickPicks] = useState<SongSearchHit[]>([]);
  const [quickIsFallback, setQuickIsFallback] = useState(false);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [managing, setManaging] = useState(false);

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SongSearchResult | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [langs, setLangs] = useState<LangCode[]>(['ko']);
  const [lines, setLines] = useState('2');

  // 저장된 운율 행을 이 폭에 맞춰 묶는다 (하단 두 줄 템플릿은 넓게, 큰 글씨는 좁게)
  const maxChars = template?.behavior.maxCharsPerLine;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftLyrics, setDraftLyrics] = useState('');
  /**
   * 격자에 보일 언어. 곡이 가진 언어에 사람이 더 고른 것을 얹는다.
   *
   * 표시 언어(`langs`)와 따로 두는 이유: 표시 언어는 **송출할 것**이고 이것은
   * **편집할 것**이다. 中文 을 넣는 동안 화면에는 한/영만 내보내고 싶을 수 있다.
   */
  /** 이 탭에서 띄울 때 쓸 프리셋·폰트 — 고르지 않으면 지금 템플릿 그대로 */
  const [outputStyle, setOutputStyle] = useState<OutputStyle>({});
  const [gridLangs, setGridLangs] = useState<LangCode[] | null>(null);
  /** 붙여 넣을 대상 언어 — 어느 언어를 채우는지 골라야 다른 언어를 지우지 않는다 */
  const [pasteLang, setPasteLang] = useState<LangCode>('en');
  /** 붙여 넣은 번역 원문 — 짝을 맞추기 전의 날글 */
  const [englishPaste, setEnglishPaste] = useState('');
  /** 마지막 짝 맞추기 결과 — 넘친 줄·모자란 줄을 사람이 보게 한다 */
  const [mergeReport, setMergeReport] = useState<{ paired: number; replaced: number; dropped: string[]; problems: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);

  const loadSongbooks = useCallback(async () => {
    try {
      setSongbooks(await api.songbooks());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '곡집을 불러오지 못했습니다');
    }
  }, []);

  /**
   * 즐겨찾기 — 예배마다 쓰는 곡을 검색 없이 바로 꺼낸다.
   *
   * 최근 송출 순으로 두면 목록이 매번 흔들려 손이 기억하지 못한다. 송영·봉헌송
   * 처럼 늘 쓰는 곡은 사람이 지정하는 편이 낫다. 아직 지정한 곡이 없으면
   * 자주 쓴 곡을 대신 보여 준다 — 빈 줄을 보여 주는 것보다 쓸모 있다.
   */
  const loadQuickPicks = useCallback(async () => {
    try {
      const favorites = await api.favorites(FAVORITE_SLOTS);
      if (favorites.length > 0) {
        setQuickPicks(favorites);
        setQuickIsFallback(false);
        return;
      }
      // 아직 지정한 곡이 없다 — 자주 쓴 곡으로 채워 빈 줄을 만들지 않는다
      setQuickPicks(await api.frequentSongs(FAVORITE_SLOTS));
      setQuickIsFallback(true);
    } catch {
      // 편의 기능이므로 실패해도 조용히 넘긴다
    }
  }, []);

  useEffect(() => {
    void loadSongbooks();
    void loadQuickPicks();
  }, [loadSongbooks, loadQuickPicks]);

  // 검색 — 곡집을 고르면 그 범위, 아니면 전체 통합 검색 (디바운스)
  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .songs(query, 60, selectedBook)
        .then(setResult)
        .catch((err) => setError(err instanceof ApiError ? err.message : '곡을 찾지 못했습니다'));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, selectedBook]);

  const openSong = useCallback(async (id: number) => {
    setError(null);
    setNotice(null);
    setEditing(false);
    try {
      const { song: loaded, availableLangs } = await api.song(id);
      setSong(loaded);
      setLangs(availableLangs.length > 0 ? availableLangs.slice(0, 1) : ['ko']);
      setDraftLyrics(formatLyrics(loaded.sections));
      // 곡이 바뀌면 격자 언어도 그 곡 기준으로 — 앞 곡의 선택이 남으면 헷갈린다
      setGridLangs(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '곡을 불러오지 못했습니다');
    }
  }, []);

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
        const deckResult = await api.songDeck(song.id, langs, lines, sectionId, maxChars);
        if (deckResult.deck.slides.length === 0) {
          setError('표시할 가사가 없습니다');
          return;
        }
        if (deckResult.missingLangs.length > 0) {
          const names = deckResult.missingLangs.map((l) => LANG_LABELS[l] ?? l).join(', ');
          setNotice(`이 곡에는 ${names} 가사가 없어 표시되지 않습니다. 편집에서 추가할 수 있습니다.`);
        }
        sendWithStyle(deckResult.deck);
        void loadQuickPicks();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '송출하지 못했습니다');
      } finally {
        setBusy(false);
      }
    },
    [song, langs, lines, sendWithStyle, loadQuickPicks],
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
        const { song: loaded, availableLangs } = await api.song(id);
        setSong(loaded);
        setDraftLyrics(formatLyrics(loaded.sections));

        // 이 곡이 가진 언어로 맞춘다 — 없는 언어를 켠 채 보내면 화면이 빈다
        const nextLangs = langs.filter((lang) => loaded.langs.includes(lang));
        const useLangs = nextLangs.length > 0 ? nextLangs : availableLangs.slice(0, 1);
        setLangs(useLangs);

        const deckResult = await api.songDeck(id, useLangs, lines, undefined, maxChars);
        if (deckResult.deck.slides.length === 0) {
          setError(`'${loaded.title}' 에 표시할 가사가 없습니다`);
          return;
        }
        sendWithStyle(deckResult.deck);
        void loadQuickPicks();
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '송출하지 못했습니다');
      } finally {
        setBusy(false);
      }
    },
    [langs, lines, sendWithStyle, loadQuickPicks],
  );

  /** 즐겨찾기에 넣거나 뺀다 — 목록은 곧바로 다시 읽는다 */
  async function toggleFavorite(): Promise<void> {
    if (!song) return;
    try {
      const result = await api.toggleFavorite(song.id, !song.isFavorite);
      setSong({ ...song, isFavorite: result.favorite });
      await loadQuickPicks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '즐겨찾기를 바꾸지 못했습니다');
    }
  }

  async function saveLyrics(): Promise<void> {
    if (!song) return;
    setBusy(true);
    setError(null);
    try {
      const { song: updated, availableLangs } = await api.saveLyrics(song.id, draftLyrics);
      setSong(updated);
      setDraftLyrics(formatLyrics(updated.sections));
      setEditing(false);
      setNotice(`가사를 저장했습니다 (언어: ${availableLangs.map((l) => LANG_LABELS[l] ?? l).join(', ')})`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 표시 언어 토글 — 규칙은 `lib/lang-select.ts` 에 있다.
   *
   * 전에는 이 파일이 같은 규칙을 자기 안에 또 갖고 있었다. 예배 순서 탭에 같은
   * 컨트롤을 만들면서 규칙을 공용 모듈로 뺐는데 이 탭만 남아 있었고, 상한이 2 로
   * 박혀 있어 3언어를 고를 수 없었다. 두 탭이 어긋나지 않게 한 곳만 쓴다.
   */
  function toggleLang(lang: LangCode): void {
    setLangs((prev) => nextLangs(prev, lang));
  }

  if (managing) {
    return (
      <SongbookManager
        songbooks={songbooks}
        onChanged={() => {
          void loadSongbooks();
          // 곡 수가 바뀌었을 수 있으니 목록을 다시 읽는다
          void api.songs(query, 60, selectedBook).then(setResult).catch(() => undefined);
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

      <div className="song-split">
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

        {quickPicks.length > 0 && query.trim().length === 0 && (
          <div className="recent-row">
            <span className="recent-label" title={quickIsFallback ? '즐겨찾기가 비어 자주 쓴 곡을 보여 줍니다' : undefined}>
              {quickIsFallback ? '자주 쓴 곡' : '즐겨찾기'}
            </span>
            {quickPicks.map((hit) => (
              <button
                key={hit.id}
                type="button"
                className="recent-chip"
                onClick={() => void openAndSend(hit.id)}
                disabled={!connected || busy}
                title={`${hit.title} — 바로 송출`}
              >
                <span className="num">{entryLabel(hit) || '—'}</span>
                <span className="title">{hit.title}</span>
              </button>
            ))}
          </div>
        )}

        <div className="song-hits">
          {result && result.hits.length === 0 && <p className="hintline muted">결과가 없습니다.</p>}
          {result?.hits.map((hit) => (
            <button
              key={hit.id}
              type="button"
              className={`song-hit${song?.id === hit.id ? ' current' : ''}`}
              onClick={() => void openSong(hit.id)}
            >
              <span className="num">{entryLabel(hit) || '—'}</span>
              <span className="body">
                <span className="title">
                  {hit.title}
                  {hit.confirmed && (
                    <span className="confirm-tag" title="줄나눔을 확인한 곡 — 자동 갱신이 건드리지 않습니다">
                      승인
                    </span>
                  )}
                </span>
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
              {song.confirmed && (
                <span className="confirm-tag" title="줄나눔을 확인한 곡 — 자동 갱신이 건드리지 않습니다">
                  승인
                </span>
              )}
            </h2>

            {song.links && song.links.length > 0 && (
              <p className="hintline muted">
                대응곡:{' '}
                {song.links.map((link, index) => (
                  <span key={link.id}>
                    {index > 0 && ', '}
                    <button
                      type="button"
                      className="link-inline"
                      onClick={() => void openSong(link.id)}
                      title="가사가 다른 판본입니다"
                    >
                      {entryLabel(link) || link.title}
                    </button>
                  </span>
                ))}
                {' '}(가사가 다릅니다)
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
                  {SELECTABLE_LANGS.map((lang) => {
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
                격자를 **먼저** 둔다. 여러 언어를 다룰 때 실제로 하는 일은
                '줄이 맞는지 보고 고치기' 이고, 원문 텍스트는 대량으로 붙여 넣을 때만
                필요하다. 자주 쓰는 것을 위에 둔다.
              */}
              {(() => {
                // DB 는 알파벳 순으로 준다 (['en','ko','zh']). 기준 언어를 앞으로 돌린다 —
                // 진하게 그리는 줄이 맨 위여야 무엇에 맞추는지 보인다
                const songLangs = orderLangs(song.langs.length > 0 ? song.langs : ['ko']);
                const shown = orderLangs(gridLangs ?? songLangs);
                return (
                  <>
                    <div className="row detail-controls">
                      <label title="격자에 보일 언어입니다. 송출 언어와는 따로입니다">
                        편집할 언어
                      </label>
                      <span className="candidates">
                        {SELECTABLE_LANGS.map((lang) => {
                          const on = shown.includes(lang);
                          const has = song.langs.includes(lang);
                          return (
                            <button
                              key={lang}
                              type="button"
                              className={on ? 'primary' : undefined}
                              onClick={() =>
                                setGridLangs(
                                  on
                                    ? shown.filter((l) => l !== lang)
                                    : [...shown, lang],
                                )
                              }
                              title={has ? '' : '아직 이 언어 가사가 없습니다 — 켜면 넣을 자리가 생깁니다'}
                            >
                              {LANG_LABELS[lang] ?? lang}
                              {!has && ' +'}
                            </button>
                          );
                        })}
                      </span>
                    </div>

                    <LyricsGrid
                      text={draftLyrics}
                      langs={shown.length > 0 ? shown : ['ko']}
                      onChange={setDraftLyrics}
                    />
                  </>
                );
              })()}

              <details className="detail-block">
                <summary>원문으로 편집 (대량 붙여 넣기)</summary>
                <p className="hintline muted">
                  <code>[1절]</code> 로 섹션을 나눕니다. <code>|</code> 로 시작하는 줄은 직전 줄의
                  번역이고, <code>|zh</code> 처럼 언어를 붙일 수 있습니다 (없으면 영어).
                  줄바꿈이 그대로 화면 줄이 됩니다.
                </p>
                <textarea
                  className="lyrics-editor"
                  value={draftLyrics}
                  onChange={(e) => setDraftLyrics(e.target.value)}
                  spellCheck={false}
                  rows={14}
                  aria-label="가사"
                />
              </details>
              {/*
                영어 붙여 넣기 — 손으로 `|` 를 끼우지 않게 한다.
                4절 × 4줄이면 16번을 정확히 맞춰야 하고, 한 줄만 밀려도 어느 영어가 어느
                한국어의 번역인지 어긋난 채 저장된다. 화면에서야 드러난다.
                **저장하지 않는다** — 위 편집 칸을 채워 주고 사람이 보고 누른다.
              */}
              <details className="detail-block">
                <summary>번역 붙여 넣기</summary>
                <p className="hintline muted">
                  고른 언어만 절 순서대로 붙여 넣으세요. 절 사이는 빈 줄로 나눕니다
                  (<code>[2절]</code> 처럼 라벨을 붙이면 그 절에 들어갑니다).
                  한국어와 <b>다른 언어는 건드리지 않습니다.</b>
                </p>

                {/*
                  대상 언어를 고르게 한다. 전에는 늘 영어로 넣어서, 中文 을 붙이면
                  English 가 사라졌다 (실측 확인한 데이터 손실).
                */}
                <div className="row detail-controls">
                  <label>넣을 언어</label>
                  <span className="candidates">
                    {SELECTABLE_LANGS.filter((lang) => lang !== 'ko').map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        className={pasteLang === lang ? 'primary' : undefined}
                        onClick={() => setPasteLang(lang)}
                      >
                        {LANG_LABELS[lang] ?? lang}
                      </button>
                    ))}
                  </span>
                </div>
                <textarea
                  className="lyrics-editor"
                  value={englishPaste}
                  onChange={(e) => setEnglishPaste(e.target.value)}
                  spellCheck={false}
                  rows={10}
                  aria-label="번역 가사"
                  placeholder={'1절 첫 줄\n1절 둘째 줄\n\n2절 첫 줄\n2절 둘째 줄'}
                />
                <div className="row" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const merged = mergeSecondaryLyrics(draftLyrics, englishPaste, pasteLang);
                      setDraftLyrics(merged.text);
                      setMergeReport(merged);
                    }}
                    disabled={englishPaste.trim().length === 0}
                    title="위 편집 칸에 짝지어 채웁니다. 저장은 따로 누르세요."
                  >
                    짝 맞춰 채우기
                  </button>
                  <button type="button" onClick={() => { setEnglishPaste(''); setMergeReport(null); }}>
                    비우기
                  </button>
                </div>

                {mergeReport && (
                  <div className="merge-report">
                    <p className="hintline">
                      {mergeReport.paired}줄을 짝지었습니다
                      {mergeReport.replaced > 0 &&
                        ` (있던 ${LANG_LABELS[pasteLang] ?? pasteLang} ${mergeReport.replaced}줄은 갈아 끼웠습니다)`}
                      . 위 칸을 확인하고 <b>가사 저장</b>을 누르세요.
                    </p>
                    {mergeReport.problems.map((problem) => (
                      <p key={problem} className="hintline warn">⚠ {problem}</p>
                    ))}
                  </div>
                )}
              </details>

              <div className="row" style={{ marginTop: 10 }}>
                <button type="button" className="primary" onClick={() => void saveLyrics()} disabled={busy}>
                  가사 저장
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftLyrics(formatLyrics(song.sections));
                    setMergeReport(null);
                  }}
                >
                  되돌리기
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {deck && deck.slides.length > 0 && (
        <div className="card">
          <h2>슬라이드 — {deck.reference}</h2>
          <div className="slides">
            {deck.slides.map((slide, index) => (
              <button
                key={index}
                type="button"
                className={`slide-item${index === currentIndex ? ' current' : ''}`}
                onClick={() => send({ t: 'goto', index })}
                disabled={!connected}
              >
                <span className="label">
                  {index === currentIndex ? '▶ ' : ''}
                  {deck.labels[index] || index + 1}
                </span>
                <span className="text">
                  {slide.kind === 'song'
                    ? slide.lines.map((group, gi) => (
                        <span key={gi} style={{ display: 'block' }}>
                          {group.map((line, li) => (
                            <span key={li} className={li === 0 ? undefined : 'secondary'} style={{ display: 'block' }}>
                              {/* 몇 절인지 첫 줄 앞에 붙인다 (후렴처럼 번호가 없으면 붙지 않는다) */}
                              {gi === 0 && li === 0 && isSectionStart(slide, deck.slides[index - 1])
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
      )}
        </div>
      </div>
    </>
  );
}

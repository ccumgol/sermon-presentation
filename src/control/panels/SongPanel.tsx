import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  LANG_LABELS, MAX_LANGS, langChoices, orderLangs, toggleLang as nextLangs,
} from '../../../lib/lang-select.ts';
import { OutputStyleBar, type OutputStyle } from '../components/OutputStyleBar.tsx';
import { LyricsTwoPane } from '../components/LyricsTwoPane.tsx';

import type {
  ClientMsg, Deck, LangCode, Song, Songbook, SongSearchHit, SongSearchResult, Template,
} from '../../../shared/types.ts';
import { buildSongDeck, isSectionStart, verseNumberPrefix } from '../../../lib/song-slides.ts';
import { formatLyrics, parseLyrics } from '../../../lib/lyrics-parser.ts';
import { api, ApiError } from '../api.ts';
import { isComposing } from '../ime.ts';
import { SongbookBar } from '../components/SongbookBar.tsx';
import { SongbookManager } from './SongbookManager.tsx';

/** 즐겨찾기 칸 수 — 한 줄에 들어가고 손이 기억할 수 있는 개수 */
const FAVORITE_SLOTS = 5;

/**
 * '최근' 에 보여 줄 곡 수.
 *
 * 즐겨찾기(5)보다 하나 많다 — 한 예배에서 4~5곡을 부르므로 5칸이면 이번 주로 꽉 차
 * **지난주가 하나도 안 보인다.**
 *
 * 8칸도 재 봤는데 칩 줄이 129px(세 줄)이 됐다. 곡집 칸은 폭이 596px 로 고정이라
 * (창을 넓혀도 늘지 않는다) 줄 수가 줄지 않고, 그만큼 아래 검색 결과가 밀린다.
 * 6칸이면 두 줄이다 — 더 거슬러 갈 일은 검색이 맡는다.
 */
const RECENT_SLOTS = 6;

/** 빠른 칩 줄이 무엇을 보여 주는가 */
type QuickMode = 'favorite' | 'recent';

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
  /**
   * 즐겨찾기를 기본으로 둔다. 송영·봉헌송처럼 **늘 같은 자리에 있어야 손이 기억하는**
   * 곡이 여기 있고, '최근' 은 목록이 매주 흔들린다.
   */
  const [quickMode, setQuickMode] = useState<QuickMode>('favorite');
  /**
   * 대응곡을 붙이는 중이면 검색어. `null` 이면 닫혀 있다.
   *
   * 목록을 늘 펼쳐 두지 않는 이유: 대응곡은 자료를 반입할 때 한 번 정해지고 그 뒤로는
   * 좀처럼 손대지 않는다. 늘 보이면 매번 지나쳐야 하는 줄이 하나 는다.
   */
  const [linking, setLinking] = useState<string | null>(null);
  const [linkHits, setLinkHits] = useState<SongSearchHit[]>([]);
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
  /** '＋ 새 곡' 칸이 열려 있나. 열려 있으면 제목을 받는다 */
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [draftLyrics, setDraftLyrics] = useState('');

  /**
   * **편집 중인 곡의 슬라이드를 미리 본다.**
   *
   * 아래 슬라이드 칸은 지금 송출 중인 곡을 보여 준다. 그래서 다른 곡을 편집하는 동안
   * 엉뚱한 곡이 남아 있었다 (2026-08-29 사용자). 편집 중에는 **고치고 있는 곡**을 보여야
   * 줄나눔이 화면에서 어떻게 되는지 알 수 있다.
   *
   * **저장 전 원문으로 만든다.** `buildSongDeck` 은 서버가 쓰는 것과 같은 lib 함수라
   * 여기서 만든 것과 실제로 송출될 것이 같다. 그리고 **라이브 출력은 건드리지 않는다** —
   * 예배 중에 가사를 손보다가 화면이 바뀌면 안 된다.
   */
  const draftDeck = useMemo(() => {
    if (!editing || !song) return null;
    const sections = parseLyrics(draftLyrics).map((section, index) => ({
      ...section,
      id: -(index + 1),
      position: index,
      /*
       * 편집 중인 가사는 **사람이 치고 있는 줄**이다. 저장하면 `manual` 이 되므로
       * 미리보기도 같은 규칙으로 그려야 한다 — 여기서 빼면 미리보기에서는 줄이 묶여
       * 보이다가 저장한 뒤엔 안 묶이는(또는 그 반대) 어긋남이 생긴다.
       */
      linesSource: 'manual' as const,
    }));
    if (sections.length === 0) return null;
    /*
     * **원문에 있는 언어를 모두 보인다.** 표시 언어 설정을 따르면 방금 적은 번역이
     * 안 보인다 — 그 설정은 저장된 곡을 기준으로 하기 때문이다. 편집 중에 확인하고
     * 싶은 것은 '내가 적은 두 언어가 줄로 잘 맞았는가' 이므로 둘 다 보여야 한다.
     */
    const inDraft = orderLangs([...new Set(sections.flatMap((s) => s.lines.map((l) => l.lang)))]);
    const built = buildSongDeck(
      { ...song, sections, langs: inDraft },
      {
        langs: inDraft,
        linesPerSlide: lines === 'section' ? 'section' : (Number(lines) as 1 | 2 | 4),
        ...(maxChars === undefined ? {} : { maxCharsPerLine: maxChars }),
      },
    );
    return built.slides.length > 0 ? built : null;
  }, [editing, song, draftLyrics, lines, maxChars]);
  /**
   * 격자에 보일 언어. 곡이 가진 언어에 사람이 더 고른 것을 얹는다.
   *
   * 표시 언어(`langs`)와 따로 두는 이유: 표시 언어는 **송출할 것**이고 이것은
   * **편집할 것**이다. 中文 을 넣는 동안 화면에는 한/영만 내보내고 싶을 수 있다.
   */
  /** 이 탭에서 띄울 때 쓸 프리셋·폰트 — 고르지 않으면 지금 템플릿 그대로 */
  const [outputStyle, setOutputStyle] = useState<OutputStyle>({});
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
   * 검색 없이 바로 꺼내는 칩 줄.
   *
   * **즐겨찾기** — 송영·봉헌송처럼 매주 쓰는 곡. 최근 순으로 두면 목록이 매번 흔들려
   * 손이 기억하지 못하므로 사람이 지정한다. 아직 지정한 곡이 없으면 자주 쓴 곡을
   * 대신 보여 준다 — 빈 줄보다 쓸모 있다.
   *
   * **최근** — 방금 부른 곡과 지난주 곡. 서버가 덱을 만들 때마다 기록해 두는데
   * (`song_usage`) 그 기록을 꺼내 보는 길이 화면에 없었다 (§4.6 U-2, 2026-09-03).
   * '지난주에 뭐 불렀지' 와 '방금 띄운 곡 다시' 가 여기서 해결된다.
   */
  const loadQuickPicks = useCallback(async () => {
    try {
      if (quickMode === 'recent') {
        setQuickPicks(await api.recentSongs(RECENT_SLOTS));
        setQuickIsFallback(false);
        return;
      }
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
  }, [quickMode]);

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
    setLinking(null);
    try {
      const { song: loaded, availableLangs } = await api.song(id);
      setSong(loaded);
      setLangs(availableLangs.length > 0 ? availableLangs.slice(0, 1) : ['ko']);
      setDraftLyrics(formatLyrics(loaded.sections));
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

  /**
   * 새 곡을 만든다 — **곡집을 주지 않으므로 '기타' 에 들어간다.**
   *
   * 만든 뒤 곧바로 가사 편집을 연다. 제목만 있는 곡을 목록에 남겨 두면 '가사가 없는
   * 곡' 이 쌓이고, 무엇을 하려던 것인지 나중에 알 수 없다.
   */
  async function createSong(): Promise<void> {
    const title = newTitle.trim();
    if (title.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api.createSong(title);
      setCreating(false);
      setNewTitle('');
      setQuery('');
      setResult(null);
      await openSong(made.id);
      setEditing(true);
      setNotice(`'${made.title}' 을 기타 곡집에 만들었습니다. 가사를 넣으세요.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '만들지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /**
   * 곡을 지운다 — **되돌릴 수 없다.**
   *
   * `data/songs.sqlite` 는 git 에 없어 되돌릴 방법이 백업뿐이다. 그래서 제목을
   * 보여 주고 한 번 물어본다. 실수로 지우는 길을 열어 두지 않는다.
   */
  async function removeSong(): Promise<void> {
    if (!song) return;
    const ok = window.confirm(
      `'${song.title}' 을 지웁니다.\n\n가사와 함께 완전히 사라지고 되돌릴 수 없습니다.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteSong(song.id);
      setSong(null);
      setEditing(false);
      setResult(null);
      setQuery('');
      setNotice('곡을 지웠습니다.');
      void loadQuickPicks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /** 즐겨찾기에 넣거나 뺀다 — 목록은 곧바로 다시 읽는다 */
  // ── 대응곡 연결·해제 ────────────────────────────────────────

  // 붙일 곡 찾기 (디바운스). 자기 자신과 이미 붙은 곡은 목록에서 뺀다
  useEffect(() => {
    if (linking === null || linking.trim().length === 0 || !song) {
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
    if (!song) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.linkSong(song.id, linkedId);
      setSong(updated);
      setLinking(null);
      setLinkHits([]);
      setNotice(`대응곡을 연결했습니다`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '연결하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /** 되돌릴 수 있는 동작이라(다시 붙이면 된다) 확인을 받지 않는다 */
  async function unlinkSong(linkedId: number, label: string): Promise<void> {
    if (!song) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.unlinkSong(song.id, linkedId);
      setSong(updated);
      setNotice(`'${label}' 연결을 풀었습니다`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '풀지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

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
    /*
     * **빈 가사로 덮지 않는다.** 두 칸 중 한국어를 비우고 저장하면 그 곡의 가사가
     * 통째로 사라진다. `data/songs.sqlite` 는 git 에 없어 되돌릴 방법이 백업뿐이다.
     * 실수로 지우는 길을 열어 두지 않는다 — 정말 지우려면 곡 삭제를 쓴다.
     */
    if (draftLyrics.trim().length === 0) {
      setError('가사가 비어 있어 저장하지 않았습니다. 지우려면 곡을 삭제하세요.');
      return;
    }
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
                <span className="num">{entryLabel(hit) || '—'}</span>
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
                    onClick={() => void openSong(link.id)}
                    title="가사가 다른 판본입니다 — 눌러서 엽니다"
                  >
                    {entryLabel(link) || link.title}
                  </button>
                  <button
                    type="button"
                    className="del"
                    disabled={busy}
                    onClick={() => void unlinkSong(link.id, entryLabel(link) || link.title)}
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
                        {entryLabel(hit) ? `${entryLabel(hit)} ` : ''}
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

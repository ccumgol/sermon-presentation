/**
 * **찬양 탭에서 고르고 고치는 곡** — 지금 연 곡 · 표시 설정 · 가사 편집.
 *
 * `SongPanel` 에서 떼어냈다 (2026-09-08, PLAN-next 5번). 실측했더니 오른쪽 열
 * 블록이 컴포넌트 안 상태 **스물다섯**을 쓰고 있었다 — 그대로 컴포넌트로 빼면
 * 프롭 스물다섯짜리 껍데기가 된다. 곡 계열을 묶으면 **객체 하나**다.
 *
 * ## 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 빈 가사로 덮지 않는다 | 두 칸 중 한국어를 비우고 저장하면 그 곡 가사가 통째로 사라진다. `songs.sqlite` 는 git 에 없어 되돌릴 방법이 백업뿐이다 |
 * | 지우기 전에 제목을 보여 주고 묻는다 | 되돌릴 수 없다 |
 * | 곡을 바꾸면 악보 보기가 꺼진다 | 앞 곡에서 켠 것이 남으면 검토가 안 된 다음 곡 악보가 예고 없이 벽에 걸린다 |
 * | 악보 모양을 바꿔도 **다시 송출하지 않는다** | 지금 뜬 덱을 다시 보내면 첫 슬라이드로 튄다 — 3절 부르다 1절로 가는 것보다 다음 송출부터가 안전하다 |
 * | 표시 언어 규칙은 `lib/lang-select.ts` 하나만 쓴다 | 전에 이 탭만 자기 규칙을 갖고 있어 상한이 2 로 박혀 3언어를 못 골랐다 |
 */

import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from 'react';

import { LANG_LABELS, orderLangs, toggleLang as nextLangs } from '../../../lib/lang-select.ts';
import { formatLyrics, parseLyrics } from '../../../lib/lyrics-parser.ts';
import type { SheetSummary } from '../../../lib/sheet-attach.ts';
import { buildSongDeck } from '../../../lib/song-slides.ts';
import type { LangCode, Song } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import type { Feedback } from './useFeedback.ts';

export interface SongEditorDeps {
  feedback: Feedback;
  /** 목록을 비우거나 다시 읽는 길 — 곡을 만들거나 지우면 목록이 낡는다 */
  clearResult: () => void;
  setQuery: (value: string) => void;
  reloadQuickPicks: () => Promise<void>;
  /** 활성 템플릿의 표시 행 폭 — 저장된 운율 행을 이 폭에 맞춰 묶는다 */
  maxChars: number | undefined;
}

export interface SongEditor {
  song: Song | null;
  /** 수록·대응곡을 고치는 줄(`SongMetaRows`)이 곡을 갱신한다 */
  setSong: Dispatch<SetStateAction<Song | null>>;
  /** 이 곡의 악보 상태 — 곡을 여는 순간 받는다 */
  sheet: SheetSummary | undefined;
  /** 이 탭에서 띄울 때 프로젝터에 악보를 낼지. **기본은 가사** */
  useSheet: boolean;
  setUseSheet: (on: boolean) => void;

  langs: LangCode[];
  toggleLang: (lang: LangCode) => void;
  lines: string;
  setLines: (value: string) => void;

  editing: boolean;
  setEditing: Dispatch<SetStateAction<boolean>>;
  draftLyrics: string;
  setDraftLyrics: (value: string) => void;
  /** 편집 중인 가사로 만든 미리보기 덱 — 라이브 출력은 건드리지 않는다 */
  draftDeck: ReturnType<typeof buildSongDeck> | null;

  creating: boolean;
  setCreating: Dispatch<SetStateAction<boolean>>;
  newTitle: string;
  setNewTitle: (value: string) => void;

  /**
   * 곡을 연다. `startEditing` 을 주면 **가사 편집까지 펼친다** —
   * 예배 중 오타를 고치러 온 사람에게 한 박자를 덜어 준다 (2026-09-12).
   */
  openSong: (id: number, startEditing?: boolean) => Promise<void>;
  /** 열되 화면 설정은 이 곡에 맞춰 고친다 — 번호 즉시 송출이 쓴다 */
  openForSend: (id: number) => Promise<{ song: Song; langs: LangCode[] } | null>;
  createSong: () => Promise<void>;
  removeSong: () => Promise<void>;
  toggleFavorite: () => Promise<void>;
  saveLyrics: () => Promise<void>;
  chooseSheetLayout: (layout: 'shared' | 'sequential' | null) => Promise<void>;
}

export function useSongEditor(deps: SongEditorDeps): SongEditor {
  const { feedback, clearResult, setQuery, reloadQuickPicks, maxChars } = deps;
  const { setError, setNotice, setBusy } = feedback;

  const [song, setSong] = useState<Song | null>(null);
  const [sheet, setSheet] = useState<SheetSummary | undefined>(undefined);
  const [useSheet, setUseSheet] = useState(false);
  const [langs, setLangs] = useState<LangCode[]>(['ko']);
  const [lines, setLines] = useState('2');
  const [editing, setEditing] = useState(false);
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

  /** 곡을 받아 화면 상태를 그 곡에 맞춘다 (여는 두 길이 함께 쓴다) */
  const adopt = useCallback((loaded: Song, found: SheetSummary | undefined, nextLangs2: LangCode[]) => {
    setSong(loaded);
    setSheet(found);
    // 앞 곡에서 켜 둔 악보 보기가 남으면 안 된다
    setUseSheet(false);
    setLangs(nextLangs2);
    setDraftLyrics(formatLyrics(loaded.sections));
  }, []);

  /**
   * @param startEditing 열자마자 가사 편집을 펼칠지. 기본은 아니다.
   *
   * **실패하면 켜지 않는다** — 곡을 못 불러왔는데 편집 칸만 열리면 빈 칸에 쓰게 된다.
   */
  const openSong = useCallback(
    async (id: number, startEditing = false) => {
      setError(null);
      setNotice(null);
      setEditing(false);
      try {
        const { song: loaded, availableLangs, sheet: found } = await api.song(id);
        adopt(loaded, found, availableLangs.length > 0 ? availableLangs.slice(0, 1) : ['ko']);
        if (startEditing) setEditing(true);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '곡을 불러오지 못했습니다');
      }
    },
    [adopt, setError, setNotice],
  );

  /**
   * 번호 즉시 송출용 — 열면서 **이 곡이 가진 언어로 맞춘다.**
   * 없는 언어를 켠 채 보내면 화면이 빈다. 부르는 쪽이 그 언어로 덱을 만든다.
   */
  const openForSend = useCallback(
    async (id: number): Promise<{ song: Song; langs: LangCode[] } | null> => {
      const { song: loaded, availableLangs, sheet: found } = await api.song(id);
      const kept = langs.filter((lang) => loaded.langs.includes(lang));
      const useLangs = kept.length > 0 ? kept : availableLangs.slice(0, 1);
      adopt(loaded, found, useLangs);
      return { song: loaded, langs: useLangs };
    },
    [adopt, langs],
  );

  const createSong = useCallback(async () => {
    const title = newTitle.trim();
    if (title.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api.createSong(title);
      setCreating(false);
      setNewTitle('');
      setQuery('');
      clearResult();
      await openSong(made.id);
      setEditing(true);
      setNotice(`'${made.title}' 을 기타 곡집에 만들었습니다. 가사를 넣으세요.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '만들지 못했습니다');
    } finally {
      setBusy(false);
    }
  }, [newTitle, clearResult, openSong, setQuery, setBusy, setError, setNotice]);

  /**
   * 곡을 지운다 — **되돌릴 수 없다.**
   *
   * `data/songs.sqlite` 는 git 에 없어 되돌릴 방법이 백업뿐이다. 그래서 제목을
   * 보여 주고 한 번 물어본다. 실수로 지우는 길을 열어 두지 않는다.
   */
  const removeSong = useCallback(async () => {
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
      clearResult();
      setQuery('');
      setNotice('곡을 지웠습니다.');
      void reloadQuickPicks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '지우지 못했습니다');
    } finally {
      setBusy(false);
    }
  }, [song, clearResult, reloadQuickPicks, setQuery, setBusy, setError, setNotice]);

  /** 즐겨찾기에 넣거나 뺀다 — 목록은 곧바로 다시 읽는다 */
  const toggleFavorite = useCallback(async () => {
    if (!song) return;
    try {
      const result = await api.toggleFavorite(song.id, !song.isFavorite);
      setSong({ ...song, isFavorite: result.favorite });
      await reloadQuickPicks();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '즐겨찾기를 바꾸지 못했습니다');
    }
  }, [song, reloadQuickPicks, setError]);

  const saveLyrics = useCallback(async () => {
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
  }, [song, draftLyrics, setBusy, setError, setNotice]);

  /**
   * 악보 모양(겹쳐/이어)을 사람이 고른다. `null` 이면 자동 짐작으로 되돌린다.
   *
   * **송출을 다시 하지 않는다.** 지금 화면에 떠 있는 덱을 다시 보내면 첫 슬라이드로
   * 되돌아간다 — 예배 중에 3절을 부르다 1절로 튀는 것보다, 다음에 띄울 때 반영되는
   * 편이 안전하다. 그래서 안내 문구로 알린다.
   */
  const chooseSheetLayout = useCallback(
    async (layout: 'shared' | 'sequential' | null) => {
      if (!sheet || !song) return;
      setError(null);
      setNotice(null);
      try {
        await api.setSheetLayout(sheet.songbookId, sheet.number, layout);
        const { sheet: found } = await api.song(song.id);
        setSheet(found);
        setNotice(
          layout === null
            ? '악보 모양을 자동으로 되돌렸습니다 — 다음 송출부터 반영됩니다'
            : '악보 모양을 바꿨습니다 — 다음 송출부터 반영됩니다',
        );
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '악보 모양을 바꾸지 못했습니다');
      }
    },
    [sheet, song, setError, setNotice],
  );

  /**
   * 표시 언어 토글 — 규칙은 `lib/lang-select.ts` 에 있다.
   *
   * 전에는 이 파일이 같은 규칙을 자기 안에 또 갖고 있었다. 예배 순서 탭에 같은
   * 컨트롤을 만들면서 규칙을 공용 모듈로 뺐는데 이 탭만 남아 있었고, 상한이 2 로
   * 박혀 있어 3언어를 고를 수 없었다. 두 탭이 어긋나지 않게 한 곳만 쓴다.
   */
  const toggleLang = useCallback((lang: LangCode) => {
    setLangs((prev) => nextLangs(prev, lang));
  }, []);

  return {
    song, setSong, sheet, useSheet, setUseSheet,
    langs, toggleLang, lines, setLines,
    editing, setEditing, draftLyrics, setDraftLyrics, draftDeck,
    creating, setCreating, newTitle, setNewTitle,
    openSong, openForSend, createSong, removeSong, toggleFavorite, saveLyrics, chooseSheetLayout,
  };
}

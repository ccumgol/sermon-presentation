// @vitest-environment jsdom
/**
 * **찬양 탭에서 고르고 고치는 곡** (`src/control/hooks/useSongEditor.ts`).
 *
 * ## 왜 값이 있는가
 *
 * 여기가 **가사를 쓰는 길**이다. `data/songs.sqlite` 는 git 에 없어 되돌릴 방법이
 * 백업뿐이고, 실제로 한 번 지웠다 (CLAUDE.md). 그래서 이 훅에는 '실수로 지우지
 * 못하게 막는' 규칙이 여럿 있다 — 그것들을 여기서 못 박는다.
 *
 * | 규칙 | 없으면 |
 * |---|---|
 * | 빈 가사로 덮지 않는다 | 한국어 칸을 비우고 저장하면 그 곡 가사가 통째로 사라진다 |
 * | 지우기 전에 묻는다 | 되돌릴 수 없다 |
 * | 곡을 바꾸면 악보 보기가 꺼진다 | 검토 안 된 다음 곡 악보가 예고 없이 벽에 걸린다 |
 * | 악보 모양을 바꿔도 다시 송출하지 않는다 | 3절 부르다 1절로 튄다 |
 *
 * ## 틀(harness)
 *
 * `api` 를 바꿔 끼운다 (import 보다 먼저 — `plan-storage.test.tsx` 와 같은 틀).
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Song } from '../../shared/types.ts';

// ── api 를 바꿔 끼운다 (import 보다 먼저) ────────────────────
const song = vi.fn();
const createSongApi = vi.fn();
const deleteSong = vi.fn();
const toggleFavoriteApi = vi.fn();
const saveLyricsApi = vi.fn();
const setSheetLayout = vi.fn();

class FakeApiError extends Error {}

vi.mock('../../src/control/api.ts', () => ({
  api: {
    song: (...a: unknown[]) => song(...a),
    createSong: (...a: unknown[]) => createSongApi(...a),
    deleteSong: (...a: unknown[]) => deleteSong(...a),
    toggleFavorite: (...a: unknown[]) => toggleFavoriteApi(...a),
    saveLyrics: (...a: unknown[]) => saveLyricsApi(...a),
    setSheetLayout: (...a: unknown[]) => setSheetLayout(...a),
  },
  ApiError: FakeApiError,
}));

const { useSongEditor } = await import('../../src/control/hooks/useSongEditor.ts');

const SONG = {
  id: 7,
  title: '주께와 엎드려',
  langs: ['ko', 'en'],
  isFavorite: false,
  entries: [],
  sections: [
    { id: 1, kind: 'verse', label: '1절', position: 0, lines: [{ lineIndex: 0, lang: 'ko', text: '가사 한 줄' }] },
  ],
} as unknown as Song;

const SHEET = { songbookId: 'chanmi2000', number: 7, systemCount: 4, layout: 'shared', chosen: false } as never;

const deps = {
  clearResult: vi.fn(),
  setQuery: vi.fn(),
  reloadQuickPicks: vi.fn(async () => undefined),
};

/** 배너 셋을 진짜처럼 쌓아 둔다 — 무엇이 사람에게 보이는지 봐야 한다 */
function makeFeedback() {
  const state = { busy: false, error: null as string | null, notice: null as string | null };
  return {
    ...state,
    setBusy: (v: boolean) => { state.busy = v; },
    setError: (v: string | null) => { state.error = v; },
    setNotice: (v: string | null) => { state.notice = v; },
    read: () => ({ ...state }),
  };
}

let feedback: ReturnType<typeof makeFeedback>;

function setup(maxChars?: number) {
  feedback = makeFeedback();
  return renderHook(() =>
    useSongEditor({
      feedback: feedback as never,
      clearResult: deps.clearResult,
      setQuery: deps.setQuery,
      reloadQuickPicks: deps.reloadQuickPicks,
      maxChars,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  song.mockResolvedValue({ song: SONG, availableLangs: ['ko', 'en'], sheet: SHEET });
});

// ─────────────────────────────────────────────────────────────
describe('곡 열기', () => {
  it('곡·악보·가사를 함께 받는다', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });

    expect(result.current.song?.title).toBe('주께와 엎드려');
    expect(result.current.sheet).toBe(SHEET);
    expect(result.current.draftLyrics).toContain('가사 한 줄');
  });

  /** 앞 곡에서 켜 둔 것이 남으면 **검토 안 된 다음 곡 악보**가 예고 없이 벽에 걸린다 */
  it('곡을 바꾸면 악보 보기가 꺼진다', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    act(() => { result.current.setUseSheet(true); });
    expect(result.current.useSheet).toBe(true);

    await act(async () => { await result.current.openSong(8); });
    expect(result.current.useSheet).toBe(false);
  });

  it('여는 순간 편집 상태를 닫는다', async () => {
    const { result } = setup();
    act(() => { result.current.setEditing(true); });
    await act(async () => { await result.current.openSong(7); });
    expect(result.current.editing).toBe(false);
  });

  it('첫 언어 하나만 켠다 — 없는 언어를 켜 두면 화면이 빈다', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    expect(result.current.langs).toEqual(['ko']);
  });

  it('실패하면 배너로 알린다 (조용히 넘기지 않는다)', async () => {
    song.mockRejectedValueOnce(new FakeApiError('서버가 죽었다'));
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });

    expect(feedback.read().error).toBe('서버가 죽었다');
  });
});

// ─────────────────────────────────────────────────────────────
/**
 * 번호 즉시 송출은 열면서 **그 곡이 가진 언어로** 맞춰야 한다 —
 * 없는 언어를 켠 채 보내면 화면이 빈다.
 */
describe('번호 즉시 송출용 열기', () => {
  it('지금 켠 언어 중 그 곡에 있는 것만 남긴다', async () => {
    song.mockResolvedValue({
      song: { ...SONG, langs: ['ko'] },
      availableLangs: ['ko'],
      sheet: undefined,
    });
    const { result } = setup();
    act(() => { result.current.toggleLang('en'); });
    expect(result.current.langs).toEqual(['ko', 'en']);

    let opened: { langs: string[] } | null = null;
    await act(async () => { opened = (await result.current.openForSend(7)) as never; });

    expect(opened!.langs).toEqual(['ko']);
    expect(result.current.langs).toEqual(['ko']);
  });

  /** 하나도 안 남으면 그 곡이 가진 첫 언어로 — 빈 배열로 보내면 화면이 빈다 */
  it('남는 것이 없으면 그 곡의 첫 언어를 쓴다', async () => {
    song.mockResolvedValue({ song: { ...SONG, langs: ['en'] }, availableLangs: ['en'], sheet: undefined });
    const { result } = setup();

    let opened: { langs: string[] } | null = null;
    await act(async () => { opened = (await result.current.openForSend(7)) as never; });
    expect(opened!.langs).toEqual(['en']);
  });
});

// ─────────────────────────────────────────────────────────────
describe('가사 저장 — 되돌릴 수 없는 길', () => {
  /**
   * **이것이 이 파일에서 가장 값비싼 검사다.** 두 칸 중 한국어를 비우고 저장하면
   * 그 곡의 가사가 통째로 사라진다. 되돌릴 방법은 백업뿐이다.
   */
  it('빈 가사로 덮지 않는다 — 서버를 부르지도 않는다', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    act(() => { result.current.setDraftLyrics('   \n  \n'); });

    await act(async () => { await result.current.saveLyrics(); });

    expect(saveLyricsApi).not.toHaveBeenCalled();
    expect(feedback.read().error).toContain('가사가 비어 있어 저장하지 않았습니다');
  });

  it('내용이 있으면 저장하고 편집을 닫는다', async () => {
    saveLyricsApi.mockResolvedValue({ song: SONG, availableLangs: ['ko', 'en'] });
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    act(() => { result.current.setEditing(true); result.current.setDraftLyrics('[1절]\n새 가사'); });

    await act(async () => { await result.current.saveLyrics(); });

    expect(saveLyricsApi).toHaveBeenCalledWith(7, '[1절]\n새 가사');
    expect(result.current.editing).toBe(false);
    expect(feedback.read().notice).toContain('가사를 저장했습니다');
  });

  it('곡을 안 열었으면 아무 일도 하지 않는다', async () => {
    const { result } = setup();
    await act(async () => { await result.current.saveLyrics(); });
    expect(saveLyricsApi).not.toHaveBeenCalled();
  });

  it('실패하면 알린다', async () => {
    saveLyricsApi.mockRejectedValue(new FakeApiError('디스크가 꽉 찼다'));
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    act(() => { result.current.setDraftLyrics('가사'); });
    await act(async () => { await result.current.saveLyrics(); });

    expect(feedback.read().error).toBe('디스크가 꽉 찼다');
  });
});

// ─────────────────────────────────────────────────────────────
describe('곡 지우기 — 되돌릴 수 없다', () => {
  /** 실수로 지우는 길을 열어 두지 않는다 */
  it('묻고, 아니라고 하면 지우지 않는다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    await act(async () => { await result.current.removeSong(); });

    expect(deleteSong).not.toHaveBeenCalled();
  });

  it('물어본 문구에 곡 제목이 들어간다', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    await act(async () => { await result.current.removeSong(); });

    expect(confirmSpy.mock.calls[0]![0]).toContain('주께와 엎드려');
    expect(confirmSpy.mock.calls[0]![0]).toContain('되돌릴 수 없습니다');
  });

  it('예라고 하면 지우고 목록을 비운다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteSong.mockResolvedValue(undefined);
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    await act(async () => { await result.current.removeSong(); });

    expect(deleteSong).toHaveBeenCalledWith(7);
    expect(result.current.song).toBeNull();
    // 없는 곡이 목록에 남으면 안 된다
    expect(deps.clearResult).toHaveBeenCalled();
    expect(deps.reloadQuickPicks).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
describe('곡 만들기', () => {
  it('빈 제목은 만들지 않는다', async () => {
    const { result } = setup();
    act(() => { result.current.setNewTitle('   '); });
    await act(async () => { await result.current.createSong(); });
    expect(createSongApi).not.toHaveBeenCalled();
  });

  /** 만들고 나면 곧바로 가사를 넣을 수 있어야 한다 — 제목만 있는 곡은 쓸모가 없다 */
  it('만들면 그 곡을 열고 편집을 켠다', async () => {
    createSongApi.mockResolvedValue({ id: 9, title: '새 곡' });
    const { result } = setup();
    act(() => { result.current.setNewTitle('  새 곡  '); });
    await act(async () => { await result.current.createSong(); });

    expect(createSongApi).toHaveBeenCalledWith('새 곡');
    expect(result.current.editing).toBe(true);
    expect(result.current.creating).toBe(false);
    expect(feedback.read().notice).toContain('가사를 넣으세요');
  });
});

// ─────────────────────────────────────────────────────────────
describe('즐겨찾기', () => {
  it('뒤집고 목록을 다시 읽는다', async () => {
    toggleFavoriteApi.mockResolvedValue({ favorite: true });
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    await act(async () => { await result.current.toggleFavorite(); });

    expect(toggleFavoriteApi).toHaveBeenCalledWith(7, true);
    expect(result.current.song?.isFavorite).toBe(true);
    expect(deps.reloadQuickPicks).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
/**
 * **송출을 다시 하지 않는다.** 지금 뜬 덱을 다시 보내면 첫 슬라이드로 되돌아간다 —
 * 예배 중 3절을 부르다 1절로 튀는 것보다 다음 송출부터 반영되는 편이 안전하다.
 */
describe('악보 모양 고르기', () => {
  it('고르면 저장하고 다음 송출부터라고 알린다', async () => {
    setSheetLayout.mockResolvedValue(undefined);
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    await act(async () => { await result.current.chooseSheetLayout('sequential'); });

    expect(setSheetLayout).toHaveBeenCalledWith('chanmi2000', 7, 'sequential');
    expect(feedback.read().notice).toContain('다음 송출부터');
  });

  it('null 이면 자동으로 되돌렸다고 알린다', async () => {
    setSheetLayout.mockResolvedValue(undefined);
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    await act(async () => { await result.current.chooseSheetLayout(null); });

    expect(feedback.read().notice).toContain('자동으로 되돌렸습니다');
  });

  it('악보가 없는 곡이면 아무 일도 하지 않는다', async () => {
    song.mockResolvedValue({ song: SONG, availableLangs: ['ko'], sheet: undefined });
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    await act(async () => { await result.current.chooseSheetLayout('shared'); });

    expect(setSheetLayout).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────
/**
 * 편집 중에는 **고치고 있는 곡**을 보여야 줄나눔이 화면에서 어떻게 되는지 안다.
 * 아래 슬라이드 칸은 송출 중인 곡을 보여 주므로, 그것만 있으면 다른 곡을 편집하는
 * 동안 엉뚱한 곡이 남는다 (2026-08-29 사용자).
 */
describe('편집 중 미리보기', () => {
  it('편집 중이 아니면 없다', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    expect(result.current.draftDeck).toBeNull();
  });

  it('편집 중이면 지금 치고 있는 가사로 만든다', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    act(() => {
      result.current.setEditing(true);
      result.current.setDraftLyrics('[1절]\n첫째 줄\n둘째 줄');
    });

    await waitFor(() => expect(result.current.draftDeck).not.toBeNull());
    expect(result.current.draftDeck!.slides.length).toBeGreaterThan(0);
  });

  it('가사가 비면 미리보기도 없다', async () => {
    const { result } = setup();
    await act(async () => { await result.current.openSong(7); });
    act(() => { result.current.setEditing(true); result.current.setDraftLyrics(''); });
    expect(result.current.draftDeck).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('표시 언어', () => {
  it('켜고 끈다', () => {
    const { result } = setup();
    act(() => { result.current.toggleLang('en'); });
    expect(result.current.langs).toEqual(['ko', 'en']);

    act(() => { result.current.toggleLang('en'); });
    expect(result.current.langs).toEqual(['ko']);
  });
});

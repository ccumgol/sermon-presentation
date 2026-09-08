// @vitest-environment jsdom
/**
 * **찬양 탭의 곡 찾기** (`src/control/hooks/useSongSearch.ts`).
 *
 * ## 왜 값이 있는가
 *
 * 예배 중 곡이 갑자기 바뀔 때 손이 가장 먼저 닿는 곳이다. 여기서 지키는 것:
 *
 * | | 없으면 |
 * |---|---|
 * | 디바운스 | 글자마다 서버를 찔러 예배 중 로그와 CPU 를 낭비한다 |
 * | `refresh()` | 수록 정보를 고쳐도 목록이 옛 번호를 들고 있어 **안 먹은 것처럼** 보인다 |
 * | `clearResult()` | 곡을 지운 직후 **없는 곡이 목록에 남는다** (refresh 는 200ms 뒤다) |
 * | 즐겨찾기가 비면 자주 쓴 곡으로 | 빈 줄만 보이면 고장으로 보인다 |
 * | `onError` 를 ref 로 붙잡기 | 화살표 함수를 넘기면 **검색이 무한히 다시 돈다** |
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const songbooksApi = vi.fn();
const songsApi = vi.fn();
const favoritesApi = vi.fn();
const frequentApi = vi.fn();
const recentApi = vi.fn();

class FakeApiError extends Error {}

vi.mock('../../src/control/api.ts', () => ({
  api: {
    songbooks: (...a: unknown[]) => songbooksApi(...a),
    songs: (...a: unknown[]) => songsApi(...a),
    favorites: (...a: unknown[]) => favoritesApi(...a),
    frequentSongs: (...a: unknown[]) => frequentApi(...a),
    recentSongs: (...a: unknown[]) => recentApi(...a),
  },
  ApiError: FakeApiError,
}));

const { DEBOUNCE_MS, FAVORITE_SLOTS, RECENT_SLOTS, useSongSearch } = await import(
  '../../src/control/hooks/useSongSearch.ts'
);

const hit = (id: number, title: string) => ({ id, title, entries: [] });
const onError = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  songbooksApi.mockResolvedValue([{ id: 'hymn_new', name: '새찬송가' }]);
  songsApi.mockResolvedValue({ hits: [hit(1, '은혜')], total: 1, truncated: false });
  favoritesApi.mockResolvedValue([hit(2, '즐겨찾는 곡')]);
  frequentApi.mockResolvedValue([hit(3, '자주 쓴 곡')]);
  recentApi.mockResolvedValue([hit(4, '최근 곡')]);
});

const setup = () => renderHook(() => useSongSearch(onError));

// ─────────────────────────────────────────────────────────────
describe('처음 뜰 때', () => {
  it('곡집과 빠른 칩 줄을 읽는다', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.songbooks).toHaveLength(1));
    await waitFor(() => expect(result.current.quickPicks).toHaveLength(1));
    expect(favoritesApi).toHaveBeenCalledWith(FAVORITE_SLOTS);
  });

  it('곡집을 못 읽으면 알린다', async () => {
    songbooksApi.mockRejectedValueOnce(new FakeApiError('곡집 서버가 죽었다'));
    setup();
    await waitFor(() => expect(onError).toHaveBeenCalledWith('곡집 서버가 죽었다'));
  });
});

// ─────────────────────────────────────────────────────────────
describe('검색', () => {
  /**
   * **가짜 시계로 잰다.** 진짜 시계로는 '아직 안 갔다' 를 증명할 수 없다 —
   * 디바운스를 0 으로 바꿔도 검사가 통과했다(변이 검증에서 실제로 그랬다).
   */
  it(`${DEBOUNCE_MS}ms 전에는 찌르지 않고, 마지막 글자로 한 번만 간다`, async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useSongSearch(onError));
      await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10); });
      songsApi.mockClear();

      act(() => { result.current.setQuery('은'); });
      act(() => { result.current.setQuery('은혜'); });

      // 글자마다 찌르면 예배 중 로그와 CPU 를 낭비한다
      await act(async () => { await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1); });
      expect(songsApi).not.toHaveBeenCalled();

      await act(async () => { await vi.advanceTimersByTimeAsync(2); });
      expect(songsApi).toHaveBeenCalledTimes(1);
      expect(songsApi).toHaveBeenCalledWith('은혜', 60, null);
    } finally {
      vi.useRealTimers();
    }
  });

  it('곡집을 고르면 그 범위로 좁힌다', async () => {
    const { result } = setup();
    await waitFor(() => expect(songsApi).toHaveBeenCalled());
    songsApi.mockClear();

    act(() => { result.current.setSelectedBook('hymn_new'); });
    await waitFor(() => expect(songsApi).toHaveBeenCalledWith('', 60, 'hymn_new'));
  });

  it('결과가 담긴다', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.result?.hits).toHaveLength(1));
  });

  it('검색 실패를 알린다 — 조용히 넘기지 않는다', async () => {
    songsApi.mockRejectedValue(new FakeApiError('찾지 못했다'));
    setup();
    await waitFor(() => expect(onError).toHaveBeenCalledWith('찾지 못했다'));
  });

  /** 수록 정보를 고치면 목록의 번호(`새305`)가 달라진다 */
  it('refresh() 로 다시 찾는다', async () => {
    const { result } = setup();
    await waitFor(() => expect(songsApi).toHaveBeenCalled());
    songsApi.mockClear();

    act(() => { result.current.refresh(); });
    await waitFor(() => expect(songsApi).toHaveBeenCalledTimes(1));
  });

  /** refresh 는 200ms 뒤라 그 사이 **없는 곡이 목록에 남는다** */
  it('clearResult() 는 지금 비운다', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.result).not.toBeNull());

    act(() => { result.current.clearResult(); });
    expect(result.current.result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('빠른 칩 줄', () => {
  it('기본은 즐겨찾기다 — 손이 기억하는 자리여야 한다', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.quickPicks[0]?.title).toBe('즐겨찾는 곡'));
    expect(result.current.quickMode).toBe('favorite');
    expect(result.current.quickIsFallback).toBe(false);
  });

  /** 빈 줄만 보이면 고장으로 보인다 */
  it('즐겨찾기가 비면 자주 쓴 곡으로 채우고 그렇다고 표시한다', async () => {
    favoritesApi.mockResolvedValue([]);
    const { result } = setup();

    await waitFor(() => expect(result.current.quickPicks[0]?.title).toBe('자주 쓴 곡'));
    expect(result.current.quickIsFallback).toBe(true);
  });

  it('최근으로 바꾸면 최근 곡을 읽는다', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.quickPicks).toHaveLength(1));

    act(() => { result.current.setQuickMode('recent'); });
    await waitFor(() => expect(result.current.quickPicks[0]?.title).toBe('최근 곡'));
    expect(recentApi).toHaveBeenCalledWith(RECENT_SLOTS);
    expect(result.current.quickIsFallback).toBe(false);
  });

  /** 편의 기능이므로 실패해도 화면을 막지 않는다 */
  it('실패해도 조용히 넘어간다', async () => {
    favoritesApi.mockRejectedValue(new FakeApiError('죽었다'));
    const { result } = setup();
    await waitFor(() => expect(result.current.songbooks).toHaveLength(1));

    expect(onError).not.toHaveBeenCalledWith('죽었다');
    expect(result.current.quickPicks).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
/**
 * 부르는 쪽이 화살표 함수를 넘기면 매 렌더 바뀐다. 그것을 의존성에 넣으면
 * **검색이 무한히 다시 돈다** — ref 로 붙잡아 막는다.
 */
describe('onError 가 매번 바뀌어도', () => {
  it('검색이 다시 돌지 않는다', async () => {
    const { rerender } = renderHook(({ fn }) => useSongSearch(fn), {
      initialProps: { fn: () => undefined },
    });
    // 처음 뜰 때의 검색이 가라앉기를 기다린 뒤에 센다
    await waitFor(() => expect(songsApi).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 300));
    const settled = songsApi.mock.calls.length;

    for (let i = 0; i < 5; i++) rerender({ fn: () => undefined });
    await new Promise((r) => setTimeout(r, 400));

    expect(songsApi.mock.calls.length).toBe(settled);
  });
});

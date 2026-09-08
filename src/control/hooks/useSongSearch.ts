/**
 * **찬양 탭의 곡 찾기** — 곡집 목록 · 검색 · 빠른 칩 줄.
 *
 * `SongPanel` 에서 떼어냈다 (2026-09-08, PLAN-next 5번). 자르기 전에 실측했더니
 * 왼쪽 열 블록이 컴포넌트 안 상태 **스물넷**을 쓰고 있었다 — 그대로 컴포넌트로
 * 빼면 프롭 스물넷짜리 껍데기가 된다(R-4 가 전에 멈춘 자리다). 검색 계열을
 * 하나로 묶으면 **객체 하나**다.
 *
 * ## 여기 모인 것과 그 이유
 *
 * | | |
 * |---|---|
 * | 곡집 목록·고른 곡집 | 검색 범위를 정한다 — 검색과 한 덩이다 |
 * | 검색어·결과·디바운스 | |
 * | `refresh()` | 수록 정보를 고치면 목록의 번호(`새305`)가 달라진다. 다시 찾지 않으면 왼쪽만 옛 번호를 들고 있어 **방금 고친 것이 안 먹은 것처럼** 보인다 |
 * | 빠른 칩 줄(즐겨찾기·최근) | 검색 없이 꺼내는 길 — 같은 목록 자리를 쓴다 |
 * | 곡집 관리 열림 | 곡집을 고치면 목록을 다시 읽어야 한다 |
 *
 * ## 오류는 밖에서 받는다
 *
 * 배너는 `useFeedback` 이 갖는다. 이 훅이 자기 배너를 또 만들면 화면에 오류 줄이
 * 둘이 된다 — `onError` 로 넘긴다.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { api, ApiError } from '../api.ts';
import type { Songbook, SongSearchHit, SongSearchResult } from '../../../shared/types.ts';

/** 즐겨찾기 칸 수 — 한 줄에 들어가고 손이 기억할 수 있는 개수 */
export const FAVORITE_SLOTS = 5;

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
export const RECENT_SLOTS = 6;

/** 빠른 칩 줄이 무엇을 보여 주는가 */
export type QuickMode = 'favorite' | 'recent';

/** 검색어를 친 뒤 서버를 찌르기까지 기다리는 시간 */
const DEBOUNCE_MS = 200;

export interface SongSearch {
  songbooks: Songbook[];
  reloadSongbooks: () => Promise<void>;
  /** 곡집 관리 칸이 열려 있나 */
  managing: boolean;
  setManaging: (open: boolean) => void;

  selectedBook: string | null;
  setSelectedBook: (id: string | null) => void;
  query: string;
  setQuery: (value: string) => void;
  result: SongSearchResult | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
  /** 검색을 다시 돌린다 — 수록 정보를 고친 뒤 목록의 번호를 맞춘다 */
  refresh: () => void;
  /**
   * 결과를 **지금 비운다.** 곡을 만들거나 지운 직후에 쓴다 —
   * `refresh()` 는 디바운스(200ms) 뒤에 오므로 그 사이 **없는 곡이 목록에 남는다.**
   */
  clearResult: () => void;

  quickPicks: SongSearchHit[];
  quickMode: QuickMode;
  setQuickMode: (mode: QuickMode) => void;
  /** 즐겨찾기가 비어 자주 쓴 곡으로 채웠나 */
  quickIsFallback: boolean;
  reloadQuickPicks: () => Promise<void>;
}

export function useSongSearch(onError: (message: string) => void): SongSearch {
  const [songbooks, setSongbooks] = useState<Songbook[]>([]);
  const [managing, setManaging] = useState(false);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SongSearchResult | null>(null);
  const [searchKey, setSearchKey] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const [quickPicks, setQuickPicks] = useState<SongSearchHit[]>([]);
  const [quickIsFallback, setQuickIsFallback] = useState(false);
  /**
   * 즐겨찾기를 기본으로 둔다. 송영·봉헌송처럼 **늘 같은 자리에 있어야 손이 기억하는**
   * 곡이 여기 있고, '최근' 은 목록이 매주 흔들린다.
   */
  const [quickMode, setQuickMode] = useState<QuickMode>('favorite');

  /**
   * `onError` 를 의존성에 넣지 않으려고 붙잡아 둔다.
   *
   * 부르는 쪽이 `setError` 를 그대로 넘기면 늘 같은 것이라 문제가 없지만, 화살표
   * 함수를 넘기면 매 렌더 바뀌어 **검색이 무한히 다시 돈다.** 훅이 그것을 막는다.
   */
  const errorRef = useRef(onError);
  errorRef.current = onError;

  const reloadSongbooks = useCallback(async () => {
    try {
      setSongbooks(await api.songbooks());
    } catch (err) {
      errorRef.current(err instanceof ApiError ? err.message : '곡집을 불러오지 못했습니다');
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
   */
  const reloadQuickPicks = useCallback(async () => {
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
    void reloadSongbooks();
    void reloadQuickPicks();
  }, [reloadSongbooks, reloadQuickPicks]);

  // 검색 — 곡집을 고르면 그 범위, 아니면 전체 통합 검색 (디바운스)
  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .songs(query, 60, selectedBook)
        .then(setResult)
        .catch((err) => errorRef.current(err instanceof ApiError ? err.message : '곡을 찾지 못했습니다'));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, selectedBook, searchKey]);

  const refresh = useCallback(() => setSearchKey((key) => key + 1), []);
  const clearResult = useCallback(() => setResult(null), []);

  return {
    songbooks, reloadSongbooks, managing, setManaging,
    selectedBook, setSelectedBook, query, setQuery, result, searchRef, refresh, clearResult,
    quickPicks, quickMode, setQuickMode, quickIsFallback, reloadQuickPicks,
  };
}

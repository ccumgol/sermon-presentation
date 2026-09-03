/**
 * 찬양 검색의 **순서와 총계** — 찾는 곡이 목록 안에 있기만 하면 되는 것이 아니라
 * 위에 보여야 한다.
 *
 * 왜 이 테스트가 있는가: '은혜' 로 찾으면 제목이 걸리는 곡이 34곡인데 가나다순으로
 * 돌려주는 바람에 제목이 정확히 「은혜」인 곡이 17번째로 밀렸다. 예배 순서 탭은
 * 후보를 짧게 잘라 보여 줘서 **아예 보이지 않았다** (2026-09-03 사용자 보고).
 * 총계도 늘 `hits.length` 라서 "잘렸다" 는 안내가 뜰 수 없었다.
 *
 * vitest.config.ts 가 SERMON_DATA_DIR 을 .test-data 로 돌려놓아 실제 자료는
 * 건드리지 않는다. 다른 통합 테스트와 같은 DB 파일을 쓰므로 **내가 넣은 source 만**
 * 지운다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as store from '../../server/db/songs.ts';

const SOURCE = 'test-search-rank';
/** 다른 테스트의 곡과 겹치지 않는 말 — 총계를 세는 테스트가 있어서 유일해야 한다 */
const WORD = '랭크시험말';

function make(title: string, lyric = '아무 가사'): number {
  return store.createSong({
    title,
    source: SOURCE,
    entries: [{ songbookId: 'misc' }],
    sections: [{ kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: lyric }] }],
  });
}

let exactId: number;
let prefixId: number;
let containsId: number;
let lyricOnlyId: number;

beforeAll(() => {
  store.initSongsDb();
  store.deleteBySource(SOURCE);

  // 가나다순으로는 '가나다…' 가 맨 앞이다 — 등급 정렬이 없으면 이것이 1번으로 나온다
  containsId = make(`가나다 ${WORD}`);
  prefixId = make(`${WORD} 뒷말`);
  exactId = make(WORD);
  lyricOnlyId = make('제목에는 없는 곡', `가사에만 ${WORD} 이 있다`);
});

afterAll(() => {
  store.deleteBySource(SOURCE);
  store.closeSongsDb();
});

describe('제목 검색 순서', () => {
  it('완전일치 → 앞부분 → 포함 순으로 돌려준다', () => {
    const result = store.searchSongs(WORD, { limit: 30 });
    const titleHits = result.hits.filter((h) => h.matchedOn === 'title').map((h) => h.id);
    expect(titleHits).toEqual([exactId, prefixId, containsId]);
  });

  it('가사 일치는 제목 일치보다 뒤에 온다', () => {
    const result = store.searchSongs(WORD, { limit: 30 });
    const ids = result.hits.map((h) => h.id);
    expect(ids.indexOf(lyricOnlyId)).toBeGreaterThan(ids.indexOf(containsId));
  });
});

describe('총계', () => {
  it('제목·가사로 일치한 곡을 모두 센다', () => {
    const result = store.searchSongs(WORD, { limit: 30 });
    expect(result.total).toBe(4);
    expect(result.truncated).toBe(false);
  });

  it('잘렸으면 총계가 표시된 수보다 크고 truncated 가 선다', () => {
    const result = store.searchSongs(WORD, { limit: 2 });
    expect(result.hits).toHaveLength(2);
    expect(result.total).toBe(4);
    expect(result.truncated).toBe(true);
  });

  it('잘려도 가장 잘 맞는 곡은 남는다 — 이것이 이 정렬의 목적이다', () => {
    const result = store.searchSongs(WORD, { limit: 1 });
    expect(result.hits[0]?.id).toBe(exactId);
  });
});

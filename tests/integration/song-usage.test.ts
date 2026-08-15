/**
 * 사용 기록 · 가사 점검 통합 테스트.
 *
 * 둘 다 편의 기능이지만 **예배를 방해하면 안 된다**는 성질이 중요하다:
 *  - 사용 기록이 실패해도 송출은 진행된다
 *  - 가사 점검은 자동으로 아무것도 지우지 않고 목록만 준다
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as store from '../../server/db/songs.ts';
import type { ApiResponse, Deck, SongSearchHit } from '../../shared/types.ts';

let app: FastifyInstance;
let full: number;
let oneLine: number;
let noSections: number;

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();

  store.initSongsDb();
  store.deleteBySource('usage-test');

  full = store.createSong({
    title: '사용기록 정상 곡',
    source: 'usage-test',
    entries: [{ songbookId: 'misc' }],
    sections: [
      {
        kind: 'verse',
        label: '1절',
        lines: [
          { lineIndex: 0, lang: 'ko', text: '첫째 줄' },
          { lineIndex: 1, lang: 'ko', text: '둘째 줄' },
        ],
      },
    ],
  });

  oneLine = store.createSong({
    title: '한 줄뿐인 곡',
    source: 'usage-test',
    entries: [{ songbookId: 'misc' }],
    sections: [{ kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: '유일한 줄' }] }],
  });

  noSections = store.createSong({
    title: '섹션 없는 곡',
    source: 'usage-test',
    entries: [{ songbookId: 'misc' }],
    sections: [],
  });
});

afterAll(async () => {
  store.deleteBySource('usage-test');
  await app.close();
  store.closeSongsDb();
});

async function get<T>(url: string): Promise<{ status: number; body: ApiResponse<T> }> {
  const response = await app.inject({ method: 'GET', url });
  return { status: response.statusCode, body: response.json() as ApiResponse<T> };
}

describe('사용 기록', () => {
  it('덱을 만들면 사용으로 기록된다', async () => {
    const before = store.getSong(full)!;
    expect(before.entries.length).toBeGreaterThan(0);

    await get<{ deck: Deck }>(`/api/songs/${full}/deck?langs=ko`);

    const recent = (await get<SongSearchHit[]>('/api/songs/recent')).body.data!;
    expect(recent.some((hit) => hit.id === full)).toBe(true);
  });

  it('여러 번 송출하면 자주 쓴 곡에 올라온다', async () => {
    for (let i = 0; i < 3; i++) await get(`/api/songs/${full}/deck?langs=ko`);
    const frequent = (await get<SongSearchHit[]>('/api/songs/frequent')).body.data!;
    expect(frequent.some((hit) => hit.id === full)).toBe(true);
  });

  it('최근 목록은 최신 순이다', async () => {
    // oneLine 을 마지막에 송출하면 맨 앞에 와야 한다
    await get(`/api/songs/${oneLine}/deck?langs=ko`);
    const recent = (await get<SongSearchHit[]>('/api/songs/recent')).body.data!;
    expect(recent[0]?.id).toBe(oneLine);
  });

  it('슬라이드가 없으면 기록하지 않는다', async () => {
    // 섹션이 없는 곡은 덱이 비므로 '사용'이 아니다
    await get(`/api/songs/${noSections}/deck?langs=ko`);
    const recent = (await get<SongSearchHit[]>('/api/songs/recent?limit=40')).body.data!;
    expect(recent.some((hit) => hit.id === noSections)).toBe(false);
  });

  it('limit 을 넘겨 요청 수를 제한한다', async () => {
    const recent = (await get<SongSearchHit[]>('/api/songs/recent?limit=1')).body.data!;
    expect(recent).toHaveLength(1);
  });

  it('markUsed 는 없는 곡에도 예외를 던지지 않는다', () => {
    // 편의 기능이 송출을 막아서는 안 된다
    expect(() => store.markUsed(999999)).not.toThrow();
  });
});

describe('가사 점검', () => {
  it('섹션 없는 곡과 한 줄뿐인 곡을 찾는다', async () => {
    const items = (await get<Array<{ id: number; reason: string }>>('/api/songs/incomplete')).body.data!;

    expect(items.find((i) => i.id === noSections)?.reason).toBe('no_sections');
    expect(items.find((i) => i.id === oneLine)?.reason).toBe('too_few_lines');
  });

  it('정상 곡은 목록에 없다', async () => {
    const items = (await get<Array<{ id: number }>>('/api/songs/incomplete')).body.data!;
    expect(items.some((i) => i.id === full)).toBe(false);
  });

  it('곡집으로 범위를 좁힌다', async () => {
    const misc = (await get<Array<{ id: number }>>('/api/songs/incomplete?book=misc')).body.data!;
    expect(misc.some((i) => i.id === oneLine)).toBe(true);

    // 찬송가에는 이 테스트 곡이 없다
    const hymns = (await get<Array<{ id: number }>>('/api/songs/incomplete?book=hymn_new')).body.data!;
    expect(hymns.some((i) => i.id === oneLine)).toBe(false);
  });

  it('점검이 아무것도 지우지 않는다', async () => {
    const before = store.countSongs();
    await get('/api/songs/incomplete');
    expect(store.countSongs()).toBe(before);
    expect(store.getSong(oneLine)).toBeDefined();
  });

  it('수록 정보를 함께 준다 (어느 곡집인지 알 수 있게)', async () => {
    const items = (
      await get<Array<{ id: number; entries: Array<{ songbookId: string }> }>>('/api/songs/incomplete')
    ).body.data!;
    const item = items.find((i) => i.id === oneLine)!;
    expect(item.entries.some((e) => e.songbookId === 'misc')).toBe(true);
  });
});

describe('즐겨찾기', () => {
  it('기본값은 즐겨찾기 아님', async () => {
    const list = (await get<SongSearchHit[]>('/api/songs/favorites')).body.data!;
    expect(list.some((hit) => hit.id === full)).toBe(false);
  });

  it('넣으면 목록에 나온다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/songs/${full}/favorite`,
      payload: { value: true },
    });
    expect(response.statusCode).toBe(200);

    const list = (await get<SongSearchHit[]>('/api/songs/favorites')).body.data!;
    expect(list.some((hit) => hit.id === full)).toBe(true);
  });

  it('곡 정보에 표시된다', async () => {
    expect(store.getSong(full)?.isFavorite).toBe(true);
  });

  it('빼면 목록에서 사라진다', async () => {
    await app.inject({ method: 'POST', url: `/api/songs/${full}/favorite`, payload: { value: false } });
    const list = (await get<SongSearchHit[]>('/api/songs/favorites')).body.data!;
    expect(list.some((hit) => hit.id === full)).toBe(false);
    expect(store.getSong(full)?.isFavorite).toBeUndefined();
  });

  it('값을 안 주면 토글한다', () => {
    expect(store.toggleFavorite(full)).toBe(true);
    expect(store.toggleFavorite(full)).toBe(false);
  });

  it('기본 5개까지만 준다', async () => {
    const ids = [full, oneLine, noSections];
    for (const id of ids) store.toggleFavorite(id, true);

    const list = (await get<SongSearchHit[]>('/api/songs/favorites')).body.data!;
    expect(list.length).toBeLessThanOrEqual(5);

    for (const id of ids) store.toggleFavorite(id, false);
  });

  it('없는 곡은 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/songs/999999/favorite',
      payload: { value: true },
    });
    expect(response.statusCode).toBe(404);
  });

  it('즐겨찾기는 사용 기록과 별개다', async () => {
    // 송출해도 즐겨찾기에 자동으로 들어가지 않는다
    await get(`/api/songs/${full}/deck?langs=ko`);
    const list = (await get<SongSearchHit[]>('/api/songs/favorites')).body.data!;
    expect(list.some((hit) => hit.id === full)).toBe(false);
  });
});

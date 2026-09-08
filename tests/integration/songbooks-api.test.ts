/**
 * 곡집 REST — **되돌릴 수 없는 사용자 데이터를 쓰는 길.**
 *
 * ## 이 파일이 붙잡는 함정
 *
 * 2026-09-07 번들 작업(`079d654`)에서 드러난 것:
 *
 * > **곡집을 곡보다 먼저 만들어야 한다.** 순서가 뒤바뀌면 `setEntries` 가 수록
 * > 정보를 버리고 곡이 전부 **'기타'** 로 떨어진다.
 *
 * 이 규칙은 `server/routes/backup.ts` 안에서만 지켜지고 있었고, **곡집 쪽에는
 * 그것을 붙잡는 검사가 없었다.** 다음에 누가 순서를 바꾸면 조용히 재발한다 —
 * 화면에서는 곡이 멀쩡히 보이고, 번호만 사라진다.
 *
 * vitest.config.ts 가 SERMON_DATA_DIR 을 .test-data 로 돌려놓아 실제 가사는
 * 건드리지 않는다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as store from '../../server/db/songs.ts';
import type { ApiResponse, Song, Songbook } from '../../shared/types.ts';

let app: FastifyInstance;

/** 이 파일이 만든 것만 지운다 — 다른 검사의 자료를 쓸어 가면 안 된다 */
const SOURCE = 'songbook_api_test';
const madeBooks: string[] = [];

beforeAll(async () => {
  app = (await buildApp({ getPort: () => 7777 })).app;
  await app.ready();
  store.initSongsDb();
});

afterAll(async () => {
  await app.close();
});

afterEach(async () => {
  store.deleteBySource(SOURCE);
  for (const id of madeBooks.splice(0)) {
    await app.inject({ method: 'DELETE', url: `/api/songbooks/${id}` });
  }
});

async function post<T>(
  url: string,
  payload: Record<string, unknown>,
): Promise<{ code: number; body: ApiResponse<T> }> {
  const res = await app.inject({ method: 'POST', url, payload });
  return { code: res.statusCode, body: res.json() as ApiResponse<T> };
}

async function makeBook(name: string, extra: Record<string, unknown> = {}): Promise<Songbook> {
  const { body } = await post<Songbook>('/api/songbooks', { name, ...extra });
  const book = body.data!;
  madeBooks.push(book.id);
  return book;
}

function songOf(title: string, entries: Array<{ songbookId: string; number?: number }>): number {
  return store.createSong({
    title,
    source: SOURCE,
    entries,
    sections: [{ kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: '가사' }] }],
  });
}

// ─────────────────────────────────────────────────────────────
describe('목록과 조회', () => {
  it('내장 곡집이 보인다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/songbooks' });
    const ids = (res.json() as ApiResponse<Songbook[]>).data!.map((one) => one.id);
    expect(ids).toContain('hymn_new');
    expect(ids).toContain('misc');
  });

  it('하나를 열면 빠진 번호도 함께 준다', async () => {
    const book = await makeBook('빈칸 시험');
    songOf('1번', [{ songbookId: book.id, number: 1 }]);
    songOf('3번', [{ songbookId: book.id, number: 3 }]);

    const res = await app.inject({ method: 'GET', url: `/api/songbooks/${book.id}` });
    const data = (res.json() as ApiResponse<{ songbook: Songbook; missing: number[]; max: number }>).data!;
    expect(data.missing).toEqual([2]);
    expect(data.max).toBe(3);
  });

  it('없는 곡집은 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/songbooks/없음' });
    expect(res.statusCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
describe('만들기 · 고치기 · 지우기', () => {
  it('만들면 목록에 들어간다', async () => {
    const book = await makeBook('경배와 찬양', { shortLabel: '경' });
    expect(book.shortLabel).toBe('경');
    expect(book.songCount).toBe(0);
  });

  it('빈 이름은 400', async () => {
    const { code } = await post('/api/songbooks', { name: '  ' });
    expect(code).toBe(400);
  });

  it('고치면 반영된다', async () => {
    const book = await makeBook('옛 이름');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/songbooks/${book.id}`,
      payload: { name: '새 이름' },
    });
    expect((res.json() as ApiResponse<Songbook>).data!.name).toBe('새 이름');
  });

  it('없는 곡집을 고치면 404', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/songbooks/없음', payload: { name: '가' } });
    expect(res.statusCode).toBe(404);
  });

  /**
   * 곡집을 지워도 **가사는 사라지지 않는다.** 그 곡집에만 있던 곡은 '기타' 로 옮긴다.
   */
  it('지우면 수록곡이 기타로 옮겨진다', async () => {
    const book = await makeBook('지울 곡집');
    const songId = songOf('여기에만 있는 곡', [{ songbookId: book.id, number: 1 }]);

    const res = await app.inject({ method: 'DELETE', url: `/api/songbooks/${book.id}` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as ApiResponse<{ movedToMisc: number }>).data!.movedToMisc).toBe(1);
    madeBooks.length = 0; // 이미 지웠다

    // 곡은 살아 있고 '기타' 에 있다
    const song = store.getSong(songId)!;
    expect(song.entries.map((one) => one.songbookId)).toEqual(['misc']);
  });

  /** 내장 곡집을 지우면 '기타' 가 사라져 갈 곳 없는 곡이 생긴다 */
  it('내장 곡집을 지우면 409', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/songbooks/hymn_new' });
    expect(res.statusCode).toBe(409);
  });

  it('없는 곡집을 지우면 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/songbooks/없음' });
    expect(res.statusCode).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
/**
 * **이 절이 이 파일의 핵심이다.**
 *
 * `setEntries` 는 **없는 곡집을 조용히 버린다.** 하나도 못 넣으면 '기타' 로
 * 떨어뜨린다. 그래서 곡집을 나중에 만들면 곡이 전부 '기타' 가 된다 — 화면에는
 * 곡이 멀쩡히 보이고 **번호만 사라져서**, 예배 중 '새 305' 를 쳐야 알아챈다.
 */
describe('곡집을 곡보다 먼저 만들어야 한다 (2026-09-07 함정)', () => {
  it('곡집이 없으면 수록 정보가 기타로 떨어진다 — 이것이 그 함정이다', () => {
    const songId = songOf('아직 없는 곡집에 넣으려는 곡', [{ songbookId: '아직없음', number: 7 }]);

    const song = store.getSong(songId)!;
    expect(song.entries).toHaveLength(1);
    expect(song.entries[0]!.songbookId).toBe('misc');
    // 번호가 사라진다 — 이것 때문에 '새 305' 검색이 안 된다
    expect(song.entries[0]!.number).toBeUndefined();
  });

  it('곡집을 먼저 만들면 번호까지 그대로 들어간다', async () => {
    const book = await makeBook('먼저 만든 곡집');
    const songId = songOf('제대로 들어간 곡', [{ songbookId: book.id, number: 7 }]);

    const song = store.getSong(songId)!;
    expect(song.entries[0]!.songbookId).toBe(book.id);
    expect(song.entries[0]!.number).toBe(7);
  });

  /** 있는 것만 살리고 없는 것은 버린다 — 하나라도 살면 '기타' 로 떨어지지 않는다 */
  it('일부만 없으면 있는 것만 남는다', () => {
    const songId = songOf('반만 맞는 곡', [
      { songbookId: 'hymn_new', number: 305 },
      { songbookId: '없는곡집', number: 1 },
    ]);

    const song = store.getSong(songId)!;
    expect(song.entries.map((one) => one.songbookId)).toEqual(['hymn_new']);
  });
});

// ─────────────────────────────────────────────────────────────
describe('수록 정보 고치기 (PUT /api/songs/:id/entries)', () => {
  /** `entries` 에 이상한 값도 보내야 하므로 타입을 열어 둔다 */
  async function setEntries(songId: number, entries: unknown): Promise<number> {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/songs/${songId}/entries`,
      payload: { entries } as Record<string, unknown>,
    });
    return res.statusCode;
  }

  it('곡집과 번호를 바꾼다', async () => {
    const book = await makeBook('옮겨 갈 곡집');
    const songId = songOf('옮길 곡', [{ songbookId: 'hymn_new', number: 1 }]);

    expect(await setEntries(songId, [{ songbookId: book.id, number: 42 }])).toBe(200);

    const song = store.getSong(songId)!;
    expect(song.entries[0]!.songbookId).toBe(book.id);
    expect(song.entries[0]!.number).toBe(42);
  });

  /** 빈 배열을 주면 갈 곳이 없다 — 곡이 사라지지 않게 '기타' 로 떨어뜨린다 */
  it('빈 배열이면 기타로 간다 (곡이 목록에서 사라지지 않게)', async () => {
    const songId = songOf('비울 곡', [{ songbookId: 'hymn_new', number: 1 }]);
    expect(await setEntries(songId, [])).toBe(200);

    expect(store.getSong(songId)!.entries.map((one) => one.songbookId)).toEqual(['misc']);
  });

  /** 번호 체계가 없는 곡집에는 번호를 저장하지 않는다 */
  it('번호 없는 곡집에 넣으면 번호가 버려진다', async () => {
    const book = await makeBook('번호 없는 곡집', { numbered: false });
    const songId = songOf('가', [{ songbookId: 'hymn_new', number: 1 }]);

    await setEntries(songId, [{ songbookId: book.id, number: 99 }]);

    const entry = store.getSong(songId)!.entries[0]!;
    expect(entry.songbookId).toBe(book.id);
    expect(entry.number).toBeUndefined();
  });

  it('한 곡을 여러 곡집에 넣는다', async () => {
    const songId = songOf('두 곡집에 실릴 곡', [{ songbookId: 'hymn_new', number: 305 }]);
    await setEntries(songId, [
      { songbookId: 'hymn_new', number: 305 },
      { songbookId: 'hymn_old', number: 405 },
    ]);

    const ids = store.getSong(songId)!.entries.map((one) => one.songbookId).sort();
    expect(ids).toEqual(['hymn_new', 'hymn_old']);
  });

  it('entries 가 배열이 아니면 400', async () => {
    const songId = songOf('가', [{ songbookId: 'hymn_new', number: 1 }]);
    expect(await setEntries(songId, '아님')).toBe(400);
    expect(await setEntries(songId, undefined)).toBe(400);
  });

  it('없는 곡이면 404', async () => {
    expect(await setEntries(9999999, [])).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────
describe('대응곡 연결 — 가사가 다른 같은 찬송', () => {
  it('잇고 끊는다', async () => {
    const a = songOf('새찬송가 쪽', [{ songbookId: 'hymn_new', number: 305 }]);
    const b = songOf('통일찬송가 쪽', [{ songbookId: 'hymn_old', number: 405 }]);

    const linked = await post<Song>(`/api/songs/${a}/link`, { linkedId: b });
    expect(linked.code).toBe(200);
    expect(linked.body.data!.links?.map((one) => one.id)).toContain(b);

    // 반대쪽에서도 보인다 — 한쪽만 보이면 어느 곡을 열었는지에 따라 달라진다
    expect(store.getSong(b)!.links?.map((one) => one.id)).toContain(a);

    const res = await app.inject({ method: 'DELETE', url: `/api/songs/${a}/link/${b}` });
    expect(res.statusCode).toBe(200);
    expect(store.getSong(a)!.links ?? []).toHaveLength(0);
  });

  it('없는 곡을 이으면 404', async () => {
    const a = songOf('가', [{ songbookId: 'hymn_new', number: 1 }]);
    expect((await post(`/api/songs/${a}/link`, { linkedId: 9999999 })).code).toBe(404);
  });
});


// ─────────────────────────────────────────────────────────────
/**
 * **일괄 반입** — 곡집에 곡을 한꺼번에 넣는 길.
 *
 * 여기가 사용자 데이터를 가장 많이 쓰는 자리다. `mode: 'replace'` 는 그 곡집의
 * 기존 곡을 **먼저 지운다** — 되돌릴 방법이 백업뿐이므로 무엇이 지워지고 무엇이
 * 들어가는지 숫자로 돌려준다.
 */
describe('일괄 반입', () => {
  function importTo(id: string, payload: Record<string, unknown>) {
    return app.inject({ method: 'POST', url: `/api/songbooks/${id}/import`, payload });
  }

  interface ImportResult {
    songbook: Songbook;
    added: number;
    replaced: number;
    skipped: string[];
    missingNumbers: number[];
  }

  it('번호 + 제목 머리줄 형식을 읽어 넣는다', async () => {
    const book = await makeBook('반입 시험');
    const res = await importTo(book.id, {
      text: '1. 첫째 곡\n첫째 곡 가사\n\n2. 둘째 곡\n둘째 곡 가사\n',
    });

    expect(res.statusCode).toBe(200);
    const data = (res.json() as ApiResponse<ImportResult>).data!;
    expect(data.added).toBe(2);
    expect(data.songbook.songCount).toBe(2);
    // 번호까지 붙는다 — 이것이 '찬 1' 검색의 근거다
    expect(store.searchSongs('첫째 곡').hits[0]!.entries[0]!.number).toBe(1);
  });

  /** 구조화된 입력도 받는다 (미리 보고 고친 뒤 보내는 경로) */
  it('songs 배열로도 넣는다', async () => {
    const book = await makeBook('배열 반입');
    const res = await importTo(book.id, {
      songs: [{ number: 7, title: '배열로 온 곡', lyrics: '가사 한 줄' }],
    });

    expect((res.json() as ApiResponse<ImportResult>).data!.added).toBe(1);
  });

  it('text 도 songs 도 없으면 400', async () => {
    const book = await makeBook('빈 반입');
    expect((await importTo(book.id, {})).statusCode).toBe(400);
    expect((await importTo(book.id, { text: '   ' })).statusCode).toBe(400);
  });

  it('읽을 곡이 하나도 없으면 400', async () => {
    const book = await makeBook('해석 실패');
    expect((await importTo(book.id, { songs: [] })).statusCode).toBe(400);
  });

  it('없는 곡집이면 404', async () => {
    expect((await importTo('없음', { text: '1. 가\n가사' })).statusCode).toBe(404);
  });

  /** 조용히 버리지 않는다 — 무엇이 빠졌는지 알아야 다시 넣을 수 있다 */
  it('제목 없는 곡·가사 없는 곡을 건너뛰고 알려 준다', async () => {
    const book = await makeBook('건너뜀 시험');
    const res = await importTo(book.id, {
      songs: [
        { title: '멀쩡한 곡', lyrics: '가사' },
        { title: '   ', lyrics: '가사' },
        { title: '가사 없는 곡', lyrics: '' },
      ],
    });

    const data = (res.json() as ApiResponse<ImportResult>).data!;
    expect(data.added).toBe(1);
    expect(data.skipped).toHaveLength(2);
    expect(data.skipped.join(' ')).toContain('가사 없음');
  });

  /**
   * `replace` 는 **먼저 지운다.** 지운 수를 돌려주지 않으면 사용자가 무엇을
   * 잃었는지 알 수 없다.
   */
  it("replace 는 그 곡집의 기존 곡을 지우고 수를 알려 준다", async () => {
    const book = await makeBook('갈아 끼울 곡집');
    await importTo(book.id, { text: '1. 옛 곡\n옛 가사\n' });

    const res = await importTo(book.id, { text: '1. 새 곡\n새 가사\n', mode: 'replace' });
    const data = (res.json() as ApiResponse<ImportResult>).data!;

    expect(data.replaced).toBe(1);
    expect(data.added).toBe(1);
    expect(data.songbook.songCount).toBe(1);
    expect(store.searchSongs('옛 곡').hits).toHaveLength(0);
  });

  /** 기본은 덧붙이기다 — 실수로 통째로 지우면 안 된다 */
  it('mode 를 안 주면 지우지 않고 덧붙인다', async () => {
    const book = await makeBook('덧붙일 곡집');
    await importTo(book.id, { text: '1. 먼저 온 곡\n가사\n' });
    const res = await importTo(book.id, { text: '2. 나중 온 곡\n가사\n' });

    const data = (res.json() as ApiResponse<ImportResult>).data!;
    expect(data.replaced).toBe(0);
    expect(data.songbook.songCount).toBe(2);
  });

  /** 빠진 번호를 알려 줘야 '일부만 들어갔다' 를 눈으로 안다 */
  it('빠진 번호를 함께 준다', async () => {
    const book = await makeBook('빈칸 있는 반입');
    const res = await importTo(book.id, { text: '1. 가\n가사\n\n4. 나\n가사\n' });

    expect((res.json() as ApiResponse<ImportResult>).data!.missingNumbers).toEqual([2, 3]);
  });

  /** 번호 체계가 없는 곡집에는 번호를 붙이지 않는다 */
  it('번호 없는 곡집은 번호를 저장하지 않는다', async () => {
    const book = await makeBook('번호 없는 반입', { numbered: false });
    await importTo(book.id, { songs: [{ number: 5, title: '번호 무시될 곡', lyrics: '가사' }] });

    const hit = store.searchSongs('번호 무시될 곡').hits[0]!;
    expect(hit.entries[0]!.number).toBeUndefined();
  });

  it('가져온 표시가 남는다', async () => {
    const book = await makeBook('표시 시험');
    const res = await importTo(book.id, { text: '1. 가\n가사\n' });

    const after = (res.json() as ApiResponse<ImportResult>).data!.songbook;
    expect(after.importedAt).toBeTruthy();
    expect(after.sourceNote).toContain('1곡');
  });
});

// ─────────────────────────────────────────────────────────────
describe('반입 미리 보기 — 저장하지 않는다', () => {
  it('해석 결과만 돌려준다', async () => {
    const before = store.countSongs();
    const res = await app.inject({
      method: 'POST',
      url: '/api/songbooks/parse',
      payload: { text: '1. 미리 볼 곡\n가사 한 줄\n' },
    });

    expect(res.statusCode).toBe(200);
    const data = (res.json() as ApiResponse<{ songs: Array<{ title: string; number?: number }> }>).data!;
    expect(data.songs[0]!.title).toBe('미리 볼 곡');
    // **저장하지 않는다** — 미리 보기가 데이터를 남기면 확인할 수가 없다
    expect(store.countSongs()).toBe(before);
  });

  it('text 가 없으면 400', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/songbooks/parse', payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

/**
 * 찬양 REST 통합 테스트 — 임시 songs.sqlite 에 직접 곡을 넣고 검증한다.
 *
 * vitest.config.ts 가 SERMON_DATA_DIR 을 .test-data 로 돌려놓아
 * 실제 찬송가 데이터는 건드리지 않는다.
 */

import { MAX_LANGS } from '../../lib/lang-select.ts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as store from '../../server/db/songs.ts';
import type { ApiResponse, Deck, Song, SongSearchResult } from '../../shared/types.ts';

let app: FastifyInstance;
let hymnId: number;
let ccmId: number;
let oldId: number;

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();

  store.initSongsDb();
  // 이전 실행의 잔여물을 지우고 시작한다
  store.deleteBySource('manual');
  store.deleteBySource('hymn_new');
  store.deleteBySource('hymn_old');

  hymnId = store.createSong({
    title: '나 같은 죄인 살리신',
    hasAmen: true,
    source: 'hymn_new',
    entries: [{ songbookId: 'hymn_new', number: 305 }],
    sections: [
      {
        kind: 'verse',
        label: '1절',
        lines: [
          { lineIndex: 0, lang: 'ko', text: '나 같은 죄인 살리신' },
          { lineIndex: 0, lang: 'en', text: 'Amazing grace how sweet the sound' },
          { lineIndex: 1, lang: 'ko', text: '주 은혜 놀라워' },
          { lineIndex: 1, lang: 'en', text: 'That saved a wretch like me' },
        ],
      },
      {
        kind: 'chorus',
        label: '후렴',
        lines: [{ lineIndex: 0, lang: 'ko', text: '후렴 줄입니다' }],
      },
    ],
  });

  oldId = store.createSong({
    title: '나 같은 죄인 살리신',
    source: 'hymn_old',
    entries: [{ songbookId: 'hymn_old', number: 405 }],
    sections: [{ kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: '통일찬송가 가사' }] }],
  });
  store.linkSongs(hymnId, oldId);

  ccmId = store.createSong({
    title: '한국어만 있는 곡',
    source: 'manual',
    entries: [{ songbookId: 'misc' }],
    copyright: '© 2020 예시',
    ccliNumber: '1234567',
    sections: [{ kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: '한국어 가사' }] }],
  });
});

afterAll(async () => {
  // 넣은 곡만 지운다. DB 파일 자체를 지우면 병렬로 도는 다른 통합 테스트가 깨진다.
  store.deleteBySource('manual');
  store.deleteBySource('hymn_new');
  store.deleteBySource('hymn_old');
  await app.close();
  store.closeSongsDb();
});

async function get<T>(url: string): Promise<{ status: number; body: ApiResponse<T> }> {
  const response = await app.inject({ method: 'GET', url });
  return { status: response.statusCode, body: response.json() as ApiResponse<T> };
}

async function put<T>(url: string, payload: Record<string, unknown>): Promise<{ status: number; body: ApiResponse<T> }> {
  const response = await app.inject({ method: 'PUT', url, payload });
  return { status: response.statusCode, body: response.json() as ApiResponse<T> };
}

describe('검색', () => {
  it('찬송가 번호로 찾는다', async () => {
    const { body } = await get<SongSearchResult>('/api/songs?q=305');
    expect(body.data!.hits.some((h) => h.id === hymnId && h.matchedOn === 'number')).toBe(true);
  });

  it('판본을 지정해 찾는다', async () => {
    const { body } = await get<SongSearchResult>(`/api/songs?q=${encodeURIComponent('새 305')}`);
    expect(body.data!.hits[0]?.id).toBe(hymnId);
  });

  it('통일찬송가 번호로 대응곡을 찾는다', async () => {
    // 가사가 다르므로 별도 곡이다 — 405 는 통일찬송가 쪽 곡을 찾아야 한다
    const { body } = await get<SongSearchResult>('/api/songs?q=405');
    expect(body.data!.hits.some((h) => h.id === oldId)).toBe(true);
  });

  it('곡집을 지정해 범위를 좁힌다', async () => {
    const { body } = await get<SongSearchResult>('/api/songs?q=&book=hymn_old');
    expect(body.data!.scope).toBe('songbook');
    expect(body.data!.hits.every((h) => h.entries.some((e) => e.songbookId === 'hymn_old'))).toBe(true);
  });

  it('대응곡을 함께 돌려준다', async () => {
    const { body } = await get<{ song: Song }>(`/api/songs/${hymnId}`);
    expect(body.data!.song.links?.some((l) => l.id === oldId)).toBe(true);
  });

  it('제목을 공백 없이 입력해도 찾는다', async () => {
    const { body } = await get<SongSearchResult>(`/api/songs?q=${encodeURIComponent('나같은죄인')}`);
    expect(body.data!.hits.some((h) => h.id === hymnId && h.matchedOn === 'title')).toBe(true);
  });

  it('가사 부분일치로 찾고 대목을 함께 준다', async () => {
    const { body } = await get<SongSearchResult>(`/api/songs?q=${encodeURIComponent('은혜 놀라워')}`);
    const hit = body.data!.hits.find((h) => h.id === hymnId);
    expect(hit?.matchedOn).toBe('lyrics');
    expect(hit?.snippet).toContain('은혜 놀라워');
  });

  it('검색어가 없으면 목록을 돌려준다 (빈 화면을 보이지 않게)', async () => {
    const { body } = await get<SongSearchResult>('/api/songs');
    expect(body.data!.hits.length).toBeGreaterThan(0);
  });

  it('LIKE 와일드카드를 리터럴로 취급한다', async () => {
    const { body } = await get<SongSearchResult>('/api/songs?q=%25');
    expect(body.data!.hits).toEqual([]);
  });
});

describe('곡 조회', () => {
  it('섹션·줄·언어를 함께 돌려준다', async () => {
    const { body } = await get<{ song: Song; availableLangs: string[] }>(`/api/songs/${hymnId}`);
    expect(body.data!.song.sections).toHaveLength(2);
    expect(body.data!.availableLangs).toEqual(['ko', 'en']);
    expect(body.data!.song.hasAmen).toBe(true);
  });

  it('없는 id 는 404', async () => {
    expect((await get('/api/songs/999999')).status).toBe(404);
  });
});

describe('슬라이드 묶음', () => {
  it('2언어를 줄 단위로 짝지어 담는다', async () => {
    const { body } = await get<{ deck: Deck; missingLangs: string[] }>(
      `/api/songs/${hymnId}/deck?langs=ko,en&lines=2`,
    );
    const first = body.data!.deck.slides[0]!;
    expect(first.kind).toBe('song');
    if (first.kind !== 'song') return;
    expect(first.lines[0]!.map((l) => l.lang)).toEqual(['ko', 'en']);
    expect(body.data!.missingLangs).toEqual([]);
  });

  it('수록 곡집 번호를 저작권 표기에 넣는다', async () => {
    const { body } = await get<{ deck: Deck }>(`/api/songs/${hymnId}/deck?langs=ko`);
    const first = body.data!.deck.slides[0]!;
    expect(first.kind === 'song' && first.credit).toBe('새찬송가 305장');
  });

  it('CCLI·저작권도 표기한다', async () => {
    const { body } = await get<{ deck: Deck }>(`/api/songs/${ccmId}/deck?langs=ko`);
    const first = body.data!.deck.slides[0]!;
    expect(first.kind === 'song' && first.credit).toBe('© 2020 예시 · CCLI 1234567');
  });

  it('곡에 없는 언어를 요청하면 알려준다 (조용히 넘기지 않는다)', async () => {
    const { body } = await get<{ missingLangs: string[] }>(`/api/songs/${ccmId}/deck?langs=ko,en`);
    expect(body.data!.missingLangs).toEqual(['en']);
  });

  it('특정 섹션만 요청할 수 있다', async () => {
    const song = (await get<{ song: Song }>(`/api/songs/${hymnId}`)).body.data!.song;
    const chorus = song.sections.find((s) => s.kind === 'chorus')!;
    const { body } = await get<{ deck: Deck }>(`/api/songs/${hymnId}/deck?langs=ko&section=${chorus.id}`);
    expect(body.data!.deck.labels).toEqual(['후렴']);
  });

  it(`${MAX_LANGS}개를 넘게 요청하면 ${MAX_LANGS}개로 자른다`, async () => {
    const { body } = await get<{ langs: string[] }>(
      `/api/songs/${hymnId}/deck?langs=ko,en,zh,ja`,
    );
    expect(body.data!.langs).toHaveLength(MAX_LANGS);
  });

  it('3개 언어를 요청하면 3개가 그대로 온다', async () => {
    const { body } = await get<{ langs: string[] }>(`/api/songs/${hymnId}/deck?langs=ko,en,zh`);
    expect(body.data!.langs).toEqual(['ko', 'en', 'zh']);
  });

  it('덱 라벨에 섹션 안 순서를 표시한다', async () => {
    // maxChars 를 최소로 둬 폭 묶음을 끈다 — 여기서 재는 것은 라벨 형식이다
    const { body } = await get<{ deck: Deck }>(`/api/songs/${hymnId}/deck?langs=ko&lines=1&maxChars=8`);
    expect(body.data!.deck.labels.slice(0, 2)).toEqual(['1절 1/2', '1절 2/2']);
  });

  it('템플릿 폭에 맞춰 운율 행을 묶는다', async () => {
    // 짧은 운율 행 2개가 24자 안에 들어가면 한 행으로 합쳐 표시한다
    const wide = await get<{ deck: Deck }>(`/api/songs/${hymnId}/deck?langs=ko&lines=2&maxChars=24`);
    const narrow = await get<{ deck: Deck }>(`/api/songs/${hymnId}/deck?langs=ko&lines=2&maxChars=8`);

    const linesOf = (deck: Deck): number => {
      const slide = deck.slides[0]!;
      return slide.kind === 'song' ? slide.lines.length : 0;
    };
    expect(linesOf(wide.body.data!.deck)).toBeLessThanOrEqual(linesOf(narrow.body.data!.deck));
  });

  it('범위를 벗어난 maxChars 는 기본값으로 되돌린다', async () => {
    for (const value of ['0', '1', '999', 'abc']) {
      const { status } = await get<{ deck: Deck }>(`/api/songs/${hymnId}/deck?langs=ko&maxChars=${value}`);
      expect(status, value).toBe(200);
    }
  });
});

describe('가사 편집', () => {
  it('| 페어링으로 2언어 가사를 저장한다', async () => {
    const text = ['[1절]', '한국어 줄', '| English line', '', '[후렴]', '후렴 줄'].join('\n');
    const { body } = await put<{ song: Song; availableLangs: string[] }>(`/api/songs/${ccmId}/lyrics`, { text });

    expect(body.data!.availableLangs).toEqual(['ko', 'en']);
    const verse = body.data!.song.sections[0]!;
    expect(verse.lines.filter((l) => l.lineIndex === 0).map((l) => l.lang).sort()).toEqual(['en', 'ko']);
    expect(body.data!.song.sections[1]!.kind).toBe('chorus');
  });

  it('빈 가사는 400', async () => {
    expect((await put(`/api/songs/${ccmId}/lyrics`, { text: '   ' })).status).toBe(400);
  });

  it('없는 곡은 404', async () => {
    expect((await put('/api/songs/999999/lyrics', { text: '가사' })).status).toBe(404);
  });

  it('가사 구조 미리보기는 저장하지 않는다', async () => {
    const before = (await get<{ song: Song }>(`/api/songs/${hymnId}`)).body.data!.song;
    const response = await app.inject({
      method: 'POST',
      url: '/api/songs/parse-lyrics',
      payload: { text: '[1절]\n전혀 다른 가사' },
    });
    expect(response.statusCode).toBe(200);

    const after = (await get<{ song: Song }>(`/api/songs/${hymnId}`)).body.data!.song;
    expect(after.sections).toEqual(before.sections);
  });
});

/**
 * 대응곡 연결·해제 — 새찬송가 ↔ 통일찬송가처럼 **가사가 다른 같은 찬송**.
 *
 * 라우트는 처음부터 있었는데 화면에 길이 없어 테스트도 없었다 (§4.6 U-3).
 * 이제 사람이 앱에서 붙이고 뗀다 — 잘못 붙은 연결이 그대로 굳으면 안 된다.
 */
describe('대응곡 연결', () => {
  async function post<T>(url: string, payload: Record<string, unknown>): Promise<{ status: number; body: ApiResponse<T> }> {
    const response = await app.inject({ method: 'POST', url, payload });
    return { status: response.statusCode, body: response.json() as ApiResponse<T> };
  }
  async function del<T>(url: string): Promise<{ status: number; body: ApiResponse<T> }> {
    const response = await app.inject({ method: 'DELETE', url });
    return { status: response.statusCode, body: response.json() as ApiResponse<T> };
  }

  it('붙이면 양쪽에서 서로 보인다', async () => {
    await post(`/api/songs/${hymnId}/link`, { linkedId: ccmId });

    const forward = (await get<{ song: Song }>(`/api/songs/${hymnId}`)).body.data!.song;
    const backward = (await get<{ song: Song }>(`/api/songs/${ccmId}`)).body.data!.song;
    expect((forward.links ?? []).some((l) => l.id === ccmId)).toBe(true);
    // 한쪽에서만 보이면 반대쪽 곡을 열었을 때 대응곡이 없는 것으로 보인다
    expect((backward.links ?? []).some((l) => l.id === hymnId)).toBe(true);
  });

  it('풀면 양쪽에서 사라진다 — 곡 자체는 남는다', async () => {
    await post(`/api/songs/${hymnId}/link`, { linkedId: ccmId });
    await del(`/api/songs/${hymnId}/link/${ccmId}`);

    const forward = (await get<{ song: Song }>(`/api/songs/${hymnId}`)).body.data!.song;
    const backward = (await get<{ song: Song }>(`/api/songs/${ccmId}`)).body.data!.song;
    // 연결이 하나도 안 남으면 `links` 자체가 빠진다 — 그래서 `?? []` 로 받는다
    expect((forward.links ?? []).some((l) => l.id === ccmId)).toBe(false);
    expect((backward.links ?? []).some((l) => l.id === hymnId)).toBe(false);
    expect(backward.title).toBe('한국어만 있는 곡');
  });

  it('두 번 붙여도 하나다', async () => {
    await post(`/api/songs/${hymnId}/link`, { linkedId: ccmId });
    const twice = await post<Song>(`/api/songs/${hymnId}/link`, { linkedId: ccmId });
    expect((twice.body.data!.links ?? []).filter((l) => l.id === ccmId)).toHaveLength(1);
    await del(`/api/songs/${hymnId}/link/${ccmId}`);
  });

  it('없는 곡은 404 — 잘못된 id 로 유령 연결이 생기면 안 된다', async () => {
    expect((await post(`/api/songs/${hymnId}/link`, { linkedId: 999999 })).status).toBe(404);
    expect((await post('/api/songs/999999/link', { linkedId: hymnId })).status).toBe(404);
  });

  it('붙지 않은 것을 풀어도 조용히 넘어간다', async () => {
    const response = await del<Song>(`/api/songs/${hymnId}/link/${ccmId}`);
    expect(response.status).toBe(200);
  });
});

/**
 * 수록 정보(어느 곡집 몇 번) 편집 — `PUT /api/songs/:id/entries`.
 *
 * 라우트는 처음부터 있었는데 화면에 길이 없어 테스트도 없었다 (§4.6 U-4).
 * 이제 사람이 앱에서 고친다 — **통째로 교체**하는 동작이라 실수의 값이 크다.
 */
describe('수록 정보 편집', () => {
  let target: number;

  beforeEach(() => {
    // 이 describe 안에서만 쓰는 곡 — 다른 테스트의 수록 정보를 갈아 버리면 안 된다
    store.deleteBySource('entry-test');
    target = store.createSong({
      title: '수록 정보 시험곡',
      source: 'entry-test',
      entries: [{ songbookId: 'misc' }],
      sections: [{ kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: '가사' }] }],
    });
  });

  afterAll(() => {
    store.deleteBySource('entry-test');
  });

  async function setEntries(id: number, entries: unknown): Promise<{ status: number; body: ApiResponse<Song> }> {
    const response = await app.inject({ method: 'PUT', url: `/api/songs/${id}/entries`, payload: { entries } });
    return { status: response.statusCode, body: response.json() as ApiResponse<Song> };
  }

  it('곡집과 번호를 붙인다', async () => {
    const { body } = await setEntries(target, [{ songbookId: 'hymn_new', number: 42 }]);
    const entry = body.data!.entries.find((e) => e.songbookId === 'hymn_new');
    expect(entry?.number).toBe(42);
    // 통째로 교체다 — 전에 있던 '기타' 는 남지 않는다
    expect(body.data!.entries.some((e) => e.songbookId === 'misc')).toBe(false);
  });

  it('번호를 null 로 주면 번호 없는 수록이 된다', async () => {
    const { body } = await setEntries(target, [{ songbookId: 'hymn_new', number: null }]);
    expect(body.data!.entries.find((e) => e.songbookId === 'hymn_new')?.number).toBeUndefined();
  });

  it('여러 곡집에 함께 실을 수 있다', async () => {
    const { body } = await setEntries(target, [
      { songbookId: 'hymn_new', number: 305 },
      { songbookId: 'hymn_old', number: 405 },
    ]);
    expect(body.data!.entries.map((e) => `${e.songbookShortLabel}${e.number}`).sort()).toEqual(['새305', '통405']);
  });

  /**
   * `song_entries` 의 기본키가 `(song_id, songbook_id)` 라 같은 곡집을 두 번 넣으면
   * 하나로 합쳐진다. 화면은 ＋ 목록에서 이미 쓴 곡집을 빼서 이 상황을 막는데,
   * 서버 쪽에서도 데이터가 깨지지 않는다는 것을 못 박아 둔다.
   */
  it('같은 곡집을 두 번 넣으면 하나로 합쳐진다 (마지막 값)', async () => {
    const { body } = await setEntries(target, [
      { songbookId: 'hymn_new', number: 1 },
      { songbookId: 'hymn_new', number: 2 },
    ]);
    const found = body.data!.entries.filter((e) => e.songbookId === 'hymn_new');
    expect(found).toHaveLength(1);
    expect(found[0]!.number).toBe(2);
  });

  /** 곡이 어느 곡집에도 없으면 목록에서 사라진다 — 서버가 '기타' 로 떨어뜨린다 */
  it('빈 목록을 보내면 기타 곡집으로 떨어진다', async () => {
    const { body } = await setEntries(target, []);
    expect(body.data!.entries.map((e) => e.songbookId)).toEqual(['misc']);
  });

  it('없는 곡집은 버린다 — 유령 수록이 생기면 안 된다', async () => {
    const { body } = await setEntries(target, [
      { songbookId: '없는곡집', number: 7 },
      { songbookId: 'hymn_new', number: 8 },
    ]);
    expect(body.data!.entries.map((e) => e.songbookId)).toEqual(['hymn_new']);
  });

  it('entries 가 배열이 아니면 400, 없는 곡은 404', async () => {
    expect((await setEntries(target, '새305')).status).toBe(400);
    expect((await setEntries(999999, [{ songbookId: 'hymn_new' }])).status).toBe(404);
  });
});

/**
 * 찬양 REST 통합 테스트 — 임시 songs.sqlite 에 직접 곡을 넣고 검증한다.
 *
 * vitest.config.ts 가 SERMON_DATA_DIR 을 .test-data 로 돌려놓아
 * 실제 찬송가 데이터는 건드리지 않는다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

  it('3개 이상 언어를 요청해도 2개로 자른다', async () => {
    const { body } = await get<{ langs: string[] }>(`/api/songs/${hymnId}/deck?langs=ko,en,zh`);
    expect(body.data!.langs).toHaveLength(2);
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

/**
 * 줄나눔 검토 API 통합 테스트.
 *
 * 검토는 **되돌릴 수 없는 약속**을 만든다 — 승인한 곡은 이후 자동 작업에서
 * 제외되므로, 승인 표시가 정확히 그 곡에만 붙어야 한다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { alignVerses } from '../../lib/meter-align.ts';
import { buildApp } from '../../server/app.ts';
import * as store from '../../server/db/songs.ts';
import type { ApiResponse, ReviewQueue, Song } from '../../shared/types.ts';

let app: FastifyInstance;
let evenSong: number;
let unevenSong: number;

function verse(label: string, texts: readonly string[]) {
  return {
    kind: 'verse' as const,
    label,
    lines: texts.map((text, lineIndex) => ({ lineIndex, lang: 'ko' as const, text })),
  };
}

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();

  store.initSongsDb();
  store.deleteBySource('review-test');

  evenSong = store.createSong({
    title: '절마다 행 수 같은 곡',
    source: 'review-test',
    entries: [{ songbookId: 'misc' }],
    linesSource: 'auto',
    sections: [verse('1절', ['첫째 줄이다', '둘째 줄이다']), verse('2절', ['셋째 줄이다', '넷째 줄이다'])],
  });

  unevenSong = store.createSong({
    title: '절마다 행 수 다른 곡',
    source: 'review-test',
    entries: [{ songbookId: 'misc' }],
    linesSource: 'auto',
    sections: [verse('1절', ['한 줄뿐이다']), verse('2절', ['첫째 줄이다', '둘째 줄이다'])],
  });
});

afterAll(async () => {
  store.deleteBySource('review-test');
  await app.close();
  store.closeSongsDb();
});

async function get<T>(url: string): Promise<{ status: number; body: ApiResponse<T> }> {
  const response = await app.inject({ method: 'GET', url });
  return { status: response.statusCode, body: response.json() as ApiResponse<T> };
}

async function call<T>(method: 'POST' | 'DELETE', url: string): Promise<{ status: number; body: ApiResponse<T> }> {
  const response = await app.inject({ method, url, payload: {} });
  return { status: response.statusCode, body: response.json() as ApiResponse<T> };
}

const queue = async (query = '') => (await get<ReviewQueue>(`/api/songs/review${query}`)).body.data!;

describe('검토 대기열', () => {
  it('/api/songs/review 가 :id 라우트에 먹히지 않는다', async () => {
    // 'review' 가 곡 id 로 해석되면 404 가 된다 — 정적 경로가 우선해야 한다
    const { status, body } = await get<ReviewQueue>('/api/songs/review');
    expect(status).toBe(200);
    expect(Array.isArray(body.data!.items)).toBe(true);
  });

  it('미확인 곡을 목록에 담는다', async () => {
    const result = await queue('?pending=true&limit=200');
    expect(result.items.some((item) => item.id === evenSong)).toBe(true);
  });

  it('홀수 행이 남은 곡을 손봐야 할 곡으로 표시한다', async () => {
    // unevenSong 의 1절은 한 줄뿐이다 — 2줄씩 표시에서 고아 줄이 된다
    const result = await queue('?limit=200');
    const uneven = result.items.find((item) => item.id === unevenSong);
    expect(uneven?.needsAttention).toBe(true);
    expect(uneven?.attentionReasons.some((reason) => reason.includes('홀수'))).toBe(true);

    // evenSong 은 절마다 2행씩이라 손볼 것이 없다
    expect(result.items.find((item) => item.id === evenSong)?.needsAttention).toBe(false);
  });

  it('절이 하나뿐인 곡도 손봐야 할 곡이다', async () => {
    // 절 간 정렬을 못 했으므로 초안이 아니라 원본 줄나눔이 그대로 남아 있다
    const single = store.createSong({
      title: '절이 하나뿐인 곡',
      source: 'review-test',
      entries: [{ songbookId: 'misc' }],
      linesSource: 'auto',
      sections: [verse('1절', ['첫째 줄이다', '둘째 줄이다'])],
    });

    const result = await queue('?limit=200');
    const item = result.items.find((entry) => entry.id === single);
    expect(item?.needsAttention).toBe(true);
    expect(item?.attentionReasons.some((reason) => reason.includes('절이 하나뿐'))).toBe(true);
  });

  it('손봐야 할 곡 순으로 정렬한다', async () => {
    const result = await queue('?sort=attention&limit=200');
    const firstFlagged = result.items.findIndex((item) => item.needsAttention);
    const firstClean = result.items.findIndex((item) => !item.needsAttention);
    if (firstFlagged !== -1 && firstClean !== -1) expect(firstFlagged).toBeLessThan(firstClean);
  });

  it('곡집으로 범위를 좁힌다', async () => {
    const misc = await queue('?book=misc&limit=200');
    expect(misc.items.some((item) => item.id === evenSong)).toBe(true);

    const hymns = await queue('?book=hymn_new&limit=200');
    expect(hymns.items.some((item) => item.id === evenSong)).toBe(false);
  });

  it('limit 을 넘겨 페이지를 자른다', async () => {
    const result = await queue('?limit=1');
    expect(result.items).toHaveLength(1);
  });
});

describe('승인', () => {
  it('승인하면 확인 완료가 된다', async () => {
    const { status } = await call('POST', `/api/songs/${evenSong}/confirm`);
    expect(status).toBe(200);

    const rows = store.listSectionRows(evenSong);
    expect(rows.every((row) => row.linesSource === 'manual')).toBe(true);
  });

  it('승인한 곡은 자동 작업에서 빠진다', async () => {
    // 재정렬은 lines_source 가 'auto' 인 섹션만 건드린다
    const rows = store.listSectionRows(evenSong);
    expect(rows.some((row) => row.linesSource === 'auto')).toBe(false);
  });

  it('승인은 그 곡에만 붙는다', async () => {
    const rows = store.listSectionRows(unevenSong);
    expect(rows.every((row) => row.linesSource === 'auto')).toBe(true);
  });

  it('미확인 목록에서 사라진다', async () => {
    const result = await queue('?pending=true&limit=200');
    expect(result.items.some((item) => item.id === evenSong)).toBe(false);
  });

  it('가사를 바꾸지 않는다', async () => {
    const song = (await get<{ song: Song }>(`/api/songs/${evenSong}`)).body.data!.song;
    expect(song.sections[0]!.lines.map((line) => line.text)).toEqual(['첫째 줄이다', '둘째 줄이다']);
  });

  it('되돌리면 다시 미확인이 된다', async () => {
    await call('DELETE', `/api/songs/${evenSong}/confirm`);
    expect(store.listSectionRows(evenSong).every((row) => row.linesSource === 'auto')).toBe(true);

    const result = await queue('?pending=true&limit=200');
    expect(result.items.some((item) => item.id === evenSong)).toBe(true);
  });

  it('없는 곡은 404', async () => {
    expect((await call('POST', '/api/songs/999999/confirm')).status).toBe(404);
    expect((await call('DELETE', '/api/songs/999999/confirm')).status).toBe(404);
  });

  it('확인 수를 함께 준다 (진행률 표시용)', async () => {
    const before = (await queue('?limit=1')).confirmed;
    await call('POST', `/api/songs/${evenSong}/confirm`);
    expect((await queue('?limit=1')).confirmed).toBe(before + 1);
    await call('DELETE', `/api/songs/${evenSong}/confirm`);
  });
});

describe('초안 품질 — 검토가 필요한 이유', () => {
  it('절이 하나뿐인 곡은 정렬할 수 없어 초안이 없다', () => {
    // 이런 곡은 검토 화면에서 사람이 직접 손봐야 한다
    expect(alignVerses(['혼자 있는 절이라 비교할 대상이 없다'])).toBeNull();
  });
});

describe('가사 저장 — 본문 보존', () => {
  it('편집한 그대로 저장된다 (줄이 합쳐지거나 공백이 사라지지 않는다)', async () => {
    // 검토 화면에서 저장했을 때 3행이 2행으로 바뀌고 어절이 붙는 일이 있었다.
    // 저장 경로가 본문을 건드리지 않는다는 것을 고정한다.
    const text = [
      '[1절]',
      '성부 성자와 성령 찬송과 영광 돌려',
      '보내세 태초로 지금까지 또 영원',
      '무궁토록 성 삼위께 영광 영광',
    ].join('\n');

    const response = await app.inject({
      method: 'PUT',
      url: `/api/songs/${unevenSong}/lyrics`,
      payload: { text },
    });
    expect(response.statusCode).toBe(200);

    const saved = (response.json() as ApiResponse<{ song: Song }>).data!.song;
    expect(saved.sections).toHaveLength(1);
    expect(saved.sections[0]!.lines.map((line) => line.text)).toEqual([
      '성부 성자와 성령 찬송과 영광 돌려',
      '보내세 태초로 지금까지 또 영원',
      '무궁토록 성 삼위께 영광 영광',
    ]);
  });

  it('저장하면 확인 완료가 된다 (사람이 고친 것이 곧 확인이다)', () => {
    expect(store.listSectionRows(unevenSong).every((row) => row.linesSource === 'manual')).toBe(true);
  });

  it('빈 텍스트는 거부한다 (실수로 가사를 지우지 않게)', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: `/api/songs/${unevenSong}/lyrics`,
      payload: { text: '   ' },
    });
    expect(response.statusCode).toBe(400);
    // 거부됐으므로 가사는 그대로다
    expect(store.getSong(unevenSong)!.sections[0]!.lines.length).toBeGreaterThan(0);
  });
});

describe('승인 표시가 드러난다', () => {
  it('검색 결과에 confirmed 가 실린다', async () => {
    await call('POST', `/api/songs/${evenSong}/confirm`);
    const result = (await get<{ hits: Array<{ id: number; confirmed?: boolean }> }>(
      '/api/songs?q=절마다 행 수 같은 곡',
    )).body.data!;
    expect(result.hits.find((hit) => hit.id === evenSong)?.confirmed).toBe(true);
  });

  it('곡 정보에도 실린다', async () => {
    expect(store.getSong(evenSong)?.confirmed).toBe(true);
  });

  it('승인하지 않은 곡에는 표시가 없다', () => {
    // unevenSong 은 앞선 저장 테스트에서 이미 확인 처리됐으므로 새 곡으로 본다
    const fresh = store.createSong({
      title: '승인 안 한 곡',
      source: 'review-test',
      entries: [{ songbookId: 'misc' }],
      linesSource: 'auto',
      sections: [verse('1절', ['첫째 줄이다', '둘째 줄이다'])],
    });
    expect(store.getSong(fresh)?.confirmed).toBeUndefined();
  });

  it('되돌리면 표시가 사라진다', async () => {
    await call('DELETE', `/api/songs/${evenSong}/confirm`);
    expect(store.getSong(evenSong)?.confirmed).toBeUndefined();
  });
});

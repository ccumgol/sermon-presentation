/**
 * 악보 단 경계 검토 REST — 155장을 사람이 훑는 화면이 쓰는 길.
 *
 * 확인하려는 것: 기계가 든 손(`needs_review`)과 사람의 답(`review_state`)이
 * **끝까지 따로 남는가.** 뭉쳐 버리면 같은 장을 몇 번이고 다시 보게 된다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as sheets from '../../server/db/sheets.ts';
import * as store from '../../server/db/songs.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

const SONGBOOK = 'hymn_new';
const SOURCE = 'sheet_review_test';
/** 실제 자료와 겹치지 않는 번호대 */
const ODD = 9101;   // 마지막 단이 4줄 — 봐야 하는 장
const FINE = 9102;  // 다 5줄 — 목록에 없어야 한다

interface ReviewList {
  counts: { total: number; needsReview: number; reviewed: number };
  items: Array<{
    songbookId: string; number: number; src: string; width: number; height: number;
    systems: Array<{ from: number; to: number; lineCount: number }>;
    titles: string[]; reviewState?: string;
  }>;
}

function five(from: number) {
  return { from, to: from + 100, lineCount: 5 };
}

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();

  store.initSongsDb();
  store.deleteBySource(SOURCE);

  for (const [number, title] of [[ODD, '줄이 모자란 악보'], [FINE, '멀쩡한 악보']] as const) {
    store.createSong({
      title,
      source: SOURCE,
      entries: [{ songbookId: SONGBOOK, number }],
      sections: [{ kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: '가사' }] }],
    });
  }

  sheets.putSheet(store.conn(), {
    songbookId: SONGBOOK, number: ODD, width: 900, height: 1200,
    systems: [five(100), five(300), { from: 500, to: 600, lineCount: 4 }],
    needsReview: true,
  });
  sheets.putSheet(store.conn(), {
    songbookId: SONGBOOK, number: FINE, width: 900, height: 1200,
    systems: [five(100), five(300)],
    needsReview: false,
  });
});

afterAll(async () => {
  store.deleteBySource(SOURCE);
  await app.close();
});

beforeEach(() => {
  sheets.setSheetReview(store.conn(), SONGBOOK, ODD, undefined);
});

async function listOurs(): Promise<ReviewList['items']> {
  const res = await app.inject({ method: 'GET', url: `/api/sheets/review?book=${SONGBOOK}` });
  const body = res.json() as ApiResponse<ReviewList>;
  return body.data!.items.filter((item) => item.number === ODD || item.number === FINE);
}

function judge(number: number, state: unknown) {
  return app.inject({
    method: 'PUT',
    url: `/api/sheets/${SONGBOOK}/${number}/review`,
    payload: { state },
  });
}

describe('검토 목록', () => {
  it('봐야 하는 장만 준다 — 멀쩡한 장은 빼야 훑을 수 있다', async () => {
    const ours = await listOurs();
    expect(ours.map((item) => item.number)).toEqual([ODD]);
  });

  /** 번호만 있으면 '이게 무슨 곡이지' 를 다른 탭에서 찾느라 손이 끊긴다 */
  it('곡 제목을 함께 준다', async () => {
    expect((await listOurs())[0]!.titles).toEqual(['줄이 모자란 악보']);
  });

  /** 그림 위에 경계를 겹쳐 그리려면 주소와 원본 높이가 함께 와야 한다 */
  it('그림 주소·크기·단 경계가 함께 온다', async () => {
    const item = (await listOurs())[0]!;
    expect(item.src).toBe(`/sheets/${SONGBOOK}/9101.webp`);
    expect(item.height).toBe(1200);
    expect(item.systems.map((one) => one.lineCount)).toEqual([5, 5, 4]);
  });

  it('처음에는 판정이 없다', async () => {
    expect((await listOurs())[0]!.reviewState).toBeUndefined();
  });
});

describe('판정', () => {
  it('남는다', async () => {
    expect((await judge(ODD, 'ok')).statusCode).toBe(200);
    expect((await listOurs())[0]!.reviewState).toBe('ok');
  });

  /** 뺐다면 방금 누른 것이 사라져 잘못 눌렀는지 확인할 수 없다 */
  it('판정한 장도 목록에 남는다', async () => {
    await judge(ODD, 'bad');
    expect((await listOurs()).map((item) => item.number)).toEqual([ODD]);
  });

  it('null 이면 안 본 것으로 되돌린다', async () => {
    await judge(ODD, 'ok');
    expect((await judge(ODD, null)).statusCode).toBe(200);
    expect((await listOurs())[0]!.reviewState).toBeUndefined();
  });

  it('모르는 값은 400 — 조용히 삼키지 않는다', async () => {
    await judge(ODD, 'ok');
    expect((await judge(ODD, '글쎄')).statusCode).toBe(400);
    expect((await listOurs())[0]!.reviewState).toBe('ok');
  });

  it('악보가 없는 자리는 404', async () => {
    expect((await judge(9999, 'ok')).statusCode).toBe(404);
  });

  it('번호가 숫자가 아니면 400', async () => {
    const res = await app.inject({
      method: 'PUT', url: `/api/sheets/${SONGBOOK}/abc/review`, payload: { state: 'ok' },
    });
    expect(res.statusCode).toBe(400);
  });
});

/**
 * 검출을 다시 돌려도 사람의 판정은 남아야 한다 — ⑦ 의 `layout` 과 같은 규칙이다.
 * 이것이 깨지면 155장을 훑은 일이 통째로 날아간다.
 */
it('다시 검출해도 판정이 남는다', async () => {
  await judge(ODD, 'ok');
  sheets.putSheet(store.conn(), {
    songbookId: SONGBOOK, number: ODD, width: 950, height: 1300,
    systems: [five(100), { from: 500, to: 600, lineCount: 6 }],
    needsReview: true,
  });

  const item = (await listOurs())[0]!;
  expect(item.height).toBe(1300);       // 검출 결과는 갱신되고
  expect(item.reviewState).toBe('ok');  // 사람의 판정은 그대로다
});

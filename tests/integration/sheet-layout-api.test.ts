/**
 * 악보 모양을 사람이 고치는 길 — REST 통합 테스트.
 *
 * 확인하려는 것 하나: **고른 값이 실제로 화면에 나가는 것을 바꾸는가.** 저장은
 * 되는데 덱이 옛 짐작을 그대로 쓰면 사용자 눈에는 아무 일도 일어나지 않는다.
 *
 * vitest.config.ts 가 SERMON_DATA_DIR 을 .test-data 로 돌려놓아 실제 데이터는
 * 건드리지 않는다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as sheets from '../../server/db/sheets.ts';
import * as store from '../../server/db/songs.ts';
import type { ApiResponse, Deck, Song } from '../../shared/types.ts';

let app: FastifyInstance;
let songId: number;

/** 2절 × 3줄, 단 6개 → 짐작은 '이어 적힘' 이 된다 */
const SONGBOOK = 'hymn_new';
const NUMBER = 9001;
/** 곡을 지울 때 쓰는 표식 — 다른 테스트의 hymn_new 곡을 쓸어 가면 안 된다 */
const SOURCE = 'sheet_layout_test';

function verse(label: string, texts: string[]) {
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
  store.deleteBySource(SOURCE);

  songId = store.createSong({
    title: '악보 모양 시험곡',
    source: SOURCE,
    entries: [{ songbookId: SONGBOOK, number: NUMBER }],
    sections: [
      verse('1절', ['한 줄', '두 줄', '석 줄']),
      verse('2절', ['넉 줄', '닷 줄', '엿 줄']),
    ],
  });

  sheets.putSheet(store.conn(), {
    songbookId: SONGBOOK,
    number: NUMBER,
    width: 900,
    height: 1200,
    systems: Array.from({ length: 6 }, (_, i) => ({ from: i * 200, to: i * 200 + 100, lineCount: 5 })),
    needsReview: false,
  });
});

afterAll(async () => {
  store.deleteBySource(SOURCE);
  await app.close();
});

/** 고른 값을 지워 자동 짐작 상태에서 시작한다 */
beforeEach(() => {
  sheets.setSheetLayout(store.conn(), SONGBOOK, NUMBER, undefined);
});

async function summary(): Promise<{ layout: string; chosen: boolean; uncertain: boolean }> {
  const res = await app.inject({ method: 'GET', url: `/api/songs/${songId}` });
  const body = res.json() as ApiResponse<{
    song: Song;
    sheet?: { layout: string; chosen: boolean; uncertain: boolean };
  }>;
  return body.data!.sheet!;
}

/**
 * 슬라이드마다 몇 번째 단이 붙었는지.
 *
 * `sheet=1` 을 붙인다 — **악보는 요청해야 실린다**(2026-09-04 사용자 결정).
 * 기본은 가사다.
 */
async function systemsOfDeck(sheet = true): Promise<Array<number | undefined>> {
  const query = `langs=ko&lines=1${sheet ? '&sheet=1' : ''}`;
  const res = await app.inject({ method: 'GET', url: `/api/songs/${songId}/deck?${query}` });
  const body = res.json() as ApiResponse<{ deck: Deck }>;
  return body.data!.deck.slides.map((slide) => (slide.kind === 'song' ? slide.sheet?.system : undefined));
}

function put(layout: unknown) {
  return app.inject({
    method: 'PUT',
    url: `/api/sheets/${SONGBOOK}/${NUMBER}/layout`,
    payload: { layout },
  });
}

describe('악보 모양 고르기', () => {
  it('처음에는 짐작한 값이고 chosen 이 아니다', async () => {
    const before = await summary();
    expect(before.chosen).toBe(false);
    // 2절×3줄 = 6줄, 단 6개 → 이어 적힘으로 짐작한다
    expect(before.layout).toBe('sequential');
  });

  it('고른 값이 요약에 그대로 나온다', async () => {
    expect((await put('shared')).statusCode).toBe(200);
    expect(await summary()).toMatchObject({ layout: 'shared', chosen: true });
  });

  /**
   * 이 검사가 이 기능의 값어치다 — 저장만 되고 덱이 안 바뀌면 사용자에게는
   * 아무 일도 일어나지 않은 것과 같다.
   */
  /**
   * **기본은 가사다.** 단 경계 자동 검출이 아직 불완전해, 틀린 자리가 벽에 걸리는
   * 것보다 가사가 낫다 (2026-09-04 사용자 결정). 이 규칙이 깨지면 아무도 켜지
   * 않은 악보가 예배 중에 나간다.
   */
  it('요청하지 않으면 악보를 싣지 않는다', async () => {
    expect(await systemsOfDeck(false)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('고르면 슬라이드에 붙는 단이 실제로 달라진다', async () => {
    // 이어 적힘: 여섯 슬라이드가 여섯 단에 하나씩
    expect(await systemsOfDeck()).toEqual([1, 2, 3, 4, 5, 6]);

    await put('shared');
    // 겹쳐 적힘: 두 절이 같은 여섯 단을 나눠 쓴다 → 절마다 1·3·5 단
    expect(await systemsOfDeck()).toEqual([1, 3, 5, 1, 3, 5]);
  });

  /**
   * 사람이 골랐다고 '흔들릴 수 있음' 경고가 사라지면 안 된다. 모양을 정한 것과
   * 줄 수·단 수가 어긋나는 것은 **다른 문제**다 — 여기서는 2절×3줄인데 단이 6개라,
   * '겹쳐' 로 보면 절마다 단 하나씩을 건너뛰게 되어 여전히 눈으로 봐야 한다.
   */
  it('사람이 골라도 어긋남 경고는 남는다', async () => {
    await put('shared');
    expect((await summary()).uncertain).toBe(true);
  });

  it('null 을 주면 자동 짐작으로 되돌아간다', async () => {
    await put('shared');
    expect((await put(null)).statusCode).toBe(200);

    const back = await summary();
    expect(back.chosen).toBe(false);
    expect(back.layout).toBe('sequential');
  });

  it('모르는 값은 400 — 조용히 자동으로 떨어뜨리지 않는다', async () => {
    await put('shared');
    expect((await put('wobbly')).statusCode).toBe(400);
    // 있던 값이 지워지지도 않는다
    expect((await summary()).layout).toBe('shared');
  });

  it('악보가 없는 자리는 404 — 단 경계가 없으면 모양을 정할 것도 없다', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/sheets/${SONGBOOK}/9998/layout`,
      payload: { layout: 'shared' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('번호가 숫자가 아니면 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/api/sheets/${SONGBOOK}/abc/layout`,
      payload: { layout: 'shared' },
    });
    expect(res.statusCode).toBe(400);
  });
});

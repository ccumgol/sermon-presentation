/**
 * 교독문 저장소·API·순서 항목 통합 테스트.
 *
 * 본문은 **직접 지어낸 것**을 넣는다 — 실제 파일은 개역개정 저작 본문이라
 * 리포지토리에 들어갈 수 없다. 여기서 확인하는 것은 구조와 경계다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import { getConnection } from '../../server/db/app.ts';
import * as planStore from '../../server/db/plans.ts';
import * as store from '../../server/db/readings.ts';
import type { ApiResponse, CueItem, ServicePlan } from '../../shared/types.ts';

let app: FastifyInstance;
const createdPlanIds: number[] = [];

/** 이 테스트가 넣은 것만 지우기 위한 출처 표시 */
const SOURCE = 'test-readings';

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();

  store.initReadingStore();
  store.deleteBySource(SOURCE);
  /*
   * 앞선 실행이 중간에 끊기면 900번대가 검사용 DB 에 남는다. 그러면 다음 실행의
   * 목록 검사가 **엉뚱한 이유로 깨지고**, 고치려는 사람은 코드를 뒤지게 된다
   * (2026-09-09 실제로 한 번 겪었다). 900번대는 이 파일의 것이니 먼저 비운다.
   */
  getConnection().prepare('DELETE FROM responsive_readings WHERE number >= 900').run();
  store.upsertReadings(
    [
      {
        number: 901,
        title: '시험용 교독문',
        lines: ['인도자 첫 줄', '회중 첫 줄', '인도자 둘째 줄', '회중 둘째 줄', '(다같이) 마지막 줄 (1-6)'],
      },
      { number: 902, title: '짝수 교독문', lines: ['가', '나'] },
    ],
    SOURCE,
  );
});

afterAll(async () => {
  store.deleteBySource(SOURCE);
  for (const id of createdPlanIds) planStore.deletePlan(id);
  await app.close();
});

async function getJson<T>(url: string): Promise<{ status: number; body: ApiResponse<T> }> {
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() as ApiResponse<T> };
}

describe('목록', () => {
  interface ListBody {
    total: number;
    items: Array<{ number: number; title: string; lineCount: number; slideCount: number }>;
  }

  it('번호·제목·화면 수를 주고 본문 줄은 보내지 않는다', async () => {
    const { body } = await getJson<ListBody>('/api/readings');
    const mine = body.data!.items.filter((i) => i.number >= 901);
    expect(mine.map((i) => i.number)).toEqual([901, 902]);

    const first = mine[0]!;
    expect(first.lineCount).toBe(5);
    // 5줄 → 인도자·회중 두 짝 + 다같이 한 줄 = 3화면
    expect(first.slideCount).toBe(3);
    // 목록 응답이 본문을 싣지 않는다는 것을 못박는다 (76편이면 70KB 가 넘는다)
    expect(JSON.stringify(first)).not.toContain('인도자 첫 줄');
  });

  it('번호로 찾는다', async () => {
    const { body } = await getJson<ListBody>('/api/readings?q=901');
    expect(body.data!.items.map((i) => i.number)).toEqual([901]);
  });

  it('제목으로 찾는다', async () => {
    const { body } = await getJson<ListBody>('/api/readings?q=짝수');
    expect(body.data!.items.map((i) => i.number)).toEqual([902]);
  });

  it('본문 낱말로도 찾는다 — 첫 구절만 기억날 때가 있다', async () => {
    const { body } = await getJson<ListBody>('/api/readings?q=회중 둘째');
    expect(body.data!.items.map((i) => i.number)).toEqual([901]);
  });

  it('전체 개수는 검색과 무관하게 알려 준다', async () => {
    const all = await getJson<ListBody>('/api/readings');
    const some = await getJson<ListBody>('/api/readings?q=901');
    expect(some.body.data!.total).toBe(all.body.data!.total);
  });
});

describe('한 편 읽기', () => {
  interface OneBody {
    number: number;
    title: string;
    lines: string[];
    slides: Array<{ leader: string; people?: string }>;
  }

  it('줄과 화면 묶음을 함께 준다', async () => {
    const { body } = await getJson<OneBody>('/api/readings/901');
    expect(body.data!.title).toBe('시험용 교독문');
    expect(body.data!.slides).toEqual([
      { leader: '인도자 첫 줄', people: '회중 첫 줄' },
      { leader: '인도자 둘째 줄', people: '회중 둘째 줄' },
      { leader: '(다같이) 마지막 줄 (1-6)' },
    ]);
  });

  it('본문을 한 글자도 고치지 않는다 — 성구 표기·절 범위·(다같이) 그대로', async () => {
    const { body } = await getJson<OneBody>('/api/readings/901');
    expect(body.data!.lines[4]).toBe('(다같이) 마지막 줄 (1-6)');
  });

  it('없는 번호는 404 와 함께 무엇을 해야 하는지 알려 준다', async () => {
    const { status, body } = await getJson<OneBody>('/api/readings/9999');
    expect(status).toBe(404);
    expect(body.error).toContain('가져오기');
  });
});

describe('저장소', () => {
  it('같은 번호는 덮어쓴다 — 파일을 고쳐 다시 가져오는 것이 정상 흐름이다', () => {
    store.upsertReadings([{ number: 901, title: '고친 제목', lines: ['한 줄', '두 줄'] }], SOURCE);
    const reading = store.getReading(901);
    expect(reading?.title).toBe('고친 제목');
    expect(reading?.lines).toEqual(['한 줄', '두 줄']);
    // 되돌려 둔다 (뒤 테스트가 원래 모양을 기대할 수 있다)
    store.upsertReadings(
      [{ number: 901, title: '시험용 교독문', lines: ['인도자 첫 줄', '회중 첫 줄'] }],
      SOURCE,
    );
  });

  it('없는 번호는 undefined — 던지지 않는다', () => {
    expect(store.getReading(99_999)).toBeUndefined();
    expect(store.getReading(1.5)).toBeUndefined();
  });

  /**
   * **줄 목록이 깨져 있어도 목록 전체가 살아 있어야 한다** (`readings.ts` 머리말).
   *
   * 줄은 JSON 한 칸에 담긴다. 그 칸이 깨지면(옛 판에서 온 자료·손으로 고친 DB)
   * `JSON.parse` 가 던지는데, 그것이 위로 새어 나가면 **교독문 하나 때문에 목록이
   * 통째로 안 열린다.** 예배 준비가 막히는 실패다.
   *
   * 그래서 빈 줄 목록으로 두고 넘어간다 — 컨트롤 패널이 '표시할 내용이 없습니다' 로
   * 알려 주고, 나머지 교독문은 그대로 쓸 수 있다.
   */
  it('줄이 깨진 교독문이 있어도 목록이 죽지 않는다', () => {
    const conn = getConnection();
    const insert = conn.prepare(
      `INSERT INTO responsive_readings (book, number, title, lines, source, updated_at)
       VALUES ('hymn_old', ?, ?, ?, ?, '2026-01-01')
       ON CONFLICT(book, number) DO UPDATE SET lines = excluded.lines, title = excluded.title`,
    );
    insert.run(903, '깨진 교독문', '{이건 JSON 이 아니다', SOURCE);
    // 배열이 아닌 JSON · 문자열이 아닌 원소도 같은 규칙이다
    insert.run(904, '배열이 아님', '{"a":1}', SOURCE);
    insert.run(905, '섞인 배열', '["살아 있는 줄", 42, null]', SOURCE);

    const all = store.listReadings();
    const find = (number: number) => all.find((one) => one.number === number);

    expect(find(903)?.lines).toEqual([]);
    expect(find(904)?.lines).toEqual([]);
    // 문자열이 아닌 것만 걸러 내고 살릴 수 있는 줄은 살린다
    expect(find(905)?.lines).toEqual(['살아 있는 줄']);
    // 나머지가 그대로 있는 것이 이 검사의 핵심이다
    expect(find(901)?.lines.length).toBeGreaterThan(0);
  });

  /** 고르는 화면이 '빈 쪽' 을 흐리게 하는 데 쓴다 — 두 찬송가를 따로 센다 */
  it('찬송가별 편수를 센다', () => {
    store.upsertReadings([{ number: 906, title: '새찬송가용', lines: ['가'] }], SOURCE, 'hymn_new');

    const counts = store.countByBook();
    expect(counts.hymn_new).toBeGreaterThanOrEqual(1);
    expect(counts.hymn_old).toBeGreaterThanOrEqual(3);

    // 번호가 같아도 서로 다른 글이다 — 한쪽을 지워도 다른 쪽은 남는다
    const before = store.countByBook().hymn_old;
    expect(store.getReading(906, 'hymn_new')?.title).toBe('새찬송가용');
    expect(store.getReading(906, 'hymn_old')).toBeUndefined();
    expect(store.countByBook().hymn_old).toBe(before);
  });

  /**
   * 번들용 목록은 **모르는 찬송가 이름을 버린다.**
   *
   * `(book, number)` 가 열쇠라 DB 에는 어떤 글자든 들어갈 수 있다(옛 판·손으로 고친
   * DB). 그것을 그대로 번들에 실으면 받는 PC 에서 어디에도 속하지 않는 교독문이
   * 되고, 화면 어디에도 나타나지 않으면서 자리만 차지한다.
   */
  it('모르는 찬송가 이름은 번들 목록에서 뺀다', () => {
    getConnection()
      .prepare(
        `INSERT INTO responsive_readings (book, number, title, lines, source, updated_at)
         VALUES ('hymn_지어낸것', 907, '어디에도 없는 책', '["가"]', ?, '2026-01-01')`,
      )
      .run(SOURCE);

    expect(store.listAllReadings().some((one) => one.number === 907)).toBe(false);
    // 그래도 DB 에는 남아 있다 — 목록이 조용히 지우지는 않는다
    expect(store.countReadings()).toBeGreaterThan(store.listAllReadings().length);

    getConnection().prepare("DELETE FROM responsive_readings WHERE book = 'hymn_지어낸것'").run();
  });

  /**
   * **되돌릴 수 없는 길이다.** 지운 수를 정확히 돌려주지 않으면 화면이
   * '몇 편을 지웠다' 를 거짓으로 말한다.
   */
  it('출처로 지운다 — 다른 출처는 건드리지 않는다', () => {
    store.upsertReadings([{ number: 951, title: '남을 것', lines: ['가'] }], '다른-출처');
    // `source` 를 갖고 오는 것은 번들용 목록이다 — 화면용(`listReadings`)은 버린다
    const mine = store.listAllReadings().filter((one) => one.source === SOURCE).length;

    expect(store.deleteBySource(SOURCE)).toBe(mine);
    expect(store.listAllReadings().some((one) => one.source === SOURCE)).toBe(false);
    expect(store.getReading(951)?.title).toBe('남을 것');

    expect(store.deleteBySource('다른-출처')).toBe(1);
    // 없는 출처를 지우면 0 — 던지지 않는다
    expect(store.deleteBySource('있지도-않은-출처')).toBe(0);
  });
});

describe('순서 항목', () => {
  it('교독문 항목을 저장하고 제목도 남긴다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/plans',
      payload: {
        name: '교독문 항목 테스트',
        items: [{ type: 'reading', readingNumber: 901, readingTitle: '시험용 교독문' }],
      },
    });
    const body = res.json() as ApiResponse<{ plan: ServicePlan; rejected?: string[] }>;
    createdPlanIds.push(body.data!.plan.id);

    const item = body.data!.plan.items[0] as Extract<CueItem, { type: 'reading' }>;
    expect(item.type).toBe('reading');
    expect(item.readingNumber).toBe(901);
    // 가져오기를 안 한 PC 로 순서표를 옮겨도 무엇이었는지 남아야 한다
    expect(item.readingTitle).toBe('시험용 교독문');
  });

  it('번호가 없거나 이상하면 버리고 이유를 알린다', async () => {
    for (const bad of [{}, { readingNumber: 0 }, { readingNumber: -3 }, { readingNumber: 'abc' }]) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/plans',
        payload: { name: '거부', items: [{ type: 'reading', ...bad }] },
      });
      const body = res.json() as ApiResponse<{ plan: ServicePlan; rejected?: string[] }>;
      createdPlanIds.push(body.data!.plan.id);
      expect(body.data!.plan.items, JSON.stringify(bad)).toHaveLength(0);
      expect(body.data!.rejected?.join(' ')).toContain('교독문 번호');
    }
  });
});

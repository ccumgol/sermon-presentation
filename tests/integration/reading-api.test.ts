/**
 * 교독문 저장소·API·순서 항목 통합 테스트.
 *
 * 본문은 **직접 지어낸 것**을 넣는다 — 실제 파일은 개역개정 저작 본문이라
 * 리포지토리에 들어갈 수 없다. 여기서 확인하는 것은 구조와 경계다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
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

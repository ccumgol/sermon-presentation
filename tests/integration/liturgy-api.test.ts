/**
 * 주기도문·사도신경 항목의 저장·검증.
 *
 * 이 항목은 **본문을 담지 않고 어느 것인지만 담는다.** 그래서 검증이 하는 일은
 * "모르는 본문을 거부하고, 판본·장수는 이상하면 기본으로 떨어뜨리는" 것이다.
 * 판본이 이상하다고 항목을 버리면 예배 순서에서 한 순서가 통째로 사라진다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as planStore from '../../server/db/plans.ts';
import type { ApiResponse, CueItem, ServicePlan } from '../../shared/types.ts';

let app: FastifyInstance;
const createdPlanIds: number[] = [];

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  for (const id of createdPlanIds) planStore.deletePlan(id);
  await app.close();
});

/** 만들기 응답은 `{ plan, rejected? }` — 버린 항목을 조용히 넘기지 않기 위해서다 */
type PlanResponse = ApiResponse<{ plan: ServicePlan; rejected?: string[] }>;

async function post(payload: Record<string, unknown>): Promise<PlanResponse> {
  const res = await app.inject({ method: 'POST', url: '/api/plans', payload });
  const body = res.json() as PlanResponse;
  if (body.data?.plan) createdPlanIds.push(body.data.plan.id);
  return body;
}

async function createPlan(items: unknown[], extra: Record<string, unknown> = {}): Promise<ServicePlan> {
  const body = await post({ name: '전례문 테스트', items, ...extra });
  expect(body.success, body.error ?? '').toBe(true);
  return body.data!.plan;
}

function liturgyOf(plan: ServicePlan): Extract<CueItem, { type: 'liturgy' }> {
  const item = plan.items.find((i) => i.type === 'liturgy');
  expect(item, '전례문 항목이 저장되지 않았습니다').toBeDefined();
  return item as Extract<CueItem, { type: 'liturgy' }>;
}

describe('전례문 항목 저장', () => {
  it('주기도문·사도신경이 저장되고 다시 읽힌다', async () => {
    const plan = await createPlan([
      { type: 'liturgy', textId: 'lords-prayer', version: 'new' },
      { type: 'liturgy', textId: 'apostles-creed', version: 'traditional' },
    ]);

    const kinds = plan.items.map((i) => i.type);
    expect(kinds).toEqual(['liturgy', 'liturgy']);

    const [prayer, creed] = plan.items as Array<Extract<CueItem, { type: 'liturgy' }>>;
    expect(prayer!.textId).toBe('lords-prayer');
    expect(prayer!.version).toBe('new');
    expect(creed!.version).toBe('traditional');

    // id 를 안 보내도 서버가 발급한다 — 없으면 재배치가 깨진다
    expect(prayer!.id.length).toBeGreaterThan(0);
    expect(prayer!.id).not.toBe(creed!.id);
  });

  it('모르는 본문은 버리고 이유를 알린다 — 조용히 넘기지 않는다', async () => {
    const body = await post({
      name: '거부',
      items: [{ type: 'liturgy', textId: 'nicene-creed', version: 'new' }],
    });
    expect(body.data!.plan.items).toHaveLength(0);
    expect(body.data!.rejected?.join(' ')).toContain('nicene-creed');
  });

  it('이상한 판본은 항목을 버리지 않고 새번역으로 떨어뜨린다', async () => {
    // 순서가 통째로 사라지는 것이 잘못된 판본으로 나가는 것보다 나쁘다
    const plan = await createPlan([{ type: 'liturgy', textId: 'lords-prayer', version: '옛날것' }]);
    expect(liturgyOf(plan).version).toBe('new');
  });

  it('이상한 장수는 저장하지 않는다 — 기본값이 박히면 나중에 기본을 못 바꾼다', async () => {
    const plan = await createPlan([
      { type: 'liturgy', textId: 'lords-prayer', version: 'new', perSlide: 5 },
    ]);
    expect(liturgyOf(plan).perSlide).toBeUndefined();
  });

  it('아는 장수는 그대로 저장한다', async () => {
    const plan = await createPlan([
      { type: 'liturgy', textId: 'apostles-creed', version: 'new', perSlide: 0 },
    ]);
    expect(liturgyOf(plan).perSlide).toBe(0);
  });
});

describe('직접 고친 본문', () => {
  it('고친 본문이 저장된다', async () => {
    const plan = await createPlan([
      {
        type: 'liturgy',
        textId: 'lords-prayer',
        version: 'traditional',
        overrideLines: ['나라가 임하옵시며', '아멘'],
      },
    ]);
    expect(liturgyOf(plan).overrideLines).toEqual(['나라가 임하옵시며', '아멘']);
  });

  it('빈 줄과 공백을 걸러낸다', async () => {
    const plan = await createPlan([
      {
        type: 'liturgy',
        textId: 'lords-prayer',
        version: 'new',
        overrideLines: ['  하늘에 계신 우리 아버지,  ', '', '   ', '아멘.'],
      },
    ]);
    expect(liturgyOf(plan).overrideLines).toEqual(['하늘에 계신 우리 아버지,', '아멘.']);
  });

  it('전부 비면 고치지 않은 것으로 본다 — 빈 화면이 나가면 안 된다', async () => {
    const plan = await createPlan([
      { type: 'liturgy', textId: 'lords-prayer', version: 'new', overrideLines: ['', '  '] },
    ]);
    expect(liturgyOf(plan).overrideLines).toBeUndefined();
  });

  it('문자열이 아닌 값은 버린다', async () => {
    const plan = await createPlan([
      { type: 'liturgy', textId: 'lords-prayer', version: 'new', overrideLines: ['괜찮은 줄', 42, null] },
    ]);
    expect(liturgyOf(plan).overrideLines).toEqual(['괜찮은 줄']);
  });
});

describe('예배 기본 판본', () => {
  it('예배 기본값으로 판본과 장수를 담는다', async () => {
    const plan = await createPlan([], {
      defaults: { liturgy: { version: 'traditional', perSlide: 6 } },
    });
    expect(plan.defaults?.liturgy).toEqual({ version: 'traditional', perSlide: 6 });
  });

  it('모르는 값은 담지 않는다', async () => {
    const plan = await createPlan([], { defaults: { liturgy: { version: 'x', perSlide: 7 } } });
    expect(plan.defaults?.liturgy).toBeUndefined();
  });
});

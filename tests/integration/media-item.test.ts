/**
 * 그림·동영상 항목(예배 전 안내)의 저장·검증.
 *
 * 배경(`canvas.background`)과 다른 물건이다. 배경은 템플릿당 하나뿐이라 안내 그림
 * 세 장을 돌릴 수 없었다. 이 항목은 순서에 여러 장을 나란히 둘 수 있다.
 *
 * 파일 이름 검증은 **배경 업로드와 같은 함수**를 쓴다 — 같은 폴더를 가리키므로
 * 경로 이탈을 두 곳에서 따로 막으면 한쪽이 뒤처진다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as planStore from '../../server/db/plans.ts';
import { AUTO_HOLD_MS_MAX, AUTO_HOLD_MS_MIN } from '../../shared/types.ts';
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

type PlanResponse = ApiResponse<{ plan: ServicePlan; rejected?: string[] }>;

async function post(items: unknown[]): Promise<PlanResponse> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/plans',
    payload: { name: '안내 테스트', items },
  });
  const body = res.json() as PlanResponse;
  if (body.data?.plan) createdPlanIds.push(body.data.plan.id);
  return body;
}

async function createOne(item: Record<string, unknown>): Promise<Extract<CueItem, { type: 'media' }>> {
  const body = await post([item]);
  expect(body.success, body.error ?? '').toBe(true);
  const saved = body.data!.plan.items[0];
  expect(saved, `항목이 저장되지 않았습니다: ${body.data!.rejected?.join(', ')}`).toBeDefined();
  return saved as Extract<CueItem, { type: 'media' }>;
}

describe('그림·동영상 항목 저장', () => {
  it('그림과 동영상을 나란히 담는다 — 안내 여러 장이 목적이다', async () => {
    const body = await post([
      { type: 'media', src: 'notice-1.png', mediaKind: 'image' },
      { type: 'media', src: 'notice-2.png', mediaKind: 'image' },
      { type: 'media', src: 'welcome.mp4', mediaKind: 'video' },
    ]);
    const items = body.data!.plan.items as Array<Extract<CueItem, { type: 'media' }>>;
    expect(items.map((i) => i.src)).toEqual(['notice-1.png', 'notice-2.png', 'welcome.mp4']);
    expect(items.map((i) => i.mediaKind)).toEqual(['image', 'image', 'video']);
    // id 는 서버가 발급한다 — 겹치면 재배치가 꼬인다
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });

  it('맞춤은 cover 만 저장한다 — 기본(contain)이 박히면 나중에 기본을 못 바꾼다', async () => {
    expect((await createOne({ type: 'media', src: 'a.png', mediaKind: 'image' })).fit).toBeUndefined();
    expect(
      (await createOne({ type: 'media', src: 'a.png', mediaKind: 'image', fit: 'contain' })).fit,
    ).toBeUndefined();
    expect(
      (await createOne({ type: 'media', src: 'a.png', mediaKind: 'image', fit: 'cover' })).fit,
    ).toBe('cover');
  });

  it('모르는 종류는 그림으로 본다 — 항목을 버리면 안내 한 장이 사라진다', async () => {
    expect((await createOne({ type: 'media', src: 'a.png', mediaKind: 'gif' })).mediaKind).toBe('image');
  });
});

describe('파일 이름 검증 (배경과 같은 규칙)', () => {
  /**
   * 검증은 **거부가 아니라 정규화**다 (`safeBackgroundName`). 경로를 떼어 낸 뒤
   * 허용 확장자만 통과시키므로, 저장된 값은 언제나 구분자 없는 파일 이름이다 —
   * 그게 지켜야 할 성질이다. 배경 업로드와 같은 함수를 써서 두 곳이 어긋나지 않게 한다.
   */
  it('저장된 이름에는 경로가 남지 않는다', async () => {
    const saved = await createOne({ type: 'media', src: 'sub/dir/notice.png', mediaKind: 'image' });
    expect(saved.src).toBe('notice.png');
    expect(saved.src).not.toContain('/');
  });

  it('배경이 될 수 없는 이름은 거부한다', async () => {
    // '../../etc/passwd' → 'passwd' (확장자 없음) · '..' → 숨김 · '.env' → 숨김
    for (const src of ['../../etc/passwd', '/etc/passwd', '..', '.env', 'script.sh', 'notes.txt']) {
      const body = await post([{ type: 'media', src, mediaKind: 'image' }]);
      expect(body.data!.plan.items, `통과된 이름: ${src}`).toHaveLength(0);
      expect(body.data!.rejected?.join(' ')).toContain('파일 이름');
    }
  });

  it('이름이 비면 거부한다', async () => {
    const body = await post([{ type: 'media', mediaKind: 'image' }]);
    expect(body.data!.plan.items).toHaveLength(0);
    expect(body.data!.rejected?.join(' ')).toContain('파일 이름');
  });
});

describe('머무는 시간', () => {
  it('없으면 저장하지 않는다 — 구분에 설정한 시간을 쓴다는 뜻이다', async () => {
    expect((await createOne({ type: 'media', src: 'a.png', mediaKind: 'image' })).holdMs).toBeUndefined();
  });

  it('긴 안내 동영상을 위해 항목별 시간을 담는다', async () => {
    expect(
      (await createOne({ type: 'media', src: 'w.mp4', mediaKind: 'video', holdMs: 45_000 })).holdMs,
    ).toBe(45_000);
  });

  it('범위를 벗어나면 한도로 자른다', async () => {
    expect((await createOne({ type: 'media', src: 'a.png', mediaKind: 'image', holdMs: 1 })).holdMs).toBe(
      AUTO_HOLD_MS_MIN,
    );
    expect(
      (await createOne({ type: 'media', src: 'a.png', mediaKind: 'image', holdMs: 99_999_999 })).holdMs,
    ).toBe(AUTO_HOLD_MS_MAX);
  });

  it('이상한 값은 담지 않는다', async () => {
    for (const holdMs of [0, -5, 'abc', null]) {
      expect((await createOne({ type: 'media', src: 'a.png', mediaKind: 'image', holdMs })).holdMs)
        .toBeUndefined();
    }
  });
});

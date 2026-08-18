/**
 * 항목 배경(교독문·주기도문·사도신경) 저장·검증.
 *
 * 배경을 항목에 두는 이유는 3.23 참고 — 템플릿에 두면 배경을 바꿀 때마다
 * 템플릿을 새로 만들어야 한다.
 *
 * 여기서 지키는 것은 **폴더 밖을 가리킬 수 없다**는 것이다. 이름 검증은 배경
 * 업로드와 같은 함수를 쓰고, 폴더는 아는 두 값만 받는다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as planStore from '../../server/db/plans.ts';
import type { ApiResponse, CueItem, ItemBackground, ServicePlan } from '../../shared/types.ts';

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

async function post(payload: Record<string, unknown>): Promise<PlanResponse> {
  const res = await app.inject({ method: 'POST', url: '/api/plans', payload });
  const body = res.json() as PlanResponse;
  if (body.data?.plan) createdPlanIds.push(body.data.plan.id);
  return body;
}

async function backgroundOf(background: unknown, type = 'liturgy'): Promise<ItemBackground | undefined> {
  const item =
    type === 'liturgy'
      ? { type: 'liturgy', textId: 'lords-prayer', version: 'new', background }
      : { type: 'reading', readingNumber: 23, background };
  const body = await post({ name: '배경 테스트', items: [item] });
  const saved = body.data!.plan.items[0] as Extract<CueItem, { type: 'liturgy' | 'reading' }>;
  expect(saved, `항목이 저장되지 않았습니다: ${body.data!.rejected?.join(', ')}`).toBeDefined();
  return saved.background;
}

describe('배경 저장', () => {
  it('사용자 폴더(library)와 앱 폴더(data) 둘 다 담는다', async () => {
    expect(await backgroundOf({ src: 'bg_1.png', source: 'library' })).toEqual({
      src: 'bg_1.png',
      source: 'library',
    });
    expect(await backgroundOf({ src: 'sanctuary.jpg', source: 'data' })).toEqual({
      src: 'sanctuary.jpg',
      source: 'data',
    });
  });

  it('교독문 항목에도 담긴다', async () => {
    expect(await backgroundOf({ src: 'bg_2.png', source: 'library' }, 'reading')).toEqual({
      src: 'bg_2.png',
      source: 'library',
    });
  });

  it('맞춤은 contain 만 저장한다 — 기본(cover)이 박히면 나중에 기본을 못 바꾼다', async () => {
    expect((await backgroundOf({ src: 'bg_1.png', source: 'library', fit: 'cover' }))?.fit).toBeUndefined();
    expect((await backgroundOf({ src: 'bg_1.png', source: 'library', fit: 'contain' }))?.fit).toBe('contain');
  });
});

describe('폴더 밖을 가리킬 수 없다', () => {
  it('경로가 남지 않는다', async () => {
    const saved = await backgroundOf({ src: 'a/b/bg_1.png', source: 'library' });
    expect(saved?.src).toBe('bg_1.png');
    expect(saved?.src).not.toContain('/');
  });

  it('배경이 될 수 없는 이름이면 배경을 담지 않는다 — 항목은 살린다', async () => {
    for (const src of ['../../etc/passwd', '.env', 'notes.txt', '..', '']) {
      expect(await backgroundOf({ src, source: 'library' }), src).toBeUndefined();
    }
  });

  it('모르는 폴더면 배경을 담지 않는다', async () => {
    for (const source of ['etc', 'file', '', undefined, 3]) {
      expect(await backgroundOf({ src: 'bg_1.png', source }), String(source)).toBeUndefined();
    }
  });

  it('배경이 없어도 항목은 저장된다 — 배경 때문에 순서가 사라지면 안 된다', async () => {
    const body = await post({
      name: '배경 없이',
      items: [{ type: 'liturgy', textId: 'lords-prayer', version: 'new', background: { src: 'x.txt' } }],
    });
    expect(body.data!.plan.items).toHaveLength(1);
    expect((body.data!.plan.items[0] as Extract<CueItem, { type: 'liturgy' }>).background).toBeUndefined();
  });
});

describe('예배 기본 배경', () => {
  it('기본값으로 담고 다시 읽는다', async () => {
    const body = await post({
      name: '기본 배경',
      items: [],
      defaults: { readingBackground: { src: 'bg_5.png', source: 'library' } },
    });
    expect(body.data!.plan.defaults?.readingBackground).toEqual({ src: 'bg_5.png', source: 'library' });
  });

  it('이상한 값은 담지 않는다', async () => {
    const body = await post({
      name: '기본 배경2',
      items: [],
      defaults: { readingBackground: { src: '../x.png', source: 'nope' } },
    });
    expect(body.data!.plan.defaults?.readingBackground).toBeUndefined();
  });
});

describe('배경 목록 API', () => {
  it('사용자 폴더 목록을 따로 준다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backgrounds' });
    const body = res.json() as ApiResponse<{
      files: unknown[];
      library: unknown[];
      libraryDir: string;
    }>;
    expect(Array.isArray(body.data!.library)).toBe(true);
    expect(body.data!.libraryDir.length).toBeGreaterThan(0);
  });
});

/**
 * 출력 페이지의 배경 결정 규칙.
 *
 * 실제 렌더는 브라우저에서 확인했지만, **결정 순서**는 자동으로 지켜야 한다 —
 * 전에 세 곳이 각자 배경을 그려서 도착 순서에 따라 결과가 달라졌고, 출력 페이지를
 * 새로 열면 항목 배경이 템플릿 값에 지워졌다.
 */
describe('출력 페이지 — 배경을 정하는 곳은 하나뿐이다', () => {
  it('applyBackdrop 을 직접 부르는 곳은 두 갈래(템플릿·항목)뿐이다', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../public/output/output.js', import.meta.url), 'utf8');

    /*
     * 정의 한 줄 + 두 갈래(템플릿 배경 · 항목 배경).
     * 안내(media) 갈래는 D-B 결정으로 덜어냈다 — 반복 동영상·안내 화면은 OBS 가 맡는다.
     * 늘어나면 결정 지점이 또 흩어졌다는 뜻이다.
     */
    const calls = source.match(/applyBackdrop\(/g) ?? [];
    expect(calls.length, 'applyBackdrop 호출이 늘었습니다 — syncBackdrop 을 거치게 하세요').toBe(3);

    // 세 갈래를 고르는 곳이 syncBackdrop 이어야 한다
    expect(source).toContain('function syncBackdrop(payload)');
    expect(source).toMatch(/syncBackdrop\(payload\);/);
  });

  it('템플릿 CSS 패치가 배경을 곧바로 그리지 않는다', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('../../public/output/output.js', import.meta.url), 'utf8');

    // applyBackdropFromString 은 기억만 하고 syncBackdrop 에 맡긴다
    const fn = source.slice(
      source.indexOf('function applyBackdropFromString'),
      source.indexOf('function applyBlockOverrides'),
    );
    expect(fn).toContain('templateBackdrop');
    expect(fn).toContain('syncBackdrop(lastSlide)');
    expect(fn, '패치가 배경을 직접 그리면 항목 배경이 지워진다').not.toMatch(/applyBackdrop\(/);
  });
});

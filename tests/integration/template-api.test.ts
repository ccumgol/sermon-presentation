/**
 * 템플릿 REST 통합 테스트.
 *
 * 핵심은 두 가지다:
 *  - 내장 프리셋은 어떤 경로로도 수정·삭제되지 않는다 (기준점이 사라지면 복구 수단이 없다)
 *  - 부분 패치가 나머지 값을 지우지 않는다 (편집 UI 가 바뀐 필드만 보내기 때문)
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID } from '../../lib/template-presets.ts';
import { buildApp } from '../../server/app.ts';
import * as store from '../../server/db/templates.ts';
import type { ApiResponse, Template } from '../../shared/types.ts';

let app: FastifyInstance;
const createdIds: number[] = [];

beforeAll(async () => {
  // 이 테스트는 app.sqlite 에 쓴다. vitest.config.ts 가 SERMON_DATA_DIR 을
  // .test-data 로 돌려놓아 사용자 데이터는 건드리지 않는다.
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  // 만든 것만 지운다. DB 파일 자체를 지우면 병렬로 도는 다른 통합 테스트가 깨진다.
  for (const id of createdIds) {
    await app.inject({ method: 'DELETE', url: `/api/templates/${id}` });
  }
  await app.close();
});

async function get<T>(url: string): Promise<{ status: number; body: ApiResponse<T> }> {
  const response = await app.inject({ method: 'GET', url });
  return { status: response.statusCode, body: response.json() as ApiResponse<T> };
}

async function send<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: ApiResponse<T> }> {
  const response = await app.inject({ method, url, payload });
  return { status: response.statusCode, body: response.json() as ApiResponse<T> };
}

describe('GET /api/templates', () => {
  it('프리셋을 먼저 돌려준다', async () => {
    const { body } = await get<Template[]>('/api/templates');
    expect(body.data!.slice(0, BUILTIN_TEMPLATES.length).every((t) => t.isBuiltin)).toBe(true);
  });

  it('프리셋 8종이 모두 있다', async () => {
    const { body } = await get<Template[]>('/api/templates');
    expect(body.data!.filter((t) => t.isBuiltin)).toHaveLength(8);
  });
});

describe('GET /api/templates/:id', () => {
  it('프리셋을 id 로 가져온다', async () => {
    const { body } = await get<Template>(`/api/templates/${DEFAULT_TEMPLATE_ID}`);
    expect(body.data?.isBuiltin).toBe(true);
  });

  it('없는 id 는 404', async () => {
    expect((await get('/api/templates/999999')).status).toBe(404);
  });

  it('CSS 변수를 계산해 준다', async () => {
    const { body } = await get<Record<string, string>>(`/api/templates/${DEFAULT_TEMPLATE_ID}/css`);
    expect(body.data?.['--primary-size']).toMatch(/px$/);
    expect(body.data?.['--canvas-bg']).toBe('transparent');
  });
});

describe('내장 프리셋 보호', () => {
  it('수정하려 하면 409 로 거부한다', async () => {
    const { status, body } = await send('PUT', `/api/templates/${DEFAULT_TEMPLATE_ID}`, { name: '바꿔치기' });
    expect(status).toBe(409);
    expect(body.error).toContain('복제');
  });

  it('삭제하려 하면 409 로 거부한다', async () => {
    expect((await send('DELETE', `/api/templates/${DEFAULT_TEMPLATE_ID}`)).status).toBe(409);
  });

  it('거부된 뒤에도 프리셋 값이 그대로다', async () => {
    const { body } = await get<Template>(`/api/templates/${DEFAULT_TEMPLATE_ID}`);
    expect(body.data?.name).toBe(BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID)!.name);
  });
});

describe('사용자 템플릿', () => {
  it('복제하면 편집 가능한 사본이 생긴다', async () => {
    const { body } = await send<Template>('POST', `/api/templates/${DEFAULT_TEMPLATE_ID}/duplicate`, {});
    expect(body.data!.id).toBeGreaterThan(0);
    expect(body.data!.isBuiltin).toBe(false);
    createdIds.push(body.data!.id);
  });

  it('부분 패치가 나머지 값을 지우지 않는다', async () => {
    const created = (await send<Template>('POST', `/api/templates/${DEFAULT_TEMPLATE_ID}/duplicate`, {})).body.data!;
    createdIds.push(created.id);

    const updated = (
      await send<Template>('PUT', `/api/templates/${created.id}`, {
        text: { primary: { fontSize: 99 } },
      })
    ).body.data!;

    // 바꾼 것만 바뀌고
    expect(updated.text.primary.fontSize).toBe(99);
    // 같은 역할의 다른 속성과
    expect(updated.text.primary.color).toBe(created.text.primary.color);
    expect(updated.text.primary.stroke).toEqual(created.text.primary.stroke);
    // 다른 역할·레이아웃·behavior 는 그대로 남는다
    expect(updated.text.secondary).toEqual(created.text.secondary);
    expect(updated.layout).toEqual(created.layout);
    expect(updated.behavior).toEqual(created.behavior);
  });

  it('안전 영역도 부분 갱신이 된다', async () => {
    const created = (await send<Template>('POST', `/api/templates/${DEFAULT_TEMPLATE_ID}/duplicate`, {})).body.data!;
    createdIds.push(created.id);

    const updated = (
      await send<Template>('PUT', `/api/templates/${created.id}`, { canvas: { safeArea: { bottom: 200 } } })
    ).body.data!;

    expect(updated.canvas.safeArea.bottom).toBe(200);
    expect(updated.canvas.safeArea.top).toBe(created.canvas.safeArea.top);
    expect(updated.canvas.width).toBe(1920);
  });

  it('배경 모드를 바꿀 수 있다', async () => {
    const created = (await send<Template>('POST', `/api/templates/${DEFAULT_TEMPLATE_ID}/duplicate`, {})).body.data!;
    createdIds.push(created.id);

    const updated = (
      await send<Template>('PUT', `/api/templates/${created.id}`, {
        canvas: { background: { mode: 'chroma', color: '#1eff00' } },
      })
    ).body.data!;
    expect(updated.canvas.background).toEqual({ mode: 'chroma', color: '#1eff00' });
  });

  it('그림·동영상 배경을 저장하고 다시 읽는다', async () => {
    const created = (await send<Template>('POST', `/api/templates/${DEFAULT_TEMPLATE_ID}/duplicate`, {})).body.data!;
    createdIds.push(created.id);

    const updated = (
      await send<Template>('PUT', `/api/templates/${created.id}`, {
        canvas: { background: { mode: 'video', src: 'loop.mp4', fit: 'contain', opacity: 0.8 } },
      })
    ).body.data!;
    expect(updated.canvas.background).toEqual({ mode: 'video', src: 'loop.mp4', fit: 'contain', opacity: 0.8 });

    // 다시 읽어도 그대로여야 한다 — 배경은 예배 직전에 다시 고를 여유가 없다
    const reread = (await get<Template>(`/api/templates/${created.id}`)).body.data!;
    expect(reread.canvas.background).toEqual(updated.canvas.background);

    // 다른 필드를 고쳐도 배경이 지워지지 않는다 (편집 UI 는 바뀐 필드만 보낸다)
    const renamed = (await send<Template>('PUT', `/api/templates/${created.id}`, { name: '배경 유지' })).body.data!;
    expect(renamed.canvas.background).toEqual(updated.canvas.background);
  });

  it('삭제된다', async () => {
    const created = (await send<Template>('POST', `/api/templates/${DEFAULT_TEMPLATE_ID}/duplicate`, {})).body.data!;
    expect((await send('DELETE', `/api/templates/${created.id}`)).status).toBe(200);
    expect((await get(`/api/templates/${created.id}`)).status).toBe(404);
  });

  it('이름 없이 만들면 400', async () => {
    expect((await send('POST', '/api/templates', { kind: 'bible' })).status).toBe(400);
  });

  it('알 수 없는 kind 는 bible 로 떨어진다', async () => {
    const { body } = await send<Template>('POST', '/api/templates', { name: '테스트', kind: '이상한값' });
    createdIds.push(body.data!.id);
    expect(body.data!.kind).toBe('bible');
  });
});

describe('GET /api/template/current', () => {
  it('현재 적용된 템플릿을 돌려준다', async () => {
    const { body } = await get<Template>('/api/template/current');
    expect(body.data?.id).toBeDefined();
    expect(body.data?.canvas.width).toBe(1920);
  });
});

describe('옛 폰트 체인 자동 갱신', () => {
  it('저장된 사본의 옛 체인을 새 체인으로 올린다', async () => {
    const OLD = '"SBL Greek", "Cardo", "Gentium Plus", serif';

    // 옛 체인을 가진 사본을 직접 만들어 둔다
    const created = store.createTemplate({
      ...BUILTIN_TEMPLATES[0]!,
      name: '옛 체인 사본',
      overridesByLang: { grc: { fontFamily: OLD } },
    } as never);

    // 초기화를 다시 돌리면 갱신된다 (앱 시작 때마다 도는 경로)
    store.initTemplateStore();

    const after = store.getTemplate(created.id)!;
    expect(after.overridesByLang?.grc?.fontFamily).not.toBe(OLD);
    expect(after.overridesByLang?.grc?.fontFamily).toContain('Times New Roman');

    store.deleteTemplate(created.id);
  });

  it('사용자가 직접 고른 폰트는 건드리지 않는다', () => {
    const MINE = '"내가 고른 폰트", serif';
    const created = store.createTemplate({
      ...BUILTIN_TEMPLATES[0]!,
      name: '직접 고른 폰트',
      overridesByLang: { grc: { fontFamily: MINE } },
    } as never);

    store.initTemplateStore();
    expect(store.getTemplate(created.id)!.overridesByLang?.grc?.fontFamily).toBe(MINE);

    store.deleteTemplate(created.id);
  });
});

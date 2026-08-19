/**
 * 프리셋 덮어쓰기 · 원본 불러오기.
 *
 * ## 무엇을 바꾸는가
 *
 * 전에는 프리셋이 **코드 상수**라 서버가 수정을 거부했다(409). 그래서 템플릿 탭이
 * 저장할 때 **강제로 복제**했고, 사용자의 사본이 넷 쌓였다. 같은 이름의 사본이 둘이라
 * 목록에서 구분도 안 됐다.
 *
 * 이제 프리셋 id 로도 DB 행을 쓸 수 있다. `getTemplate` 이 **DB 먼저 → 코드 대체**
 * 순서로 보므로:
 *
 * - **덮어쓰기** = 프리셋 id 로 행을 쓴다
 * - **원본 불러오기** = 그 행을 지운다 → 코드 상수가 다시 보인다
 *
 * '원본' 을 따로 저장할 필요가 없다 — **코드가 곧 원본**이다. 백업이 날아가도,
 * DB 가 깨져도 프리셋은 언제나 코드에서 되살아난다.
 *
 * ## 지우기와 되돌리기는 다른 동작이다
 *
 * 프리셋에 `DELETE` 는 여전히 거부한다. 프리셋은 코드에 있으므로 '지운다' 는 말이
 * 성립하지 않는다. 되돌리기는 `POST /:id/restore` 다 — 같은 동사에 두 뜻을 담으면
 * 예배 중 잘못 눌렀을 때 무엇이 일어날지 알 수 없다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { BUILTIN_TEMPLATES, getBuiltinTemplate } from '../../lib/template-presets.ts';
import { buildApp } from '../../server/app.ts';
import type { ApiResponse, Template } from '../../shared/types.ts';

let app: FastifyInstance;

/** 이 테스트가 덮어쓴 프리셋 — 끝나면 반드시 원본으로 되돌린다 */
const touched = new Set<number>();
const createdIds: number[] = [];

/** 교독문 프리셋. 다른 통합 테스트가 기본 프리셋(-2)을 쓰므로 겹치지 않는 것을 고른다 */
const PRESET_ID = -10;

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
});

afterEach(async () => {
  for (const id of touched) await app.inject({ method: 'POST', url: `/api/templates/${id}/restore` });
  touched.clear();
});

afterAll(async () => {
  for (const id of createdIds) await app.inject({ method: 'DELETE', url: `/api/templates/${id}` });
  await app.close();
});

async function get<T>(url: string): Promise<{ status: number; body: ApiResponse<T> }> {
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() as ApiResponse<T> };
}

async function send<T>(
  method: 'POST' | 'PUT' | 'DELETE',
  url: string,
  payload?: Record<string, unknown>,
): Promise<{ status: number; body: ApiResponse<T> }> {
  const res = await app.inject({ method, url, payload });
  return { status: res.statusCode, body: res.json() as ApiResponse<T> };
}

function original(id: number): Template {
  const found = getBuiltinTemplate(id);
  if (!found) throw new Error(`프리셋 ${id} 가 없습니다`);
  return found;
}

describe('프리셋 덮어쓰기', () => {
  it('프리셋 id 로 저장하면 그 값이 이긴다', async () => {
    touched.add(PRESET_ID);
    const { status } = await send('PUT', `/api/templates/${PRESET_ID}`, { name: '교독문 (우리 교회)' });
    expect(status).toBe(200);

    const { body } = await get<Template>(`/api/templates/${PRESET_ID}`);
    expect(body.data!.name).toBe('교독문 (우리 교회)');
  });

  it('덮어썼어도 **프리셋 자리에 그대로 있다** — 목록에서 사라지거나 뒤로 밀리지 않는다', async () => {
    touched.add(PRESET_ID);
    await send('PUT', `/api/templates/${PRESET_ID}`, { name: '고친 교독문' });

    const { body } = await get<Template[]>('/api/templates');
    const presets = body.data!.slice(0, BUILTIN_TEMPLATES.length);
    // 프리셋 개수도 순서도 그대로여야 한다. 사본이 새로 생기면 안 된다
    expect(presets).toHaveLength(BUILTIN_TEMPLATES.length);
    expect(presets.map((t) => t.id)).toEqual(BUILTIN_TEMPLATES.map((t) => t.id));
    expect(presets.find((t) => t.id === PRESET_ID)!.name).toBe('고친 교독문');
  });

  it('덮어쓴 프리셋임을 표시한다 — 원본과 다르다는 것을 알아야 되돌릴 수 있다', async () => {
    touched.add(PRESET_ID);
    const before = await get<Template>(`/api/templates/${PRESET_ID}`);
    expect(before.body.data!.isOverridden).toBeFalsy();

    await send('PUT', `/api/templates/${PRESET_ID}`, { name: 'x' });
    const after = await get<Template>(`/api/templates/${PRESET_ID}`);
    expect(after.body.data!.isOverridden).toBe(true);
    // 여전히 프리셋이다 — 사용자 사본이 아니다
    expect(after.body.data!.isBuiltin).toBe(true);
  });

  it('부분 패치가 나머지 값을 지우지 않는다', async () => {
    touched.add(PRESET_ID);
    await send('PUT', `/api/templates/${PRESET_ID}`, { name: '이름만' });

    const { body } = await get<Template>(`/api/templates/${PRESET_ID}`);
    expect(body.data!.text.primary.fontSize).toBe(original(PRESET_ID).text.primary.fontSize);
    expect(body.data!.behavior.showReference).toBe(original(PRESET_ID).behavior.showReference);
  });

  it('두 번 덮어써도 사본이 쌓이지 않는다', async () => {
    touched.add(PRESET_ID);
    await send('PUT', `/api/templates/${PRESET_ID}`, { name: '첫 번째' });
    await send('PUT', `/api/templates/${PRESET_ID}`, { name: '두 번째' });

    const { body } = await get<Template[]>('/api/templates');
    expect(body.data!.filter((t) => t.id === PRESET_ID)).toHaveLength(1);
    expect(body.data!.find((t) => t.id === PRESET_ID)!.name).toBe('두 번째');
  });
});

describe('원본 불러오기', () => {
  it('되돌리면 코드의 값이 다시 보인다', async () => {
    await send('PUT', `/api/templates/${PRESET_ID}`, { name: '고친 이름' });
    const { status } = await send('POST', `/api/templates/${PRESET_ID}/restore`);
    expect(status).toBe(200);

    const { body } = await get<Template>(`/api/templates/${PRESET_ID}`);
    expect(body.data!.name).toBe(original(PRESET_ID).name);
    expect(body.data!.isOverridden).toBeFalsy();
  });

  it('덮어쓴 적 없는 프리셋을 되돌려도 오류가 아니다 — 결과가 같으므로', async () => {
    const { status } = await send('POST', `/api/templates/${PRESET_ID}/restore`);
    expect(status).toBe(200);
  });

  it('사용자 템플릿은 되돌릴 원본이 없다 — 거부한다', async () => {
    const created = (await send<Template>('POST', `/api/templates/${PRESET_ID}/duplicate`, {})).body.data!;
    createdIds.push(created.id);

    const { status, body } = await send('POST', `/api/templates/${created.id}/restore`);
    expect(status).toBe(409);
    expect(body.error).toContain('프리셋');
  });

  it('없는 id 는 404', async () => {
    expect((await send('POST', '/api/templates/-9999/restore')).status).toBe(404);
  });
});

describe('지우기와 되돌리기를 섞지 않는다', () => {
  it('프리셋에 DELETE 는 여전히 거부한다', async () => {
    const { status, body } = await send('DELETE', `/api/templates/${PRESET_ID}`);
    expect(status).toBe(409);
    // 무엇을 눌러야 하는지 알려 준다
    expect(body.error).toContain('원본');
  });

  it('덮어쓴 상태에서도 DELETE 는 거부한다', async () => {
    touched.add(PRESET_ID);
    await send('PUT', `/api/templates/${PRESET_ID}`, { name: 'x' });
    expect((await send('DELETE', `/api/templates/${PRESET_ID}`)).status).toBe(409);
    // 거부됐으니 덮어쓴 값이 남아 있어야 한다
    expect((await get<Template>(`/api/templates/${PRESET_ID}`)).body.data!.name).toBe('x');
  });
});

describe('백업에 프리셋 덮어쓰기가 담긴다', () => {
  it('요약이 덮어쓴 프리셋을 센다 — 담기지 않으면 되돌릴 수 없다', async () => {
    const before = (await get<{ templates: number }>('/api/backup/summary')).body.data!.templates;

    touched.add(PRESET_ID);
    await send('PUT', `/api/templates/${PRESET_ID}`, { name: '백업에 담길 것' });

    const after = (await get<{ templates: number }>('/api/backup/summary')).body.data!.templates;
    expect(after).toBe(before + 1);
  });
});

/**
 * 예배 순서 + 데이터 이전 통합 테스트.
 *
 * 데이터 이전은 다른 PC 설치의 유일한 경로라, **왕복(내보내기 → 가져오기)이
 * 내용을 잃지 않는지**가 핵심이다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as planStore from '../../server/db/plans.ts';
import * as songStore from '../../server/db/songs.ts';
import * as templateStore from '../../server/db/templates.ts';
import { DEFAULT_TEMPLATE_ID } from '../../lib/template-presets.ts';
import type { ApiResponse, CueItem, ServicePlan } from '../../shared/types.ts';

let app: FastifyInstance;

/** 이 테스트가 만든 것만 지우기 위한 목록 */
const createdPlanIds: number[] = [];
const createdTemplateIds: number[] = [];

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();

  songStore.initSongsDb();
  songStore.deleteBySource('manual');
  for (const plan of planStore.listPlans()) planStore.deletePlan(plan.id);
});

afterAll(async () => {
  // 만든 것만 지운다 — DB 파일을 지우면 다른 통합 테스트가 깨진다
  songStore.deleteBySource('manual');
  for (const id of createdPlanIds) planStore.deletePlan(id);
  for (const plan of planStore.listPlans()) planStore.deletePlan(plan.id);
  for (const id of createdTemplateIds) {
    try {
      templateStore.deleteTemplate(id);
    } catch {
      // 이미 지워졌으면 무시
    }
  }
  await app.close();
  songStore.closeSongsDb();
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

type PlanResponse = { plan: ServicePlan; rejected?: string[] };

describe('예배 순서 CRUD', () => {
  it('만들고 읽는다', async () => {
    const { body } = await send<PlanResponse>('POST', '/api/plans', {
      name: '주일 1부',
      serviceDate: '2026-08-16',
      items: [{ type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: ['niv'] }],
    });

    const plan = body.data!.plan;
    createdPlanIds.push(plan.id);
    expect(plan.name).toBe('주일 1부');
    expect(plan.items).toHaveLength(1);
    // id 를 안 보내도 서버가 발급한다
    expect(plan.items[0]!.id).toMatch(/^item-/);
  });

  it('이름이 없으면 400', async () => {
    expect((await send('POST', '/api/plans', { items: [] })).status).toBe(400);
  });

  it('잘못된 항목은 버리고 알린다 (조용히 넘기지 않는다)', async () => {
    const { body } = await send<PlanResponse>('POST', '/api/plans', {
      name: '검증 테스트',
      items: [
        { type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [] },
        { type: 'bible' }, // ref 없음
        { type: 'song' }, // songId 없음
        { type: 'text', content: '   ' }, // 빈 내용
        { type: '이상한종류' },
        'not an object',
      ],
    });

    createdPlanIds.push(body.data!.plan.id);
    expect(body.data!.plan.items).toHaveLength(1);
    expect(body.data!.rejected).toHaveLength(5);
  });

  it('항목을 갱신한다', async () => {
    const created = (await send<PlanResponse>('POST', '/api/plans', { name: '갱신 대상', items: [] })).body.data!.plan;
    createdPlanIds.push(created.id);

    const { body } = await send<PlanResponse>('PUT', `/api/plans/${created.id}`, {
      items: [
        { type: 'song', songId: 1, songTitle: '찬송', langs: ['ko', 'en'] },
        { type: 'blank' },
      ],
    });

    expect(body.data!.plan.items).toHaveLength(2);
    expect(body.data!.plan.items[0]!.type).toBe('song');
  });

  it('언어를 2개로 자른다', async () => {
    const created = (await send<PlanResponse>('POST', '/api/plans', {
      name: '언어 제한',
      items: [{ type: 'song', songId: 1, songTitle: '찬송', langs: ['ko', 'en', 'zh', 'ja'] }],
    })).body.data!.plan;
    createdPlanIds.push(created.id);

    const item = created.items[0] as Extract<CueItem, { type: 'song' }>;
    expect(item.langs).toHaveLength(2);
  });

  it('복제하면 항목 id 가 새로 발급된다', async () => {
    const created = (await send<PlanResponse>('POST', '/api/plans', {
      name: '복제 원본',
      items: [{ type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [] }],
    })).body.data!.plan;
    createdPlanIds.push(created.id);

    const { body } = await send<ServicePlan>('POST', `/api/plans/${created.id}/duplicate`, {});
    createdPlanIds.push(body.data!.id);

    expect(body.data!.name).toBe('복제 원본 사본');
    // 같은 id 를 쓰면 재배치가 꼬인다
    expect(body.data!.items[0]!.id).not.toBe(created.items[0]!.id);
  });

  it('없는 순서표는 404', async () => {
    expect((await get('/api/plans/999999')).status).toBe(404);
    expect((await send('PUT', '/api/plans/999999', { name: 'x' })).status).toBe(404);
    expect((await send('DELETE', '/api/plans/999999')).status).toBe(404);
  });

  it('삭제된다', async () => {
    const created = (await send<PlanResponse>('POST', '/api/plans', { name: '삭제 대상', items: [] })).body.data!.plan;
    expect((await send('DELETE', `/api/plans/${created.id}`)).status).toBe(200);
    expect((await get(`/api/plans/${created.id}`)).status).toBe(404);
  });
});

describe('데이터 이전', () => {
  it('담길 내용을 미리 알려준다', async () => {
    const { body } = await get<{ songs: number; plans: number; approximateBytes: number }>('/api/backup/summary');
    expect(body.data!.approximateBytes).toBeGreaterThan(0);
  });

  it('내보낸 파일에 첨부 헤더가 붙는다', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/backup/export' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-disposition']).toContain('sermon-bundle-');
  });

  it('왕복해도 내용을 잃지 않는다', async () => {
    // 곡 · 템플릿 · 순서표를 하나씩 만들어 둔다
    const songId = songStore.createSong({
      title: '왕복 테스트 곡',
      source: 'manual',
      copyright: '© 테스트',
      sections: [
        {
          kind: 'verse',
          label: '1절',
          lines: [
            { lineIndex: 0, lang: 'ko', text: '한국어 줄' },
            { lineIndex: 0, lang: 'en', text: 'English line' },
          ],
        },
      ],
    });

    const template = (
      await send<{ id: number }>('POST', `/api/templates/${DEFAULT_TEMPLATE_ID}/duplicate`, {})
    ).body.data!;
    createdTemplateIds.push(template.id);

    const plan = (await send<PlanResponse>('POST', '/api/plans', {
      name: '왕복 순서',
      items: [{ type: 'bible', ref: '요 3:16', primary: 'nkrv', secondary: [] }],
    })).body.data!.plan;
    createdPlanIds.push(plan.id);

    // 내보내기
    const exported = JSON.parse(
      (await app.inject({ method: 'GET', url: '/api/backup/export' })).body,
    ) as Record<string, unknown>;

    expect(exported.format).toBe('sermon-presentation-bundle');
    // 송출 상태는 담기지 않는다 (다른 PC 에서 복원하면 엉뚱한 화면이 뜬다)
    expect(Object.keys(exported.settings as object)).not.toContain('live_state');

    // 같은 서버에 다시 가져오기 (merge) — 사본이 늘어야 한다
    const beforeSongs = songStore.countSongs();
    const { body } = await send<{ songs: number; templates: number; plans: number; skipped: string[] }>(
      'POST',
      '/api/backup/import',
      { bundle: exported, mode: 'merge' },
    );

    expect(body.data!.songs).toBeGreaterThan(0);
    expect(body.data!.plans).toBeGreaterThan(0);
    expect(body.data!.skipped).toEqual([]);
    expect(songStore.countSongs()).toBeGreaterThan(beforeSongs);

    // 가져온 곡의 2언어 페어링이 살아 있는지
    const restored = songStore
      .searchSongs('왕복 테스트 곡')
      .hits.map((hit) => songStore.getSong(hit.id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
    expect(restored.length).toBeGreaterThanOrEqual(2);
    for (const song of restored) {
      expect(song!.langs.sort()).toEqual(['en', 'ko']);
      expect(song!.copyright).toBe('© 테스트');
    }

    // 정리
    for (const song of restored) songStore.deleteSong(song!.id);
    songStore.deleteSong(songId);
    for (const t of templateStore.listTemplates().filter((x) => !x.isBuiltin)) {
      try {
        templateStore.deleteTemplate(t.id);
      } catch {
        // 무시
      }
    }
  });

  it('1MB 를 넘는 번들도 가져온다', async () => {
    // Fastify 기본 본문 한도가 1MB 라 실제 번들(찬송가 1,202곡 = 1.6MB)이 막혔던 적이 있다.
    // 라우트 한도를 올렸으므로 큰 번들도 통과해야 한다.
    const bigSongs = Array.from({ length: 400 }, (_, i) => ({
      title: `대용량 테스트 곡 ${i}`,
      tags: [],
      langs: ['ko'],
      source: 'manual',
      sections: [
        {
          kind: 'verse',
          label: '1절',
          lines: [{ lineIndex: 0, lang: 'ko', text: '가'.repeat(1200) }],
        },
      ],
    }));

    const bundle = { format: 'sermon-presentation-bundle', version: 1, songs: bigSongs };
    expect(Buffer.byteLength(JSON.stringify(bundle))).toBeGreaterThan(1024 * 1024);

    const { status, body } = await send<{ songs: number }>('POST', '/api/backup/import', {
      bundle,
      mode: 'merge',
    });

    expect(status).toBe(200);
    expect(body.data!.songs).toBe(400);
    songStore.deleteBySource('manual');
  });

  it('다른 앱의 파일은 거부한다', async () => {
    const { status, body } = await send('POST', '/api/backup/import', {
      bundle: { format: 'something-else', version: 1 },
      mode: 'merge',
    });
    expect(status).toBe(400);
    expect(body.error).toContain('백업이 아닙니다');
  });

  it('미래 버전은 거부한다', async () => {
    const { status, body } = await send('POST', '/api/backup/import', {
      bundle: { format: 'sermon-presentation-bundle', version: 999 },
      mode: 'merge',
    });
    expect(status).toBe(400);
    expect(body.error).toContain('지원하지 않는 버전');
  });

  it('객체가 아닌 입력을 거부한다', async () => {
    expect((await send('POST', '/api/backup/import', { bundle: 'nope', mode: 'merge' })).status).toBe(400);
  });

  it('mode 를 지정하지 않으면 merge 로 본다 (덮어쓰기는 명시해야만)', async () => {
    const before = planStore.countPlans();
    await send('POST', '/api/backup/import', {
      bundle: { format: 'sermon-presentation-bundle', version: 1, plans: [{ name: '추가된 순서', items: [] }] },
    });
    expect(planStore.countPlans()).toBe(before + 1);
    for (const plan of planStore.listPlans().filter((p) => p.name === '추가된 순서')) planStore.deletePlan(plan.id);
  });

  it('폰트 파일 이름으로 경로를 탈출할 수 없다', async () => {
    const { body } = await send<{ fonts: number; skipped: string[] }>('POST', '/api/backup/import', {
      bundle: {
        format: 'sermon-presentation-bundle',
        version: 1,
        fonts: [{ name: '../../evil.woff2', base64: 'AAAA' }, { name: 'bad.exe', base64: 'AAAA' }],
      },
      mode: 'merge',
    });

    // basename 으로 잘려 fonts 폴더 안에만 쓰이고, 지원하지 않는 확장자는 거부된다
    expect(body.data!.fonts).toBe(1);
    expect(body.data!.skipped.some((s) => s.includes('bad.exe'))).toBe(true);
  });
});

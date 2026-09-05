/**
 * 예배 순서 + 데이터 이전 통합 테스트.
 *
 * 데이터 이전은 다른 PC 설치의 유일한 경로라, **왕복(내보내기 → 가져오기)이
 * 내용을 잃지 않는지**가 핵심이다.
 */

import { MAX_LANGS } from '../../lib/lang-select.ts';
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

  it(`언어를 ${MAX_LANGS}개로 자른다 — 성경의 주 역본 + 보조 2개와 같다`, async () => {
    const created = (await send<PlanResponse>('POST', '/api/plans', {
      name: '언어 제한',
      items: [{ type: 'song', songId: 1, songTitle: '찬송', langs: ['ko', 'en', 'zh', 'ja'] }],
    })).body.data!.plan;
    createdPlanIds.push(created.id);

    const item = created.items[0] as Extract<CueItem, { type: 'song' }>;
    // 상한을 숫자로 박지 않는다 — 한 곳(lib/lang-select.ts)만 고치면 되게
    expect(item.langs).toHaveLength(MAX_LANGS);
    expect(item.langs).toEqual(['ko', 'en', 'zh']);
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

    /*
     * 같은 서버에 다시 가져오기 (merge).
     *
     * **곡이 늘면 안 된다.** 전에는 무조건 새로 만들어서, 같은 번들을 두 번
     * 넣으면 4,531곡이 통째로 복제됐다 (2026-09-05 에 고쳤다).
     */
    const beforeSongs = songStore.countSongs();
    const { body } = await send<{
      songs: number; templates: number; plans: number; songsExisting: number; skipped: string[];
    }>('POST', '/api/backup/import', { bundle: exported, mode: 'merge' });

    expect(body.data!.songs).toBe(0);
    expect(body.data!.songsExisting).toBeGreaterThan(0);
    expect(body.data!.plans).toBeGreaterThan(0);
    /*
     * 곡·템플릿을 저장하다 실패한 것이 없어야 한다.
     *
     * '연결이 끊겼습니다' 는 걸러 낸다 — 이 파일의 다른 검사들이 실제로 없는
     * 곡(`songId: 1`)을 가리키는 순서를 만들어 두기 때문이다. 그 경고는 **맞는
     * 경고**이고, 끊긴 연결을 알리는 것이 이 기능의 일이다.
     */
    expect(body.data!.skipped.filter((one) => !one.includes('연결이 끊겼습니다'))).toEqual([]);
    expect(songStore.countSongs()).toBe(beforeSongs);

    // 곡 자체는 그대로 있고, 2언어 페어링도 살아 있다
    const restored = songStore
      .searchSongs('왕복 테스트 곡')
      .hits.map((hit) => songStore.getSong(hit.id))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
    expect(restored.length).toBeGreaterThanOrEqual(1);
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

describe('구분·인용구 항목 저장', () => {
  it('구분(divider)을 저장한다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '구분 테스트',
      items: [
        { type: 'divider', label: '예배 부름' },
        { type: 'text', content: '광고입니다' },
      ],
    });
    expect(created.status).toBe(200);

    const plan = created.body.data!.plan;
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0]).toMatchObject({ type: 'divider', label: '예배 부름' });
  });

  it('이름 없는 구분은 거부하고 알린다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '빈 구분',
      items: [{ type: 'divider', label: '   ' }],
    });
    expect(created.body.data!.rejected?.length).toBeGreaterThan(0);
    expect(created.body.data!.plan.items).toHaveLength(0);
  });

  it('인용구(quote)를 광고와 구분해 저장한다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: 'variant 테스트',
      items: [
        { type: 'text', content: '광고' },
        { type: 'text', content: '인용구', variant: 'quote' },
      ],
    });

    const items = created.body.data!.plan.items as Array<{ variant?: string }>;
    expect(items[0]!.variant).toBeUndefined();
    expect(items[1]!.variant).toBe('quote');
  });

  it('예배 유형(template)과 저장된 순서(plan)를 나눠 목록으로 준다', async () => {
    const template = await send<PlanResponse>('POST', '/api/plans', {
      name: '유형 테스트',
      kind: 'template',
      items: [{ type: 'text', content: '대표기도', variant: 'order' }],
    });
    const savedPlan = await send<PlanResponse>('POST', '/api/plans', {
      name: '2026-08-16 유형 테스트',
      items: [{ type: 'text', content: '광고' }],
    });
    createdPlanIds.push(template.body.data!.plan.id, savedPlan.body.data!.plan.id);

    expect(template.body.data!.plan.kind).toBe('template');
    // kind 를 주지 않으면 저장된 순서다 — 유형이 함부로 늘어나면 안 된다
    expect(savedPlan.body.data!.plan.kind).toBe('plan');

    const templates = await get<ServicePlan[]>('/api/plans?kind=template');
    const plans = await get<ServicePlan[]>('/api/plans?kind=plan');
    expect(templates.body.data!.some((p) => p.name === '유형 테스트')).toBe(true);
    expect(templates.body.data!.some((p) => p.name === '2026-08-16 유형 테스트')).toBe(false);
    expect(plans.body.data!.some((p) => p.name === '2026-08-16 유형 테스트')).toBe(true);
  });

  it('알 수 없는 kind 는 저장된 순서로 떨어뜨린다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: 'kind 방어',
      kind: 'builtin',
      items: [],
    });
    createdPlanIds.push(created.body.data!.plan.id);
    expect(created.body.data!.plan.kind).toBe('plan');
  });

  it('유형을 갱신해도 유형으로 남는다 (템플릿 업데이트)', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '갱신 유형',
      kind: 'template',
      items: [{ type: 'text', content: '대표기도', variant: 'order' }],
    });
    const id = created.body.data!.plan.id;
    createdPlanIds.push(id);

    const updated = await send<PlanResponse>('PUT', `/api/plans/${id}`, {
      items: [
        { type: 'text', content: '대표기도', variant: 'order' },
        { type: 'text', content: '축도', variant: 'order' },
      ],
    });
    expect(updated.body.data!.plan.kind).toBe('template');
    expect(updated.body.data!.plan.items).toHaveLength(2);
  });

  /**
   * '저장하기' 가 기대는 길 — 불러온 회차를 **그 자리에** 갱신한다.
   *
   * 전에는 화면에 이 길이 없었다. 저장된 순서를 불러와 고치면 '순서 저장하기' 로
   * 긴 이름('2026-08-17 주일 1부 예배')을 똑같이 맞혀 쳐야 덮어써졌고, 한 글자만
   * 달라도 회차가 하나 더 생겼다 (2026-09-03 사용자 보고). 서버 쪽은 되어 있었고
   * 화면이 그 길을 막고 있었던 것이라, 여기서 못을 박아 둔다.
   */
  it('저장된 순서를 갱신해도 순서로 남고 회차가 늘지 않는다 (저장하기)', async () => {
    const before = await get<ServicePlan[]>('/api/plans?kind=plan');

    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '2026-08-17 주일 1부 예배',
      items: [{ type: 'text', content: '대표기도', variant: 'order' }],
    });
    const saved = created.body.data!.plan;
    createdPlanIds.push(saved.id);
    expect(saved.kind).toBe('plan');

    const updated = await send<PlanResponse>('PUT', `/api/plans/${saved.id}`, {
      name: saved.name,
      items: [
        { type: 'text', content: '대표기도', variant: 'order' },
        { type: 'song', songId: 1, songTitle: '은혜', langs: ['ko'] },
      ],
    });
    expect(updated.body.data!.plan.id).toBe(saved.id);
    expect(updated.body.data!.plan.kind).toBe('plan');
    expect(updated.body.data!.plan.items).toHaveLength(2);

    // 같은 이름의 회차가 둘이 되면 다음에 어느 쪽을 덮어쓸지 알 수 없다
    const after = await get<ServicePlan[]>('/api/plans?kind=plan');
    expect(after.body.data!.length).toBe(before.body.data!.length + 1);
    expect(after.body.data!.filter((p) => p.name === saved.name)).toHaveLength(1);
  });

  /** '다른 이름으로 저장' 은 원본을 건드리지 않는다 */
  it('저장된 순서를 복제하면 사본도 순서다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '복제 대상 회차',
      items: [{ type: 'text', content: '대표기도', variant: 'order' }],
    });
    const source = created.body.data!.plan;
    createdPlanIds.push(source.id);

    const copy = await send<ServicePlan>('POST', `/api/plans/${source.id}/duplicate`, {});
    createdPlanIds.push(copy.body.data!.id);

    expect(copy.body.data!.kind).toBe('plan');
    expect(copy.body.data!.id).not.toBe(source.id);
    expect(copy.body.data!.items[0]!.id).not.toBe(source.items[0]!.id);
  });

  /**
   * '이름 바꾸기' 가 기대는 길. 이름만 보내면 항목이 그대로여야 한다 —
   * 여기서 항목이 비면 유형 하나가 통째로 날아간다.
   */
  it('이름만 바꾸면 항목과 기본 설정이 그대로 남는다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '주일예배',
      kind: 'template',
      items: [
        { type: 'text', content: '대표기도', variant: 'order' },
        { type: 'liturgy', textId: 'lords-prayer', version: 'new' },
      ],
      defaults: { liturgy: { version: 'traditional' } },
    });
    const id = created.body.data!.plan.id;
    createdPlanIds.push(id);

    const renamed = await send<PlanResponse>('PUT', `/api/plans/${id}`, { name: '주일 1부 예배' });
    expect(renamed.body.data!.plan.name).toBe('주일 1부 예배');
    expect(renamed.body.data!.plan.kind).toBe('template');
    expect(renamed.body.data!.plan.items.map((i) => i.type)).toEqual(['text', 'liturgy']);
    expect(renamed.body.data!.plan.defaults?.liturgy?.version).toBe('traditional');
  });

  /** '주일 1부' 를 놔둔 채 '2부' 를 만드는 길 — 사본이 '순서'로 떨어지면 안 된다 */
  it('유형을 복제하면 사본도 유형이고 항목 id 는 새로 받는다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '복제 대상 유형',
      kind: 'template',
      items: [{ type: 'text', content: '대표기도', variant: 'order' }],
    });
    const source = created.body.data!.plan;
    createdPlanIds.push(source.id);

    const copy = await send<ServicePlan>('POST', `/api/plans/${source.id}/duplicate`, {});
    createdPlanIds.push(copy.body.data!.id);

    expect(copy.body.data!.kind).toBe('template');
    expect(copy.body.data!.name).toBe('복제 대상 유형 사본');
    expect(copy.body.data!.items).toHaveLength(1);
    // 같은 항목 id 를 나눠 쓰면 한쪽을 옮길 때 다른 쪽이 꼬인다
    expect(copy.body.data!.items[0]!.id).not.toBe(source.items[0]!.id);
  });

  it('예배 전 안내 자동 진행 설정을 저장하고 범위를 지킨다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '자동 진행',
      items: [
        { type: 'divider', label: '예배 전', auto: { holdMs: 8000, loop: true } },
        { type: 'divider', label: '너무 짧음', auto: { holdMs: 0, loop: false } },
        { type: 'divider', label: '너무 김', auto: { holdMs: 99_999_999 } },
        { type: 'divider', label: '값이 이상함', auto: { holdMs: 'abc' } },
        { type: 'divider', label: '자동 아님' },
      ],
    });
    createdPlanIds.push(created.body.data!.plan.id);

    const items = created.body.data!.plan.items as Array<{ auto?: { holdMs: number; loop: boolean } }>;
    expect(items[0]!.auto).toEqual({ holdMs: 8000, loop: true });
    // 0초면 화면이 깜빡이고, 몇 시간이면 멈춘 것처럼 보인다 — 경계에서 자른다
    expect(items[1]!.auto).toEqual({ holdMs: 1000, loop: false });
    expect(items[2]!.auto!.holdMs).toBe(600000);
    expect(items[3]!.auto!.holdMs).toBe(8000); // 기본값으로 떨어진다
    expect(items[4]!.auto).toBeUndefined();
  });

  it('순서 표시(order)를 저장한다 — 둘째 줄(설교자)까지 보존', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '순서 표시 테스트',
      items: [
        { type: 'text', content: '대표기도', variant: 'order' },
        { type: 'text', content: '설교 제목\n박기현 목사', variant: 'order' },
      ],
    });

    const items = created.body.data!.plan.items as Array<{ variant?: string; content?: string }>;
    expect(items[0]!.variant).toBe('order');
    // 순서 이름 아래 줄은 화면에 함께 나가야 하므로 줄바꿈을 지우지 않는다
    expect(items[1]!.content).toBe('설교 제목\n박기현 목사');
  });

  it('순서 표시 배치는 stack 만 저장하고 기본(split)은 남기지 않는다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '배치 테스트',
      items: [
        { type: 'text', content: '대표기도\n박기현 목사', variant: 'order' },
        { type: 'text', content: '주기도문', variant: 'order', layout: 'stack' },
        { type: 'text', content: '축도', variant: 'order', layout: '<script>' },
        // 배치는 순서 표시에만 뜻이 있다 — 광고에 붙여도 버린다
        { type: 'text', content: '광고', layout: 'stack' },
      ],
    });
    createdPlanIds.push(created.body.data!.plan.id);

    const items = created.body.data!.plan.items as Array<{ layout?: string }>;
    expect(items[0]!.layout).toBeUndefined();
    expect(items[1]!.layout).toBe('stack');
    expect(items[2]!.layout).toBeUndefined();
    expect(items[3]!.layout).toBeUndefined();
  });

  it('글자별 조정을 저장하고 범위를 지킨다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '글자 조정',
      items: [
        { type: 'text', content: '폐회송', variant: 'order',
          charStyles: [{ size: 1.4 }, { size: 99, dy: -9 }, {}] },
        // 순서 표시가 아니면 뜻이 없으므로 버린다
        { type: 'text', content: '광고', charStyles: [{ size: 1.4 }] },
      ],
    });
    createdPlanIds.push(created.body.data!.plan.id);

    const items = created.body.data!.plan.items as Array<{ charStyles?: Array<{ size?: number; dy?: number }> }>;
    expect(items[0]!.charStyles![0]!.size).toBe(1.4);
    expect(items[0]!.charStyles![1]!.size).toBe(2.5); // 상한
    expect(items[0]!.charStyles![1]!.dy).toBe(-0.6); // 하한
    expect(items[0]!.charStyles![2]).toEqual({}); // 만지지 않은 글자는 빈 채로
    expect(items[1]!.charStyles).toBeUndefined();
  });

  it('담당자 크기를 저장한다 — 기본값(1)은 남기지 않는다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '담당자 크기',
      items: [
        { type: 'text', content: '대표기도\n박기현 목사', variant: 'order', presenterScale: 0.7 },
        { type: 'text', content: '축도\n김목사', variant: 'order', presenterScale: 1 },
        { type: 'text', content: '광고\n이집사', variant: 'order', presenterScale: 99 },
      ],
    });
    createdPlanIds.push(created.body.data!.plan.id);

    const items = created.body.data!.plan.items as Array<{ presenterScale?: number }>;
    expect(items[0]!.presenterScale).toBe(0.7);
    expect(items[1]!.presenterScale).toBeUndefined();
    expect(items[2]!.presenterScale).toBe(2.5);
  });

  it('테두리 두께를 저장한다 — 0 도 지정으로 남긴다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '테두리',
      items: [
        { type: 'text', content: '대표기도\n박기현 목사', variant: 'order', titleStroke: 6, presenterStroke: 0 },
        { type: 'text', content: '축도', variant: 'order' },
      ],
    });
    createdPlanIds.push(created.body.data!.plan.id);

    const items = created.body.data!.plan.items as Array<{ titleStroke?: number; presenterStroke?: number }>;
    expect(items[0]!.titleStroke).toBe(6);
    // 0 = '이 항목은 테두리 없음'. 지정이 없는 것(undefined)과 다르다
    expect(items[0]!.presenterStroke).toBe(0);
    expect(items[1]!.titleStroke).toBeUndefined();
  });

  it('알 수 없는 variant 는 광고로 떨어뜨린다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: 'variant 방어',
      items: [{ type: 'text', content: '내용', variant: '<script>' }],
    });
    expect((created.body.data!.plan.items[0] as { variant?: string }).variant).toBeUndefined();
  });
});

describe('예배 유형 기본값 시딩', () => {
  it('유형이 하나도 없을 때만 넣는다 — 지운 유형이 되살아나지 않는다', () => {
    for (const plan of planStore.listPlans()) planStore.deletePlan(plan.id);

    planStore.seedDefaultTemplates();
    const first = planStore.listPlans('template');
    // 만든 순으로 나온다 — 자주 쓰는 주일예배가 맨 위 (가나다 순이면 부흥회가 올라온다)
    expect(first.map((p) => p.name)).toEqual(['주일예배', '수요예배', '새벽기도회', '부흥회']);

    // 이미 유형이 있으면 다시 넣지 않는다
    planStore.seedDefaultTemplates();
    expect(planStore.listPlans('template')).toHaveLength(first.length);

    // 하나만 남겨도 되살아나지 않는다 (사용자가 지운 유형이 다시 생기면 안 된다)
    for (const plan of first.slice(1)) planStore.deletePlan(plan.id);
    planStore.seedDefaultTemplates();
    expect(planStore.listPlans('template')).toHaveLength(1);

    for (const plan of planStore.listPlans()) planStore.deletePlan(plan.id);
  });

  it('기본 유형은 순서 표시와 구분으로만 이뤄져 바로 송출할 수 있다', () => {
    for (const plan of planStore.listPlans()) planStore.deletePlan(plan.id);
    planStore.seedDefaultTemplates();

    const sunday = planStore.listPlans('template').find((p) => p.name === '주일예배')!;
    expect(sunday.items.length).toBeGreaterThan(0);
    for (const item of sunday.items) {
      expect(['divider', 'text']).toContain(item.type);
      if (item.type === 'text') expect(item.variant).toBe('order');
    }

    for (const plan of planStore.listPlans()) planStore.deletePlan(plan.id);
  });
});

describe('예배 기본 설정', () => {
  it('템플릿·역본 기본값을 저장하고 다시 읽는다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '기본 설정',
      defaults: {
        templates: { bible: -2, song: -4, order: -9, text: -6 },
        bible: { primary: 'krv', secondary: ['niv', 'kjv'], paging: 'auto' },
        song: { langs: ['ko', 'en'], lines: '4' },
      },
      items: [],
    });
    const id = created.body.data!.plan.id;
    createdPlanIds.push(id);

    expect(created.body.data!.plan.defaults).toEqual({
      templates: { bible: -2, song: -4, order: -9, text: -6 },
      bible: { primary: 'krv', secondary: ['niv', 'kjv'], paging: 'auto' },
      song: { langs: ['ko', 'en'], lines: '4' },
    });

    const reread = await get<ServicePlan>(`/api/plans/${id}`);
    expect(reread.body.data!.defaults?.bible?.primary).toBe('krv');
  });

  it('알 수 없는 값은 버리고 보조 역본은 2개로 자른다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '기본 설정 방어',
      defaults: {
        templates: { bible: 'x', song: 1.5, nope: 3 },
        bible: { primary: 42, secondary: ['niv', 'kjv', 'esv', 7] },
      },
      items: [],
    });
    createdPlanIds.push(created.body.data!.plan.id);

    const defaults = created.body.data!.plan.defaults!;
    expect(defaults.templates).toBeUndefined(); // 정수가 아닌 값만 있었다
    expect(defaults.bible?.primary).toBeUndefined();
    expect(defaults.bible?.secondary).toEqual(['niv', 'kjv']);
  });

  it('null 을 보내면 기본 설정을 지운다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '기본 설정 삭제',
      defaults: { bible: { primary: 'krv' } },
      items: [],
    });
    const id = created.body.data!.plan.id;
    createdPlanIds.push(id);

    const cleared = await send<PlanResponse>('PUT', `/api/plans/${id}`, { defaults: null });
    expect(cleared.body.data!.plan.defaults).toBeUndefined();
  });

  /**
   * '기본 설정' 카드의 저장 버튼이 기대는 길 — 기본 설정과 항목이 **한 번에** 간다.
   *
   * 화면은 기본 설정을 따로 저장하지 않는다. `service_plans.defaults` 에 순서표와
   * 함께 담기고, 저장 버튼도 그것 하나뿐이다 ('기본 설정을 저장하는 버튼이 어떤
   * 것인지 모르겠다', 2026-09-03). 그러니 이 한 번의 PUT 에서 둘 다 남아야 한다 —
   * 한쪽만 남으면 사용자는 저장했다고 믿고 예배에 들어간다.
   */
  it('기본 설정과 항목이 한 번의 저장으로 함께 남는다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '기본 설정 + 항목',
      kind: 'template',
      items: [{ type: 'text', content: '대표기도', variant: 'order' }],
    });
    const id = created.body.data!.plan.id;
    createdPlanIds.push(id);
    expect(created.body.data!.plan.defaults).toBeUndefined();

    const saved = await send<PlanResponse>('PUT', `/api/plans/${id}`, {
      name: '기본 설정 + 항목',
      items: [
        { type: 'text', content: '대표기도', variant: 'order' },
        { type: 'liturgy', textId: 'lords-prayer', version: 'new' },
      ],
      defaults: {
        bible: { primary: 'krv', secondary: ['niv'], paging: 'auto' },
        song: { langs: ['ko', 'en'], lines: '2' },
        liturgy: { version: 'traditional', perSlide: 4 },
        titleOnSelect: false,
        readingBackground: { src: 'bg_1.png', source: 'library' },
      },
    });
    expect(saved.body.data!.plan.items).toHaveLength(2);

    // 다시 읽어도 그대로여야 한다 — 화면 state 가 아니라 DB 에 남았는지를 본다
    const reread = await get<ServicePlan>(`/api/plans/${id}`);
    const d = reread.body.data!.defaults!;
    expect(d.bible).toEqual({ primary: 'krv', secondary: ['niv'], paging: 'auto' });
    expect(d.song).toEqual({ langs: ['ko', 'en'], lines: '2' });
    expect(d.liturgy).toEqual({ version: 'traditional', perSlide: 4 });
    // '켬' 이 기본이라 false 만 저장된다 — 이것이 빠지면 끈 설정이 조용히 되살아난다
    expect(d.titleOnSelect).toBe(false);
    expect(d.readingBackground).toEqual({ src: 'bg_1.png', source: 'library' });
    expect(reread.body.data!.items).toHaveLength(2);
  });

  /**
   * '이름 바꾸기' 는 항목을 보내지 않는다 — 아직 저장하지 않은 편집을 굳히면 안 되므로.
   * 그래서 돌아오는 plan 에는 **저장된** 기본 설정이 들어 있다. 화면이 그것을 그대로
   * 받아 쓰면 편집 중인 기본 설정이 조용히 옛 값으로 돌아간다 (PlanPanel 이 지금
   * 화면의 defaults 를 유지하는 이유).
   */
  it('이름만 바꾸면 서버는 저장된 기본 설정을 그대로 돌려준다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '이름 바꿀 유형',
      kind: 'template',
      items: [],
      defaults: { bible: { primary: 'krv' } },
    });
    const id = created.body.data!.plan.id;
    createdPlanIds.push(id);

    const renamed = await send<PlanResponse>('PUT', `/api/plans/${id}`, { name: '바뀐 이름' });
    expect(renamed.body.data!.plan.name).toBe('바뀐 이름');
    expect(renamed.body.data!.plan.defaults?.bible?.primary).toBe('krv');
  });

  it('복제하면 기본 설정도 따라간다', async () => {
    const created = await send<PlanResponse>('POST', '/api/plans', {
      name: '복제 기본 설정',
      defaults: { bible: { primary: 'krv' } },
      items: [],
    });
    createdPlanIds.push(created.body.data!.plan.id);

    const copy = await send<ServicePlan>('POST', `/api/plans/${created.body.data!.plan.id}/duplicate`, {});
    createdPlanIds.push(copy.body.data!.id);
    expect(copy.body.data!.defaults?.bible?.primary).toBe('krv');
  });
});

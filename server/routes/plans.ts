/**
 * 예배 순서 REST 라우트.
 *
 * 항목 검증을 경계에서 한다 — 잘못된 항목이 저장되면 예배 중 순서표가 깨진다.
 * 알 수 없는 필드는 버리고, 필수 필드가 없는 항목은 거부한다.
 */

import type { FastifyInstance } from 'fastify';

import type { ApiResponse, CueItem, ServicePlan } from '../../shared/types.ts';
import * as store from '../db/plans.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

/**
 * 들어온 항목을 검증해 정규화한다.
 * id 가 없으면 새로 발급한다 — 클라이언트가 잊어도 재배치가 깨지지 않게.
 */
export function normalizeItems(raw: unknown): { items: CueItem[]; rejected: string[] } {
  if (!Array.isArray(raw)) return { items: [], rejected: ['항목 목록이 배열이 아닙니다'] };

  const items: CueItem[] = [];
  const rejected: string[] = [];

  for (const [index, entry] of raw.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      rejected.push(`${index + 1}번째 항목: 객체가 아닙니다`);
      continue;
    }

    // 유니온 전체에 공통인 필드만 여기서 읽는다.
    // templateId 는 'blank' 항목에 없으므로 레코드로 따로 본다.
    const item = entry as Partial<CueItem> & { type?: string };
    const fields = entry as Record<string, unknown>;
    const id = typeof item.id === 'string' && item.id.length > 0 ? item.id : store.newItemId();
    // divider 에는 note 가 없어 유니온에서 사라진다 — 느슨한 객체로 읽는다
    const loose = entry as Record<string, unknown>;
    const note = typeof loose.note === 'string' ? loose.note : undefined;
    const templateId = typeof fields.templateId === 'number' ? fields.templateId : undefined;

    switch (item.type) {
      case 'bible': {
        const bible = item as Extract<CueItem, { type: 'bible' }>;
        if (typeof bible.ref !== 'string' || bible.ref.trim().length === 0) {
          rejected.push(`${index + 1}번째 항목: 성경 참조가 없습니다`);
          continue;
        }
        items.push({
          id,
          type: 'bible',
          ref: bible.ref.trim(),
          primary: typeof bible.primary === 'string' ? bible.primary : 'nkrv',
          secondary: Array.isArray(bible.secondary) ? bible.secondary.filter((s) => typeof s === 'string') : [],
          ...(typeof bible.paging === 'string' ? { paging: bible.paging } : {}),
          ...(templateId !== undefined ? { templateId } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }

      case 'song': {
        const song = item as Extract<CueItem, { type: 'song' }>;
        if (typeof song.songId !== 'number' || !Number.isInteger(song.songId)) {
          rejected.push(`${index + 1}번째 항목: 곡 id 가 올바르지 않습니다`);
          continue;
        }
        items.push({
          id,
          type: 'song',
          songId: song.songId,
          songTitle: typeof song.songTitle === 'string' ? song.songTitle : '(제목 없음)',
          langs: Array.isArray(song.langs) ? song.langs.filter((l) => typeof l === 'string').slice(0, 2) : ['ko'],
          ...(typeof song.lines === 'string' ? { lines: song.lines } : {}),
          ...(templateId !== undefined ? { templateId } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }

      case 'text': {
        const text = item as Extract<CueItem, { type: 'text' }>;
        if (typeof text.content !== 'string' || text.content.trim().length === 0) {
          rejected.push(`${index + 1}번째 항목: 내용이 없습니다`);
          continue;
        }
        // 광고(notice)·인용구(quote)·순서 표시(order)는 저장 구조가 같고 표시만 다르다.
        // 아는 값만 통과시킨다 — 모르는 값은 기본(광고)으로 떨어뜨린다.
        const variant =
          text.variant === 'quote' || text.variant === 'order' ? text.variant : undefined;

        items.push({
          id,
          type: 'text',
          content: text.content,
          ...(variant ? { variant } : {}),
          ...(templateId !== undefined ? { templateId } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }

      case 'blank':
        items.push({ id, type: 'blank', ...(note ? { note } : {}) });
        break;

      case 'divider': {
        const divider = item as Extract<CueItem, { type: 'divider' }>;
        const label = typeof divider.label === 'string' ? divider.label.trim() : '';
        if (label.length === 0) {
          rejected.push(`${index + 1}번째 항목: 구분 이름이 없습니다`);
          continue;
        }
        items.push({ id, type: 'divider', label });
        break;
      }

      default:
        rejected.push(`${index + 1}번째 항목: 알 수 없는 종류 '${String(item.type)}'`);
    }
  }

  return { items, rejected };
}

export async function registerPlanRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/plans', async () => ok(store.listPlans()));

  app.get<{ Params: { id: string } }>('/api/plans/:id', async (request, reply) => {
    const plan = store.getPlan(Number(request.params.id));
    return plan ? ok(plan) : reply.code(404).send(fail('예배 순서를 찾을 수 없습니다'));
  });

  app.post<{ Body: { name?: string; serviceDate?: string; items?: unknown } }>(
    '/api/plans',
    async (request, reply) => {
      const name = request.body?.name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send(fail('name 이 필요합니다'));
      }

      const { items, rejected } = normalizeItems(request.body?.items ?? []);
      const plan = store.createPlan({
        name: name.trim(),
        ...(request.body?.serviceDate ? { serviceDate: request.body.serviceDate } : {}),
        items,
      });

      // 버린 항목이 있으면 조용히 넘기지 않고 알린다
      return ok({ plan, ...(rejected.length > 0 ? { rejected } : {}) });
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string; serviceDate?: string; items?: unknown } }>(
    '/api/plans/:id',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!store.getPlan(id)) return reply.code(404).send(fail('예배 순서를 찾을 수 없습니다'));

      const patch: Parameters<typeof store.updatePlan>[1] = {};
      if (typeof request.body?.name === 'string' && request.body.name.trim().length > 0) {
        patch.name = request.body.name.trim();
      }
      if (typeof request.body?.serviceDate === 'string') patch.serviceDate = request.body.serviceDate;

      let rejected: string[] = [];
      if (request.body?.items !== undefined) {
        const normalized = normalizeItems(request.body.items);
        patch.items = normalized.items;
        rejected = normalized.rejected;
      }

      const plan = store.updatePlan(id, patch);
      return ok({ plan, ...(rejected.length > 0 ? { rejected } : {}) });
    },
  );

  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/plans/:id/duplicate',
    async (request, reply) => {
      try {
        return ok(store.duplicatePlan(Number(request.params.id), request.body?.name));
      } catch (err) {
        return reply.code(404).send(fail(err instanceof Error ? err.message : '복제할 수 없습니다'));
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/plans/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!store.getPlan(id)) return reply.code(404).send(fail('예배 순서를 찾을 수 없습니다'));
    store.deletePlan(id);
    return ok({ deleted: id });
  });
}

export interface ServicePlanResponse {
  plan: ServicePlan;
  rejected?: string[];
}

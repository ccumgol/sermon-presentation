/**
 * 템플릿 REST 라우트.
 *
 * 입력 검증은 경계에서 한다 — 잘못된 템플릿이 저장되면 예배 중 화면이 깨진다.
 * 미지의 필드는 버리고, 알려진 필드만 기본값과 병합해 저장한다.
 */

import type { FastifyInstance } from 'fastify';

import { templateToCssVars } from '../../lib/template-css.ts';
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID } from '../../lib/template-presets.ts';
import type { ApiResponse, Template } from '../../shared/types.ts';
import * as store from '../db/templates.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

const KINDS = new Set(['bible', 'song', 'lower_third', 'blank', 'order']);

/**
 * 들어온 값을 기준 템플릿과 병합해 유효한 Template 을 만든다.
 * 깊은 병합이 필요한 이유: 편집 UI 가 바뀐 필드만 보내기 때문이다.
 */
function mergeTemplate(base: Template, patch: unknown): Template {
  if (typeof patch !== 'object' || patch === null) return base;
  const p = patch as Partial<Template>;

  const text = { ...base.text };
  if (p.text && typeof p.text === 'object') {
    for (const role of Object.keys(base.text) as Array<keyof Template['text']>) {
      const incoming = p.text[role];
      if (incoming && typeof incoming === 'object') text[role] = { ...base.text[role], ...incoming };
    }
  }

  return {
    ...base,
    ...(typeof p.name === 'string' && p.name.trim().length > 0 ? { name: p.name.trim() } : {}),
    ...(typeof p.kind === 'string' && KINDS.has(p.kind) ? { kind: p.kind as Template['kind'] } : {}),
    canvas: {
      ...base.canvas,
      ...(p.canvas ?? {}),
      safeArea: { ...base.canvas.safeArea, ...(p.canvas?.safeArea ?? {}) },
      background: p.canvas?.background ?? base.canvas.background,
    },
    layout: { ...base.layout, ...(p.layout ?? {}) },
    text,
    behavior: {
      ...base.behavior,
      ...(p.behavior ?? {}),
      transition: { ...base.behavior.transition, ...(p.behavior?.transition ?? {}) },
    },
    ...(p.overridesByLang ? { overridesByLang: p.overridesByLang } : {}),
    ...(p.overridesByTranslation ? { overridesByTranslation: p.overridesByTranslation } : {}),
    id: base.id,
    isBuiltin: base.isBuiltin,
  };
}

function baseFor(kind: string): Template {
  return (
    BUILTIN_TEMPLATES.find((t) => t.kind === kind) ??
    BUILTIN_TEMPLATES.find((t) => t.id === DEFAULT_TEMPLATE_ID) ??
    BUILTIN_TEMPLATES[0]!
  );
}

export interface TemplateRouteHooks {
  /** 템플릿이 바뀌면 송출 화면에 즉시 반영해야 한다 */
  onTemplateChanged: (template: Template) => void;
  currentTemplateId: () => number;
}

export async function registerTemplateRoutes(app: FastifyInstance, hooks: TemplateRouteHooks): Promise<void> {
  app.get('/api/templates', async () => ok(store.listTemplates()));

  app.get<{ Params: { id: string } }>('/api/templates/:id', async (request, reply) => {
    const template = store.getTemplate(Number(request.params.id));
    return template ? ok(template) : reply.code(404).send(fail('템플릿을 찾을 수 없습니다'));
  });

  /** 편집 UI 미리보기용 — 저장하지 않고 CSS 변수만 계산해 본다 */
  app.get<{ Params: { id: string } }>('/api/templates/:id/css', async (request, reply) => {
    const template = store.getTemplate(Number(request.params.id));
    return template ? ok(templateToCssVars(template)) : reply.code(404).send(fail('템플릿을 찾을 수 없습니다'));
  });

  app.post<{ Body: unknown }>('/api/templates', async (request, reply) => {
    const body = (request.body ?? {}) as Partial<Template>;
    const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : 'bible';

    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return reply.code(400).send(fail('name 이 필요합니다'));
    }

    const merged = mergeTemplate(baseFor(kind), body);
    const { id: _id, isBuiltin: _b, ...rest } = merged;
    return ok(store.createTemplate(rest));
  });

  app.put<{ Params: { id: string }; Body: unknown }>('/api/templates/:id', async (request, reply) => {
    const id = Number(request.params.id);
    const existing = store.getTemplate(id);
    if (!existing) return reply.code(404).send(fail('템플릿을 찾을 수 없습니다'));

    try {
      const next = store.updateTemplate(id, mergeTemplate(existing, request.body));
      // 지금 송출 중인 템플릿을 고쳤다면 화면에 바로 반영한다
      if (hooks.currentTemplateId() === id) hooks.onTemplateChanged(next);
      return ok(next);
    } catch (err) {
      if (err instanceof store.BuiltinTemplateError) return reply.code(409).send(fail(err.message));
      throw err;
    }
  });

  app.post<{ Params: { id: string }; Body: { name?: string } }>(
    '/api/templates/:id/duplicate',
    async (request, reply) => {
      try {
        return ok(store.duplicateTemplate(Number(request.params.id), request.body?.name));
      } catch (err) {
        return reply.code(404).send(fail(err instanceof Error ? err.message : '복제할 수 없습니다'));
      }
    },
  );

  app.delete<{ Params: { id: string } }>('/api/templates/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!store.getTemplate(id)) return reply.code(404).send(fail('템플릿을 찾을 수 없습니다'));

    try {
      store.deleteTemplate(id);
      // 지우는 템플릿이 송출 중이었다면 기본 프리셋으로 되돌린다
      if (hooks.currentTemplateId() === id) hooks.onTemplateChanged(store.getTemplateOrDefault(DEFAULT_TEMPLATE_ID));
      return ok({ deleted: id });
    } catch (err) {
      if (err instanceof store.BuiltinTemplateError) return reply.code(409).send(fail(err.message));
      throw err;
    }
  });
}

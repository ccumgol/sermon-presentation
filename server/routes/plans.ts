/**
 * 예배 순서 REST 라우트.
 *
 * 항목 검증을 경계에서 한다 — 잘못된 항목이 저장되면 예배 중 순서표가 깨진다.
 * 알 수 없는 필드는 버리고, 필수 필드가 없는 항목은 거부한다.
 */

import type { FastifyInstance } from 'fastify';

import { safeBackgroundName } from './backgrounds.ts';
import {
  DEFAULT_LITURGY_VERSION,
  isLiturgyId,
  isLiturgyPerSlide,
  isLiturgyVersion,
} from '../../lib/liturgy-texts.ts';
import {
  normalizeCharStyles, normalizePresenterScale, normalizeStroke,
} from '../../lib/order-rhythm.ts';

import {
  AUTO_HOLD_MS_DEFAULT,
  AUTO_HOLD_MS_MAX,
  AUTO_HOLD_MS_MIN,
  type ApiResponse,
  type CueItem,
  type ItemBackground,
  type ReadingStyle,
  type PlanDefaults,
  type PlanKind,
  type ServicePlan,
} from '../../shared/types.ts';
import * as store from '../db/plans.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

/**
 * 항목 배경을 검증한다.
 *
 * 이름 검증은 배경 업로드와 **같은 함수**를 쓴다(`safeBackgroundName`) — 경로를 떼고
 * 허용 확장자만 통과시킨다. 폴더는 아는 두 값만 받는다. 모르는 값이면 배경을 담지
 * 않는다 (항목은 살린다 — 배경이 없어도 본문은 나가야 한다).
 */
function readItemBackground(raw: unknown): ItemBackground | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;

  const src = safeBackgroundName(value.src);
  if (!src) return undefined;

  const source = value.source === 'data' ? 'data' : value.source === 'library' ? 'library' : undefined;
  if (!source) return undefined;

  // 기본은 cover — 배경이 화면을 못 채우면 글자 뒤에 빈 자리가 보인다
  const fit = value.fit === 'contain' ? 'contain' : undefined;
  return { src, source, ...(fit ? { fit } : {}) };
}

/**
 * 교독문·전례문의 표시 설정(폰트·글자 크기)을 검증한다.
 *
 * 폰트는 **아는 두 값만** 받는다 — 모르는 값이면 담지 않고 템플릿 폰트를 쓴다.
 * 배수는 범위를 잘라 둔다. 0 이나 음수가 들어가면 글자가 사라지고, 너무 크면
 * 화면을 넘겨 `autoFit` 이 다시 줄인다(그러면 지정한 뜻이 없어진다).
 */
const READING_SCALE_MIN = 0.6;
const READING_SCALE_MAX = 2;

function readReadingStyle(raw: unknown): ReadingStyle | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;

  const font = value.font === 'serif' ? 'serif' : value.font === 'sans' ? 'sans' : undefined;
  const scale =
    typeof value.scale === 'number' && Number.isFinite(value.scale)
      ? Math.min(Math.max(Math.round(value.scale * 100) / 100, READING_SCALE_MIN), READING_SCALE_MAX)
      : undefined;

  // 기본값(1)은 저장하지 않는다 — 박아 두면 나중에 기본을 바꿀 수 없다
  const keepScale = scale !== undefined && scale !== 1 ? scale : undefined;
  if (!font && keepScale === undefined) return undefined;
  return { ...(font ? { font } : {}), ...(keepScale !== undefined ? { scale: keepScale } : {}) };
}

/**
 * 예배 전 안내 자동 진행 설정을 검증한다.
 *
 * 간격을 범위 밖으로 저장할 수 있으면 0초(무한 반복으로 화면이 깜빡임)나
 * 몇 시간짜리가 들어간다. 예배 화면이 걸린 문제라 경계에서 잘라 둔다.
 */
function readAuto(raw: unknown): { holdMs: number; loop: boolean } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as { holdMs?: unknown; loop?: unknown };
  const holdMs = typeof value.holdMs === 'number' && Number.isFinite(value.holdMs)
    ? Math.min(Math.max(Math.round(value.holdMs), AUTO_HOLD_MS_MIN), AUTO_HOLD_MS_MAX)
    : AUTO_HOLD_MS_DEFAULT;
  return { holdMs, loop: value.loop !== false };
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
        // 배치는 순서 표시에만 뜻이 있다. 기본(split)은 저장하지 않는다 —
        // 저장된 순서표에 기본값이 박혀 있으면 나중에 기본을 바꿀 수 없다.
        const layout = variant === 'order' && text.layout === 'stack' ? 'stack' : undefined;
        // 글자별 수동 조정도 순서 표시에만 뜻이 있다
        const charStyles = variant === 'order' ? normalizeCharStyles(fields.charStyles) : undefined;
        const presenterScale = variant === 'order' ? normalizePresenterScale(fields.presenterScale) : undefined;
        const titleStroke = variant === 'order' ? normalizeStroke(fields.titleStroke) : undefined;
        const presenterStroke = variant === 'order' ? normalizeStroke(fields.presenterStroke) : undefined;

        items.push({
          id,
          type: 'text',
          content: text.content,
          ...(variant ? { variant } : {}),
          ...(layout ? { layout } : {}),
          ...(charStyles ? { charStyles } : {}),
          ...(presenterScale !== undefined ? { presenterScale } : {}),
          ...(titleStroke !== undefined ? { titleStroke } : {}),
          ...(presenterStroke !== undefined ? { presenterStroke } : {}),
          ...(templateId !== undefined ? { templateId } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }

      case 'liturgy': {
        const liturgy = item as Extract<CueItem, { type: 'liturgy' }>;
        if (!isLiturgyId(liturgy.textId)) {
          rejected.push(`${index + 1}번째 항목: 모르는 본문 '${String(liturgy.textId)}'`);
          continue;
        }
        // 판본·장수는 모르는 값이면 기본으로 떨어뜨린다. 항목을 버릴 일은 아니다 —
        // 무엇을 띄울지(textId)만 맞으면 예배는 진행된다.
        const version = isLiturgyVersion(liturgy.version) ? liturgy.version : DEFAULT_LITURGY_VERSION;
        const background = readItemBackground(fields.background);
        const perSlide = isLiturgyPerSlide(fields.perSlide) ? fields.perSlide : undefined;
        // 빈 배열은 '고치지 않음'으로 본다 — 실수로 다 지웠을 때 빈 화면이 나가면 안 된다
        const overrideLines = Array.isArray(fields.overrideLines)
          ? fields.overrideLines
              .filter((line): line is string => typeof line === 'string')
              .map((line) => line.trim())
              .filter((line) => line.length > 0)
          : [];

        items.push({
          id,
          type: 'liturgy',
          textId: liturgy.textId,
          version,
          ...(perSlide !== undefined ? { perSlide } : {}),
          ...(overrideLines.length > 0 ? { overrideLines } : {}),
          ...(background ? { background } : {}),
          ...(readReadingStyle(fields.style) ? { style: readReadingStyle(fields.style)! } : {}),
          ...(templateId !== undefined ? { templateId } : {}),
          ...(note ? { note } : {}),
        });
        break;
      }

      case 'reading': {
        const reading = item as Extract<CueItem, { type: 'reading' }>;
        if (!Number.isInteger(reading.readingNumber) || reading.readingNumber <= 0) {
          rejected.push(`${index + 1}번째 항목: 교독문 번호가 올바르지 않습니다`);
          continue;
        }
        items.push({
          id,
          type: 'reading',
          readingNumber: reading.readingNumber,
          // 제목은 표시용이다. DB 에 없어도 순서표에 무엇이었는지 남는다 —
          // 가져오기를 안 한 PC 로 순서표를 옮겼을 때 번호만 남으면 알 수 없다.
          ...(typeof reading.readingTitle === 'string' && reading.readingTitle.trim().length > 0
            ? { readingTitle: reading.readingTitle.trim() }
            : {}),
          ...(readItemBackground(fields.background)
            ? { background: readItemBackground(fields.background)! }
            : {}),
          ...(readReadingStyle(fields.style) ? { style: readReadingStyle(fields.style)! } : {}),
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
        const auto = readAuto(divider.auto);
        items.push({ id, type: 'divider', label, ...(auto ? { auto } : {}) });
        break;
      }

      default:
        rejected.push(`${index + 1}번째 항목: 알 수 없는 종류 '${String(item.type)}'`);
    }
  }

  return { items, rejected };
}

/**
 * 순서표의 기본 설정을 검증한다.
 *
 * 아는 필드만 통과시킨다. 템플릿 id 는 정수만, 역본은 문자열만, 보조 역본은 두 개까지.
 * 여기서 걸러야 잘못된 값이 **예배 중 모든 항목에** 퍼진다.
 */
function readDefaults(raw: unknown): PlanDefaults | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  const out: PlanDefaults = {};

  const templates = value.templates as Record<string, unknown> | undefined;
  if (templates && typeof templates === 'object') {
    const picked: NonNullable<PlanDefaults['templates']> = {};
    for (const key of ['bible', 'song', 'order', 'text'] as const) {
      const id = templates[key];
      if (typeof id === 'number' && Number.isInteger(id)) picked[key] = id;
    }
    if (Object.keys(picked).length > 0) out.templates = picked;
  }

  const bible = value.bible as Record<string, unknown> | undefined;
  if (bible && typeof bible === 'object') {
    const picked: NonNullable<PlanDefaults['bible']> = {};
    if (typeof bible.primary === 'string') picked.primary = bible.primary;
    if (Array.isArray(bible.secondary)) {
      picked.secondary = bible.secondary.filter((id): id is string => typeof id === 'string').slice(0, 2);
    }
    if (typeof bible.paging === 'string') picked.paging = bible.paging;
    if (Object.keys(picked).length > 0) out.bible = picked;
  }

  const song = value.song as Record<string, unknown> | undefined;
  if (song && typeof song === 'object') {
    const picked: NonNullable<PlanDefaults['song']> = {};
    if (Array.isArray(song.langs)) {
      picked.langs = song.langs.filter((l): l is string => typeof l === 'string').slice(0, 2);
    }
    if (typeof song.lines === 'string') picked.lines = song.lines;
    if (Object.keys(picked).length > 0) out.song = picked;
  }

  const liturgy = value.liturgy as Record<string, unknown> | undefined;
  if (liturgy && typeof liturgy === 'object') {
    const picked: NonNullable<PlanDefaults['liturgy']> = {};
    if (isLiturgyVersion(liturgy.version)) picked.version = liturgy.version;
    if (isLiturgyPerSlide(liturgy.perSlide)) picked.perSlide = liturgy.perSlide;
    if (Object.keys(picked).length > 0) out.liturgy = picked;
  }

  const readingBackground = readItemBackground(value.readingBackground);
  if (readingBackground) out.readingBackground = readingBackground;

  return Object.keys(out).length > 0 ? out : undefined;
}

/** 알 수 없는 값은 유형이 아니라 저장된 순서로 본다 — 유형이 함부로 늘어나면 안 된다 */
function readKind(value: unknown): PlanKind | undefined {
  if (value === 'template' || value === 'plan') return value;
  return undefined;
}

export async function registerPlanRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { kind?: string } }>('/api/plans', async (request) =>
    ok(store.listPlans(readKind(request.query?.kind))),
  );

  app.get<{ Params: { id: string } }>('/api/plans/:id', async (request, reply) => {
    const plan = store.getPlan(Number(request.params.id));
    return plan ? ok(plan) : reply.code(404).send(fail('예배 순서를 찾을 수 없습니다'));
  });

  app.post<{ Body: { name?: string; serviceDate?: string; items?: unknown; kind?: string; defaults?: unknown } }>(
    '/api/plans',
    async (request, reply) => {
      const name = request.body?.name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        return reply.code(400).send(fail('name 이 필요합니다'));
      }

      const { items, rejected } = normalizeItems(request.body?.items ?? []);
      const kind = readKind(request.body?.kind);
      const plan = store.createPlan({
        name: name.trim(),
        ...(request.body?.serviceDate ? { serviceDate: request.body.serviceDate } : {}),
        items,
        ...(kind ? { kind } : {}),
        ...(readDefaults(request.body?.defaults) ? { defaults: readDefaults(request.body?.defaults)! } : {}),
      });

      // 버린 항목이 있으면 조용히 넘기지 않고 알린다
      return ok({ plan, ...(rejected.length > 0 ? { rejected } : {}) });
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string; serviceDate?: string; items?: unknown; defaults?: unknown } }>(
    '/api/plans/:id',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!store.getPlan(id)) return reply.code(404).send(fail('예배 순서를 찾을 수 없습니다'));

      const patch: Parameters<typeof store.updatePlan>[1] = {};
      if (typeof request.body?.name === 'string' && request.body.name.trim().length > 0) {
        patch.name = request.body.name.trim();
      }
      if (typeof request.body?.serviceDate === 'string') patch.serviceDate = request.body.serviceDate;

      if (request.body?.defaults !== undefined) {
        // null 을 보내면 기본 설정을 지운다 — '이 예배는 항목이 알아서'로 되돌리는 길
        patch.defaults = readDefaults(request.body.defaults);
      }

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

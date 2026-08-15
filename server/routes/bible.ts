/**
 * 성경 조회 REST 라우트.
 *
 * 모든 응답은 ApiResponse<T> 형식을 따른다 (success/data/error).
 * 입력은 경계에서 전부 검증한다 — 파싱 실패는 200 + success:false 로 돌려주고
 * (오퍼레이터가 타이핑 중인 정상 상황이므로 오류가 아니다),
 * 잘못된 파라미터는 400 으로 돌려준다.
 */

import type { FastifyInstance } from 'fastify';

import { parseReference } from '../../lib/reference-parser.ts';
import { buildSlides, describeSlide, type PagingMode } from '../../lib/slide-builder.ts';
import type { ApiResponse, Deck, Testament } from '../../shared/types.ts';
import * as bible from '../db/bible.ts';

const PAGING_MODES: readonly PagingMode[] = ['verse', 'pair', 'all', 'auto'];

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

/** 쉼표로 구분된 역본 목록을 검증한다. 알 수 없는 id 는 조용히 버리지 않고 알린다. */
function parseTranslationIds(raw: unknown, fallback: string): { ids: string[]; unknown: string[] } {
  const text = typeof raw === 'string' && raw.trim().length > 0 ? raw : fallback;
  const requested = text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const ids: string[] = [];
  const unknownIds: string[] = [];
  for (const id of requested) {
    if (bible.getTranslation(id)) {
      if (!ids.includes(id)) ids.push(id);
    } else {
      unknownIds.push(id);
    }
  }
  return { ids, unknown: unknownIds };
}

function parseTestament(raw: unknown): Testament | undefined {
  if (raw === 'OT' || raw === 'NT') return raw;
  return undefined;
}

export async function registerBibleRoutes(app: FastifyInstance, defaultTranslation: string): Promise<void> {
  app.get('/api/translations', async () => ok(bible.listTranslations()));

  app.get('/api/books', async () => ok(bible.listBooks()));

  app.get('/api/bible/build-info', async () => ok(bible.getBuildInfo()));

  /**
   * 참조 파싱만 수행한다. 입력창에서 타이핑할 때마다 호출되므로 가볍게 유지한다.
   * 파싱 실패도 정상 응답 — 후보 목록을 그대로 내려 UI 가 안내할 수 있게 한다.
   */
  app.get<{ Querystring: { q?: string } }>('/api/bible/parse', async (request) => {
    const result = parseReference(request.query.q ?? '');
    return ok(result);
  });

  /**
   * 본문 조회. 참조 문자열 또는 이미 파싱된 범위를 받는다.
   * 응답에는 슬라이드 묶음까지 포함해 컨트롤 패널이 한 번의 요청으로 송출 준비를 마친다.
   */
  app.get<{
    Querystring: { ref?: string; t?: string; paging?: string; heading?: string };
  }>('/api/bible/passage', async (request, reply) => {
    const ref = request.query.ref ?? '';
    if (ref.trim().length === 0) {
      return reply.code(400).send(fail('ref 파라미터가 필요합니다'));
    }

    const parsed = parseReference(ref);
    if (!parsed.ok) {
      // 파싱 실패는 오류가 아니라 안내 대상이다
      return ok({ parse: parsed, passage: null, deck: null });
    }

    const { ids, unknown } = parseTranslationIds(request.query.t, defaultTranslation);
    if (ids.length === 0) {
      return reply.code(400).send(fail(`알 수 없는 역본: ${unknown.join(', ') || '(없음)'}`));
    }

    const pagingRaw = request.query.paging ?? 'pair';
    const paging = (PAGING_MODES as readonly string[]).includes(pagingRaw)
      ? (pagingRaw as PagingMode)
      : 'pair';

    const includeHeading = request.query.heading !== 'false';

    const passage = bible.getPassage({ ranges: parsed.ranges, translationIds: ids, includeHeading });
    const slides = buildSlides(passage, paging);

    const deck: Deck = {
      reference: passage.referenceAbbr,
      slides,
      labels: slides.map(describeSlide),
      index: 0,
    };

    return ok({
      parse: parsed,
      passage,
      deck,
      paging,
      // 요청한 역본 중 없는 것이 있으면 조용히 넘기지 않고 알린다
      ...(unknown.length > 0 ? { unknownTranslations: unknown } : {}),
      // 해당 역본에 본문이 없는 경우(헬라어로 구약 조회 등)를 UI 가 안내할 수 있게
      unavailableTranslations: passage.blocks.filter((b) => b.unavailable).map((b) => b.translationId),
    });
  });

  /** 전문 검색. 한국어는 부분일치, 그 외는 어절 검색 (server/db/bible.ts) */
  app.get<{
    Querystring: { q?: string; t?: string; testament?: string; limit?: string };
  }>('/api/bible/search', async (request, reply) => {
    const term = (request.query.q ?? '').trim();
    if (term.length === 0) {
      return reply.code(400).send(fail('q 파라미터가 필요합니다'));
    }

    const { ids, unknown } = parseTranslationIds(request.query.t, defaultTranslation);
    const translationId = ids[0];
    if (!translationId) {
      return reply.code(400).send(fail(`알 수 없는 역본: ${unknown.join(', ') || '(없음)'}`));
    }

    const limitRaw = Number(request.query.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : undefined;

    const result = bible.search(term, {
      translationId,
      testament: parseTestament(request.query.testament),
      ...(limit ? { limit } : {}),
    });

    return ok(result);
  });

  /** 장 이동용 — 역본별 실제 장 수 */
  app.get<{ Querystring: { t?: string; book?: string } }>('/api/bible/chapters', async (request, reply) => {
    const book = Number(request.query.book);
    if (!Number.isInteger(book) || book < 1 || book > 66) {
      return reply.code(400).send(fail('book 은 1~66 사이의 정수여야 합니다'));
    }

    const { ids } = parseTranslationIds(request.query.t, defaultTranslation);
    const translationId = ids[0];
    if (!translationId) return reply.code(400).send(fail('알 수 없는 역본'));

    return ok({ translationId, book, chapters: bible.getChapterCount(translationId, book) });
  });
}

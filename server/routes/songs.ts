/**
 * 찬양 REST 라우트.
 *
 * 성경과 마찬가지로 응답에 **슬라이드 묶음까지** 담아, 컨트롤 패널이
 * 한 번의 요청으로 송출 준비를 마치게 한다.
 */

import { MAX_LANGS } from '../../lib/lang-select.ts';
import type { FastifyInstance } from 'fastify';

import { parseLyrics } from '../../lib/lyrics-parser.ts';
import { attachSheets, isUncertain, sheetSrc, type SheetSummary } from '../../lib/sheet-attach.ts';
import { guessLayout } from '../../lib/sheet-match.ts';
import * as sheets from '../db/sheets.ts';
import {
  availableLangs,
  buildSongDeck,
  DEFAULT_MAX_CHARS_PER_LINE,
  type LinesPerSlide,
} from '../../lib/song-slides.ts';
import type { ApiResponse, Deck, LangCode, Song } from '../../shared/types.ts';
import * as store from '../db/songs.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

const LINES_OPTIONS = new Set(['1', '2', '4', 'section']);

/**
 * 덱 이름 — 번호가 있는 첫 수록 곡집을 앞에 붙인다.
 * '새찬송가 305장 나 같은 죄인 살리신' 처럼 오퍼레이터가 무엇을 올렸는지 바로 보이게.
 */
function deckReference(song: Song): string {
  const numbered = song.entries.find((entry) => entry.number !== undefined);
  return numbered ? `${numbered.songbookShortLabel} ${numbered.number}장 ${song.title}` : song.title;
}

function parseLines(raw: unknown): LinesPerSlide {
  if (raw === 'section') return 'section';
  const n = Number(raw);
  return n === 1 || n === 2 || n === 4 ? (n as LinesPerSlide) : 2;
}

/**
 * 표시 행 폭. 범위를 벗어난 값은 기본값으로 되돌린다.
 *
 * 하한 8자는 한 어절도 못 담는 폭을 막고, 상한 60자는 한 절이 통째로 한 행이
 * 되는 것을 막는다 — 둘 다 화면에서 읽을 수 없는 결과가 된다.
 */
function parseMaxChars(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 8 || n > 60) return DEFAULT_MAX_CHARS_PER_LINE;
  return Math.round(n);
}

function parseLangs(raw: unknown, fallback: LangCode[]): LangCode[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) return fallback;
  const langs = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // 상한은 한 곳에서 정한다 (lib/lang-select.ts). 성경의 '주 역본 + 보조 2개' 와 같다
  return langs.slice(0, MAX_LANGS);
}

export async function registerSongRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/songs/count', async () => ok({ total: store.countSongs() }));

  /** 최근 송출한 곡 — 검색 없이 바로 꺼내는 경로 */
  app.get<{ Querystring: { limit?: string } }>('/api/songs/recent', async (request) => {
    const limit = Number(request.query.limit);
    return ok(store.listRecent(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 40) : 12));
  });

  /** 자주 송출한 곡 */
  app.get<{ Querystring: { limit?: string } }>('/api/songs/frequent', async (request) => {
    const limit = Number(request.query.limit);
    return ok(store.listFrequent(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 40) : 12));
  });

  /** 즐겨찾기 — 예배마다 쓰는 곡을 검색 없이 바로 꺼낸다 */
  app.get<{ Querystring: { limit?: string } }>('/api/songs/favorites', async (request) => {
    const limit = Number(request.query.limit);
    return ok(store.listFavorites(Number.isInteger(limit) && limit > 0 ? Math.min(limit, 20) : 5));
  });

  /** 즐겨찾기에 넣거나 뺀다 */
  app.post<{ Params: { id: string }; Body: { value?: boolean } }>(
    '/api/songs/:id/favorite',
    async (request, reply) => {
      const next = store.toggleFavorite(Number(request.params.id), request.body?.value);
      if (next === null) return reply.code(404).send(fail('곡을 찾을 수 없습니다'));
      return ok({ id: Number(request.params.id), favorite: next });
    },
  );

  /** 가사가 비었거나 한 줄인 곡 — 가져오기 누락을 예배 전에 발견하기 위한 점검 */
  app.get<{ Querystring: { book?: string } }>('/api/songs/incomplete', async (request) =>
    ok(store.listIncomplete(request.query.book)),
  );

  app.get<{ Querystring: { q?: string; limit?: string; book?: string } }>('/api/songs', async (request) => {
    const query = (request.query.q ?? '').trim();
    const limitRaw = Number(request.query.limit);
    const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined;

    // 곡집을 고르면 그 곡집으로 범위를 좁힌다. 검색어가 없으면 목록을 돌려준다.
    return ok(
      store.searchSongs(query, {
        ...(request.query.book ? { songbookId: request.query.book } : {}),
        ...(limit ? { limit } : {}),
      }),
    );
  });

  /**
   * 이 곡의 악보 상태 — 조작 화면이 **곡을 열자마자** 알아야 한다.
   *
   * 덱을 만들 때까지 기다리면 '악보가 왜 안 나오지?' 를 송출하고 나서야 알게 된다.
   * 판정은 `attachSheets` 와 **같은 함수**를 쓴다 — 두 곳에 적으면 화면은 '괜찮다'
   * 는데 실제로는 어긋나는 일이 생긴다.
   *
   * 여러 곡집에 실린 곡은 **악보가 있는 첫 수록**을 쓴다 (덱 라우트와 같은 규칙).
   */
  function sheetSummaryFor(song: Song): SheetSummary | undefined {
    const sectionLines = [...song.sections]
      .sort((a, b) => a.position - b.position)
      .map((section) => new Set(section.lines.map((line) => line.lineIndex)).size);

    for (const entry of song.entries) {
      if (entry.number === undefined) continue;
      const sheet = sheets.getSheet(store.conn(), entry.songbookId, entry.number);
      if (!sheet || sheet.systems.length === 0) continue;
      // 사람이 정해 둔 것이 있으면 그것이 이긴다. 없으면 짐작한다
      const layout = sheet.layout ?? guessLayout(sectionLines, sheet.systems.length);
      return {
        songbookId: sheet.songbookId,
        number: sheet.number,
        systemCount: sheet.systems.length,
        layout,
        chosen: sheet.layout !== undefined,
        uncertain: isUncertain(sectionLines, sheet.systems.length, layout),
        needsReview: sheet.needsReview,
      };
    }
    return undefined;
  }

  app.get<{ Params: { id: string } }>('/api/songs/:id', async (request, reply) => {
    const song = store.getSong(Number(request.params.id));
    if (!song) return reply.code(404).send(fail('곡을 찾을 수 없습니다'));
    return ok({ song, availableLangs: availableLangs(song), sheet: sheetSummaryFor(song) });
  });

  /**
   * 줄나눔 검토 대기열.
   *
   * 자동 정렬은 제안이므로 사람이 한 번 훑어야 한다. 확인한 곡은 이후 자동
   * 작업에서 제외되므로, 여기서 승인한 것은 영구히 보존된다.
   */
  app.get<{
    Querystring: { sort?: string; pending?: string; book?: string; limit?: string; offset?: string };
  }>('/api/songs/review', async (request) => {
    const sort = ['number', 'usage', 'attention'].includes(request.query.sort ?? '')
      ? (request.query.sort as 'number' | 'usage' | 'attention')
      : 'number';

    return ok(
      store.reviewQueue({
        sort,
        pendingOnly: request.query.pending === 'true',
        ...(request.query.book ? { songbookId: request.query.book } : {}),
        limit: Math.min(200, Math.max(1, Number(request.query.limit) || 50)),
        offset: Math.max(0, Number(request.query.offset) || 0),
      }),
    );
  });

  /** 줄나눔을 확인 완료로 표시 */
  app.post<{ Params: { id: string } }>('/api/songs/:id/confirm', async (request, reply) => {
    const songId = Number(request.params.id);
    if (!store.getSong(songId)) return reply.code(404).send(fail('곡을 찾을 수 없습니다'));
    if (!store.confirmLines(songId)) return reply.code(400).send(fail('확인할 섹션이 없습니다'));
    return ok({ id: songId, confirmed: true });
  });

  /** 확인 표시 되돌리기 */
  app.delete<{ Params: { id: string } }>('/api/songs/:id/confirm', async (request, reply) => {
    const songId = Number(request.params.id);
    if (!store.getSong(songId)) return reply.code(404).send(fail('곡을 찾을 수 없습니다'));
    store.unconfirmLines(songId);
    return ok({ id: songId, confirmed: false });
  });

  /** 송출용 슬라이드 묶음 */
  app.get<{
    Params: { id: string };
    Querystring: {
      langs?: string;
      lines?: string;
      section?: string;
      credit?: string;
      /** 표시 한 행의 최대 글자 수 — 템플릿의 값을 그대로 넘긴다 */
      maxChars?: string;
    };
  }>('/api/songs/:id/deck', async (request, reply) => {
    const song = store.getSong(Number(request.params.id));
    if (!song) return reply.code(404).send(fail('곡을 찾을 수 없습니다'));

    const langs = parseLangs(request.query.langs, availableLangs(song).slice(0, 1));
    const linesPerSlide = parseLines(request.query.lines);
    const includeCredit = request.query.credit !== 'false';
    const maxCharsPerLine = parseMaxChars(request.query.maxChars);

    // 특정 섹션만 요청한 경우
    const sectionId = request.query.section ? Number(request.query.section) : null;
    const sequence =
      sectionId !== null && song.sections.some((s) => s.id === sectionId) ? [sectionId] : undefined;

    const { slides, labels, slideSections, sectionLines } = buildSongDeck(song, {
      langs,
      linesPerSlide,
      includeCredit,
      maxCharsPerLine,
      ...(sequence ? { sequence } : {}),
    });

    /*
     * 악보가 있으면 슬라이드마다 **어느 단인지**를 실어 보낸다.
     *
     * 여기서 붙이는 이유: 덱은 한 번 만들어져 여러 화면으로 간다. 화면마다 따로
     * 계산하면 프로젝터와 조작 화면이 다른 단을 가리킬 수 있다.
     *
     * 곡이 여러 곡집에 실렸으면 **악보가 있는 첫 수록**을 쓴다. 같은 곡의 악보는
     * 어느 곡집 것이든 같은 가락이라 아무거나 쓰면 되고, 없는 것을 찾아 헤매느니
     * 있는 것을 바로 쓰는 편이 낫다.
     */
    let withSheets = slides;
    for (const entry of song.entries) {
      if (entry.number === undefined) continue;
      const sheet = sheets.getSheet(store.conn(), entry.songbookId, entry.number);
      if (!sheet || sheet.systems.length === 0) continue;
      withSheets = attachSheets(slides, {
        slideSections,
        sectionLines,
        // 사람이 정해 둔 모양이 있으면 짐작하지 않는다 (요약 라우트와 같은 규칙)
        ...(sheet.layout ? { layout: sheet.layout } : {}),
        sheet: {
          songbookId: sheet.songbookId,
          number: sheet.number,
          height: sheet.height,
          systems: sheet.systems,
        },
      });
      break;
    }

    const deck: Deck = {
      reference: deckReference(song),
      slides: withSheets,
      labels,
      index: 0,
    };

    // 덱을 만들어 준 시점을 '사용'으로 본다 — 최근 목록의 근거가 된다
    if (withSheets.length > 0) store.markUsed(song.id);

    // 요청한 언어 중 이 곡에 없는 것을 조용히 넘기지 않고 알린다
    const missingLangs = langs.filter((lang) => !song.langs.includes(lang));

    return ok({ deck, langs, availableLangs: availableLangs(song), missingLangs });
  });

  /**
   * 가사 텍스트를 붙여넣어 구조를 미리 본다 (저장하지 않음).
   * `|` 페어링이 의도대로 잡혔는지 편집 UI 가 보여주기 위한 용도.
   */
  app.post<{ Body: { text?: string; primaryLang?: string; secondaryLang?: string } }>(
    '/api/songs/parse-lyrics',
    async (request, reply) => {
      const text = request.body?.text;
      if (typeof text !== 'string') return reply.code(400).send(fail('text 가 필요합니다'));

      return ok(
        parseLyrics(text, {
          primaryLang: request.body?.primaryLang ?? 'ko',
          secondaryLang: request.body?.secondaryLang ?? 'en',
        }),
      );
    },
  );

  /** 가사 구조를 통째로 교체한다 (부분 수정보다 페어링이 안전하다) */
  app.put<{ Params: { id: string }; Body: { text?: string; primaryLang?: string; secondaryLang?: string } }>(
    '/api/songs/:id/lyrics',
    async (request, reply) => {
      const id = Number(request.params.id);
      if (!store.getSong(id)) return reply.code(404).send(fail('곡을 찾을 수 없습니다'));

      const text = request.body?.text;
      if (typeof text !== 'string' || text.trim().length === 0) {
        return reply.code(400).send(fail('가사 텍스트가 필요합니다'));
      }

      const sections = parseLyrics(text, {
        primaryLang: request.body?.primaryLang ?? 'ko',
        secondaryLang: request.body?.secondaryLang ?? 'en',
      });
      if (sections.length === 0) return reply.code(400).send(fail('해석할 수 있는 가사가 없습니다'));

      store.replaceSections(id, sections);
      const updated = store.getSong(id)!;
      return ok({ song: updated, availableLangs: availableLangs(updated) });
    },
  );

  app.post<{ Body: { title?: string; text?: string; primaryLang?: string; secondaryLang?: string } }>(
    '/api/songs',
    async (request, reply) => {
      const title = request.body?.title;
      if (typeof title !== 'string' || title.trim().length === 0) {
        return reply.code(400).send(fail('title 이 필요합니다'));
      }

      const sections = parseLyrics(request.body?.text ?? '', {
        primaryLang: request.body?.primaryLang ?? 'ko',
        secondaryLang: request.body?.secondaryLang ?? 'en',
      });

      /*
       * **`lines_source` 를 'manual' 로 넣는다.**
       *
       * 기본값은 `'auto'` 인데, 그러면 사람이 앱에서 직접 쓴 곡이 검토 대기열에
       * 올라오고 자동 작업의 대상이 된다. 검토할 '자동 결과' 가 없는데도 그렇다.
       * 사람이 쓴 것이므로 `manual` 이 사실에 맞고, 뒤이어 가사 편집으로 저장하면
       * 어차피 같은 값이 된다 (`replaceSections` 의 기본값).
       */
      const id = store.createSong({
        title: title.trim(),
        source: 'manual',
        sections,
        linesSource: 'manual',
      });
      return ok(store.getSong(id));
    },
  );

  /**
   * 악보 모양을 사람이 정한다 — `shared`(절이 겹쳐 적힘) · `sequential`(이어 적힘).
   *
   * `layout` 을 주지 않으면 **자동 짐작으로 되돌린다.** 잘못 골랐을 때 원래대로 갈 수
   * 있어야 하고, 짐작 규칙이 나아지면 그 곡도 자동이 맞힐 수 있다.
   *
   * 곡이 아니라 **악보**에 붙는다 (곡집·번호). 같은 악보를 여러 곡이 가리킬 수 있고,
   * 모양은 악보가 어떻게 인쇄됐는지의 성질이지 곡의 성질이 아니다.
   */
  app.put<{ Params: { songbookId: string; number: string }; Body: { layout?: unknown } }>(
    '/api/sheets/:songbookId/:number/layout',
    async (request, reply) => {
      // `null` 도 '되돌린다' 로 본다 — JSON.stringify 가 undefined 키를 지워 버려서
      // 화면이 '자동으로' 를 보낼 방법이 null 뿐인 경우가 있다 (lineGapPx 에서 겪은 것)
      const raw = request.body?.layout ?? undefined;
      if (raw !== undefined && raw !== 'shared' && raw !== 'sequential') {
        return reply.code(400).send(fail("layout 은 'shared' · 'sequential' · null 중 하나여야 합니다"));
      }
      const number = Number(request.params.number);
      if (!Number.isInteger(number)) return reply.code(400).send(fail('번호가 올바르지 않습니다'));

      const changed = sheets.setSheetLayout(store.conn(), request.params.songbookId, number, raw);
      if (!changed) return reply.code(404).send(fail('악보를 찾을 수 없습니다'));
      return ok({ songbookId: request.params.songbookId, number, layout: raw ?? null });
    },
  );

  /**
   * 사람이 봐야 하는 악보 목록 — 오선이 5줄로 잡히지 않은 장들.
   *
   * **곡 제목을 함께 준다.** 번호만 있으면 '이게 무슨 곡이지' 를 다른 탭에서
   * 찾아봐야 해서, 155장을 훑는 동안 손이 계속 끊긴다.
   *
   * 이미 본 장도 함께 준다 — 빼면 방금 누른 것이 사라져 잘못 눌렀는지 알 수 없다.
   */
  app.get<{ Querystring: { book?: string } }>('/api/sheets/review', async (request) => {
    const db = store.conn();
    const rows = sheets.listSheetsToReview(db, request.query.book);
    const titles = store.titlesByEntry(request.query.book);

    return ok({
      counts: sheets.countSheets(db),
      items: rows.map((sheet) => ({
        songbookId: sheet.songbookId,
        number: sheet.number,
        src: sheetSrc(sheet.songbookId, sheet.number),
        width: sheet.width,
        height: sheet.height,
        systems: sheet.systems,
        titles: titles.get(`${sheet.songbookId}:${sheet.number}`) ?? [],
        ...(sheet.reviewState ? { reviewState: sheet.reviewState } : {}),
      })),
    });
  });

  /**
   * 한 장에 대한 사람의 판정. `state` 가 없으면 **안 본 것으로 되돌린다.**
   *
   * 155장을 훑는 중에 한 번 잘못 누르면 그 장을 다시 만날 방법이 없어지므로,
   * 물릴 길을 반드시 둔다.
   */
  app.put<{ Params: { songbookId: string; number: string }; Body: { state?: unknown } }>(
    '/api/sheets/:songbookId/:number/review',
    async (request, reply) => {
      const raw = request.body?.state ?? undefined;
      if (raw !== undefined && raw !== 'ok' && raw !== 'bad') {
        return reply.code(400).send(fail("state 는 'ok' · 'bad' · null 중 하나여야 합니다"));
      }
      const number = Number(request.params.number);
      if (!Number.isInteger(number)) return reply.code(400).send(fail('번호가 올바르지 않습니다'));

      const changed = sheets.setSheetReview(store.conn(), request.params.songbookId, number, raw);
      if (!changed) return reply.code(404).send(fail('악보를 찾을 수 없습니다'));
      return ok({ songbookId: request.params.songbookId, number, state: raw ?? null });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/songs/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!store.getSong(id)) return reply.code(404).send(fail('곡을 찾을 수 없습니다'));
    store.deleteSong(id);
    return ok({ deleted: id });
  });
}

export { LINES_OPTIONS };

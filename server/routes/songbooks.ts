/**
 * 곡집 REST 라우트 — 목록·생성·수정·삭제·가져오기.
 *
 * '가져오기'와 '개별 생성'이 같은 경로를 쓴다: 곡집을 만들고 그 안에 곡을 넣는다.
 * 재가져오기는 `deleteBySongbook` 으로 범위를 지우고 다시 넣으므로,
 * 개별 갱신과 일괄 갱신이 정확히 같은 동작이다.
 */

import type { FastifyInstance } from 'fastify';

import { parseLyrics } from '../../lib/lyrics-parser.ts';
import { parseSongbookText, type ParsedSongInput } from '../../lib/songbook-import.ts';
import type { ApiResponse, Songbook } from '../../shared/types.ts';
import * as songbooks from '../db/songbooks.ts';
import * as songs from '../db/songs.ts';

/** 가져오기 본문 한도 — 곡집 하나가 수백 곡일 수 있다 */
const IMPORT_BODY_LIMIT = 64 * 1024 * 1024;

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

export interface ImportSongbookResult {
  songbook: Songbook;
  added: number;
  replaced: number;
  /** 건너뛴 곡 — 조용히 넘기지 않고 알린다 */
  skipped: string[];
  /** 번호가 빠진 자리 (가져오기가 일부만 됐는지 확인용) */
  missingNumbers: number[];
}

export async function registerSongbookRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/songbooks', async () => ok(songbooks.listSongbooks(songs.conn())));

  app.get<{ Params: { id: string } }>('/api/songbooks/:id', async (request, reply) => {
    const book = songbooks.getSongbook(songs.conn(), request.params.id);
    if (!book) return reply.code(404).send(fail('곡집을 찾을 수 없습니다'));
    return ok({ songbook: book, ...songbooks.findGaps(songs.conn(), book.id) });
  });

  app.post<{ Body: { name?: string; shortLabel?: string; numbered?: boolean; quickSlot?: number } }>(
    '/api/songbooks',
    async (request, reply) => {
      try {
        const book = songbooks.createSongbook(songs.conn(), {
          name: request.body?.name ?? '',
          ...(request.body?.shortLabel ? { shortLabel: request.body.shortLabel } : {}),
          ...(request.body?.numbered !== undefined ? { numbered: request.body.numbered } : {}),
          ...(request.body?.quickSlot !== undefined ? { quickSlot: request.body.quickSlot } : {}),
        });
        return ok(book);
      } catch (err) {
        return reply.code(400).send(fail(err instanceof Error ? err.message : '만들 수 없습니다'));
      }
    },
  );

  app.put<{
    Params: { id: string };
    Body: { name?: string; shortLabel?: string; numbered?: boolean; quickSlot?: number | null };
  }>('/api/songbooks/:id', async (request, reply) => {
    try {
      return ok(songbooks.updateSongbook(songs.conn(), request.params.id, request.body ?? {}));
    } catch (err) {
      const message = err instanceof Error ? err.message : '수정할 수 없습니다';
      return reply.code(message.includes('찾을 수 없습니다') ? 404 : 400).send(fail(message));
    }
  });

  app.delete<{ Params: { id: string } }>('/api/songbooks/:id', async (request, reply) => {
    try {
      // 수록곡은 '기타'로 옮긴다 — 곡집을 지워도 본문이 사라지지 않아야 한다
      const result = songbooks.deleteSongbook(songs.conn(), request.params.id);
      return ok({ deleted: request.params.id, ...result });
    } catch (err) {
      const message = err instanceof Error ? err.message : '지울 수 없습니다';
      return reply.code(message.includes('찾을 수 없습니다') ? 404 : 409).send(fail(message));
    }
  });

  /**
   * 곡집에 곡을 넣는다 (일괄 가져오기).
   *
   * `text` 로 여러 곡을 한 번에, 또는 `songs` 배열로 구조화된 입력을 받는다.
   * `mode: 'replace'` 면 그 곡집의 기존 곡을 먼저 지운다 — 개별 갱신의 기본 경로다.
   */
  app.post<{
    Params: { id: string };
    Body: { text?: string; songs?: ParsedSongInput[]; mode?: string; secondaryLang?: string };
  }>('/api/songbooks/:id/import', { bodyLimit: IMPORT_BODY_LIMIT }, async (request, reply) => {
    const db = songs.conn();
    const book = songbooks.getSongbook(db, request.params.id);
    if (!book) return reply.code(404).send(fail('곡집을 찾을 수 없습니다'));

    const skipped: string[] = [];
    let parsed: ParsedSongInput[];

    if (Array.isArray(request.body?.songs)) {
      parsed = request.body.songs;
    } else if (typeof request.body?.text === 'string' && request.body.text.trim().length > 0) {
      const result = parseSongbookText(request.body.text, { numbered: book.numbered });
      parsed = result.songs;
      skipped.push(...result.skipped);
    } else {
      return reply.code(400).send(fail('text 또는 songs 가 필요합니다'));
    }

    if (parsed.length === 0) {
      return reply.code(400).send(fail(`가져올 곡이 없습니다${skipped.length > 0 ? ` (건너뜀 ${skipped.length}건)` : ''}`));
    }

    const replaced = request.body?.mode === 'replace' ? songs.deleteBySongbook(book.id) : 0;

    let added = 0;
    for (const item of parsed) {
      if (typeof item?.title !== 'string' || item.title.trim().length === 0) {
        skipped.push('제목 없는 곡');
        continue;
      }

      const sections = Array.isArray(item.sections)
        ? item.sections
        : parseLyrics(item.lyrics ?? '', { secondaryLang: request.body?.secondaryLang ?? 'en' });

      if (sections.length === 0) {
        skipped.push(`${item.title}: 가사 없음`);
        continue;
      }

      try {
        songs.createSong({
          title: item.title.trim(),
          ...(item.titleAlt ? { titleAlt: item.titleAlt } : {}),
          ...(item.author ? { author: item.author } : {}),
          ...(item.copyright ? { copyright: item.copyright } : {}),
          ...(item.ccliNumber ? { ccliNumber: item.ccliNumber } : {}),
          tags: [book.name],
          source: book.id,
          entries: [{ songbookId: book.id, ...(book.numbered && item.number !== undefined ? { number: item.number } : {}) }],
          sections,
        });
        added++;
      } catch (err) {
        skipped.push(`${item.title}: ${err instanceof Error ? err.message : '저장 실패'}`);
      }
    }

    songbooks.markImported(db, book.id, `가져오기 ${added}곡`);
    const gaps = songbooks.findGaps(db, book.id);

    return ok({
      songbook: songbooks.getSongbook(db, book.id)!,
      added,
      replaced,
      skipped,
      // 빠진 번호가 많으면 가져오기가 일부만 된 것이다
      missingNumbers: gaps.missing.slice(0, 50),
    } satisfies ImportSongbookResult);
  });

  /** 가져오기 전에 어떻게 해석되는지 미리 본다 (저장하지 않음) */
  app.post<{ Body: { text?: string; numbered?: boolean } }>(
    '/api/songbooks/parse',
    { bodyLimit: IMPORT_BODY_LIMIT },
    async (request, reply) => {
      const text = request.body?.text;
      if (typeof text !== 'string') return reply.code(400).send(fail('text 가 필요합니다'));
      return ok(parseSongbookText(text, { numbered: request.body?.numbered !== false }));
    },
  );

  /** 곡의 수록 정보를 바꾼다 — '이 곡은 많은물소리 42번' 을 나중에 붙일 때 쓴다 */
  app.put<{ Params: { id: string }; Body: { entries?: Array<{ songbookId: string; number?: number | null }> } }>(
    '/api/songs/:id/entries',
    async (request, reply) => {
      const songId = Number(request.params.id);
      if (!songs.getSong(songId)) return reply.code(404).send(fail('곡을 찾을 수 없습니다'));

      const entries = request.body?.entries;
      if (!Array.isArray(entries)) return reply.code(400).send(fail('entries 가 필요합니다'));

      songs.setEntries(songId, entries);
      return ok(songs.getSong(songId));
    },
  );

  /** 대응곡 연결·해제 */
  app.post<{ Params: { id: string }; Body: { linkedId?: number } }>(
    '/api/songs/:id/link',
    async (request, reply) => {
      const songId = Number(request.params.id);
      const linkedId = Number(request.body?.linkedId);
      if (!songs.getSong(songId) || !songs.getSong(linkedId)) {
        return reply.code(404).send(fail('곡을 찾을 수 없습니다'));
      }
      songs.linkSongs(songId, linkedId);
      return ok(songs.getSong(songId));
    },
  );

  app.delete<{ Params: { id: string; linkedId: string } }>(
    '/api/songs/:id/link/:linkedId',
    async (request, reply) => {
      const songId = Number(request.params.id);
      if (!songs.getSong(songId)) return reply.code(404).send(fail('곡을 찾을 수 없습니다'));
      songs.unlinkSongs(songId, Number(request.params.linkedId));
      return ok(songs.getSong(songId));
    },
  );
}

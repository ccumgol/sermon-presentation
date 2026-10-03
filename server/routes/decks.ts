/**
 * **PDF 꾸러미** — 쪽을 그림으로 바꿔 순서표에 넣는다 (2026-10-03 사용자 결정).
 *
 * ## 누가 무엇을 하나
 *
 * | | |
 * |---|---|
 * | 사람 | `data/decks/` 에 PDF 를 넣는다 |
 * | 조작 화면 | 그 PDF 를 읽어 **쪽을 그린다** (`pdfjs-dist`, 브라우저에서) |
 * | 서버(여기) | 그려 온 쪽을 **울타리 안에서** 파일로 쓴다 |
 *
 * 서버가 직접 그리지 않는 이유: Node 에서 PDF 를 래스터화하려면 네이티브 canvas 가
 * 필요하고, 그러면 이 저장소의 **«빌드 없음»** 이 깨진다. 조작 화면은 이미 크로미움이다.
 *
 * ## ⚠️ 업로드를 다시 여는 것이라 울타리가 있다
 *
 * 보안 S-1 이 **«배경 업로드에 총량 제한·삭제가 없다 → 디스크 고갈 → 가사 손실»**
 * 이었고, 그래서 업로드를 기능째 걷어냈다(2026-08-18 `d74fc9e`). 여기서 쓰는 길을
 * 다시 여는 이상 그 위험도 함께 돌아온다. 네 겹으로 막는다:
 *
 * 1. **루프백에서만** 받는다 — 같은 PC 에서 준비하는 일이다. LAN·태블릿은 못 쓴다
 * 2. **원본 PDF 가 폴더에 이미 있을 때만** 받는다 — 없는 이름으로 만들어 낼 수 없다
 * 3. 쪽 수·쪽 용량·꾸러미 합계 **상한** (`lib/deck-files.ts`)
 * 4. 이름은 `safeDeckName` 을 지난다 — `decks/` 밖으로 못 나간다
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance, FastifyRequest } from 'fastify';

import {
  MAX_DECK_BYTES,
  MAX_DECK_PAGES,
  MAX_PAGE_BYTES,
  PAGE_EXT,
  deckNameOf,
  pageFileName,
  safeDeckName,
} from '../../lib/deck-files.ts';
import { isLoopbackAddress } from '../../lib/lan-auth.ts';
import type { ApiResponse } from '../../shared/types.ts';
import { paths } from '../paths.ts';

function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

export interface DeckSummary {
  /** `선교보고` — 파일 이름에서 `.pdf` 를 뗀 것 */
  name: string;
  /** 원본 PDF 주소 — 조작 화면이 이것을 읽어 쪽을 그린다 */
  pdfUrl: string;
  bytes: number;
  /** 이미 바꿔 둔 쪽 수. 0 이면 아직 안 바꾼 것이다 */
  pages: number;
  /** 바꾼 쪽들이 차지하는 용량 */
  pageBytes: number;
}

/** `decks/<이름>/` 안의 쪽 그림을 센다 */
function countPages(name: string): { pages: number; bytes: number } {
  const dir = path.join(paths.decksDir, name);
  if (!existsSync(dir)) return { pages: 0, bytes: 0 };
  let pages = 0;
  let bytes = 0;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(PAGE_EXT)) continue;
    try {
      const stat = statSync(path.join(dir, file));
      if (!stat.isFile()) continue;
      pages += 1;
      bytes += stat.size;
    } catch {
      // 읽을 수 없는 항목 하나 때문에 목록이 죽지 않게
    }
  }
  return { pages, bytes };
}

export function listDecks(): DeckSummary[] {
  const dir = paths.decksDir;
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .flatMap((file) => {
      const name = deckNameOf(file);
      if (name === undefined) return [];
      try {
        const stat = statSync(path.join(dir, file));
        if (!stat.isFile()) return [];
        const counted = countPages(name);
        return [
          {
            name,
            pdfUrl: `/decks/${encodeURIComponent(file)}`,
            bytes: stat.size,
            pages: counted.pages,
            pageBytes: counted.bytes,
          },
        ];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
}

/** 원본 PDF 가 폴더에 실제로 있는가 — 울타리 2 */
function pdfExists(name: string): boolean {
  const dir = paths.decksDir;
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((file) => deckNameOf(file) === name);
}

interface PageBody {
  page?: number;
  /** `data:image/webp;base64,...` 가 아니라 **순수 base64** 만 받는다 */
  data?: string;
  /** 첫 쪽을 쓰기 전에 옛 결과를 지운다 */
  reset?: boolean;
}

export async function registerDeckRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/decks', async () => ok({ decks: listDecks(), dir: paths.decksDir }));

  /*
   * **본문 한도를 직접 준다** (2026-10-03 실측으로 잡은 버그).
   *
   * Fastify 의 기본값은 **1MB** 다. 쪽 그림을 base64 로 싣으면 4/3 로 불어나므로
   * 실제로는 **0.75MB 넘는 쪽에서 연결이 끊겼다** — 오류도 아니고 그냥 끊긴다.
   * 사진이 많은 선교보고 한 쪽은 그 크기를 쉽게 넘는다. 여기서 막히면
   * `MAX_PAGE_BYTES`(4MB) 는 닿지도 못하는 숫자가 된다.
   *
   * base64 로 부푸는 몫(4/3)을 얹되 **상한보다 넉넉히** 둔다. 두 한도가 붙어
   * 있으면 상한을 조금 넘은 쪽이 **깨끗한 413 대신 연결 끊김**으로 떨어진다 —
   * 사람에게는 «왜 안 되는지 모르겠다» 가 된다. 1MB 의 여유가 그 구간이다.
   */
  const PAGE_BODY_LIMIT = Math.ceil((MAX_PAGE_BYTES + 1024 * 1024) * (4 / 3));

  app.post<{ Params: { name: string }; Body: PageBody }>(
    '/api/decks/:name/pages',
    { bodyLimit: PAGE_BODY_LIMIT },
    async (request: FastifyRequest<{ Params: { name: string }; Body: PageBody }>, reply) => {
      // 울타리 1 — 같은 PC 에서 준비하는 일이다
      if (!isLoopbackAddress(request.ip)) {
        return reply.code(403).send(fail('이 PC 에서만 PDF 를 바꿀 수 있습니다'));
      }

      // 울타리 4 — 이름이 `decks/` 밖으로 나가지 않는다
      const name = safeDeckName(request.params.name);
      if (name === undefined) return reply.code(400).send(fail('이름이 올바르지 않습니다'));

      // 울타리 2 — 원본이 없으면 만들어 낼 수 없다
      if (!pdfExists(name)) {
        return reply.code(404).send(fail(`원본 PDF 가 없습니다 (decks/${name}.pdf)`));
      }

      const body = request.body ?? {};
      const page = body.page;
      if (typeof page !== 'number' || !Number.isInteger(page) || page < 1 || page > MAX_DECK_PAGES) {
        return reply.code(400).send(fail(`쪽 번호가 올바르지 않습니다 (1~${MAX_DECK_PAGES})`));
      }
      if (typeof body.data !== 'string' || body.data.length === 0) {
        return reply.code(400).send(fail('쪽 그림이 없습니다'));
      }

      /*
       * **`Buffer.from(…, 'base64')` 은 던지지 않는다** (2026-10-03 실측).
       * 잘못된 글자를 조용히 버리고 **작은 버퍼**를 돌려준다 — 그대로 두면
       * 깨진 `.webp` 가 파일로 남고, 예배 중에야 «그림이 안 나온다» 로 드러난다.
       * 그래서 앞머리를 본다: WebP 는 `RIFF` 로 시작해 9번째 바이트부터 `WEBP` 다.
       */
      const bytes = Buffer.from(body.data, 'base64');
      const looksWebp =
        bytes.length > 12 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP';
      if (!looksWebp) return reply.code(400).send(fail('쪽 그림을 읽지 못했습니다 (WebP 가 아닙니다)'));
      // 울타리 3 — 쪽 하나
      if (bytes.length === 0 || bytes.length > MAX_PAGE_BYTES) {
        return reply.code(413).send(fail(`쪽 하나가 너무 큽니다 (상한 ${MAX_PAGE_BYTES / 1024 / 1024}MB)`));
      }

      const dir = path.join(paths.decksDir, name);
      /*
       * 첫 쪽에서 옛 결과를 지운다. 안 지우면 **전에 20쪽이던 것을 10쪽으로 바꿨을 때
       * 11~20쪽이 남아** 예배 중에 옛 슬라이드가 뒤에 붙는다.
       */
      if (body.reset === true) rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });

      // 울타리 3 — 꾸러미 합계
      const counted = countPages(name);
      if (counted.bytes + bytes.length > MAX_DECK_BYTES) {
        return reply
          .code(413)
          .send(fail(`꾸러미가 너무 큽니다 (상한 ${MAX_DECK_BYTES / 1024 / 1024}MB). 해상도를 낮춰 보세요`));
      }

      writeFileSync(path.join(dir, pageFileName(page)), bytes);
      return ok({ name, page, bytes: bytes.length });
    },
  );
}

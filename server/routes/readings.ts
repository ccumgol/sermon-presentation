/**
 * 교독문 REST 라우트.
 *
 * 읽기만 있다 — 본문은 `scripts/import-responsive.ts` 로 넣는다. 웹에서 고칠 길을
 * 두지 않은 이유는, 76편이 원본 txt 에서 오고 그 파일이 사실상의 원본이기 때문이다.
 * 여기서 고치면 다음 가져오기에 조용히 덮어써진다.
 */

import type { FastifyInstance } from 'fastify';

import { readingSlides } from '../../lib/responsive-parser.ts';
import type { ApiResponse } from '../../shared/types.ts';
import * as store from '../db/readings.ts';

// 라우트마다 지역으로 두는 것이 이 프로젝트의 규약이다 (plans.ts 등과 같다)
function ok<T>(data: T): ApiResponse<T> {
  return { success: true, data, error: null };
}

function fail(error: string): ApiResponse<null> {
  return { success: false, data: null, error };
}

export async function registerReadingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * 목록 — 고를 때 쓴다. **본문 줄은 보내지 않는다.**
   * 76편 × 12줄이면 목록 한 번에 70KB 가 넘고, 고르는 데는 번호·제목·화면 수만 필요하다.
   */
  app.get<{ Querystring: { q?: string; book?: string } }>('/api/readings', async (request) => {
    const query = (request.query?.q ?? '').trim();
    // 어느 찬송가의 교독문인지. 없으면 통일찬송가용 — 옛 클라이언트가 그것을 기대한다
    const book = store.isReadingBook(request.query?.book) ? request.query.book : store.DEFAULT_READING_BOOK;
    const all = store.listReadings(book);

    /*
     * 숫자만 쳤으면 **본문은 보지 않는다.**
     *
     * '23' 을 치는 것은 거의 언제나 '교독문 23번' 을 뜻한다. 본문까지 뒤지면
     * 본문에 '23' 이 들어간 편이 함께 나와(실측 7건) 정작 23번을 찾기 어려워진다.
     * 제목은 본다 — '시편 23편' 을 번호로 찾는 경우가 있다.
     */
    const numeric = /^\d+$/.test(query);

    const filtered =
      query.length === 0
        ? all
        : all.filter((reading) => {
            if (String(reading.number) === query) return true;
            if (reading.title.includes(query)) return true;
            if (numeric) return false;
            return reading.lines.some((line) => line.includes(query));
          });

    // 번호가 정확히 맞는 편을 맨 위로 — 목록을 훑지 않고 바로 누를 수 있다
    const sorted = numeric
      ? [...filtered].sort((a, b) => {
          const exact = (r: typeof a): number => (String(r.number) === query ? 0 : 1);
          return exact(a) - exact(b) || a.number - b.number;
        })
      : filtered;

    return ok({
      book,
      /** 두 찬송가에 각각 몇 편이 있는지 — 고르는 화면이 빈 쪽을 흐리게 한다 */
      counts: store.countByBook(),
      total: all.length,
      items: sorted.map((reading) => ({
        number: reading.number,
        title: reading.title,
        lineCount: reading.lines.length,
        slideCount: readingSlides(reading.lines).length,
      })),
    });
  });

  /** 한 편 — 줄과 화면 묶음을 함께 준다 (컨트롤 패널이 다시 계산하지 않게) */
  app.get<{ Params: { number: string }; Querystring: { book?: string } }>(
    '/api/readings/:number',
    async (request, reply) => {
      const number = Number(request.params.number);
      const book = store.isReadingBook(request.query?.book)
        ? request.query.book
        : store.DEFAULT_READING_BOOK;
      const reading = store.getReading(number, book);
      if (!reading) {
        return reply
          .code(404)
          .send(
            fail(
              `${store.READING_BOOK_LABELS[book]} 교독문 ${request.params.number}번이 없습니다. ` +
                '가져오기를 먼저 하세요.',
            ),
          );
      }
      return ok({ ...reading, book, slides: readingSlides(reading.lines) });
    },
  );
}

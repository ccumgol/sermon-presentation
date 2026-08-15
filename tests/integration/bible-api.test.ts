/**
 * 성경 조회 통합 테스트 — 실제 bible.sqlite 를 읽는다.
 *
 * DB 가 없으면 (원본 성경 DB 를 갖지 않은 환경) 조용히 건너뛴다.
 * 건너뛴 사실은 vitest 출력에 그대로 드러나므로 숨겨지지 않는다.
 */

import { existsSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SOURCES } from '../../scripts/bible-sources.ts';
import { buildApp } from '../../server/app.ts';
import { paths } from '../../server/paths.ts';
import * as bible from '../../server/db/bible.ts';
import type { ApiResponse, ParseResult, SearchResult, Translation } from '../../shared/types.ts';

const hasBibleDb = existsSync(paths.bibleDb);

describe.skipIf(!hasBibleDb)('성경 DB 조회', () => {
  beforeAll(() => bible.initBibleDb());
  afterAll(() => bible.closeBibleDb());

  it('선언된 역본을 모두, 정렬 순서대로 돌려준다', () => {
    // 역본을 추가해도 이 테스트가 깨지지 않도록 선언 목록에서 기대값을 끌어온다
    const translations = bible.listTranslations();
    expect(translations).toHaveLength(SOURCES.length);
    expect(translations[0]?.id).toBe('nkrv');
    expect(translations.map((t) => t.sortOrder)).toEqual([...translations.map((t) => t.sortOrder)].sort((a, b) => a - b));
  });

  it('원어 역본의 범위가 반쪽이다', () => {
    expect(bible.getTranslation('grk')?.coverage).toEqual(['NT']);
    expect(bible.getTranslation('heb')?.coverage).toEqual(['OT']);
    expect(bible.getTranslation('heb')?.direction).toBe('rtl');
  });

  it('66권 메타를 돌려준다', () => {
    const books = bible.listBooks();
    expect(books).toHaveLength(66);
    expect(books[18]?.nameKo).toBe('시편');
    expect(books[18]?.chapters).toBe(150);
  });

  it('단일 절을 조회한다', () => {
    const passage = bible.getPassage({
      ranges: [{ book: 43, startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 }],
      translationIds: ['nkrv'],
    });
    expect(passage.blocks[0]?.verses).toHaveLength(1);
    expect(passage.blocks[0]?.verses[0]?.text).toContain('하나님이 세상을 이처럼 사랑하사');
    expect(passage.referenceAbbr).toBe('요 3:16');
  });

  it('장을 넘는 범위를 한 번에 조회한다', () => {
    const passage = bible.getPassage({
      ranges: [{ book: 43, startChapter: 3, startVerse: 35, endChapter: 4, endVerse: 2 }],
      translationIds: ['nkrv'],
    });
    const verses = passage.blocks[0]!.verses;
    expect(verses[0]).toMatchObject({ chapter: 3, verse: 35 });
    expect(verses[verses.length - 1]).toMatchObject({ chapter: 4, verse: 2 });
    // 3:35, 3:36, 4:1, 4:2
    expect(verses).toHaveLength(4);
  });

  it('장 전체를 조회한다 (절 지정 없음)', () => {
    const passage = bible.getPassage({
      ranges: [{ book: 19, startChapter: 23, startVerse: null, endChapter: 23, endVerse: null }],
      translationIds: ['nkrv'],
    });
    expect(passage.blocks[0]?.verses).toHaveLength(6); // 시편 23편은 6절
  });

  it('다역본을 요청 순서대로 돌려준다', () => {
    const passage = bible.getPassage({
      ranges: [{ book: 43, startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 }],
      translationIds: ['nkrv', 'niv', 'grk'],
    });
    expect(passage.blocks.map((b) => b.translationId)).toEqual(['nkrv', 'niv', 'grk']);
    expect(passage.blocks[2]?.verses[0]?.text).toContain('ἠγάπησεν');
  });

  it('역본에 없는 본문은 unavailable 로 표시한다', () => {
    // 헬라어 원문은 신약만 있다 — 화면에 오류를 띄우지 않고 조용히 구분한다
    const passage = bible.getPassage({
      ranges: [{ book: 1, startChapter: 1, startVerse: 1, endChapter: 1, endVerse: 1 }],
      translationIds: ['nkrv', 'grk'],
    });
    expect(passage.blocks[0]?.unavailable).toBeUndefined();
    expect(passage.blocks[1]?.unavailable).toBe(true);
    expect(passage.blocks[1]?.verses).toEqual([]);
  });

  it('판본별 장 구분 차이를 실제로 조회할 수 있다', () => {
    // 마소라 본문은 요엘을 4장으로 나눈다 (docs/KNOWN-DATA-ISSUES.md §3)
    const hebrew = bible.getPassage({
      ranges: [{ book: 29, startChapter: 4, startVerse: 1, endChapter: 4, endVerse: 1 }],
      translationIds: ['heb', 'nkrv'],
    });
    expect(hebrew.blocks[0]?.verses).toHaveLength(1);
    // 개역개정에는 요엘 4장이 없다
    expect(hebrew.blocks[1]?.unavailable).toBe(true);
  });

  it('소제목을 함께 돌려준다', () => {
    const passage = bible.getPassage({
      ranges: [{ book: 43, startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 18 }],
      translationIds: ['nkrv'],
      includeHeading: true,
    });
    expect(passage.heading).toBe('예수와 니고데모');
  });

  it('소제목을 요청하지 않으면 넣지 않는다', () => {
    const passage = bible.getPassage({
      ranges: [{ book: 43, startChapter: 3, startVerse: 16, endChapter: 3, endVerse: 18 }],
      translationIds: ['nkrv'],
    });
    expect(passage.heading).toBeUndefined();
  });
});

describe.skipIf(!hasBibleDb)('검색 전략', () => {
  beforeAll(() => bible.initBibleDb());
  afterAll(() => bible.closeBibleDb());

  it('한국어는 부분일치를 쓴다 — 어절 검색으로는 못 찾는 것을 찾는다', () => {
    // FTS5 unicode61 은 '사랑'으로 '사랑하사'를 못 찾는다 (26건 vs 557건)
    const result = bible.search('사랑', { translationId: 'nkrv' });
    expect(result.strategy).toBe('like');
    expect(result.total).toBeGreaterThan(500);
    expect(result.hits[0]?.reference).toMatch(/^\S+ \d+:\d+$/);
  });

  it('영어는 어절 검색을 쓴다', () => {
    const result = bible.search('love', { translationId: 'niv' });
    expect(result.strategy).toBe('fts');
    expect(result.total).toBeGreaterThan(100);
  });

  it('구약/신약 범위를 좁힌다', () => {
    const all = bible.search('사랑', { translationId: 'nkrv' });
    const ot = bible.search('사랑', { translationId: 'nkrv', testament: 'OT' });
    const nt = bible.search('사랑', { translationId: 'nkrv', testament: 'NT' });
    expect(ot.total + nt.total).toBe(all.total);
    expect(ot.hits.every((h) => h.book <= 39)).toBe(true);
    expect(nt.hits.every((h) => h.book >= 40)).toBe(true);
  });

  it('결과 수를 제한하고 잘렸음을 알린다', () => {
    const result = bible.search('사랑', { translationId: 'nkrv', limit: 5 });
    expect(result.hits).toHaveLength(5);
    expect(result.truncated).toBe(true);
  });

  it('LIKE 와일드카드를 리터럴로 취급한다', () => {
    // 사용자가 '%' 를 검색어로 넣어도 전체 매칭이 되어서는 안 된다
    const result = bible.search('%', { translationId: 'nkrv' });
    expect(result.total).toBe(0);
  });

  it('FTS 질의 문법 문자로 구문 오류가 나지 않는다', () => {
    for (const term of ['"', '(', 'love OR', 'a*b', '^x']) {
      expect(() => bible.search(term, { translationId: 'niv' })).not.toThrow();
    }
  });

  it('빈 검색어는 빈 결과', () => {
    expect(bible.search('   ', { translationId: 'nkrv' }).total).toBe(0);
  });
});

describe.skipIf(!hasBibleDb)('REST 라우트', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const built = await buildApp({ getPort: () => 7777 });
    app = built.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function getJson<T>(url: string): Promise<{ status: number; body: ApiResponse<T> }> {
    const response = await app.inject({ method: 'GET', url });
    return { status: response.statusCode, body: response.json() as ApiResponse<T> };
  }

  it('GET /api/translations', async () => {
    const { status, body } = await getJson<Translation[]>('/api/translations');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(SOURCES.length);
  });

  it('GET /api/bible/parse — 성공', async () => {
    const { body } = await getJson<ParseResult>('/api/bible/parse?q=' + encodeURIComponent('요 3:16'));
    expect(body.data?.ok).toBe(true);
  });

  it('GET /api/bible/parse — 실패도 200 으로 안내한다', async () => {
    // 타이핑 중의 정상 상황이므로 HTTP 오류가 아니다
    const { status, body } = await getJson<ParseResult>('/api/bible/parse?q=' + encodeURIComponent('없는책 1:1'));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.ok).toBe(false);
  });

  it('GET /api/bible/passage — 슬라이드 묶음까지 돌려준다', async () => {
    const { body } = await getJson<{
      deck: { slides: unknown[]; labels: string[] };
      unavailableTranslations: string[];
    }>('/api/bible/passage?ref=' + encodeURIComponent('요 3:16-18') + '&t=nkrv,niv&paging=pair');

    expect(body.data?.deck.slides).toHaveLength(2);
    expect(body.data?.deck.labels).toEqual(['3:16-17', '3:18']);
    expect(body.data?.unavailableTranslations).toEqual([]);
  });

  it('GET /api/bible/passage — 없는 역본을 알려준다', async () => {
    const { body } = await getJson<{ unavailableTranslations: string[] }>(
      '/api/bible/passage?ref=' + encodeURIComponent('창 1:1') + '&t=nkrv,grk',
    );
    expect(body.data?.unavailableTranslations).toEqual(['grk']);
  });

  it('GET /api/bible/passage — ref 없으면 400', async () => {
    const { status, body } = await getJson('/api/bible/passage');
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('GET /api/bible/passage — 알 수 없는 역본만 넘기면 400', async () => {
    const { status } = await getJson('/api/bible/passage?ref=' + encodeURIComponent('요 3:16') + '&t=nope');
    expect(status).toBe(400);
  });

  it('GET /api/bible/search', async () => {
    const { body } = await getJson<SearchResult>(
      '/api/bible/search?q=' + encodeURIComponent('사랑') + '&t=nkrv&limit=3',
    );
    expect(body.data?.strategy).toBe('like');
    expect(body.data?.hits).toHaveLength(3);
  });

  it('GET /api/bible/search — q 없으면 400', async () => {
    const { status } = await getJson('/api/bible/search?t=nkrv');
    expect(status).toBe(400);
  });

  it('GET /api/bible/chapters — 역본별 장 수', async () => {
    const heb = await getJson<{ chapters: number }>('/api/bible/chapters?t=heb&book=29');
    const nkrv = await getJson<{ chapters: number }>('/api/bible/chapters?t=nkrv&book=29');
    expect(heb.body.data?.chapters).toBe(4); // 마소라 요엘 4장
    expect(nkrv.body.data?.chapters).toBe(3);
  });

  it('GET /api/bible/chapters — 잘못된 book 은 400', async () => {
    expect((await getJson('/api/bible/chapters?t=nkrv&book=99')).status).toBe(400);
    expect((await getJson('/api/bible/chapters?t=nkrv&book=abc')).status).toBe(400);
  });

  it('출력 페이지와 컨트롤 패널 경로가 살아 있다', async () => {
    for (const url of ['/output/', '/health', '/api/info']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200);
    }
  });

  it('출력 페이지는 캐시하지 않는다', async () => {
    // 예배 중 새로고침으로 즉시 최신 파일을 받아야 한다
    const response = await app.inject({ method: 'GET', url: '/output/output.js' });
    expect(response.headers['cache-control']).toContain('no-store');
  });
});

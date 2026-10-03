/**
 * **PDF 꾸러미 API** — 목록과 **쪽을 쓰는 길의 울타리**.
 *
 * ## 왜 울타리를 검사하는가
 *
 * 쪽 그림을 쓰는 길은 **업로드를 다시 여는 것**이다. 보안 S-1 이 바로
 * «배경 업로드에 총량 제한·삭제가 없다 → 디스크 고갈 → **가사 손실**» 이었고,
 * 그래서 2026-08-18 에 업로드를 기능째 걷어냈다.
 *
 * 다시 여는 이상 울타리 넷이 **실제로 서 있는지** 여기서 못 박는다:
 *
 * | | 무엇 |
 * |---|---|
 * | 1 | 루프백에서만 — LAN·태블릿은 못 쓴다 |
 * | 2 | 원본 PDF 가 **이미 있을 때만** — 없는 이름으로 만들어 낼 수 없다 |
 * | 3 | 쪽 수·쪽 용량·합계 상한 |
 * | 4 | 이름이 `decks/` 밖으로 못 나간다 |
 */

import { existsSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_PAGE_BYTES } from '../../lib/deck-files.ts';
import { buildApp } from '../../server/app.ts';
import { clearFailures, clearPassword, setPassword } from '../../server/auth.ts';
import { listDecks } from '../../server/routes/decks.ts';
import { paths } from '../../server/paths.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

const MARK = 'zz-test-deck';
const root = paths.decksDir;
const LAN = '192.168.0.50';

/** 작은 WebP 한 장 — 내용은 상관없다. 울타리만 본다 */
const PAGE = Buffer.from('RIFFxxxxWEBPVP8 ', 'ascii').toString('base64');

beforeAll(async () => {
  app = (await buildApp({ getPort: () => 7777 })).app;
  await app.ready();
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, `${MARK}.pdf`), Buffer.alloc(64));
  writeFileSync(path.join(root, `${MARK}-메모.txt`), Buffer.alloc(8));
  // 끊어진 바로가기 — USB 를 꽂아 둔 채 빼면 이렇게 된다
  symlinkSync(path.join(root, '없는파일.pdf'), path.join(root, `${MARK}-끊김.pdf`));
});

beforeEach(() => {
  rmSync(path.join(root, MARK), { recursive: true, force: true });
});

afterAll(async () => {
  clearPassword();
  for (const name of [`${MARK}.pdf`, `${MARK}-메모.txt`, `${MARK}-끊김.pdf`, MARK, `${MARK}-없는것`]) {
    rmSync(path.join(root, name), { recursive: true, force: true });
  }
  await app.close();
});

function post(name: string, body: unknown, ip?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/decks/${encodeURIComponent(name)}/pages`,
    payload: body as object,
    ...(ip ? { remoteAddress: ip } : {}),
  });
}

describe('목록', () => {
  it('PDF 만 세고, 바꾼 쪽 수를 함께 준다', async () => {
    const before = listDecks().find((deck) => deck.name === MARK);
    expect(before?.pages).toBe(0);

    await post(MARK, { page: 1, data: PAGE, reset: true });

    const after = listDecks().find((deck) => deck.name === MARK);
    expect(after?.pages).toBe(1);
    expect(after?.pageBytes).toBeGreaterThan(0);
  });

  it('PDF 가 아닌 파일은 목록에 없다', () => {
    expect(listDecks().some((deck) => deck.name.includes('메모'))).toBe(false);
  });

  it('끊어진 바로가기 하나 때문에 목록 전체가 죽지 않는다', () => {
    const names = listDecks().map((deck) => deck.name);
    expect(names).not.toContain(`${MARK}-끊김`);
    expect(names).toContain(MARK); // 나머지는 그대로 나온다
  });

  it('API 가 폴더 자리를 알려 준다 — 어디에 넣는지 화면이 말할 수 있게', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/decks' });
    const body = res.json() as ApiResponse<{ dir: string }>;
    expect(body.data?.dir).toBe(root);
  });
});

describe('울타리', () => {
  it('① 암호 없는 LAN 은 인증에서 막힌다 (첫 번째 겹)', async () => {
    const res = await post(MARK, { page: 1, data: PAGE }, LAN);
    expect(res.statusCode).toBe(401);
    expect(existsSync(path.join(root, MARK))).toBe(false);
  });

  it('① **암호를 넣고 들어온 LAN 도** 막는다 (두 번째 겹)', async () => {
    /*
     * 여기가 라우트의 루프백 울타리다. 앞의 검사만 있으면 **이 울타리를 통째로
     * 지워도 검사가 통과한다** — 인증이 먼저 걸려서다 (2026-10-03 변이 검사에서
     * 실제로 빠져나갔다). 암호를 지나온 요청으로 와야 울타리 자체가 재진다.
     *
     * 태블릿으로 예배를 진행하는 사람이 PDF 를 바꿀 일은 없고, 열어 두면
     * S-1(디스크 고갈 → 가사 손실)이 LAN 으로 되살아난다.
     */
    setPassword('예배준비암호');
    clearFailures(LAN);
    try {
      const login = await app.inject({
        method: 'POST',
        url: '/api/login',
        remoteAddress: LAN,
        payload: { password: '예배준비암호' },
      });
      expect(login.statusCode).toBe(200);
      const raw = login.headers['set-cookie'];
      const cookie = (Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '')).split(';')[0] ?? '';

      const res = await app.inject({
        method: 'POST',
        url: `/api/decks/${encodeURIComponent(MARK)}/pages`,
        remoteAddress: LAN,
        headers: { cookie },
        payload: { page: 1, data: PAGE },
      });
      expect(res.statusCode).toBe(403);
      expect(existsSync(path.join(root, MARK))).toBe(false);
    } finally {
      clearPassword();
    }
  });

  it('② 원본 PDF 가 없으면 만들어 낼 수 없다', async () => {
    const res = await post(`${MARK}-없는것`, { page: 1, data: PAGE });
    expect(res.statusCode).toBe(404);
    expect(existsSync(path.join(root, `${MARK}-없는것`))).toBe(false);
  });

  it('③ 쪽 하나가 상한을 넘으면 **깨끗이** 거부한다', async () => {
    /*
     * 상한보다 크되 **본문 한도 안**인 크기를 보낸다. 전에는 Fastify 기본 한도
     * (1MB)가 먼저 걸려 연결이 그냥 끊겼고, 그래서 이 상한은 **닿지도 못하는
     * 숫자**였다 (2026-10-03 실측). 이제 413 과 사유가 돌아온다.
     */
    // **진짜 WebP 앞머리**를 붙인다 — 안 그러면 형식 검사(400)가 먼저 걸려
    // 용량 상한이 재지지 않는다 (2026-10-03 에 그래서 한 번 헛돌았다)
    const big = Buffer.concat([
      Buffer.from('RIFFxxxxWEBPVP8 ', 'ascii'),
      Buffer.alloc(MAX_PAGE_BYTES + 512 * 1024),
    ]).toString('base64');
    const res = await post(MARK, { page: 1, data: big });
    expect(res.statusCode).toBe(413);
    expect(existsSync(path.join(root, MARK))).toBe(false);
  });

  it('④ 이름이 decks/ 밖으로 못 나간다', async () => {
    /*
     * **400 을 콕 집는다.** '거부되기만 하면 된다' 로 두면 이름 막이를 지워도
     * 원본 확인(404)이 대신 걸려 검사가 통과한다 — 변이 검사에서 그랬다.
     */
    for (const bad of ['../escape', '.hidden', 'a/b', 'a:b']) {
      const res = await post(bad, { page: 1, data: PAGE });
      expect(res.statusCode, bad).toBe(400);
    }

    /*
     * 맨 `..` 는 **라우트에 닿지도 못한다** — 주소가 `/api/decks/../pages` 로
     * 정규화돼 `/api/pages` 가 되고 404 다. 이것도 안전하지만 **다른 장치**이므로
     * 400 을 기대하면 안 된다 (2026-10-03 실측으로 갈랐다).
     */
    expect((await post('..', { page: 1, data: PAGE })).statusCode).toBe(404);
    expect(existsSync(path.join(path.dirname(root), 'escape'))).toBe(false);
  });

  it('쪽 번호가 범위를 벗어나면 거부한다', async () => {
    for (const page of [0, -1, 1.5, 9999]) {
      const res = await post(MARK, { page, data: PAGE });
      expect(res.statusCode, String(page)).toBe(400);
    }
  });

  it('쪽 그림이 없으면 거부한다', async () => {
    expect((await post(MARK, { page: 1 })).statusCode).toBe(400);
    expect((await post(MARK, { page: 1, data: '' })).statusCode).toBe(400);
  });

  it('WebP 가 아닌 것은 파일로 쓰지 않는다', async () => {
    /*
     * `Buffer.from(…, 'base64')` 은 쓰레기를 받아도 **던지지 않고** 작은 버퍼를
     * 돌려준다 (실측). 앞머리를 안 보면 깨진 `.webp` 가 그대로 남아,
     * 예배 중에야 «그림이 안 나온다» 로 드러난다.
     */
    const junk = Buffer.from('이건 그림이 아니다').toString('base64');
    const res = await post(MARK, { page: 1, data: junk });
    expect(res.statusCode).toBe(400);
    expect(existsSync(path.join(root, MARK))).toBe(false);
  });
});

describe('다시 만들기', () => {
  it('`reset` 이 옛 쪽을 지운다 — 짧아진 PDF 뒤에 옛 장이 남지 않게', async () => {
    /*
     * 20쪽이던 것을 10쪽으로 바꿨는데 11~20쪽이 남으면 **예배 중에 옛 슬라이드가
     * 뒤에 붙는다.** 그래서 첫 쪽에서 통째로 지운다.
     */
    for (const page of [1, 2, 3]) await post(MARK, { page, data: PAGE, reset: page === 1 });
    expect(readdirSync(path.join(root, MARK))).toHaveLength(3);

    await post(MARK, { page: 1, data: PAGE, reset: true });
    expect(readdirSync(path.join(root, MARK))).toEqual(['0001.webp']);
  });

  it('`reset` 없이는 쌓인다 — 한 쪽씩 보내는 길이다', async () => {
    await post(MARK, { page: 1, data: PAGE, reset: true });
    await post(MARK, { page: 2, data: PAGE });
    expect(readdirSync(path.join(root, MARK)).sort()).toEqual(['0001.webp', '0002.webp']);
  });
});

/**
 * **HTTP 도 어디서 온 요청인지 본다** (점검 S-2, 2026-09-07).
 *
 * 2026-08-22 의 R-1 은 WebSocket 에만 `Host` 확인을 붙였다. HTTP 에는 Origin·Host
 * 검사가 **아예 없어서** 바깥 웹페이지가 REST 로는 그냥 들어왔다. 격리 서버에서
 * 실증한 두 가지를 여기서 못으로 박는다.
 *
 * 1. **본문을 안 보는 POST 는 프리플라이트가 걸리지 않는다.**
 *    `Content-Type: text/plain` 으로 `POST /api/songs/:id/confirm` 이 통해
 *    `lines_source` 가 `auto` → `manual` 로 바뀌었다 — 사람이 승인 버튼을 누른
 *    표시이고, CLAUDE.md 가 자동 작업도 손대지 말라고 못 박은 값이다.
 *
 * 2. **DNS 리바인딩** 된 페이지는 같은 출처가 되어 GET 에 `Origin` 을 붙이지
 *    않는다. `Host: evil.example` 로 `GET /api/backup/export` 가 통해 곡 전체가
 *    나갔고, `mode:replace` 가져오기까지 성공했다.
 *
 * ## 이 검사가 함께 지키는 것 — **막지 말아야 할 것**
 *
 * 여기가 과하게 조이면 **예배 중 화면이 멈춘다.** OBS 브라우저 소스·프로젝터·
 * 강사 모니터·태블릿·컨트롤 패널이 계속 통과하는지도 같이 검사한다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import * as store from '../../server/db/songs.ts';

let app: FastifyInstance;
let songId: number;

const EVIL = 'https://evil.example';

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();

  songId = store.createSong({
    title: '출처 검사 시험곡',
    sections: [
      { kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: '한 줄' }] },
    ],
  });
  // 자동 상태에서 시작한다 — 공격이 성공하면 manual 로 바뀐다
  store.unconfirmLines(songId);
});

afterAll(async () => {
  store.deleteSong(songId);
  await app.close();
});

function linesSourceOf(id: number): string | undefined {
  return store.getSong(id)?.sections[0]?.linesSource;
}

describe('바깥 웹페이지는 막는다', () => {
  it('남의 Origin 으로는 본문 없는 POST 도 통하지 않는다', async () => {
    expect(linesSourceOf(songId)).toBe('auto');

    const response = await app.inject({
      method: 'POST',
      url: `/api/songs/${songId}/confirm`,
      headers: { origin: EVIL, 'content-type': 'text/plain' },
      payload: 'x',
    });

    expect(response.statusCode).toBe(403);
    // ★ 핵심: 값이 실제로 바뀌지 않았다
    expect(linesSourceOf(songId)).toBe('auto');
  });

  it('남의 Origin 으로는 즐겨찾기도 못 건드린다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/songs/${songId}/favorite`,
      headers: { origin: EVIL, 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(response.statusCode).toBe(403);
    expect(store.getSong(songId)?.isFavorite).not.toBe(true);
  });

  it('Host 를 위조하면 읽기도 막는다 (DNS 리바인딩 — Origin 이 없다)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/backup/export',
      headers: { host: 'evil.example' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('Host 를 위조한 replace 가져오기도 막는다', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      headers: { host: 'evil.example' },
      payload: { mode: 'replace', bundle: { format: 'sermon-presentation-bundle', version: 1 } },
    });
    expect(response.statusCode).toBe(403);
    // 곡이 그대로 있다 — 지워지지 않았다
    expect(store.getSong(songId)).toBeDefined();
  });

  it('Origin 과 Host 를 서로 맞춰 보내도 막는다 (둘 다 보내는 쪽이 정한다 — R-1)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/info',
      headers: { host: 'evil.example', origin: 'http://evil.example' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('정적 파일도 막는다 — 출력 페이지를 남의 주소로 퍼 가지 못한다', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/output/',
      headers: { host: 'evil.example' },
    });
    expect(response.statusCode).toBe(403);
  });

  /*
   * Host 가 아예 없는 경우는 여기서 검사하지 않는다 — `app.inject` 가 빈 값을 자기
   * 기본값(`localhost:80`)으로 채워 넣어 **주입기를 시험하게 된다.**
   * 그 판단은 순수 함수 쪽에 있다 (`tests/unit/origin-check.test.ts`).
   */
});

describe('정당한 접속은 계속 통과한다 — 여기가 막히면 예배 중 화면이 멈춘다', () => {
  it('OBS 브라우저 소스 (Origin 없음 · Host localhost)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/output/',
      headers: { host: 'localhost:7777' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('프로젝터·강사 모니터', async () => {
    for (const url of ['/projector/', '/stage/']) {
      const response = await app.inject({ method: 'GET', url, headers: { host: 'localhost:7777' } });
      expect(response.statusCode, url).toBe(200);
    }
  });

  it('컨트롤 패널의 fetch (같은 출처 Origin + Host)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/info',
      headers: { host: 'localhost:7777', origin: 'http://localhost:7777' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('컨트롤 패널의 쓰기 요청도 통한다 (같은 출처 POST)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/api/songs/${songId}/confirm`,
      headers: { host: 'localhost:7777', origin: 'http://localhost:7777' },
    });
    expect(response.statusCode).toBe(200);
    expect(linesSourceOf(songId)).toBe('manual');
    store.unconfirmLines(songId);
  });

  it('태블릿 (사설 IP)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/info',
      headers: { host: '192.168.1.190:7777', origin: 'http://192.168.1.190:7777' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('mDNS 이름 (`.local`)', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/info',
      headers: { host: 'church-mac.local:7777' },
    });
    expect(response.statusCode).toBe(200);
  });
});

describe('막히는 정당한 주소는 허용 목록으로 푼다', () => {
  const previous = process.env.SERMON_ALLOWED_ORIGINS;
  let proxied: FastifyInstance;

  beforeAll(async () => {
    // Tailscale(100.64/10)·리버스 프록시처럼 사설 IP 도 `.local` 도 아닌 주소
    process.env.SERMON_ALLOWED_ORIGINS = 'http://100.101.71.64:7777';
    const built = await buildApp({ getPort: () => 7777 });
    proxied = built.app;
    await proxied.ready();
  });

  afterAll(async () => {
    await proxied.close();
    if (previous === undefined) delete process.env.SERMON_ALLOWED_ORIGINS;
    else process.env.SERMON_ALLOWED_ORIGINS = previous;
  });

  it('목록에 넣은 Origin 은 통과한다', async () => {
    const response = await proxied.inject({
      method: 'GET',
      url: '/api/info',
      headers: { host: '100.101.71.64:7777', origin: 'http://100.101.71.64:7777' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('그 Host 로 오는 Origin 없는 요청도 통과한다 (OBS 를 그 주소로 걸었을 때)', async () => {
    const response = await proxied.inject({
      method: 'GET',
      url: '/api/info',
      headers: { host: '100.101.71.64:7777' },
    });
    expect(response.statusCode).toBe(200);
  });

  it('목록에 없는 주소는 여전히 막힌다', async () => {
    const response = await proxied.inject({
      method: 'GET',
      url: '/api/info',
      headers: { host: 'evil.example' },
    });
    expect(response.statusCode).toBe(403);
  });
});

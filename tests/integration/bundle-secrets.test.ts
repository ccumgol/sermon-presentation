/**
 * **번들에 비밀이 실리지 않는다** (점검 S-1, 2026-09-07).
 *
 * 번들은 다른 PC 로 자료를 옮기려고 **사람이 손으로 나르는 파일**이다. 그런데
 * 내보내기가 `settings` 표를 통째로 담아서 접속 암호 해시와 **세션 서명 열쇠**까지
 * 실려 나갔다. 세션 쿠키는 `<만료시각>.<서명>` 뿐이고 서버는 열쇠만 아는 구조라,
 * 열쇠를 얻은 사람은 **암호를 몰라도 유효한 쿠키를 만들 수 있다** — 격리 서버에서
 * 실제로 통했다.
 *
 * 가져오기도 함께 막는다. 안 막으면 번들을 받은 PC 의 암호가 남의 암호로 조용히
 * 바뀌고 붙어 있던 태블릿이 전부 로그아웃된다.
 *
 * 이 두 가지를 못으로 박아 둔다 — 설정에 새 비밀을 넣는 사람이 실수로 다시
 * 열어 놓지 않게.
 */

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import { SECRET_SETTING_KEYS, setPassword, verifyPassword, verifySession } from '../../server/auth.ts';
import { getSetting, setSetting } from '../../server/db/app.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

/** 테스트가 남의 상태를 바꾸지 않도록 원래 값을 들고 있는다 */
const saved = new Map<string, string | undefined>();

const CARRIED_KEY = 'bundle_secrets_test_marker';

beforeAll(async () => {
  const built = await buildApp({ getPort: () => 7777 });
  app = built.app;
  await app.ready();

  for (const key of [...SECRET_SETTING_KEYS, CARRIED_KEY]) saved.set(key, getSetting(key));
  setPassword('테스트암호1234');
  // 비밀이 아닌 설정은 계속 실려 나가야 한다 — 통째로 막아 버린 것이 아님을 확인한다
  setSetting(CARRIED_KEY, '이 값은 옮겨져야 한다');
});

afterAll(async () => {
  for (const [key, value] of saved) setSetting(key, value ?? '');
  await app.close();
});

async function exportBundle(): Promise<{ settings: Record<string, string> }> {
  const response = await app.inject({ method: 'GET', url: '/api/backup/export' });
  expect(response.statusCode).toBe(200);
  return JSON.parse(response.body) as { settings: Record<string, string> };
}

describe('내보내기 — 비밀은 담기지 않는다', () => {
  it('접속 암호 해시와 세션 서명 열쇠가 번들에 없다', async () => {
    const bundle = await exportBundle();
    for (const key of SECRET_SETTING_KEYS) {
      expect(bundle.settings[key]).toBeUndefined();
    }
  });

  it('비밀이 아닌 설정은 그대로 실린다 (통째로 막은 것이 아니다)', async () => {
    const bundle = await exportBundle();
    expect(bundle.settings[CARRIED_KEY]).toBe('이 값은 옮겨져야 한다');
  });

  it('번들 전체 글자에서도 열쇠가 발견되지 않는다', async () => {
    const secret = getSetting('lan_session_secret');
    expect(secret).toBeTruthy();

    const response = await app.inject({ method: 'GET', url: '/api/backup/export' });
    // 값 자체로 훑는다 — 키 이름을 바꿔 담더라도 걸린다
    expect(response.body).not.toContain(secret!);
  });
});

describe('가져오기 — 남의 비밀로 덮어쓰지 않는다', () => {
  it('번들에 암호·열쇠가 들어 있어도 이 PC 의 것이 그대로 남는다', async () => {
    const secretBefore = getSetting('lan_session_secret');
    const hashBefore = getSetting('lan_password');

    const response = await app.inject({
      method: 'POST',
      url: '/api/backup/import',
      payload: {
        mode: 'merge',
        bundle: {
          format: 'sermon-presentation-bundle',
          version: 1,
          songs: [],
          templates: [],
          plans: [],
          fonts: [],
          settings: {
            lan_password: 'scrypt$00$공격자가심은해시',
            lan_session_secret: '0'.repeat(64),
          },
        },
      },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as ApiResponse<{ settings: number }>;
    // 두 키는 세지도 않는다 — 건너뛴 것이 결과에도 보여야 한다
    expect(body.data!.settings).toBe(0);

    expect(getSetting('lan_session_secret')).toBe(secretBefore);
    expect(getSetting('lan_password')).toBe(hashBefore);
    // 원래 암호가 여전히 맞고, 심어 둔 열쇠로는 쿠키를 만들 수 없다
    expect(verifyPassword('테스트암호1234')).toBe(true);
    expect(verifySession(`${Date.now() + 60_000}.${'0'.repeat(64)}`)).toBe(false);
  });
});

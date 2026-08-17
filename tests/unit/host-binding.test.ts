/**
 * 바인딩 기본값 회귀 테스트 (SECURITY-AUDIT H-1).
 *
 * 이 앱에는 인증이 없다. 기본값이 다시 `0.0.0.0` 으로 돌아가면 **같은 WiFi 의 누구나**
 * 예배 중 화면을 바꾸거나 찬양 가사를 통째로 지울 수 있다(H-2 로 실증됨).
 * 그래서 기본값 자체를 테스트로 고정한다.
 *
 * `server/config.ts` 는 모듈을 읽는 시점에 env 를 본다 — 그래서 각 경우마다
 * 모듈 캐시를 비우고 다시 읽는다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const CONFIG = '../../server/config.ts';

async function loadConfig(host?: string) {
  vi.resetModules();
  const previous = process.env.SERMON_HOST;
  if (host === undefined) delete process.env.SERMON_HOST;
  else process.env.SERMON_HOST = host;

  try {
    return await import(CONFIG);
  } finally {
    if (previous === undefined) delete process.env.SERMON_HOST;
    else process.env.SERMON_HOST = previous;
  }
}

afterEach(() => {
  vi.resetModules();
});

describe('바인딩 기본값', () => {
  it('환경변수가 없으면 이 PC 안에서만 연다', async () => {
    const config = await loadConfig(undefined);
    expect(config.HOST).toBe('127.0.0.1');
    expect(config.IS_LAN_OPEN).toBe(false);
  });

  it('SERMON_HOST=0.0.0.0 이면 LAN 에 연다 (태블릿 모드)', async () => {
    const config = await loadConfig('0.0.0.0');
    expect(config.HOST).toBe('0.0.0.0');
    expect(config.IS_LAN_OPEN).toBe(true);
  });

  it('localhost 를 직접 줘도 닫힌 것으로 본다', async () => {
    const config = await loadConfig('localhost');
    expect(config.IS_LAN_OPEN).toBe(false);
  });

  it('특정 인터페이스 주소는 열린 것으로 본다', async () => {
    // 한 랜카드에만 여는 경우도 외부 노출이다 — 경고를 보여 줘야 한다
    const config = await loadConfig('192.168.1.190');
    expect(config.IS_LAN_OPEN).toBe(true);
  });
});

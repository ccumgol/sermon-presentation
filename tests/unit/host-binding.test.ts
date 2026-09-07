/**
 * 바인딩 기본값 회귀 테스트 (SECURITY-AUDIT H-1).
 *
 * 기본값이 다시 `0.0.0.0` 으로 돌아가면 **같은 WiFi 의 누구나** 예배 중 화면을
 * 바꾸거나 찬양 가사를 통째로 지울 수 있다(H-2 로 실증됨). 지금은 접속 암호가
 * 붙어 있지만(권고 4), **암호를 정하지 않은 PC** 에서는 그 상태가 그대로 돌아온다.
 * 그래서 기본값 자체를 테스트로 고정한다.
 *
 * 2026-09-07(점검 P-1)부터 저장된 설정도 함께 본다 — 설치판에서 태블릿을 열
 * 방법이 없었기 때문이다. **환경 변수가 이긴다**는 규칙을 여기서 고정한다.
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

/**
 * `resolveHost` — 환경 변수와 저장된 설정을 합쳐 실제 바인딩 주소를 정한다 (점검 P-1).
 *
 * 순서가 뒤바뀌면 "명령으로 닫았는데 열려 있다" 가 된다.
 */
describe('resolveHost — 환경 변수가 이긴다', () => {
  it('둘 다 없으면 이 PC 안에서만 연다 (H-1 기본값)', async () => {
    const config = await loadConfig(undefined);
    expect(config.resolveHost(false)).toBe('127.0.0.1');
  });

  it('저장된 설정이 켜져 있으면 LAN 에 연다', async () => {
    const config = await loadConfig(undefined);
    expect(config.resolveHost(true)).toBe('0.0.0.0');
    expect(config.isLanHost(config.resolveHost(true))).toBe(true);
  });

  it('환경 변수가 있으면 저장된 설정을 무시한다 — 양쪽 방향 모두', async () => {
    const open = await loadConfig('0.0.0.0');
    expect(open.resolveHost(false)).toBe('0.0.0.0');

    // ★ 이쪽이 중요하다: 명령으로 닫았으면 저장된 값이 켜져 있어도 닫혀야 한다
    const closed = await loadConfig('127.0.0.1');
    expect(closed.resolveHost(true)).toBe('127.0.0.1');
    expect(closed.isLanHost(closed.resolveHost(true))).toBe(false);
  });

  it('빈 문자열은 정하지 않은 것으로 본다', async () => {
    const config = await loadConfig('');
    expect(config.resolveHost(false)).toBe('127.0.0.1');
  });
});

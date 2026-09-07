/**
 * 컨트롤 패널의 REST 호출 껍데기 (`src/control/api.ts`).
 *
 * ## 왜 값이 있는가
 *
 * 이 파일이 **서버의 거절을 사람에게 전하는 유일한 통로**다. 여기서 오류를 뭉개면
 * 화면에는 아무 일도 안 일어난 것으로 보이고, **예배 중이면 무엇이 잘못됐는지
 * 알 방법이 없다** — 조작 화면이 `{t:'error'}` 를 버리던 것과 같은 종류의 사고다
 * (§4.6 D).
 *
 * 오늘(2026-09-07) 서버가 거절하는 경우가 늘었다 — 403(출처 검사 S-2) ·
 * 409(암호 없이 랜 열기 P-1) · 429(요청 수 제한 L-2). 그 문구가 **그대로**
 * 올라와야 사람이 무엇을 해야 할지 안다.
 *
 * DOM 이 필요 없어 `jsdom` 을 쓰지 않는다 — `fetch` 만 우리 것으로 바꿔 끼운다.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, api } from '../../src/control/api.ts';

/** 서버 대신 우리가 답한다 */
function reply(body: unknown, init: { status?: number; json?: boolean } = {}): void {
  const status = init.status ?? 200;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (init.json === false) throw new SyntaxError('Unexpected token');
        return body;
      },
    })),
  );
}

function ok<T>(data: T): void {
  reply({ success: true, data, error: null });
}

function refuse(status: number, error: string): void {
  reply({ success: false, data: null, error }, { status });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('잘 되면 데이터만 돌려준다', () => {
  it('봉투(success·data·error)를 벗겨 준다', async () => {
    ok({ port: 7777, songCount: 4531 });
    await expect(api.info()).resolves.toMatchObject({ port: 7777 });
  });

  it('본문 없는 요청은 Content-Type 을 붙이지 않는다', async () => {
    ok({ passwordSet: false });
    await api.clearPassword();

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it('본문이 있으면 JSON 으로 보낸다', async () => {
    ok({ passwordSet: true });
    await api.setPassword('암호1234');

    const call = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]!;
    expect(call[0]).toBe('/api/system/password');
    const init = call[1] as RequestInit;
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({ password: '암호1234' });
  });
});

describe('★ 서버가 거절하면 그 말을 그대로 올린다', () => {
  const cases: Array<[string, number, string]> = [
    ['401 접속 암호', 401, '접속 암호가 필요합니다. /login 에서 넣으세요.'],
    ['403 출처 검사 (S-2)', 403, '이 주소로 온 요청은 받지 않습니다. 정당한 접속이면 SERMON_ALLOWED_ORIGINS 에 넣으세요.'],
    ['409 암호 없이 랜 열기 (P-1)', 409, '먼저 접속 암호를 정하세요. 암호 없이 태블릿에 열지 않습니다.'],
    ['429 요청 수 제한 (L-2)', 429, '요청이 너무 많습니다. 잠시 뒤에 다시 해 보세요.'],
    ['400 형식 오류', 400, '암호는 4자 이상이어야 합니다.'],
  ];

  for (const [label, status, message] of cases) {
    it(label, async () => {
      refuse(status, message);
      // 사람이 볼 문구가 **그대로** 와야 한다 — 'HTTP 403' 으로 바뀌면 안 된다
      await expect(api.info()).rejects.toThrow(message);
      await expect(api.info()).rejects.toBeInstanceOf(ApiError);
    });
  }

  it('서버가 이유를 안 적었으면 최소한 상태 번호는 알려 준다', async () => {
    reply({ success: false, data: null, error: null }, { status: 500 });
    await expect(api.info()).rejects.toThrow(/HTTP 500/);
  });

  it('HTTP 200 인데 success:false 인 것도 실패로 본다', async () => {
    reply({ success: false, data: null, error: '무언가 잘못됐습니다' });
    await expect(api.info()).rejects.toThrow('무언가 잘못됐습니다');
  });

  it('data 가 null 이면 실패로 본다 — 화면이 null 을 그리면 안 된다', async () => {
    reply({ success: true, data: null, error: null });
    await expect(api.info()).rejects.toBeInstanceOf(ApiError);
  });
});

describe('서버에 닿지 못할 때', () => {
  it('연결 자체가 안 되면 그렇게 말한다 (어느 주소인지까지)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(api.info()).rejects.toThrow(/서버에 연결할 수 없습니다.*\/api\/info/);
  });

  it('JSON 이 아닌 답(로그인 HTML 등)에는 해석할 수 없다고 말한다', async () => {
    reply('<!doctype html>', { status: 200, json: false });
    await expect(api.info()).rejects.toThrow(/응답을 해석할 수 없습니다.*HTTP 200/);
  });

  it('어떤 실패든 ApiError 다 — 화면이 한 곳에서 받아 쓴다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('무엇'); }));
    await expect(api.info()).rejects.toBeInstanceOf(ApiError);
  });
});

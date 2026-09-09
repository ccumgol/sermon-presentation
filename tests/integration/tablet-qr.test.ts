/**
 * **태블릿에 띄울 QR 이 실제로 만들어지는 길** (`routes/tablet.ts` · `lan.ts`).
 *
 * ## 왜 이 검사가 필요한가
 *
 * 이 라우트는 **태블릿을 연결하는 유일한 길**이다. 주소를 손으로 입력하는 것이
 * 실제로 잘 안 됐고(포트를 빼먹거나 Safari 가 `https://` 로 바꾼다) 그래서 QR 을 만들었다.
 *
 * 그런데 2026-09-09 실측에서 `routes/tablet.ts` 는 **36.4%** — `server/` 에서 가장
 * 낮았다. 있던 검사(`tablet-setup.test.ts`)는 **닫혀 있을 때**만 봤다. 즉
 * **QR 을 만드는 줄은 한 번도 밟히지 않았다.**
 *
 * ## 진짜 랜 카드를 쓰지 않는다
 *
 * `lanInterfaces()` 는 이 PC 의 실제 장치를 읽는다. 그대로 검사하면 카드가 없는
 * PC 에서는 빈 목록이 나와 **아무것도 확인하지 못한 채 통과한다.** 그래서
 * `node:os` 의 장치 목록만 가짜로 바꾼다 — 나머지(`homedir` 등)는 진짜 그대로 둔다.
 */

import type { FastifyInstance } from 'fastify';
import qrcode from 'qrcode-generator';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { qrToSvg } from '../../lib/qr-svg.ts';

const FAKE_NICS = {
  lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
  /**
   * **이 PC 안에서만 도는 사설 주소** (가상 머신용 어댑터 따위).
   *
   * 대역만 보면 공유기가 준 주소와 구별되지 않는다 — `internal` 로만 갈린다.
   * 이것이 목록에 섞이면 태블릿이 찾을 수 없는 QR 이 하나 더 생긴다.
   */
  vmnet1: [{ family: 'IPv4', internal: true, address: '192.168.99.1' }],
  // 공유기가 준 주소 — 태블릿이 찍어야 하는 것
  en0: [
    { family: 'IPv6', internal: false, address: 'fe80::1' },
    { family: 'IPv4', internal: false, address: '192.168.1.190' },
  ],
  // 맥에 태블릿을 직접 붙인 경우 (인터넷 공유) — 정당한 길이라 함께 준다
  bridge0: [{ family: 'IPv4', internal: false, address: '192.168.2.1' }],
  // Tailscale — **찍어도 열리지 않는다.** 실제로 목록에 섞여 나와 헤맸다
  utun8: [{ family: 'IPv4', internal: false, address: '10.0.0.9' }],
};

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, networkInterfaces: () => FAKE_NICS };
});

const PORT = 7777;

let openApp: FastifyInstance;
let closedApp: FastifyInstance;

interface AccessBody {
  lanOpen: boolean;
  lanWanted: boolean;
  passwordSet: boolean;
  packaged: boolean;
  targets: Array<{
    address: string;
    iface: string;
    url: string;
    qr: { size: number; path: string; moduleCount: number };
  }>;
}

async function bare(isLanOpen: boolean): Promise<FastifyInstance> {
  const { default: Fastify } = await import('fastify');
  const { registerTabletRoutes } = await import('../../server/routes/tablet.ts');
  const app = Fastify();
  registerTabletRoutes(app, () => PORT, () => isLanOpen);
  await app.ready();
  return app;
}

async function access(app: FastifyInstance): Promise<AccessBody> {
  const response = await app.inject({ method: 'GET', url: '/api/tablet-access' });
  expect(response.statusCode).toBe(200);
  return (response.json() as { data: AccessBody }).data;
}

beforeAll(async () => {
  openApp = await bare(true);
  closedApp = await bare(false);
});

afterAll(async () => {
  await openApp.close();
  await closedApp.close();
});

describe('열려 있으면 찍을 수 있는 주소를 준다', () => {
  it('열리지 않는 주소는 빼고 준다 — 루프백 · 이 PC 전용 · IPv6 · VPN 터널', async () => {
    const body = await access(openApp);
    expect(body.targets.map((one) => one.address)).toEqual(['192.168.1.190', '192.168.2.1']);
  });

  /**
   * 주소가 여러 개일 때 '어느 것을 태블릿에 넣어야 하나' 를 알 수 없어 헤맸다.
   * 장치 이름이 있어야 시스템 설정 → 네트워크 와 짝지어 볼 수 있다.
   */
  it('어느 장치인지 함께 준다', async () => {
    const body = await access(openApp);
    expect(body.targets.map((one) => one.iface)).toEqual(['en0', 'bridge0']);
  });

  /** 포트를 빼먹는 것이 손으로 입력할 때의 실수 1번이다 — QR 이 그것을 없앤다 */
  it('포트가 든 완전한 주소다', async () => {
    const body = await access(openApp);
    expect(body.targets[0]!.url).toBe(`http://192.168.1.190:${PORT}/`);
    // Safari 가 https 로 바꾸는 것을 막으려면 프로토콜이 붙어 있어야 한다
    expect(body.targets.every((one) => one.url.startsWith('http://'))).toBe(true);
  });
});

describe('QR 이 진짜 그 주소를 담고 있다', () => {
  /**
   * **이 검사가 이 파일의 핵심이다.**
   *
   * 그림이 나오는 것만 보면 '무언가 그려졌다' 밖에 모른다. 엉뚱한 것을 담은 QR 도
   * 똑같이 그려진다 — 예배 직전에 찍어 보고서야 안다.
   *
   * 그래서 **주소만으로 QR 을 따로 만들어 경로가 글자까지 같은지** 본다. 같다면
   * 담긴 것은 그 주소뿐이다. 이것이 곧 '**QR 에 암호를 담지 않는다**' 의 증명이기도
   * 하다 (담았다면 경로가 달라진다 — 아래에서 실제로 확인한다).
   */
  function expectedQr(url: string): { path: string; moduleCount: number } {
    // 격자 → 경로로 옮기는 부분은 `lib/qr-svg.ts` 가 하고 그쪽은 이미 검사가 있다.
    // 여기서 확인하는 것은 **무엇을 담았는가** 다 — 그러니 같은 함수를 쓴다.
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const svg = qrToSvg((row, col) => qr.isDark(row, col), qr.getModuleCount());
    return { path: svg.path, moduleCount: svg.moduleCount };
  }

  it('주소만으로 만든 QR 과 글자까지 같다', async () => {
    const body = await access(openApp);
    for (const target of body.targets) {
      const expected = expectedQr(target.url);
      expect(target.qr.moduleCount, target.url).toBe(expected.moduleCount);
      expect(target.qr.path, target.url).toBe(expected.path);
    }
  });

  it('무엇이든 덧붙이면 경로가 달라진다 — 위 검사가 헛돌지 않는다는 증명', () => {
    const plain = expectedQr(`http://192.168.1.190:${PORT}/`);
    const withSecret = expectedQr(`http://192.168.1.190:${PORT}/?pw=1234`);
    expect(withSecret.path).not.toBe(plain.path);
  });

  /** 규격이 요구하는 사방 4모듈 여백. 없으면 배경과 붙어 인식률이 떨어진다 */
  it('여백을 두고 크기를 알려 준다', async () => {
    const body = await access(openApp);
    const qr = body.targets[0]!.qr;
    expect(qr.moduleCount).toBeGreaterThanOrEqual(21); // QR 최소 버전
    expect(qr.size).toBe(qr.moduleCount + 8);
    expect(qr.path.length).toBeGreaterThan(0);
  });

  it('주소가 다르면 QR 도 다르다 — 두 장치에 같은 그림을 주지 않는다', async () => {
    const body = await access(openApp);
    expect(body.targets[0]!.qr.path).not.toBe(body.targets[1]!.qr.path);
  });
});

describe('닫혀 있으면 주소를 주지 않는다', () => {
  /**
   * 열리지 않는 주소를 보여 주면 '주소는 있는데 접속이 안 된다' 가 된다 —
   * 예배 직전에 가장 헤매게 만드는 안내다.
   */
  it('QR 을 만들지 않는다 — 랜 카드가 있어도', async () => {
    const body = await access(closedApp);
    expect(body.lanOpen).toBe(false);
    expect(body.targets).toEqual([]);
  });

  /** 열려 있는 쪽에서는 같은 랜 카드로 주소가 나온다 — 위가 '카드가 없어서' 가 아니다 */
  it('같은 PC 에서 열면 주소가 나온다', async () => {
    expect((await access(openApp)).targets.length).toBeGreaterThan(0);
  });
});

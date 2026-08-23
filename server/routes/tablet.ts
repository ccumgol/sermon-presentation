/**
 * 태블릿 연결 — 관리자 화면에 띄울 QR 과 상태.
 *
 * 태블릿에 주소를 손으로 입력하는 것이 실제로 잘 안 됐다(포트를 빼먹거나 Safari 가
 * `https://` 로 바꿔 버린다). 관리자 화면의 QR 을 찍으면 그 실수가 사라진다.
 *
 * **QR 에는 주소만 담는다.** 암호를 담으면 그 그림이 곧 열쇠가 되어, 화면을 스치듯
 * 본 사람도 들어올 수 있다. 찍으면 로그인 화면이 뜨고 암호는 사람이 넣는다.
 */

import type { FastifyInstance } from 'fastify';
import qrcode from 'qrcode-generator';

import { qrToSvg, type QrSvg } from '../../lib/qr-svg.ts';
import { lanInterfaces } from '../lan.ts';
import { hasPassword } from '../auth.ts';
import { IS_LAN_OPEN } from '../config.ts';

export interface TabletTarget {
  /** LAN 주소 (`192.168.1.190`) */
  address: string;
  /** 어느 장치인가 (`en0`) — 주소가 여러 개일 때 고르는 단서 */
  iface: string;
  /** 태블릿이 열어야 하는 주소 */
  url: string;
  qr: QrSvg;
}

/**
 * 오류 보정 단계 `M` — 약 15% 가 가려져도 읽힌다.
 *
 * 예배당 조명 아래 화면을 비스듬히 찍는 상황을 생각하면 `L`(7%)은 얇다. `Q`·`H` 는
 * 모듈이 촘촘해져 오히려 작은 화면에서 읽기 어려워진다.
 */
const ERROR_CORRECTION = 'M' as const;

function buildQr(url: string): QrSvg {
  // 0 = 내용에 맞는 최소 버전을 알아서 고른다
  const qr = qrcode(0, ERROR_CORRECTION);
  qr.addData(url);
  qr.make();
  return qrToSvg((row, col) => qr.isDark(row, col), qr.getModuleCount());
}

export function registerTabletRoutes(app: FastifyInstance, getPort: () => number): void {
  app.get('/api/tablet-access', async () => {
    // LAN 이 닫혀 있으면 주소를 주지 않는다 — 열리지 않는 주소를 보여 주면
    // '주소는 있는데 접속이 안 된다' 가 된다.
    const targets: TabletTarget[] = IS_LAN_OPEN
      ? lanInterfaces().map((nic) => {
          const url = `http://${nic.address}:${getPort()}/`;
          return { address: nic.address, iface: nic.iface, url, qr: buildQr(url) };
        })
      : [];

    return {
      success: true,
      data: {
        lanOpen: IS_LAN_OPEN,
        passwordSet: hasPassword(),
        targets,
      },
      error: null,
    };
  });
}

/**
 * 만든 QR 이 **정말 그 주소로 읽히는가** — 독립 디코더로 확인한다.
 *
 * 여기까지 하는 이유: QR 이 잘못돼도 화면에는 그럴듯한 격자로 보인다. 예배 직전에
 * 태블릿을 들고 "찍히지 않는다" 를 겪는 것이 가장 나쁜 결과다.
 *
 * 검증 경로는 실제와 같다 — `qrcode-generator` 가 만든 격자를 `lib/qr-svg.ts` 가
 * 그리는 그대로 흑백 픽셀로 펼쳐, **만드는 데 쓰지 않은 디코더**(jsQR)에 넣는다.
 * jsQR 은 개발 의존성이므로 앱에는 실려 나가지 않는다.
 */
import { describe, expect, it } from 'vitest';

import { QUIET_ZONE, qrToSvg } from '../../lib/qr-svg.ts';

/** 모듈 격자를 그린 그대로 RGBA 픽셀로 펼친다 (모듈당 `scale` 픽셀) */
function rasterize(svg: { size: number; path: string }, scale = 4) {
  const side = svg.size * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255); // 흰 바탕

  // 경로(`M{x} {y}h{w}v1h-{w}z`)를 되읽어 칠한다 — 화면에 그려지는 것과 같은 정보다
  for (const match of svg.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g)) {
    const [x, y, width] = [Number(match[1]), Number(match[2]), Number(match[3])];
    for (let py = y * scale; py < (y + 1) * scale; py++) {
      for (let px = x * scale; px < (x + width) * scale; px++) {
        const at = (py * side + px) * 4;
        data[at] = 0;
        data[at + 1] = 0;
        data[at + 2] = 0;
      }
    }
  }
  return { data, width: side, height: side };
}

async function roundTrip(text: string): Promise<string | null> {
  const [{ default: qrcode }, jsqrModule] = await Promise.all([
    import('qrcode-generator'),
    import('jsqr'),
  ]);
  const decode = (jsqrModule.default ?? jsqrModule) as unknown as (
    data: Uint8ClampedArray,
    width: number,
    height: number,
  ) => { data: string } | null;

  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const svg = qrToSvg((row, col) => qr.isDark(row, col), qr.getModuleCount());

  const image = rasterize(svg);
  return decode(image.data, image.width, image.height)?.data ?? null;
}

describe('QR 이 그 주소로 읽힌다', () => {
  it('태블릿 접속 주소', async () => {
    const url = 'http://192.168.1.190:7777/';
    expect(await roundTrip(url)).toBe(url);
  });

  it('다른 장치의 주소도', async () => {
    const url = 'http://192.168.1.151:7818/';
    expect(await roundTrip(url)).toBe(url);
  });

  it('포트가 길어져도', async () => {
    const url = 'http://10.0.0.5:7797/';
    expect(await roundTrip(url)).toBe(url);
  });

  it('여백이 있어야 읽힌다 — 규격이 요구하는 4모듈', () => {
    // 여백을 지우면 배경과 경계가 붙어 인식률이 떨어진다.
    // 이 값이 바뀌면 위 왕복 검사가 먼저 깨지도록 함께 고정해 둔다.
    expect(QUIET_ZONE).toBe(4);
  });
});

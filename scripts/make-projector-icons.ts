/**
 * 프로젝터 앱 아이콘 만들기 — `public/projector/icon-{192,512}.png`
 *
 * ```
 * node scripts/make-projector-icons.ts
 * ```
 *
 * ## 왜 코드로 그리는가
 *
 * '앱으로 설치' 를 크롬이 제안하려면 매니페스트에 **아이콘 PNG** 가 있어야 한다.
 * 그림 파일을 저장소에 넣는 대신 코드로 만든다 —
 *
 * - 이미지 도구(rsvg·ImageMagick)를 깔지 않아도 된다. 이 저장소는 의존성을 늘리지 않는다.
 * - 무엇을 그렸는지 **읽어서** 알 수 있다. 바이너리는 diff 가 되지 않는다.
 *
 * `node:zlib` 만 쓴다. PNG 는 서명 + IHDR + IDAT + IEND 네 덩이면 된다.
 *
 * ## 그림
 *
 * 검은 바탕에 흰 가로 막대 셋 — 벽에 비친 글줄. 여백 없이 꽉 채운다
 * (`maskable`: 안드로이드·크롬이 모서리를 제 모양대로 깎으므로 가장자리에 그림이
 * 없어야 한다).
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** 글줄 막대 — [세로 중심 비율, 가로 폭 비율] */
const BARS: ReadonlyArray<readonly [number, number]> = [
  [0.34, 0.66],
  [0.5, 0.78],
  [0.66, 0.5],
];

const BAR_HEIGHT = 0.085; // 한 변에 대한 비율

function pixel(x: number, y: number, size: number): [number, number, number] {
  const fx = x / size;
  const fy = y / size;
  for (const [center, width] of BARS) {
    const halfH = BAR_HEIGHT / 2;
    if (Math.abs(fy - center) > halfH) continue;
    // 막대 끝을 둥글게 — 반원으로 닫는다
    const halfW = width / 2;
    const dx = Math.abs(fx - 0.5);
    if (dx <= halfW - halfH) return [255, 255, 255];
    const dist = Math.hypot(dx - (halfW - halfH), fy - center);
    if (dist <= halfH) return [255, 255, 255];
  }
  return [17, 17, 19];
}

function png(size: number): Buffer {
  // 각 줄 앞에 필터 바이트 0 (없음). RGB 8비트
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b] = pixel(x + 0.5, y + 0.5, size);
      const at = row + 1 + x * 3;
      raw[at] = r;
      raw[at + 1] = g;
      raw[at + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 비트 깊이
  ihdr[9] = 2; // 색 타입 2 = 트루컬러
  ihdr[10] = 0; // 압축
  ihdr[11] = 0; // 필터
  ihdr[12] = 0; // 인터레이스 없음

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const OUT_DIR = path.join(import.meta.dirname, '../public/projector');

for (const size of [192, 512]) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  const data = png(size);
  writeFileSync(file, data);
  console.log(`${path.basename(file)} — ${size}×${size} · ${data.length.toLocaleString()} bytes`);
}

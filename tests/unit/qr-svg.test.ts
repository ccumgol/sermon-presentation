/**
 * QR 격자 → SVG 경로 (태블릿 연결 QR).
 *
 * QR 이 잘못 그려지면 **찍히지 않는다.** 여기서 지키는 것은 세 가지다 —
 * 여백(규격 4모듈), 어두운 모듈이 빠지지 않는 것, 이어진 모듈을 묶는 최적화가
 * 모양을 바꾸지 않는 것.
 */
import { describe, expect, it } from 'vitest';

import { QUIET_ZONE, qrToSvg } from '../../lib/qr-svg.ts';

/** 문자 격자로 isDark 를 만든다 (`#` = 어둡다) */
function fromRows(rows: readonly string[]) {
  return {
    isDark: (row: number, col: number) => rows[row]?.[col] === '#',
    count: rows.length,
  };
}

describe('여백 — 없으면 인식률이 떨어진다', () => {
  it('사방에 규격대로 4모듈을 둔다', () => {
    expect(QUIET_ZONE).toBe(4);
    const { isDark, count } = fromRows(['#']);
    const svg = qrToSvg(isDark, count);
    expect(svg.size).toBe(1 + 8);
    expect(svg.moduleCount).toBe(1);
  });

  it('모듈 좌표가 여백만큼 밀려 있다', () => {
    const { isDark, count } = fromRows(['#']);
    expect(qrToSvg(isDark, count).path).toBe('M4 4h1v1h-1z');
  });
});

describe('어두운 모듈을 빠뜨리지 않는다', () => {
  it('떨어져 있는 모듈은 각각 그린다', () => {
    const { isDark, count } = fromRows(['#.#', '...', '#.#']);
    const svg = qrToSvg(isDark, count);
    expect(svg.path).toBe(
      'M4 4h1v1h-1zM6 4h1v1h-1z' + 'M4 6h1v1h-1zM6 6h1v1h-1z',
    );
  });

  it('이어진 모듈은 한 덩어리로 묶는다', () => {
    // QR 은 정사각이다 — 격자도 행 수와 열 수가 같아야 한다
    const { isDark, count } = fromRows(['###', '...', '...']);
    expect(qrToSvg(isDark, count).path).toBe('M4 4h3v1h-3z');
  });

  it('행 끝까지 이어져도 닫는다', () => {
    const { isDark, count } = fromRows(['..##', '....', '....', '....']);
    expect(qrToSvg(isDark, count).path).toBe('M6 4h2v1h-2z');
  });

  it('전부 밝으면 경로가 비어 있다', () => {
    const { isDark, count } = fromRows(['..', '..']);
    expect(qrToSvg(isDark, count).path).toBe('');
  });

  it('묶어도 어두운 모듈의 총 면적은 같다', () => {
    const rows = ['#.##.', '.###.', '#...#', '#####', '.....'];
    const { isDark, count } = fromRows(rows);
    const svg = qrToSvg(isDark, count);
    // 경로의 h 값을 모두 더하면 어두운 모듈 수와 같아야 한다
    const drawn = [...svg.path.matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    const expected = rows.join('').split('').filter((ch) => ch === '#').length;
    expect(drawn).toBe(expected);
  });
});

describe('잘못된 입력', () => {
  it('모듈 수가 0 이하거나 정수가 아니면 던진다', () => {
    const isDark = () => true;
    for (const bad of [0, -1, 2.5, Number.NaN]) {
      expect(() => qrToSvg(isDark, bad), String(bad)).toThrow();
    }
  });
});

describe('실제 QR 과 맞물리는지', () => {
  it('qrcode-generator 의 격자를 그대로 담는다', async () => {
    const { default: qrcode } = await import('qrcode-generator');
    const qr = qrcode(0, 'M');
    qr.addData('http://192.168.1.190:7777/');
    qr.make();

    const count = qr.getModuleCount();
    const svg = qrToSvg((r, c) => qr.isDark(r, c), count);

    expect(svg.moduleCount).toBe(count);
    expect(svg.size).toBe(count + 8);

    const drawn = [...svg.path.matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    let dark = 0;
    for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) dark++;
    expect(drawn).toBe(dark);
  });
});

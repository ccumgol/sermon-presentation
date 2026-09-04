/**
 * 악보 단(staff system) 경계 검출.
 *
 * 여기가 틀리면 **예배 중 화면에 반쪽짜리 악보나 엉뚱한 줄이 나간다.** 픽셀을 읽는
 * 부분(`magick` 호출)과 판정을 나눠 둔 덕에 판정만 숫자 배열로 검사할 수 있다.
 *
 * 아래 만들어 쓰는 가짜 악보는 실측값을 따른다 (2026-09-04, 찬미예수 2000):
 * 오선 줄 간격 10~12px · 오선 높이 40~50px · 단 사이 100~120px ·
 * 코드 기호 띠 4~18px · 가사 띠 35px 이상.
 */

import { describe, expect, it } from 'vitest';

import {
  contentBands,
  cropRanges,
  detectSystems,
  findStaffLines,
  groupIntoSystems,
  LINE_RUN_RATIO,
  type Band,
} from '../../lib/staff-detect.ts';

const WIDTH = 1000;
const LINE = WIDTH * LINE_RUN_RATIO + 10; // 오선으로 인정되는 길이
const SHORT = WIDTH * LINE_RUN_RATIO - 10; // 인정되지 않는 길이

/** 세로 프로파일을 손으로 그린다 — `set(runs, 100, 102, LINE)` 은 100~102행이 오선 */
function set(profile: number[], from: number, to: number, value: number): void {
  for (let y = from; y <= to; y++) profile[y] = value;
}

/** 오선 다섯 줄을 `top` 부터 `gap` 간격으로 그린다. 끝 행을 돌려준다 */
function staff(runs: number[], top: number, gap = 11): number {
  for (let i = 0; i < 5; i++) set(runs, top + i * gap, top + i * gap + 1, LINE);
  return top + 4 * gap + 1;
}

describe('오선 줄 찾기', () => {
  it('폭의 15% 를 넘는 가로선만 줄로 본다', () => {
    const runs = new Array<number>(200).fill(0);
    set(runs, 50, 51, LINE);
    set(runs, 100, 101, SHORT); // 음표·가사처럼 짧은 것
    expect(findStaffLines(runs, WIDTH)).toEqual([{ from: 50, to: 51 }]);
  });

  it('두께가 2~4px 인 한 줄을 여러 개로 쪼개지 않는다', () => {
    const runs = new Array<number>(200).fill(0);
    set(runs, 50, 53, LINE);
    expect(findStaffLines(runs, WIDTH)).toEqual([{ from: 50, to: 53 }]);
  });

  it('3px 넘게 떨어지면 다른 줄이다', () => {
    const runs = new Array<number>(200).fill(0);
    set(runs, 50, 51, LINE);
    set(runs, 60, 61, LINE);
    expect(findStaffLines(runs, WIDTH)).toHaveLength(2);
  });

  it('아무것도 없으면 빈 목록', () => {
    expect(findStaffLines(new Array<number>(100).fill(0), WIDTH)).toEqual([]);
  });
});

describe('줄을 단으로 묶기', () => {
  it('간격이 갑자기 벌어지는 곳에서 끊는다', () => {
    const runs = new Array<number>(600).fill(0);
    staff(runs, 100);
    staff(runs, 250);
    staff(runs, 400);
    const groups = groupIntoSystems(findStaffLines(runs, WIDTH));
    expect(groups.map((g) => g.length)).toEqual([5, 5, 5]);
  });

  /**
   * 볼타 괄호(`1.` `2.` 반복 표시)의 가로선이 오선만큼 길다. 기울기를 펴고 나면
   * 더 곧아져서 꼭 잡힌다 — 0001번에서 실제로 '1줄짜리 단' 이 생겼다.
   */
  it('1~2줄짜리 무리는 버린다 — 볼타 괄호·밑줄 장식이다', () => {
    const runs = new Array<number>(600).fill(0);
    staff(runs, 100);
    set(runs, 250, 251, LINE); // 홀로 있는 가로선
    staff(runs, 400);
    const groups = groupIntoSystems(findStaffLines(runs, WIDTH));
    expect(groups.map((g) => g.length)).toEqual([5, 5]);
    expect(groups[1]![0]!.from).toBe(400);
  });

  it('4줄만 잡힌 단은 살린다 — 옅은 스캔에서 한 줄을 놓칠 수 있다', () => {
    const runs = new Array<number>(400).fill(0);
    for (let i = 0; i < 4; i++) set(runs, 100 + i * 11, 100 + i * 11 + 1, LINE);
    expect(groupIntoSystems(findStaffLines(runs, WIDTH)).map((g) => g.length)).toEqual([4]);
  });

  it('줄이 없으면 단도 없다', () => {
    expect(groupIntoSystems([])).toEqual([]);
  });
});

describe('내용 띠', () => {
  it('잉크가 있는 구간을 묶는다', () => {
    const ink = new Array<number>(100).fill(0);
    set(ink, 10, 20, 300);
    set(ink, 50, 60, 300);
    expect(contentBands(ink, WIDTH)).toEqual([
      { from: 10, to: 20 },
      { from: 50, to: 60 },
    ]);
  });

  it('아주 옅은 띠는 버린다 — 스캔 얼룩이 단의 끝을 흐린다', () => {
    const ink = new Array<number>(100).fill(0);
    set(ink, 10, 20, 300);
    set(ink, 50, 52, 18); // 폭의 1.8% — 얼룩
    expect(contentBands(ink, WIDTH)).toEqual([{ from: 10, to: 20 }]);
  });

  it('먼지 몇 점은 빈 줄로 본다', () => {
    const ink = new Array<number>(100).fill(1);
    set(ink, 10, 20, 300);
    expect(contentBands(ink, WIDTH)).toEqual([{ from: 10, to: 20 }]);
  });
});

/**
 * 자를 범위 — 이 프로젝트에서 가장 손이 많이 간 부분이다.
 *
 * 처음에는 오선 높이의 몇 배로 넓혔는데 **가사가 두 줄인 악보에서 둘째 줄이 잘렸다.**
 * 간격으로 나누는 것도 안 됐다 — 오선↔가사(8px)가 가사↔다음 코드(7px)보다 넓은
 * 악보가 있었다. 결국 **띠 높이**로 코드와 가사를 가른다.
 */
describe('자를 범위', () => {
  /** 실측 구조를 그대로 옮긴 가짜 악보: [코드] [오선] [가사] × 2단 */
  function twoSystems(): { groups: Band[][]; bands: Band[]; height: number } {
    const runs = new Array<number>(700).fill(0);
    staff(runs, 200); // 200~244
    staff(runs, 400); // 400~444
    const ink = new Array<number>(700).fill(0);
    set(ink, 180, 192, 200); // 1단 코드 (13px)
    set(ink, 200, 244, 800); // 1단 오선
    set(ink, 255, 292, 200); // 1단 가사 (38px)
    set(ink, 380, 392, 200); // 2단 코드
    set(ink, 400, 444, 800); // 2단 오선
    set(ink, 455, 492, 200); // 2단 가사
    return { groups: groupIntoSystems(findStaffLines(runs, WIDTH)), bands: contentBands(ink, WIDTH), height: 700 };
  }

  it('코드와 가사를 함께 담고 이웃 단은 담지 않는다', () => {
    const { groups, bands, height } = twoSystems();
    const [first, second] = cropRanges(groups, bands, height);
    expect(first!.crop).toEqual({ from: 180, to: 292 });
    expect(second!.crop).toEqual({ from: 380, to: 492 });
  });

  it('가사가 두 줄이면 둘 다 담는다 — 처음에 여기서 잘렸다', () => {
    const runs = new Array<number>(700).fill(0);
    staff(runs, 200);
    staff(runs, 450);
    const ink = new Array<number>(700).fill(0);
    set(ink, 180, 192, 200); // 코드
    set(ink, 200, 244, 800); // 오선
    set(ink, 255, 292, 200); // 1절 가사
    set(ink, 300, 337, 200); // 2절 가사
    set(ink, 430, 442, 200); // 다음 단 코드
    set(ink, 450, 494, 800);
    const [first] = cropRanges(groupIntoSystems(findStaffLines(runs, WIDTH)), contentBands(ink, WIDTH), 700);
    expect(first!.crop.to).toBe(337);
  });

  it('코드가 오선에 붙어 한 띠가 되어도 담는다 (0001번 1단)', () => {
    const runs = new Array<number>(500).fill(0);
    staff(runs, 200);
    const ink = new Array<number>(500).fill(0);
    set(ink, 180, 292, 800); // 코드·오선·가사가 빈 줄 없이 이어진다
    const [only] = cropRanges(groupIntoSystems(findStaffLines(runs, WIDTH)), contentBands(ink, WIDTH), 500);
    expect(only!.crop).toEqual({ from: 180, to: 292 });
  });

  it('위 단의 가사는 담지 않는다 — 두꺼운 띠는 코드가 아니다', () => {
    const { groups, bands, height } = twoSystems();
    const [, second] = cropRanges(groups, bands, height);
    // 1단 가사(255~292)가 들어오면 두 단의 가사가 한 화면에 나온다
    expect(second!.crop.from).toBeGreaterThan(292);
  });

  it('맨 아래 단은 작곡자 표기를 담지 않는다 — 멀리 떨어져 있다', () => {
    const runs = new Array<number>(500).fill(0);
    staff(runs, 200);
    const ink = new Array<number>(500).fill(0);
    set(ink, 180, 192, 200);
    set(ink, 200, 244, 800);
    set(ink, 255, 292, 200); // 가사
    set(ink, 400, 430, 200); // 작곡자 표기 — 100px 넘게 떨어져 있다
    const [only] = cropRanges(groupIntoSystems(findStaffLines(runs, WIDTH)), contentBands(ink, WIDTH), 500);
    expect(only!.crop.to).toBe(292);
  });

  it('그림 밖으로 나가지 않는다', () => {
    const runs = new Array<number>(300).fill(0);
    staff(runs, 10);
    const ink = new Array<number>(300).fill(0);
    set(ink, 0, 299, 800);
    const [only] = cropRanges(groupIntoSystems(findStaffLines(runs, WIDTH)), contentBands(ink, WIDTH), 300);
    expect(only!.crop.from).toBeGreaterThanOrEqual(0);
    expect(only!.crop.to).toBeLessThanOrEqual(299);
  });
});

describe('전체', () => {
  it('단 목록과 줄 수 이상 목록을 함께 준다', () => {
    const runs = new Array<number>(700).fill(0);
    staff(runs, 200);
    for (let i = 0; i < 4; i++) set(runs, 400 + i * 11, 400 + i * 11 + 1, LINE); // 4줄만
    const ink = new Array<number>(700).fill(0);
    set(ink, 200, 292, 800);
    set(ink, 400, 492, 800);

    const { systems, odd } = detectSystems(ink, runs, WIDTH, 700);
    expect(systems).toHaveLength(2);
    expect(odd).toEqual([{ index: 1, lineCount: 4 }]);
  });

  it('빈 그림이면 단이 없다 — 예외를 던지지 않는다', () => {
    const empty = new Array<number>(100).fill(0);
    expect(detectSystems(empty, empty, WIDTH, 100)).toEqual({ systems: [], odd: [] });
  });
});

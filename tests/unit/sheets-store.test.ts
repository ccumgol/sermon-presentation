/**
 * 악보 단 경계 저장소.
 *
 * 메모리 DB 로 검사한다 — 이 저장소는 `DatabaseSync` 를 인자로 받으므로 사용자
 * 데이터를 건드리지 않고 스키마째 시험할 수 있다.
 */

import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import { countSheets, getSheet, listSheets, putSheet, SCHEMA, type SheetSystem } from '../../server/db/sheets.ts';

let db: DatabaseSync;

const systems: SheetSystem[] = [
  { from: 180, to: 292, lineCount: 5 },
  { from: 380, to: 492, lineCount: 5 },
];

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
});

describe('넣고 읽기', () => {
  it('넣은 그대로 돌아온다', () => {
    putSheet(db, { songbookId: 'chanmi2000', number: 305, width: 991, height: 1447, systems, needsReview: false });

    const row = getSheet(db, 'chanmi2000', 305)!;
    expect(row.systems).toEqual(systems);
    expect(row.width).toBe(991);
    expect(row.height).toBe(1447);
    expect(row.needsReview).toBe(false);
    expect(row.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('없는 것은 undefined — 악보 없는 곡이 대부분이다', () => {
    expect(getSheet(db, 'chanmi2000', 999)).toBeUndefined();
    expect(getSheet(db, 'hymn_new', 305)).toBeUndefined();
  });

  /** 곡집이 다르면 다른 악보다 — 번호가 겹쳐도 섞이면 안 된다 */
  it('곡집과 번호를 함께 본다', () => {
    putSheet(db, { songbookId: 'chanmi2000', number: 1, width: 900, height: 900, systems, needsReview: false });
    putSheet(db, { songbookId: 'hymn_new', number: 1, width: 800, height: 800, systems: [], needsReview: true });

    expect(getSheet(db, 'chanmi2000', 1)!.width).toBe(900);
    expect(getSheet(db, 'hymn_new', 1)!.width).toBe(800);
  });

  it('다시 검출하면 덮어쓴다 — 같은 장이 둘이 되면 안 된다', () => {
    putSheet(db, { songbookId: 'chanmi2000', number: 1, width: 900, height: 900, systems, needsReview: true });
    putSheet(db, {
      songbookId: 'chanmi2000',
      number: 1,
      width: 931,
      height: 955,
      systems: [{ from: 10, to: 20, lineCount: 5 }],
      needsReview: false,
    });

    expect(listSheets(db)).toHaveLength(1);
    const row = getSheet(db, 'chanmi2000', 1)!;
    expect(row.width).toBe(931);
    expect(row.needsReview).toBe(false);
  });
});

describe('사람이 봐야 하는 표시', () => {
  it('세어서 알려 준다', () => {
    putSheet(db, { songbookId: 'chanmi2000', number: 1, width: 9, height: 9, systems, needsReview: false });
    putSheet(db, { songbookId: 'chanmi2000', number: 2, width: 9, height: 9, systems, needsReview: true });
    putSheet(db, { songbookId: 'chanmi2000', number: 3, width: 9, height: 9, systems, needsReview: true });

    expect(countSheets(db)).toEqual({ total: 3, needsReview: 2 });
  });

  it('하나도 없어도 0 을 준다 (null 이 새어 나오면 안 된다)', () => {
    expect(countSheets(db)).toEqual({ total: 0, needsReview: 0 });
  });

  /**
   * 줄 수를 참/거짓이 아니라 숫자로 남긴다 — 검토 화면이 '무엇이 이상한지' 를
   * 보여 줄 수 있어야 한다. 넷은 한 줄을 놓친 것이고 여섯은 잘못 본 것이다.
   */
  it('단마다 몇 줄이 잡혔는지 남는다', () => {
    putSheet(db, {
      songbookId: 'chanmi2000',
      number: 77,
      width: 9,
      height: 9,
      systems: [{ from: 0, to: 10, lineCount: 6 }, { from: 20, to: 30, lineCount: 7 }],
      needsReview: true,
    });
    expect(getSheet(db, 'chanmi2000', 77)!.systems.map((one) => one.lineCount)).toEqual([6, 7]);
  });
});

describe('목록', () => {
  beforeEach(() => {
    putSheet(db, { songbookId: 'chanmi2000', number: 2, width: 9, height: 9, systems, needsReview: false });
    putSheet(db, { songbookId: 'chanmi2000', number: 1, width: 9, height: 9, systems, needsReview: false });
    putSheet(db, { songbookId: 'hymn_new', number: 5, width: 9, height: 9, systems, needsReview: false });
  });

  it('번호 순으로 준다', () => {
    expect(listSheets(db, 'chanmi2000').map((one) => one.number)).toEqual([1, 2]);
  });

  it('곡집을 주지 않으면 전부', () => {
    expect(listSheets(db)).toHaveLength(3);
  });
});

/**
 * 저장된 JSON 이 깨졌으면 **그 장은 없는 것으로 본다.**
 *
 * 반쪽짜리 단 목록으로 자르면 예배 중 화면에 엉뚱한 자리가 나간다 — 악보가 아예
 * 안 나오는 편이 낫다.
 */
describe('깨진 값', () => {
  function forceRaw(raw: string): void {
    db.prepare(
      `INSERT INTO song_sheets (songbook_id, number, width, height, systems, needs_review, detected_at)
       VALUES ('chanmi2000', 1, 9, 9, ?, 0, '2026-09-04T00:00:00.000Z')`,
    ).run(raw);
  }

  it('JSON 이 아니면 없는 것으로 본다', () => {
    forceRaw('{망가짐');
    expect(getSheet(db, 'chanmi2000', 1)).toBeUndefined();
    expect(listSheets(db)).toEqual([]);
  });

  it('배열이 아니면 없는 것으로 본다', () => {
    forceRaw('{"from":1}');
    expect(getSheet(db, 'chanmi2000', 1)).toBeUndefined();
  });

  it('단 하나라도 모양이 다르면 그 장을 통째로 버린다', () => {
    forceRaw('[{"from":1,"to":2,"lineCount":5},{"from":3}]');
    expect(getSheet(db, 'chanmi2000', 1)).toBeUndefined();
  });

  it('빈 배열은 정상이다 — 단을 못 찾은 장도 기록으로 남긴다', () => {
    forceRaw('[]');
    expect(getSheet(db, 'chanmi2000', 1)!.systems).toEqual([]);
  });
});

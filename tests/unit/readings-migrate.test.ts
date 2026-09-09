/**
 * **옛 스키마의 교독문을 새 스키마로 옮기는 길** (`migrateToBookKey`).
 *
 * ## 왜 이 검사가 필요한가
 *
 * 이 함수는 사용자의 교독문 표를 **통째로 다시 만든다** — 이름을 바꾸고, 새 표를
 * 만들고, 옮겨 담고, 옛 표를 지운다. 중간에 무엇이 틀리면 교독문이 사라진다.
 * 원본은 `~/Desktop/Data/` 에 있지만 다시 가져오는 것은 사람이 해야 하는 일이고,
 * **예배 준비 중에 발견하면 늦다.**
 *
 * 그런데 2026-09-09 실측에서 이 함수는 **한 줄도 검사되지 않았다**. `server/` 에서
 * 되돌릴 수 없는 자료를 만지면서 검사가 0 인 곳은 여기가 마지막이었다.
 *
 * ## 실제 DB 를 쓰지 않는다
 *
 * `initReadingStore()` 는 app.sqlite 를 연다. 그 표를 검사가 지웠다 만들었다 하면
 * 사용자의 교독문을 담보로 잡는 셈이다. 그래서 `migrateToBookKey` 가 연결을 받도록
 * 열어 두고(기본값은 그대로다), 여기서는 **메모리 DB** 를 넘긴다.
 */

import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_READING_BOOK,
  initReadingStore,
  migrateToBookKey,
} from '../../server/db/readings.ts';

/** 옛 스키마 — 번호가 PK 고 찬송가 구분이 없다 */
const OLD_SCHEMA = `
CREATE TABLE responsive_readings (
  number     INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  lines      TEXT NOT NULL,
  source     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

function oldDb(rows: Array<{ number: number; title: string; lines: string[] }>): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(OLD_SCHEMA);
  const insert = db.prepare(
    'INSERT INTO responsive_readings (number, title, lines, source, updated_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (const row of rows) {
    insert.run(row.number, row.title, JSON.stringify(row.lines), '통일찬송가.txt', '2026-01-01');
  }
  return db;
}

interface NewRow {
  book: string;
  number: number;
  title: string;
  lines: string;
  source: string;
  updated_at: string;
}

function readAll(db: DatabaseSync): NewRow[] {
  return db
    .prepare('SELECT book, number, title, lines, source, updated_at FROM responsive_readings ORDER BY number')
    .all() as unknown as NewRow[];
}

describe('옛 스키마를 새 스키마로 옮긴다', () => {
  it('한 편도 잃지 않는다 — 개수·본문·출처·시각이 그대로다', () => {
    const db = oldDb([
      { number: 1, title: '첫째 교독문', lines: ['인도자 줄', '회중 줄'] },
      { number: 76, title: '일흔여섯째', lines: ['가', '나', '(다같이) 다'] },
      { number: 137, title: '백서른일곱째', lines: ['하나'] },
    ]);

    const moved = migrateToBookKey(db);
    expect(moved).toBe(3);

    const rows = readAll(db);
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.number)).toEqual([1, 76, 137]);
    // 본문을 한 글자도 고치지 않는다 — JSON 문자열째로 옮긴다
    expect(JSON.parse(rows[1]!.lines) as string[]).toEqual(['가', '나', '(다같이) 다']);
    // 다시 가져올 범위를 잡는 단서다. 잃으면 어디서 온 것인지 알 수 없다
    expect(rows[0]!.source).toBe('통일찬송가.txt');
    expect(rows[0]!.updated_at).toBe('2026-01-01');
  });

  /**
   * 새찬송가 교독문을 넣을 길이 없던 시절의 자료다 — 전부 통일찬송가용으로 봐야 한다.
   * 여기가 틀리면 **번호가 같은 다른 글**이 뒤섞인다 (통일 76편 ≠ 새 137편).
   */
  it('있던 것은 모두 통일찬송가용으로 표시된다', () => {
    const db = oldDb([{ number: 1, title: '첫째', lines: ['가'] }]);
    migrateToBookKey(db);
    expect(readAll(db).every((row) => row.book === DEFAULT_READING_BOOK)).toBe(true);
    expect(DEFAULT_READING_BOOK).toBe('hymn_old');
  });

  it('옛 표를 남기지 않는다 — 두 벌이 되면 어느 쪽이 진짜인지 알 수 없다', () => {
    const db = oldDb([{ number: 1, title: '첫째', lines: ['가'] }]);
    migrateToBookKey(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as unknown as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).not.toContain('responsive_readings_old');
  });

  /**
   * 새 열쇠는 `(book, number)` 다. 번호만으로 PK 를 두면 두 찬송가의 같은 번호가
   * 서로를 덮어쓴다 — 옮기는 목적 자체가 이것이다.
   */
  it('옮긴 뒤에는 같은 번호를 두 찬송가에 나란히 넣을 수 있다', () => {
    const db = oldDb([{ number: 76, title: '통일 76', lines: ['가'] }]);
    migrateToBookKey(db);

    db.prepare(
      `INSERT INTO responsive_readings (book, number, title, lines, source, updated_at)
       VALUES ('hymn_new', 76, '새 76', '["나"]', '새찬송가.txt', '2026-01-02')`,
    ).run();

    expect(readAll(db)).toHaveLength(2);
  });
});

describe('여러 번 불러도 안전하다', () => {
  it('두 번째부터는 아무것도 하지 않는다 (0 을 돌려준다)', () => {
    const db = oldDb([
      { number: 1, title: '첫째', lines: ['가'] },
      { number: 2, title: '둘째', lines: ['나'] },
    ]);
    expect(migrateToBookKey(db)).toBe(2);
    expect(migrateToBookKey(db)).toBe(0);
    expect(migrateToBookKey(db)).toBe(0);
    expect(readAll(db)).toHaveLength(2);
  });

  it('표가 아예 없으면 0 — 처음 켜는 PC 에서 던지지 않는다', () => {
    const db = new DatabaseSync(':memory:');
    expect(migrateToBookKey(db)).toBe(0);
  });

  /** 기동 경로 그대로: 새 표를 만들고 옮긴다. 빈 DB 에서 두 번 불러도 같아야 한다 */
  it('initReadingStore 를 두 번 불러도 표가 하나다', () => {
    const db = new DatabaseSync(':memory:');
    initReadingStore(db);
    initReadingStore(db);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'responsive_readings'")
      .all() as unknown as Array<{ name: string }>;
    expect(tables).toHaveLength(1);
    expect(readAll(db)).toHaveLength(0);
  });
});

/**
 * 옮기다 실패하면 **되돌린다.** 반쯤 옮긴 상태로 남으면 옛 표도 새 표도 믿을 수 없다.
 *
 * 일부러 깨뜨리는 방법: 옮겨 담을 자리에 **이름이 같은 표**를 미리 만들어 둔다.
 * `RENAME TO responsive_readings_old` 가 그 자리에서 막힌다.
 */
describe('실패하면 되돌린다', () => {
  /**
   * ⚠️ **이 검사가 없으면 `ROLLBACK` 을 `COMMIT` 으로 바꿔도 아무도 모른다** (실측).
   *
   * 아래 '이름 충돌' 검사는 **첫 문장**에서 막힌다 — 아직 쓴 것이 없어 되돌릴 것도
   * 없다. 되돌리기를 확인하려면 **옮겨 담는 도중에** 막혀야 한다.
   *
   * 방법: 옛 표의 `title` 을 비워 둘 수 있게 만들어 NULL 을 한 줄 넣는다. 새 표는
   * `title TEXT NOT NULL` 이라 `INSERT … SELECT` 에서 막힌다 — 그때는 이미
   * 이름 바꾸기와 새 표 만들기가 끝난 뒤다.
   */
  it('옮겨 담다 막히면 이름 바꾸기까지 되돌린다 — 반쯤 옮긴 상태를 남기지 않는다', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`
      CREATE TABLE responsive_readings (
        number     INTEGER PRIMARY KEY,
        title      TEXT,
        lines      TEXT NOT NULL,
        source     TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.prepare(
      `INSERT INTO responsive_readings (number, title, lines, source, updated_at)
       VALUES (1, NULL, '["가"]', '통일찬송가.txt', '2026-01-01')`,
    ).run();

    expect(() => migrateToBookKey(db)).toThrow();

    // 옛 표가 **제 이름 그대로** 남아 있어야 한다 — 이름이 바뀐 채 남으면 앱이 못 찾는다
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as Array<{
        name: string;
      }>
    ).map((table) => table.name);
    expect(tables).toContain('responsive_readings');
    expect(tables).not.toContain('responsive_readings_old');

    // 자료도 그대로다
    const rows = db
      .prepare('SELECT number, lines FROM responsive_readings')
      .all() as unknown as Array<{ number: number; lines: string }>;
    expect(rows).toEqual([{ number: 1, lines: '["가"]' }]);
  });

  it('중간에 막히면 던지고, 옛 자료는 그대로 남는다', () => {
    const db = oldDb([{ number: 1, title: '첫째', lines: ['가'] }]);
    db.exec('CREATE TABLE responsive_readings_old (x INTEGER)');

    expect(() => migrateToBookKey(db)).toThrow();

    // 옛 표가 옛 모습 그대로 남아 있어야 한다 — 다시 시도할 수 있다
    const rows = db
      .prepare('SELECT number, title FROM responsive_readings')
      .all() as unknown as Array<{ number: number; title: string }>;
    expect(rows).toEqual([{ number: 1, title: '첫째' }]);
  });
});

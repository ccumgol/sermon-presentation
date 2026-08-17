/**
 * 교독문 저장소 (app.sqlite).
 *
 * ## 왜 리포지토리가 아니라 DB 인가
 *
 * 교독문 본문은 **개역개정 저작물**이다. 성경 DB·찬양과 같은 규칙을 따른다 —
 * 원본은 `~/Desktop/Data/` 에 두고(읽기만 한다), 이 DB 로 가져온다.
 * `data/` 는 git 에서 제외되므로 본문이 리포지토리에 들어가지 않는다.
 *
 * 순서표(`service_plans`)와 **같은 DB** 에 둔 이유는, 순서표가 교독문 번호를
 * 참조하기 때문이다. 한 DB 면 `VACUUM INTO` 스냅샷 하나로 둘이 어긋나지 않는다.
 *
 * ## 줄을 JSON 한 칸에 담는다
 *
 * 줄마다 행을 만들지 않는다. 교독문은 **통째로 읽거나 안 읽는** 것이고, 줄 하나를
 * 따로 고치거나 검색할 일이 없다. 찬양 가사(`song_lines`)는 언어·절 단위로 다뤄야
 * 해서 행으로 쪼갰지만 여기는 그럴 이유가 없다.
 */

import type { ResponsiveReading } from '../../lib/responsive-parser.ts';
import { getConnection } from './app.ts';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS responsive_readings (
  number     INTEGER PRIMARY KEY,
  title      TEXT NOT NULL,
  lines      TEXT NOT NULL,   -- JSON: string[]
  source     TEXT NOT NULL,   -- 어느 파일에서 왔는지 (다시 가져올 범위를 잡는 데 쓴다)
  updated_at TEXT NOT NULL
);
`;

export function initReadingStore(): void {
  getConnection().exec(SCHEMA);
}

interface Row {
  number: number;
  title: string;
  lines: string;
  source: string;
}

/**
 * 저장된 줄을 되살린다.
 *
 * JSON 이 깨져 있어도 **던지지 않는다** — 교독문 하나 때문에 목록 전체가
 * 안 열리면 예배 준비가 막힌다. 빈 줄 목록으로 두면 컨트롤 패널이
 * '표시할 내용이 없습니다' 로 알린다.
 */
function toReading(row: Row): ResponsiveReading {
  let lines: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.lines);
    if (Array.isArray(parsed)) lines = parsed.filter((line): line is string => typeof line === 'string');
  } catch {
    lines = [];
  }
  return { number: row.number, title: row.title, lines };
}

export function listReadings(): ResponsiveReading[] {
  const rows = getConnection()
    .prepare('SELECT number, title, lines, source FROM responsive_readings ORDER BY number')
    .all() as unknown as Row[];
  return rows.map(toReading);
}

export function getReading(number: number): ResponsiveReading | undefined {
  if (!Number.isInteger(number)) return undefined;
  const row = getConnection()
    .prepare('SELECT number, title, lines, source FROM responsive_readings WHERE number = ?')
    .get(number) as unknown as Row | undefined;
  return row ? toReading(row) : undefined;
}

export function countReadings(): number {
  const row = getConnection()
    .prepare('SELECT count(*) AS c FROM responsive_readings')
    .get() as unknown as { c: number };
  return row.c;
}

/**
 * 가져오기 — 번호가 곧 열쇠라 **같은 번호는 덮어쓴다**.
 *
 * 파일을 고쳐 다시 가져오는 것이 정상 흐름이므로, 지우고 다시 넣는 대신
 * 번호 단위로 갱신한다. 파일에서 빠진 번호는 그대로 남는다 — 지우는 것은
 * `replaceAll` 이 명시적으로 한다.
 */
export function upsertReadings(readings: readonly ResponsiveReading[], source: string): number {
  const conn = getConnection();
  const now = new Date().toISOString();
  const statement = conn.prepare(
    `INSERT INTO responsive_readings (number, title, lines, source, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(number) DO UPDATE SET
       title = excluded.title, lines = excluded.lines,
       source = excluded.source, updated_at = excluded.updated_at`,
  );

  conn.exec('BEGIN');
  try {
    for (const reading of readings) {
      statement.run(reading.number, reading.title, JSON.stringify(reading.lines), source, now);
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  return readings.length;
}

/**
 * 이 출처의 교독문을 모두 지운다. **되돌릴 수 없다** — 부르는 쪽이 확인을 받아야 한다.
 * 다른 출처에서 온 것은 건드리지 않는다.
 */
export function deleteBySource(source: string): number {
  const conn = getConnection();
  const before = countReadings();
  conn.prepare('DELETE FROM responsive_readings WHERE source = ?').run(source);
  return before - countReadings();
}

/**
 * 악보 단(staff system) 경계 저장소.
 *
 * `scripts/detect-staff.ts` 가 그림을 읽어 여기에 넣고, 송출할 때 서버가 읽어
 * '지금 부르는 줄의 단만' 잘라 보낸다.
 *
 * ## 왜 곡 id 가 아니라 (곡집, 번호) 인가
 *
 * 악보 파일 이름이 **번호**다 (`chanmi2000/0305.webp`). 곡 id 로 묶어 두면 곡을 지웠다
 * 다시 넣을 때 악보와의 연결이 끊긴다 — 그림은 그대로 있는데 DB 만 잃는 것이라
 * 되살릴 방법이 검출을 다시 돌리는 것뿐이다. 곡집·번호는 자료 자체의 좌표라 안정적이다.
 *
 * ## 왜 단 목록을 JSON 한 칸에 두는가
 *
 * 단은 **늘 통째로** 읽는다 — 한 장의 단 하나만 필요한 경우가 없다(어느 단인지는
 * 목록을 받아 봐야 안다). 행으로 쪼개면 조회마다 조인이 붙고 순서 컬럼도 있어야 한다.
 * 이 프로젝트는 이미 `service_plans.items` 를 같은 이유로 JSON 으로 둔다.
 */

import type { DatabaseSync } from 'node:sqlite';

/** 한 단이 그림에서 차지하는 세로 범위 (양끝 포함, 픽셀) */
export interface SheetSystem {
  from: number;
  to: number;
  /**
   * 이 단에서 찾은 오선 줄 수. 5 가 아니면 사람이 봐야 한다.
   *
   * 값을 버리지 않고 남기는 이유: 검토 화면이 '무엇이 이상한지' 를 보여 줄 수 있어야
   * 한다. 참/거짓만 두면 4줄인지 6줄인지 알 수 없어 눈으로 다시 세야 한다.
   */
  lineCount: number;
}

export interface SheetRow {
  songbookId: string;
  number: number;
  /** 그림 크기 — 잘라 낼 때와 화면 비율 계산에 쓴다 (기울기를 편 뒤 크기다) */
  width: number;
  height: number;
  systems: SheetSystem[];
  /** 줄 수가 5가 아닌 단이 하나라도 있는가 */
  needsReview: boolean;
  detectedAt: string;
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS song_sheets (
  songbook_id  TEXT NOT NULL,
  number       INTEGER NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  systems      TEXT NOT NULL,      -- JSON: [{ from, to, lineCount }, ...]
  needs_review INTEGER NOT NULL DEFAULT 0,
  detected_at  TEXT NOT NULL,
  PRIMARY KEY (songbook_id, number)
);

CREATE INDEX IF NOT EXISTS idx_sheets_review ON song_sheets(needs_review);
`;

interface Row {
  songbook_id: string;
  number: number;
  width: number;
  height: number;
  systems: string;
  needs_review: number;
  detected_at: string;
}

/**
 * 저장된 JSON 을 다시 읽는다.
 *
 * 깨진 값이면 **그 장은 없는 것으로 본다.** 반쪽짜리 단 목록으로 자르면 예배 중
 * 화면에 엉뚱한 자리가 나가는데, 악보가 아예 안 나오는 편이 낫다.
 */
function parseSystems(raw: string): SheetSystem[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const systems = parsed.filter(
      (one): one is SheetSystem =>
        typeof one === 'object' &&
        one !== null &&
        typeof (one as SheetSystem).from === 'number' &&
        typeof (one as SheetSystem).to === 'number' &&
        typeof (one as SheetSystem).lineCount === 'number',
    );
    return systems.length === parsed.length ? systems : undefined;
  } catch {
    return undefined;
  }
}

function toRow(row: Row): SheetRow | undefined {
  const systems = parseSystems(row.systems);
  if (!systems) return undefined;
  return {
    songbookId: row.songbook_id,
    number: row.number,
    width: row.width,
    height: row.height,
    systems,
    needsReview: row.needs_review === 1,
    detectedAt: row.detected_at,
  };
}

/** 한 장의 단 목록. 없거나 저장된 값이 깨졌으면 `undefined` */
export function getSheet(db: DatabaseSync, songbookId: string, number: number): SheetRow | undefined {
  const row = db
    .prepare('SELECT * FROM song_sheets WHERE songbook_id = ? AND number = ?')
    .get(songbookId, number) as unknown as Row | undefined;
  return row ? toRow(row) : undefined;
}

/** 곡집 하나의 전부 — 검토 화면과 리포트가 쓴다 */
export function listSheets(db: DatabaseSync, songbookId?: string): SheetRow[] {
  const rows = (
    songbookId
      ? db.prepare('SELECT * FROM song_sheets WHERE songbook_id = ? ORDER BY number').all(songbookId)
      : db.prepare('SELECT * FROM song_sheets ORDER BY songbook_id, number').all()
  ) as unknown as Row[];
  return rows.map(toRow).filter((one): one is SheetRow => one !== undefined);
}

/** 넣거나 덮어쓴다. 검출을 다시 돌리면 같은 자리를 갱신한다 */
export function putSheet(db: DatabaseSync, sheet: Omit<SheetRow, 'detectedAt'> & { detectedAt?: string }): void {
  db.prepare(
    `INSERT INTO song_sheets (songbook_id, number, width, height, systems, needs_review, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(songbook_id, number) DO UPDATE SET
       width = excluded.width, height = excluded.height, systems = excluded.systems,
       needs_review = excluded.needs_review, detected_at = excluded.detected_at`,
  ).run(
    sheet.songbookId,
    sheet.number,
    sheet.width,
    sheet.height,
    JSON.stringify(sheet.systems),
    sheet.needsReview ? 1 : 0,
    sheet.detectedAt ?? new Date().toISOString(),
  );
}

export function countSheets(db: DatabaseSync): { total: number; needsReview: number } {
  const row = db
    .prepare('SELECT count(*) AS total, sum(needs_review) AS review FROM song_sheets')
    .get() as { total: number; review: number | null };
  return { total: row.total, needsReview: row.review ?? 0 };
}

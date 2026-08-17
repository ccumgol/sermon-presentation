/**
 * DB 스냅샷 — 되돌릴 수 없는 작업 직전에 남기는 안전망.
 *
 * `data/songs.sqlite` 에는 **사용자가 직접 손보고 승인한 가사**가 들어 있고 git 에
 * 없다. 되돌릴 방법이 백업뿐이다(협업 규칙 0.2). 그래서 데이터를 지우는 경로는
 * 지우기 **전에** 여기를 거친다.
 *
 * ## 왜 파일 복사가 아니라 `VACUUM INTO` 인가
 *
 * 이 DB 들은 WAL 모드다. `.sqlite` 하나만 복사하면 **WAL 에만 있는 최근 변경이
 * 빠진다**. 세 파일(`-wal`·`-shm` 포함)을 복사하는 방법도 있지만, 복사 도중에 쓰기가
 * 일어나면 서로 어긋난 조합이 남는다.
 *
 * `VACUUM INTO` 는 SQLite 가 **하나의 일관된 스냅샷**을 단일 파일로 떠 준다.
 * WAL 내용이 이미 반영되어 있어 복원할 때 그 파일만 제자리에 두면 된다.
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { paths } from '../paths.ts';

/** 스냅샷을 뜰 DB. 성경은 원본에서 다시 빌드할 수 있어 제외한다. */
const TARGETS: ReadonlyArray<{ file: string; label: string }> = [
  { file: paths.songsDb, label: 'songs' },
  { file: paths.appDb, label: 'app' },
];

export interface SnapshotResult {
  /** 만들어진 파일들의 절대 경로 */
  files: string[];
  /** 파일 이름에 들어간 시각 (같은 작업의 파일을 묶어 보는 데 쓴다) */
  stamp: string;
}

/** 파일 이름에 쓸 수 있는 시각 — 콜론·점을 뺀다 */
function stampNow(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * 지금 상태를 `data/backups/` 에 뜬다.
 *
 * @param reason 파일 이름에 들어갈 짧은 이유 (`before-import` 등)
 * @throws 하나라도 실패하면 던진다 — **부르는 쪽은 그 경우 작업을 중단해야 한다.**
 *   백업이 없는데 지우는 것이 바로 이 함수가 막으려는 위험이다.
 */
export function snapshotDatabases(reason: string): SnapshotResult {
  const safeReason = reason.replace(/[^a-zA-Z0-9-]/g, '') || 'snapshot';
  const stamp = stampNow();
  const files: string[] = [];

  mkdirSync(paths.backupsDir, { recursive: true });

  for (const target of TARGETS) {
    // 아직 만들어지지 않은 DB 는 뜰 것이 없다 (첫 실행 등)
    if (!existsSync(target.file)) continue;

    const out = path.join(paths.backupsDir, `${target.label}-${safeReason}-${stamp}.sqlite`);
    const db = new DatabaseSync(target.file, { readOnly: true });
    try {
      // 경로에 작은따옴표가 들어가면 SQL 이 깨진다 — 두 번 써서 이스케이프한다
      db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
      files.push(out);
    } finally {
      db.close();
    }
  }

  return { files, stamp };
}

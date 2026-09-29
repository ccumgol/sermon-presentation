/**
 * **자료 꾸러미** — 한 PC 의 자료를 다른 PC 로 통째로 옮기는 묶음 (2026-09-12 사용자 요청).
 *
 * ## 왜 번들(JSON)로는 안 되나
 *
 * 이미 있는 '자료 가져오기' 는 가사·곡집·교독문·템플릿을 **파일 하나**에 담는다.
 * 그런데 성경 DB(102MB)는 그 안에 들어갈 수 없어서, 여태
 * **폴더를 손으로 복사**하라고 안내해 왔다 (README '설치판으로 쓰기').
 * 이 꾸러미가 그 손작업을 대신한다.
 *
 * ## 담는 것과 빼는 것
 *
 * | | 왜 |
 * |---|---|
 * | `bible.sqlite` | 성경. 다시 만들려면 원본 폴더가 있어야 한다 |
 * | `songs.sqlite` | 가사·곡집 |
 * | `app.sqlite` | 설정·템플릿·순서표·교독문 |
 * | ❌ `backups/` | **그 PC 의 백업**이다. 받는 쪽에 옮길 것이 아니고 205MB 다 |
 * | ❌ `reports/` | 점검 산출물. 받는 쪽에 뜻이 없다 |
 * | ❌ `fonts/` | 글꼴은 PC 에 설치하는 것이라 폴더째 옮겨도 쓰이지 않는다 |
 *
 * ## 판은 프로그램과 따로 매긴다
 *
 * 자료는 프로그램과 따로 움직인다 — 가사를 고쳐도 프로그램은 그대로고, 프로그램을
 * 고쳐도 자료는 그대로다. 그래서 번호도 따로 둔다 (`DATA_PACK_VERSION`).
 */

import { DatabaseSync } from 'node:sqlite';

/** 자료 꾸러미의 판 — 프로그램 판(`package.json`)과 **다른 번호다** */
export const DATA_PACK_VERSION = '0.1.0';

/** 꾸러미임을 알아보는 표시. 엉뚱한 폴더를 고르면 여기서 걸린다 */
export const DATA_PACK_FORMAT = 'sermon-data-pack';

/** 꾸러미에 담기는 DB — 이름이 곧 데이터 폴더에서의 이름이다 */
export const PACK_DATABASES = ['bible.sqlite', 'songs.sqlite', 'app.sqlite'] as const;

export interface DataPackEntry {
  name: string;
  bytes: number;
  /** 폴더면 안에 든 파일 수 */
  files?: number;
}

export interface DataPackManifest {
  format: typeof DATA_PACK_FORMAT;
  version: string;
  /** 만든 시각 (ISO) — 두 꾸러미를 가르는 것은 사실상 이쪽이다 */
  builtAt: string;
  entries: DataPackEntry[];
}

/**
 * 이 폴더가 자료 꾸러미인가 — **읽기 전에 본다.**
 *
 * 엉뚱한 폴더를 고르면 그 안의 파일을 데이터 폴더에 쏟아붓게 된다.
 * 표시와 판이 둘 다 맞아야 통과시킨다.
 */
export function readManifest(raw: unknown): DataPackManifest | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Partial<DataPackManifest>;
  if (value.format !== DATA_PACK_FORMAT) return undefined;
  if (typeof value.version !== 'string' || value.version.length === 0) return undefined;
  if (typeof value.builtAt !== 'string') return undefined;
  return {
    format: DATA_PACK_FORMAT,
    version: value.version,
    builtAt: value.builtAt,
    entries: Array.isArray(value.entries) ? value.entries.filter(isEntry) : [],
  };
}

function isEntry(value: unknown): value is DataPackEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<DataPackEntry>;
  return typeof entry.name === 'string' && typeof entry.bytes === 'number';
}

/** 사람이 읽는 크기 — 꾸러미가 얼마나 큰지 화면이 말해 줘야 한다 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}

/**
 * 이 이름에 **사람이 손본 것이 들어 있는가**.
 *
 * `songs.sqlite`(가사)와 `app.sqlite`(순서표·설정)가 그렇다 — 그 PC 에서만 있는
 * 것이고 git 에 없다. 한 번 덮으면 되돌릴 방법이 백업뿐이다.
 *
 * 성경은 원본에서 만들어 낸 것이라 같은 자료면 같은 결과다.
 *
 * ⚠️ **'이미 파일이 있다' 와 '내용이 있다' 는 다르다.** 앱은 처음 뜰 때 빈 DB 를
 * 만든다 — 파일만 보고 건너뛰면 **새 PC 에서 가사가 안 들어간다**
 * (2026-09-12 실측으로 발견했다). 비었는지는 부르는 쪽이 DB 를 열어 본다.
 */
export function holdsUserData(name: string): boolean {
  return name === 'songs.sqlite' || name === 'app.sqlite';
}

/** 넣으면 무엇이 되는가 — 사람이 **누르기 전에** 알아야 한다 */
export type PackAction = 'install' | 'replace' | 'skip';

/**
 * 이 DB 에 **사람이 만든 흔적이 하나도 없는가** — 없으면 넣어도 잃을 것이 없다.
 *
 * ⚠️ **'행이 0개' 로는 못 가른다.** 앱은 첫 기동에 기본 예배 유형 넷을 넣고,
 * 그 유형들은 **항목까지 들고 있다** (2026-09-12 실측: 주일예배 11개 · 수요예배 6개 …).
 * 그래서 표마다 '사람이 만든 것' 이 무엇인지 골라 센다.
 *
 * | | 갓 만든 PC | 쓰던 PC (실측) |
 * |---|---:|---:|
 * | `kind='plan'` 순서표 | 0 | 3 |
 * | 템플릿 | 0 | 4 |
 * | 교독문 | 0 | 213 |
 * | 설정 | 0 | 3 |
 *
 * 못 읽으면 **비었다고 보지 않는다.** 이유가 무엇이든 그 상태에서 덮는 것보다
 * 건너뛰고 사람이 보게 하는 편이 낫다.
 *
 * `server/routes/data-pack.ts` 안에 있던 것을 꺼냈다(2026-09-28) — 이 판정이
 * 틀리면 **사용자가 손본 가사를 조용히 덮는다.** 파일 경로를 인자로 받으므로
 * 검사가 붙는다.
 */
export function isUntouched(file: string, name: string): boolean {
  const counts: string[] =
    name === 'songs.sqlite'
      ? ['SELECT count(*) AS c FROM songs']
      : [
          // 기본으로 깔린 유형(`template`)은 사람이 만든 것이 아니다
          "SELECT count(*) AS c FROM service_plans WHERE kind <> 'template'",
          'SELECT count(*) AS c FROM templates',
          'SELECT count(*) AS c FROM responsive_readings',
          'SELECT count(*) AS c FROM settings',
        ];

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    for (const sql of counts) {
      const row = db.prepare(sql).get() as unknown as { c: number } | undefined;
      if ((row?.c ?? 0) > 0) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/**
 * 이 파일을 어떻게 할 것인가 — **결정만 한다**(파일을 만지지 않는다).
 *
 * | 상황 | 무엇 | 왜 |
 * |---|---|---|
 * | 이 PC 에 없다 | `install` | 잃을 것이 없다 |
 * | 사람이 손본 것이 아니다 (성경) | `replace` | 원본에서 만들어 낸 것이라 같은 자료면 같은 결과다 |
 * | 사람 것인데 **비어 있다** | `install` | 앱이 첫 기동에 빈 DB 를 만든다. 파일이 있다고 건너뛰면 새 PC 에서 가사가 안 들어간다 (2026-09-12 실측) |
 * | 사람 것에 **내용이 있다** | `skip` | 손본 것이 사라지지 않게 건드리지 않는다 |
 */
export function planAction(
  name: string,
  targetExists: boolean,
  untouched: boolean,
): { action: PackAction; reason?: string } {
  if (!targetExists) return { action: 'install' };
  if (!holdsUserData(name)) return { action: 'replace' };
  if (untouched) return { action: 'install', reason: '이 PC 에 만들어 둔 것이 없습니다' };
  return {
    action: 'skip',
    reason: '이 PC 에 이미 자료가 있습니다 — 손본 것이 사라지지 않게 건드리지 않습니다',
  };
}

/**
 * **자료 꾸러미** — 한 PC 의 자료를 다른 PC 로 통째로 옮기는 묶음 (2026-09-12 사용자 요청).
 *
 * ## 왜 번들(JSON)로는 안 되나
 *
 * 이미 있는 '자료 가져오기' 는 가사·곡집·교독문·템플릿을 **파일 하나**에 담는다.
 * 그런데 성경 DB(102MB)와 악보 그림(52MB)은 그 안에 들어갈 수 없어서, 여태
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
 * | `sheets/` | 악보 그림 |
 * | ❌ `backups/` | **그 PC 의 백업**이다. 받는 쪽에 옮길 것이 아니고 205MB 다 |
 * | ❌ `reports/` | 점검 산출물. 받는 쪽에 뜻이 없다 |
 * | ❌ `fonts/` | 글꼴은 PC 에 설치하는 것이라 폴더째 옮겨도 쓰이지 않는다 |
 *
 * ## 판은 프로그램과 따로 매긴다
 *
 * 자료는 프로그램과 따로 움직인다 — 가사를 고쳐도 프로그램은 그대로고, 프로그램을
 * 고쳐도 자료는 그대로다. 그래서 번호도 따로 둔다 (`DATA_PACK_VERSION`).
 */

/** 자료 꾸러미의 판 — 프로그램 판(`package.json`)과 **다른 번호다** */
export const DATA_PACK_VERSION = '0.1.0';

/** 꾸러미임을 알아보는 표시. 엉뚱한 폴더를 고르면 여기서 걸린다 */
export const DATA_PACK_FORMAT = 'sermon-data-pack';

/** 꾸러미에 담기는 DB — 이름이 곧 데이터 폴더에서의 이름이다 */
export const PACK_DATABASES = ['bible.sqlite', 'songs.sqlite', 'app.sqlite'] as const;

/** 꾸러미에 담기는 폴더 */
export const PACK_FOLDERS = ['sheets'] as const;

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
 * 성경과 악보는 원본에서 만들어 낸 것이라 같은 자료면 같은 결과다.
 *
 * ⚠️ **'이미 파일이 있다' 와 '내용이 있다' 는 다르다.** 앱은 처음 뜰 때 빈 DB 를
 * 만든다 — 파일만 보고 건너뛰면 **새 PC 에서 가사가 안 들어간다**
 * (2026-09-12 실측으로 발견했다). 비었는지는 부르는 쪽이 DB 를 열어 본다.
 */
export function holdsUserData(name: string): boolean {
  return name === 'songs.sqlite' || name === 'app.sqlite';
}

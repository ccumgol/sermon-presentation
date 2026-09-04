/**
 * 모든 파일시스템 경로의 단일 진실 공급원.
 *
 * Electron 패키징(Phase 6) 시 메인 프로세스가 SERMON_DATA_DIR 을
 * app.getPath('userData') 로 지정하면, 이 파일 외에 고칠 곳이 없다.
 * 다른 모듈에서 경로를 직접 조립하는 것은 금지.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 소스 트리 루트 (server/ 의 부모) */
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 쓰기 가능한 사용자 데이터 디렉터리.
 * 개발 중에는 <repo>/data, Electron 에서는 SERMON_DATA_DIR.
 */
export const DATA_DIR = process.env.SERMON_DATA_DIR
  ? path.resolve(process.env.SERMON_DATA_DIR)
  : path.join(APP_ROOT, 'data');

/**
 * 원본 성경 DB 폴더 — 읽기 전용으로만 접근한다.
 * 절대 이 폴더에 쓰지 않는다 (계획서 §11 리스크 대응).
 */
export const BIBLE_SOURCE_DIR = process.env.BIBLE_DB_DIR
  ? path.resolve(process.env.BIBLE_DB_DIR)
  : path.join(homedir(), 'Desktop', 'Data', 'BibleDB');

/**
 * 찬양 자료 원본 폴더 — **읽기 전용으로만 접근한다.**
 *
 * 악보 원본(`찬미예수 2000 악보/`, BMP 2,062장 340MB)이 여기 있다. 변환 결과만
 * `data/sheets/` 로 나가고 원본은 그대로 둔다 — 원본이 있어야 다시 변환할 수 있다.
 */
export const PRAISE_SOURCE_DIR = process.env.SERMON_PRAISE_DIR
  ? path.resolve(process.env.SERMON_PRAISE_DIR)
  : path.join(homedir(), 'Desktop', 'Data', 'Praise');

/**
 * 사용자가 모아 둔 배경 그림 폴더 — **읽기 전용으로만 접근한다.**
 *
 * 성경 DB 폴더와 같은 규칙이다. 여기에 쓰지 않고, 복사해 오지도 않는다 —
 * 54MB(13장)를 `data/` 로 옮기면 두 벌이 되고 백업 용량 계산도 어긋난다.
 * 폴더에 파일을 넣으면 목록에 바로 나타나는 것이 사용자가 기대하는 동작이다.
 */
export const BACKGROUND_SOURCE_DIR = process.env.SERMON_BACKGROUND_DIR
  ? path.resolve(process.env.SERMON_BACKGROUND_DIR)
  : path.join(homedir(), 'Desktop', 'Data', 'Background');

export const paths = {
  appRoot: APP_ROOT,
  dataDir: DATA_DIR,
  bibleSourceDir: BIBLE_SOURCE_DIR,
  praiseSourceDir: PRAISE_SOURCE_DIR,
  backgroundSourceDir: BACKGROUND_SOURCE_DIR,

  /**
   * 성경 DB 는 읽기 전용·불변이라 사용자 데이터와 위치를 분리할 수 있다.
   * SERMON_BIBLE_DB 로 따로 지정하면 여러 사용자가 한 파일을 공유하거나,
   * 테스트가 사용자 데이터를 건드리지 않고 실제 DB 를 읽을 수 있다.
   */
  bibleDb: process.env.SERMON_BIBLE_DB
    ? path.resolve(process.env.SERMON_BIBLE_DB)
    : path.join(DATA_DIR, 'bible.sqlite'),
  songsDb: path.join(DATA_DIR, 'songs.sqlite'),
  appDb: path.join(DATA_DIR, 'app.sqlite'),

  fontsDir: path.join(DATA_DIR, 'fonts'),
  /**
   * 스냅샷을 두는 곳. `SERMON_BACKUP_DIR` 로 **다른 디스크**를 가리킬 수 있다.
   *
   * `songs.sqlite` 는 git 에 없어 되돌릴 방법이 백업뿐인데, 기본값은 DB 와 같은
   * 디스크다 — 디스크가 죽으면 원본과 백업을 함께 잃는다. 외장 디스크나 클라우드
   * 폴더를 가리키면 그 위험이 사라진다 (스냅샷 하나가 3~7MB 라 부담이 없다).
   *
   * ```
   * SERMON_BACKUP_DIR=~/Library/CloudStorage/Dropbox/sermon-backups ./start.sh
   * ```
   *
   * 같은 디스크면 서버가 뜰 때 알린다 (`snapshotDatabases` 의 `sameDevice`).
   */
  backupsDir: process.env.SERMON_BACKUP_DIR
    ? path.resolve(process.env.SERMON_BACKUP_DIR.replace(/^~(?=\/|$)/, homedir()))
    : path.join(DATA_DIR, 'backups'),
  /**
   * 배경 그림·동영상. 사용자가 파일을 직접 넣어도 되고 앱에서 올려도 된다.
   * 서버는 이 폴더 밖의 파일은 배경으로 내주지 않는다.
   */
  backgroundsDir: path.join(DATA_DIR, 'backgrounds'),
  /**
   * 빌드 리포트는 자기가 만든 DB 와 같은 위치에 둔다.
   * APP_ROOT 아래에 두었을 때, SERMON_DATA_DIR 을 바꿔 실행한 시험 빌드의 리포트가
   * 실제 리포트 폴더에 섞여 "어느 파일로 빌드했는지"를 잘못 알려주는 일이 있었다.
   */
  reportsDir: path.join(DATA_DIR, 'reports'),
  /**
   * 악보 이미지 — 원본 BMP 를 WebP 로 바꿔 둔 곳. 곡집별로 나눈다
   * (`sheets/chanmi2000/0001.webp`).
   *
   * **원본을 복사해 오는 것이 아니라 변환해서 둔다.** 무손실이라 그림은 같고
   * 용량만 340MB → 50MB 로 준다(실측 14.7%). 배경 그림과 달리 원본 폴더를 그대로
   * 읽지 않는 이유는 BMP 를 브라우저가 잘 다루지 못하고, 한 장이 2,245px 까지
   * 되어 예배 중에 그대로 내보내기에 무겁기 때문이다.
   */
  sheetsDir: path.join(DATA_DIR, 'sheets'),

  publicDir: path.join(APP_ROOT, 'public'),
  outputDir: path.join(APP_ROOT, 'public', 'output'),
} as const;

/** 쓰기 대상 디렉터리를 필요 시 생성한다. 원본 DB 폴더는 건드리지 않는다. */
export function ensureDataDirs(): void {
  for (const dir of [
    paths.dataDir, paths.fontsDir, paths.backupsDir, paths.reportsDir, paths.backgroundsDir, paths.sheetsDir,
  ]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

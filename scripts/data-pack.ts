/**
 * 자료 꾸러미를 만든다 — `release/sermon-data-<판>/`.
 *
 * ```bash
 * npm run data:pack
 * ```
 *
 * ## 왜 폴더인가 (zip 이 아니라)
 *
 * 받는 쪽에서 **풀 도구가 필요 없다.** 옮길 때 한 덩이로 만들고 싶으면 OS 의
 * '압축' 으로 묶으면 된다 — 우리가 압축 라이브러리를 들이는 것보다 낫다
 * (이 저장소는 의존성을 늘리지 않는 것을 원칙으로 한다).
 *
 * ## ⚠️ `cp` 로 뜨지 않는다
 *
 * DB 는 WAL 모드다. 파일 하나만 복사하면 최근 변경이 `-wal` 에 남아 **곡 0개짜리**
 * 꾸러미가 된다 (실제로 겪었다 — CLAUDE.md '백업'). `VACUUM INTO` 로 일관된 한 파일을 뜬다.
 *
 * ## 원본을 건드리지 않는다
 *
 * 읽기 전용으로 열고, 쓰는 곳은 `release/` 뿐이다.
 */

import { DatabaseSync } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  DATA_PACK_FORMAT,
  DATA_PACK_VERSION,
  PACK_DATABASES,
  PACK_FOLDERS,
  formatBytes,
  type DataPackEntry,
  type DataPackManifest,
} from '../lib/data-pack.ts';
import { paths } from '../server/paths.ts';

const outRoot = path.join(paths.appRoot, 'release');
const outDir = path.join(outRoot, `sermon-data-${DATA_PACK_VERSION}`);

function folderBytes(dir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const inner = folderBytes(full);
      bytes += inner.bytes;
      files += inner.files;
    } else {
      bytes += stat.size;
      files += 1;
    }
  }
  return { bytes, files };
}

function main(): void {
  console.log(`자료 꾸러미 ${DATA_PACK_VERSION} 를 만듭니다`);
  console.log(`  읽는 곳: ${paths.dataDir}`);
  console.log(`  쓰는 곳: ${outDir}`);
  console.log('');

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const entries: DataPackEntry[] = [];

  for (const name of PACK_DATABASES) {
    const source = path.join(paths.dataDir, name);
    if (!existsSync(source)) {
      console.log(`  – ${name} — 없어서 건너뜁니다`);
      continue;
    }
    const target = path.join(outDir, name);

    // `VACUUM INTO` 로 뜬다 — WAL 에 남은 최근 변경까지 한 파일에 담긴다
    const db = new DatabaseSync(source, { readOnly: true });
    try {
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }

    const bytes = statSync(target).size;
    entries.push({ name, bytes });
    console.log(`  ✓ ${name}  ${formatBytes(bytes)}`);
  }

  for (const name of PACK_FOLDERS) {
    const source = path.join(paths.dataDir, name);
    if (!existsSync(source)) {
      console.log(`  – ${name}/ — 없어서 건너뜁니다`);
      continue;
    }
    cpSync(source, path.join(outDir, name), { recursive: true });
    const { bytes, files } = folderBytes(source);
    entries.push({ name, bytes, files });
    console.log(`  ✓ ${name}/  ${formatBytes(bytes)} (${files.toLocaleString('ko-KR')}개)`);
  }

  const manifest: DataPackManifest = {
    format: DATA_PACK_FORMAT,
    version: DATA_PACK_VERSION,
    builtAt: new Date().toISOString(),
    entries,
  };
  writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log('');
  console.log(`  모두 ${formatBytes(total)}`);
  console.log('');
  console.log('  받는 PC 에서: 앱의 **설정 탭 → 데이터 폴더 열기** 를 누르고,');
  console.log(`  이 폴더를 그 안에 **install** 이라는 이름으로 넣은 뒤`);
  console.log('  설정 탭의 **자료 설치** 를 누르세요.');
}

main();

/**
 * 악보 단(staff system) 경계 검출 → `data/songs.sqlite` 의 `song_sheets`
 *
 * ```
 * npm run sheets:detect                    # 미리보기 (아무것도 쓰지 않는다)
 * npm run sheets:detect -- --apply         # 실제로 넣는다
 * npm run sheets:detect -- --apply --force # 이미 넣은 것도 다시 검출한다
 * npm run sheets:detect -- --limit 50      # 앞에서 50장만 (시험용)
 * ```
 *
 * `npm run sheets:convert` 를 먼저 돌려 `data/sheets/` 를 채워 둬야 한다.
 * **변환 결과를 읽는다** — 원본 BMP 가 아니다. 변환할 때 기울기를 폈으므로 좌표가
 * 화면에 나가는 그림과 같아야 하기 때문이다.
 *
 * ## 하는 일
 *
 * 그림마다 행별 잉크량과 '가장 긴 가로 연속 검은 구간' 을 재서 `lib/staff-detect.ts`
 * 에 넘긴다. 판정은 전부 거기 있고 여기서는 픽셀만 읽는다 — Node 에 이미지 디코더가
 * 없어 `magick` 을 거쳐야 하는데, 그 부분과 판정을 섞으면 판정을 테스트할 수 없다.
 *
 * ## 사람이 봐야 하는 것
 *
 * 줄 수가 5가 아닌 단이 하나라도 있으면 `needs_review` 로 표시해 둔다. 전수 2,061장
 * 중 155장(7.5%)이 여기 걸린다 (2026-09-04 실측). 넷이면 한 줄을 놓친 것이고 여섯이면
 * 무언가를 오선으로 잘못 본 것이라, 자른 범위가 어긋났을 수 있다.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { sheetNumberOf } from '../lib/sheet-files.ts';
import { detectSystems } from '../lib/staff-detect.ts';
import * as sheets from '../server/db/sheets.ts';
import { conn, initSongsDb } from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';
import { paths } from '../server/paths.ts';

/** 행별 잉크량과 최장 연속 구간 — 판정에 필요한 것은 이 둘뿐이다 */
function profiles(file: string): { width: number; height: number; ink: number[]; runs: number[] } {
  const size = execFileSync('magick', ['identify', '-format', '%w %h', file]).toString().trim().split(' ');
  const width = Number(size[0]);
  const height = Number(size[1]);
  const data = execFileSync('magick', [file, '-colorspace', 'Gray', '-depth', '8', 'GRAY:-'], {
    maxBuffer: 1 << 30,
  });

  const ink: number[] = [];
  const runs: number[] = [];
  for (let y = 0; y < height; y++) {
    const base = y * width;
    let count = 0;
    let run = 0;
    let best = 0;
    for (let x = 0; x < width; x++) {
      if (data[base + x]! < 128) {
        count++;
        run++;
        if (run > best) best = run;
      } else {
        run = 0;
      }
    }
    ink.push(count);
    runs.push(best);
  }
  return { width, height, ink, runs };
}

function hasImageMagick(): boolean {
  try {
    execFileSync('magick', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

interface Target {
  songbookId: string;
  number: number;
  file: string;
}

function collect(force: boolean): { targets: Target[]; skipped: number } {
  const db = conn();
  const targets: Target[] = [];
  let skipped = 0;

  if (!existsSync(paths.sheetsDir)) return { targets, skipped };

  for (const songbookId of readdirSync(paths.sheetsDir).sort()) {
    const dir = path.join(paths.sheetsDir, songbookId);
    for (const entry of readdirSync(dir).sort()) {
      if (!entry.endsWith('.webp')) continue;
      const number = sheetNumberOf(entry);
      if (number === undefined) continue;
      if (!force && sheets.getSheet(db, songbookId, number)) {
        skipped++;
        continue;
      }
      targets.push({ songbookId, number, file: path.join(dir, entry) });
    }
  }
  return { targets, skipped };
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const force = args.includes('--force');
  const limitAt = args.indexOf('--limit');
  const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : undefined;

  if (!hasImageMagick()) {
    console.error('❌ ImageMagick(magick) 이 없습니다:\n   brew install imagemagick');
    process.exitCode = 1;
    return;
  }

  initSongsDb();
  const db = conn();

  const { targets: all, skipped } = collect(force);
  const targets = limit !== undefined && Number.isInteger(limit) ? all.slice(0, limit) : all;

  console.log(`악보 : ${paths.sheetsDir}`);
  console.log(`검출할 것 ${targets.length}장 · 이미 넣어 둠 ${skipped}장${limit ? ` · --limit ${limit}` : ''}`);
  if (targets.length === 0) {
    console.log('\n할 일이 없습니다. 먼저 npm run sheets:convert -- --apply 를 돌리세요.');
    return;
  }

  if (apply) {
    // 사용자 DB 에 쓴다 — 되돌릴 방법이 백업뿐이다
    const snap = snapshotDatabases('before-detect-staff');
    console.log(`스냅샷: ${snap.files.join(' · ')}`);
    if (snap.sameDevice) {
      console.log('⚠️  백업이 원본과 같은 디스크에 있습니다 — SERMON_BACKUP_DIR 로 다른 디스크를 가리키세요.');
    }
  }

  const systemCounts = new Map<number, number>();
  const review: Array<{ songbookId: string; number: number; note: string }> = [];
  const failed: Array<{ number: number; message: string }> = [];
  let done = 0;

  for (const target of targets) {
    try {
      const { width, height, ink, runs } = profiles(target.file);
      const { systems, odd } = detectSystems(ink, runs, width, height);

      systemCounts.set(systems.length, (systemCounts.get(systems.length) ?? 0) + 1);
      if (odd.length > 0) {
        review.push({
          songbookId: target.songbookId,
          number: target.number,
          note: odd.map((one) => `${one.index + 1}단 ${one.lineCount}줄`).join(' · '),
        });
      }

      if (apply) {
        sheets.putSheet(db, {
          songbookId: target.songbookId,
          number: target.number,
          width,
          height,
          systems: systems.map((one) => ({
            from: one.crop.from,
            to: one.crop.to,
            lineCount: one.lines.length,
          })),
          needsReview: odd.length > 0,
        });
      }
      done++;
    } catch (err) {
      failed.push({ number: target.number, message: err instanceof Error ? err.message.split('\n')[0]! : String(err) });
    }
    if (done % 200 === 0) console.log(`  … ${done}/${targets.length}`);
  }

  const noSystem = systemCounts.get(0) ?? 0;
  console.log('');
  console.log(`검출 ${done}장`);
  console.log(
    `단 수 분포: ${[...systemCounts].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}단×${v}`).join(' · ')}`,
  );
  console.log(`단을 하나도 못 찾은 장: ${noSystem}`);
  console.log(
    `사람이 봐야 하는 장: ${review.length} (${((review.length / Math.max(1, done)) * 100).toFixed(1)}%)` +
      ' — 줄 수가 5가 아닌 단이 있습니다',
  );
  for (const one of review.slice(0, 10)) console.log(`   ${one.songbookId} ${one.number}번: ${one.note}`);
  if (review.length > 10) console.log(`   … 그 밖 ${review.length - 10}장`);

  if (failed.length > 0) {
    console.log(`❌ 읽지 못한 장 ${failed.length}: ${failed.slice(0, 5).map((f) => f.number).join(', ')}`);
    process.exitCode = 1;
  }

  if (!apply) {
    console.log('\n미리보기입니다 — 아무것도 쓰지 않았습니다. 실제로 넣으려면 --apply');
    return;
  }

  // 스스로 확인한다 — 넣었다고 말했으면 실제로 있어야 한다
  const stored = sheets.countSheets(db);
  console.log(`\nDB 에 담긴 악보 ${stored.total}장 (사람이 봐야 하는 것 ${stored.needsReview}장)`);
  const missing = targets.filter((one) => !sheets.getSheet(db, one.songbookId, one.number));
  if (missing.length > 0) {
    console.log(`❌ 넣었다고 했는데 없는 장 ${missing.length}`);
    process.exitCode = 1;
  }
}

main();

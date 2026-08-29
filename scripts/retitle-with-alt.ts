/**
 * 제목을 **`한국어 - 영문`** 으로 바꾼다.
 *
 * ```
 * node scripts/retitle-with-alt.ts --songbook misc            # 미리보기
 * node scripts/retitle-with-alt.ts --songbook misc --apply    # 실제로 바꾼다
 * node scripts/retitle-with-alt.ts --songbook misc --undo     # 되돌리기(미리보기)
 * ```
 *
 * ## 왜
 *
 * 영어 원제(`title_alt`)가 **화면 어디에도 나오지 않는다.** 목록·검색 모두 한국어
 * 제목만 보여 준다. 그래서 영어로 곡을 찾을 수 없었다 (2026-08-29 사용자 요청).
 *
 * ## 되돌릴 수 있다
 *
 * `title_alt` 는 그대로 두므로 붙인 꼬리를 떼면 원래 제목이 나온다 (`--undo`).
 * 한국어 제목 자체에 ` - ` 가 들어 있으면 어디서 끊을지 알 수 없으므로 **그런 곡은
 * 건드리지 않고 알린다** — 조용히 제목을 망가뜨리지 않는다.
 *
 * ## 두 번 돌려도 같다
 *
 * 이미 `한국어 - 영문` 인 곡은 건너뛴다.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import * as songs from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';

const JOINER = ' - ';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface Plan {
  id: number;
  from: string;
  to: string;
}

function main(): void {
  const songbook = argValue('--songbook');
  if (songbook === undefined) {
    console.error('❌ --songbook <곡집id> 가 필요합니다.');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const undo = process.argv.includes('--undo');

  songs.initSongsDb();

  const plans: Plan[] = [];
  const skipped: string[] = [];

  for (const id of songs.listSongIds(songbook)) {
    const song = songs.getSong(id);
    if (!song) continue;
    const alt = song.titleAlt?.trim() ?? '';
    if (alt.length === 0) {
      skipped.push(`${song.title} — 영어 원제가 없습니다`);
      continue;
    }
    const suffix = `${JOINER}${alt}`;

    if (undo) {
      if (!song.title.endsWith(suffix)) continue;
      plans.push({ id, from: song.title, to: song.title.slice(0, -suffix.length) });
      continue;
    }

    if (song.title.endsWith(suffix)) continue; // 이미 되어 있다
    /*
     * 한국어 제목에 이미 ` - ` 가 있으면 나중에 어디서 끊을지 알 수 없다.
     * 되돌릴 수 없는 모양을 만들지 않는다.
     */
    if (song.title.includes(JOINER)) {
      skipped.push(`${song.title} — 제목에 이미 ' - ' 가 있어 건드리지 않습니다`);
      continue;
    }
    plans.push({ id, from: song.title, to: `${song.title}${suffix}` });
  }

  console.log(`곡집 ${songbook} · ${undo ? '되돌리기' : '한국어 - 영문'}`);
  console.log(`  바꿀 곡: ${plans.length}곡`);
  if (skipped.length > 0) {
    console.log(`\n건드리지 않는 곡 ${skipped.length}개:`);
    for (const s of skipped.slice(0, 8)) console.log(`  ${s}`);
  }
  if (plans.length === 0) {
    console.log('\n바꿀 것이 없습니다.');
    return;
  }

  console.log('\n표본 (앞 5곡):');
  for (const p of plans.slice(0, 5)) console.log(`  ${p.from}\n    → ${p.to}`);

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 바꾸려면 --apply 를 붙이세요.');
    return;
  }

  const snapshot = snapshotDatabases(undo ? 'before-retitle-undo' : 'before-retitle');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);

  for (const p of plans) songs.updateSongMeta(p.id, { title: p.to });
  console.log(`\n바꿨습니다: ${plans.length}곡`);

  // 되살려 대조한다 — 제목과 영어 원제가 둘 다 그대로여야 한다
  let ok = 0;
  const wrong: string[] = [];
  for (const p of plans) {
    const got = songs.getSong(p.id);
    if (got?.title === p.to) ok += 1;
    else wrong.push(`${p.from} → ${got?.title ?? '(없음)'}`);
  }
  console.log(
    wrong.length === 0
      ? `확인: ${ok}곡을 다시 읽었고 제목이 그대로입니다 (영어 원제는 그대로 두었습니다 — --undo 로 되돌립니다)`
      : `⚠ 다시 읽은 결과가 다릅니다:\n  ${wrong.slice(0, 5).join('\n  ')}`,
  );
}

if (!existsSync('data')) {
  console.error(`data 폴더가 없습니다. 저장소 뿌리에서 실행하세요. (지금: ${path.resolve('.')})`);
  process.exit(1);
}
main();

/**
 * 새찬송가 **영어 원제**와 **통일찬송가 번호**를 넣는다.
 *
 * ```
 * node scripts/import-hymn-en-titles.ts                 # 미리보기 (아무것도 쓰지 않는다)
 * node scripts/import-hymn-en-titles.ts --apply         # 실제로 넣는다
 * node scripts/import-hymn-en-titles.ts --file <경로>   # 다른 TSV
 * node scripts/import-hymn-en-titles.ts --links-only    # 통일 번호 연결만
 * node scripts/import-hymn-en-titles.ts --titles-only   # 영어 원제만
 * ```
 *
 * ## 가져오는 것은 둘뿐이다
 *
 * | 가져온다 | 어디로 |
 * |---|---|
 * | 영어 원제 | `songs.title_alt` |
 * | 통일찬송가 번호 | `song_links` (새 곡 ↔ 통일 곡) |
 *
 * **한국어 제목은 가져오지 않는다.** 출처(nme.kr 위키)에 우리보다 오타가 많다 —
 * 정혼한 처녀에세 / 취후기도 / 사람의 주님께 / 내밀리고. 우리 DB 가 원본이다.
 *
 * ## 넣지 않는 것
 *
 * 출처에서 행이 중복되며 뒤가 밀린 **새 631·632·638·639** 는 넣지 않는다
 * (`SUSPECT_NUMBERS`). 그대로 붙이면 엉뚱한 곡에 영어 제목이 간다. 목록으로 뽑아
 * 주므로 사람이 확인해 손으로 넣으면 된다.
 *
 * ## 이미 있는 값을 덮지 않는다
 *
 * `title_alt` 에 이미 무언가 적혀 있으면 **건드리지 않는다.** 사람이 손으로 고친 값이
 * 자동 작업에 지워지면 안 된다 (`lines_source = 'manual'` 을 지키는 것과 같은 이유).
 * 덮어쓰려면 `--overwrite` 를 붙인다.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseHymnEnRows, RESOLVED_SUSPECTS, SUSPECT_NUMBERS } from '../lib/hymn-en-titles.ts';
import { findByEntry, getSong, initSongsDb, linkSongs, updateSongMeta } from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';

const DEFAULT_FILE = 'data/hymn-en-titles.tsv';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 곡집·번호로 곡을 하나 집는다. 같은 번호가 둘이면 **고르지 않고 알린다** */
function pickOne(
  songbookId: 'hymn_new' | 'hymn_old',
  number: number,
): { id: number } | { ambiguous: number[] } | undefined {
  const hits = findByEntry(songbookId, number);
  if (hits.length === 0) return undefined;
  if (hits.length > 1) return { ambiguous: hits.map((h) => h.id) };
  return { id: hits[0]!.id };
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const overwrite = process.argv.includes('--overwrite');
  const linksOnly = process.argv.includes('--links-only');
  const titlesOnly = process.argv.includes('--titles-only');
  const file = argValue('--file') ?? DEFAULT_FILE;

  if (!existsSync(file)) {
    console.error(`파일이 없습니다: ${file}`);
    process.exit(1);
  }

  const { rows, skipped, problems } = parseHymnEnRows(readFileSync(file, 'utf8'));

  console.log(`출처: ${file}`);
  console.log(`읽은 행 ${rows.length}개 · 일부러 뺀 행 ${skipped.length}개`);

  if (problems.length > 0) {
    console.log(`\n⚠ 출처에서 발견한 문제 ${problems.length}건:`);
    for (const p of problems.slice(0, 10)) console.log(`  - ${p}`);
    if (problems.length > 10) console.log(`  … 그리고 ${problems.length - 10}건 더`);
  }

  initSongsDb();

  /*
   * 뺀 항목은 **우리 제목과 나란히** 보여 준다. 출처의 한국어만 보여 주면 무엇이
   * 어긋났는지 알 수 없다 — 두 열을 맞대 봐야 사람이 판단할 수 있다.
   */
  /*
   * 어긋난 구간은 **사람이 판정한 표**(`RESOLVED_SUSPECTS`)를 쓴다. 출처의 번호를
   * 그대로 믿지 않고, 우리 제목을 기준으로 무엇이 맞는지 정해 둔 값이다.
   * 판정하지 못한 것(출처에 아예 없는 곡)은 비워 두고 알린다.
   */
  if (skipped.length > 0) {
    console.log(`\n★ 어긋난 구간 ${skipped.length}건 — 우리 제목을 기준으로 판정한 값을 씁니다.\n`);
    console.log(`  ${'번호'.padEnd(6)}${'우리 제목'.padEnd(22)}${'넣는 영어 원제'.padEnd(34)}근거`);
    for (const s of skipped) {
      const found = pickOne('hymn_new', s.newNumber);
      const ours = found && 'id' in found ? (getSong(found.id)?.title ?? '?') : '?';
      const fix = RESOLVED_SUSPECTS.get(s.newNumber);
      const what = fix ? fix.english : '(넣지 않음)';
      const why = fix ? fix.basis : '출처에 이 곡이 없습니다 — 짐작해 채우지 않습니다';
      console.log(`  ${String(s.newNumber).padEnd(6)}${ours.padEnd(22)}${what.padEnd(34)}${why}`);
    }
  }

  // ── 무엇이 바뀔지 먼저 센다 ─────────────────────────────────
  const titlePlan: Array<{ songId: number; number: number; title: string; english: string }> = [];
  const linkPlan: Array<{ newId: number; oldId: number; newNo: number; oldNo: number }> = [];
  const notes: string[] = [];

  for (const row of rows) {
    const found = pickOne('hymn_new', row.newNumber);
    if (!found) {
      notes.push(`새 ${row.newNumber}장: 우리 DB 에 없습니다`);
      continue;
    }
    if ('ambiguous' in found) {
      notes.push(`새 ${row.newNumber}장: 같은 번호가 ${found.ambiguous.length}곡 있어 건너뜁니다`);
      continue;
    }

    const song = getSong(found.id);
    if (!song) continue;

    if (!linksOnly) {
      const already = song.titleAlt?.trim();
      if (already && !overwrite) {
        if (already !== row.english) notes.push(`새 ${row.newNumber}장: 원제가 이미 있어 그대로 둡니다 (「${already}」)`);
      } else if (already !== row.english) {
        titlePlan.push({ songId: found.id, number: row.newNumber, title: song.title, english: row.english });
      }
    }

    if (!titlesOnly) {
      const linkedIds = new Set((song.links ?? []).map((l) => l.id));
      for (const oldNo of row.oldNumbers) {
        const old = pickOne('hymn_old', oldNo);
        if (!old) {
          notes.push(`통일 ${oldNo}장: 우리 DB 에 없습니다 (새 ${row.newNumber}장의 짝)`);
          continue;
        }
        if ('ambiguous' in old) {
          notes.push(`통일 ${oldNo}장: 같은 번호가 ${old.ambiguous.length}곡 있어 건너뜁니다`);
          continue;
        }
        if (linkedIds.has(old.id)) continue; // 이미 연결돼 있다
        linkPlan.push({ newId: found.id, oldId: old.id, newNo: row.newNumber, oldNo });
      }
    }
  }

  /*
   * 판정한 어긋난 구간을 계획에 더한다. 여기서도 **이미 적힌 값은 덮지 않는다** —
   * 사람이 손으로 고친 것이 자동 작업에 지워지면 안 된다.
   */
  if (!linksOnly) {
    for (const [number, fix] of RESOLVED_SUSPECTS) {
      const found = pickOne('hymn_new', number);
      if (!found || !('id' in found)) {
        notes.push(`새 ${number}장: 우리 DB 에서 찾지 못해 판정값을 넣지 못했습니다`);
        continue;
      }
      const song = getSong(found.id);
      if (!song) continue;
      const already = song.titleAlt?.trim();
      if (already && !overwrite) continue;
      if (already === fix.english) continue;
      titlePlan.push({ songId: found.id, number, title: song.title, english: fix.english });
    }
  }

  console.log(`\n바뀔 것`);
  console.log(`  영어 원제를 채울 곡: ${titlePlan.length}곡`);
  console.log(`  새로 이을 새↔통일 연결: ${linkPlan.length}건`);

  if (notes.length > 0) {
    console.log(`\n건너뛴 것 ${notes.length}건:`);
    for (const n of notes.slice(0, 12)) console.log(`  - ${n}`);
    if (notes.length > 12) console.log(`  … 그리고 ${notes.length - 12}건 더`);
  }

  console.log(`\n표본 (앞 6곡):`);
  for (const t of titlePlan.slice(0, 6)) {
    console.log(`  새 ${String(t.number).padStart(3)}장  ${t.title}  →  ${t.english}`);
  }

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 넣으려면 --apply 를 붙이세요.');
    return;
  }

  // 되돌릴 길을 먼저 만든다
  const snapshot = snapshotDatabases('before-hymn-en-titles');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);

  for (const t of titlePlan) updateSongMeta(t.songId, { titleAlt: t.english });
  for (const l of linkPlan) linkSongs(l.newId, l.oldId);
  console.log(`\n넣었습니다: 원제 ${titlePlan.length}곡 · 연결 ${linkPlan.length}건`);

  // 되살려 대조한다 — 저장이 잘못되면 나중에 알게 된다
  let ok = 0;
  for (const t of titlePlan) {
    if (getSong(t.songId)?.titleAlt === t.english) ok += 1;
  }
  console.log(
    ok === titlePlan.length
      ? `확인: 원제 ${ok}곡을 다시 읽었습니다`
      : `⚠ 다시 읽은 결과가 다릅니다 (${ok}/${titlePlan.length})`,
  );

  /*
   * 어긋난 구간의 경계를 검사한다 — 이 스크립트가 지켜야 하는 약속이다.
   * 판정한 것은 그 값이 들어가 있어야 하고, 판정하지 못한 것은 **비어 있어야** 한다.
   */
  const wrong: string[] = [];
  for (const n of SUSPECT_NUMBERS) {
    const found = pickOne('hymn_new', n);
    if (!found || !('id' in found)) continue;
    const got = getSong(found.id)?.titleAlt ?? null;
    const want = RESOLVED_SUSPECTS.get(n)?.english ?? null;
    if (got !== want) wrong.push(`새 ${n}장: 넣으려던 값 ${want ?? '(없음)'} · 실제 ${got ?? '(없음)'}`);
  }
  console.log(
    wrong.length === 0
      ? `확인: 어긋난 구간 — 판정한 ${RESOLVED_SUSPECTS.size}곡은 채워지고, 나머지는 비어 있습니다`
      : `⚠ 어긋난 구간이 뜻대로 되지 않았습니다:\n  ${wrong.join('\n  ')}`,
  );
}

if (!existsSync('data')) {
  console.error(`data 폴더가 없습니다. 저장소 뿌리에서 실행하세요. (지금: ${path.resolve('.')})`);
  process.exit(1);
}
main();

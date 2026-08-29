/**
 * `lines_source` 표시를 옮긴다 — **잘못 찍힌 승인 표시를 바로잡기 위한 도구.**
 *
 * ```
 * node scripts/relabel-lines-source.ts --songbook hymn_new --from manual --to imported
 * node scripts/relabel-lines-source.ts --songbook hymn_new --from manual --to imported --apply
 * ```
 *
 * ## 왜 필요했나
 *
 * 한/영 반입이 새찬송가 645곡 전부에 `'manual'` 을 찍었다. `manual` 은 '사람이 앱에서
 * 승인했다' 는 뜻이고, CLAUDE.md 는 그 표시가 붙은 곡을 **자동 스크립트도 Agent 도**
 * 건드리지 말라고 못 박는다. 그런데 곡집 전부에 찍혀 있으면 **아무것도 가려내지
 * 못한다** — 사람이 손본 곡과 일괄 반입된 곡이 같아 보인다 (2026-08-28 발견).
 *
 * 일괄 반입의 정확한 이름은 `'imported'` 다. 자동 작업에서는 `manual` 과 똑같이
 * 보호되고(둘 다 `!== 'auto'`) 검토 대기열에도 올라오지 않는다. 다른 것은 뜻뿐이다.
 *
 * ## `--to manual` 은 거부한다
 *
 * `manual` 은 **사람이 앱에서 승인 버튼을 눌렀다**는 기록이다. 스크립트가 그것을
 * 만들어 낼 수 있으면 표시 자체가 뜻을 잃는다 — 지금 고치고 있는 문제가 바로 그것이다.
 * 승인은 검토 탭에서 사람이 한다.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { conn, initSongsDb, type LinesSource } from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';

const VALID: readonly LinesSource[] = ['auto', 'manual', 'imported'];

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const songbook = argValue('--songbook');
  const from = argValue('--from');
  const to = argValue('--to');
  const apply = process.argv.includes('--apply');

  if (!songbook || !from || !to) {
    console.error('❌ --songbook <곡집> --from <표시> --to <표시> 가 모두 필요합니다.');
    process.exit(1);
  }
  if (!VALID.includes(from as LinesSource) || !VALID.includes(to as LinesSource)) {
    console.error(`❌ 표시는 ${VALID.join(' · ')} 중 하나여야 합니다.`);
    process.exit(1);
  }
  if (to === 'manual') {
    console.error('❌ `manual` 로는 바꿀 수 없습니다.');
    console.error('   그것은 사람이 앱에서 승인했다는 기록입니다. 스크립트가 만들어 내면');
    console.error('   표시가 뜻을 잃습니다 — 이 도구가 고치고 있는 문제가 바로 그것입니다.');
    console.error('   승인은 컨트롤 패널의 검토 탭에서 하세요.');
    process.exit(1);
  }

  initSongsDb();
  const db = conn();

  const count = db
    .prepare(
      `SELECT COUNT(*) AS sections, COUNT(DISTINCT sec.song_id) AS songs
       FROM song_sections sec JOIN song_entries e ON e.song_id = sec.song_id
       WHERE e.songbook_id = ? AND sec.lines_source = ?`,
    )
    .get(songbook, from) as { sections: number; songs: number };

  console.log(`곡집 ${songbook} · ${from} → ${to}`);
  console.log(`  대상: ${count.songs}곡 · ${count.sections}개 섹션`);

  if (count.sections === 0) {
    console.log('\n바꿀 것이 없습니다.');
    return;
  }

  const sample = db
    .prepare(
      `SELECT e.number AS n, s.title AS t FROM song_sections sec
       JOIN song_entries e ON e.song_id = sec.song_id JOIN songs s ON s.id = sec.song_id
       WHERE e.songbook_id = ? AND sec.lines_source = ? GROUP BY s.id ORDER BY e.number, s.title LIMIT 5`,
    )
    .all(songbook, from) as unknown as Array<{ n: number | null; t: string }>;
  console.log('\n표본:');
  // 번호가 없는 곡집이 있다 ('기타') — 그때는 제목만 보여 준다
  for (const row of sample) console.log(`  ${row.n === null ? '  ' : `${row.n}장`}  ${row.t}`);

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 바꾸려면 --apply 를 붙이세요.');
    return;
  }

  const snapshot = snapshotDatabases('before-relabel-lines-source');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);
  if (snapshot.sameDevice) {
    console.log('  ⚠️ 백업이 원본과 같은 디스크에 있습니다 — 디스크가 죽으면 함께 잃습니다.');
    console.log('     SERMON_BACKUP_DIR 로 다른 디스크를 가리킬 수 있습니다.');
  }

  const changed = db
    .prepare(
      `UPDATE song_sections SET lines_source = ?
       WHERE lines_source = ? AND song_id IN (SELECT song_id FROM song_entries WHERE songbook_id = ?)`,
    )
    .run(to, from, songbook);
  console.log(`\n바꿨습니다: ${changed.changes}개 섹션`);

  // 되살려 대조한다
  const after = db
    .prepare(
      `SELECT sec.lines_source AS src, COUNT(*) AS c FROM song_sections sec
       JOIN song_entries e ON e.song_id = sec.song_id WHERE e.songbook_id = ?
       GROUP BY sec.lines_source ORDER BY c DESC`,
    )
    .all(songbook) as unknown as Array<{ src: string; c: number }>;
  console.log('\n확인 — 지금 상태:');
  for (const row of after) console.log(`  ${String(row.src).padEnd(10)}${row.c}개 섹션`);
}

if (!existsSync('data')) {
  console.error(`data 폴더가 없습니다. 저장소 뿌리에서 실행하세요. (지금: ${path.resolve('.')})`);
  process.exit(1);
}
main();

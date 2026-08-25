/**
 * 백업에서 **곡을 콕 집어** 가사를 되돌린다.
 *
 * ```
 * npm run restore:lyrics -- --from <백업.sqlite> --numbers 641,643        # 미리보기
 * npm run restore:lyrics -- --from <백업.sqlite> --numbers 641,643 --apply
 * npm run restore:lyrics -- --from <백업> --book hymn_old --numbers 40
 * ```
 *
 * ## 왜 필요했나
 *
 * 2026-08-25, 한/영 반입이 **아멘 찬송(638·641~645)의 가사를 지웠다.** 그 곡들은
 * 가사 자체가 `아멘 아멘 아멘` 인데, 반입기가 줄 끝 아멘을 '예배 표시' 로 보고 뗀
 * 것이다(`아멘 아멘` → `아멘`). 실수는 고쳤지만 **이미 들어간 데이터는 되돌려야** 했다.
 *
 * 백업 전체를 제자리에 놓으면 그 뒤에 한 다른 작업까지 잃는다. 그래서 **곡 단위로**
 * 되돌린다.
 *
 * ## 무엇을 되돌리고 무엇을 두는가
 *
 * 가사(섹션·줄)만 되돌린다. 곡의 제목·원제·곡집 수록·사용 기록은 건드리지 않는다 —
 * 그것들은 이 사고와 무관하고, 되돌리면 그 뒤의 작업이 사라진다.
 */

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import * as songs from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';
import type { LinesSource } from '../server/db/songs.ts';
import type { SongLine, SongSection } from '../shared/types.ts';

type NewSection = { kind: SongSection['kind']; label: string; lines: SongLine[] };

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

/** 백업 파일에서 (곡집, 번호) 의 가사를 읽는다 */
function readFromBackup(
  db: DatabaseSync,
  bookId: string,
  number: number,
): { title: string; sections: NewSection[]; linesSource: LinesSource } | undefined {
  const row = db
    .prepare(
      `SELECT s.id AS id, s.title AS title
         FROM song_entries e JOIN songs s ON s.id = e.song_id
        WHERE e.songbook_id = ? AND e.number = ?`,
    )
    .get(bookId, number) as unknown as { id: number; title: string } | undefined;
  if (!row) return undefined;

  const sectionRows = db
    .prepare(
      `SELECT id, kind, label, lines_source FROM song_sections
        WHERE song_id = ? ORDER BY position`,
    )
    .all(row.id) as unknown as Array<{
    id: number;
    kind: string;
    label: string;
    lines_source: string;
  }>;

  const lineStmt = db.prepare(
    'SELECT line_index, lang, text FROM song_lines WHERE section_id = ? ORDER BY line_index, lang',
  );
  const sections: NewSection[] = sectionRows.map((section) => ({
    kind: section.kind as SongSection['kind'],
    label: section.label,
    lines: (
      lineStmt.all(section.id) as unknown as Array<{
        line_index: number;
        lang: string;
        text: string;
      }>
    ).map((line) => ({
      lineIndex: line.line_index,
      lang: line.lang as SongLine['lang'],
      text: line.text,
    })),
  }));

  // 백업의 표시를 그대로 살린다 — 승인한 곡이 '자동' 으로 내려가면 안 된다
  const source = (sectionRows[0]?.lines_source ?? 'manual') as LinesSource;
  return { title: row.title, sections, linesSource: source };
}

function main(): void {
  const from = argValue('--from');
  const bookId = argValue('--book') ?? 'hymn_new';
  const raw = argValue('--numbers');
  const apply = process.argv.includes('--apply');

  if (from === undefined || !existsSync(from)) {
    console.error('❌ --from <백업.sqlite> 가 필요합니다.');
    process.exitCode = 1;
    return;
  }
  const numbers = (raw ?? '')
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
  if (numbers.length === 0) {
    console.error('❌ --numbers 641,643 처럼 곡 번호를 주세요.');
    process.exitCode = 1;
    return;
  }

  const backup = new DatabaseSync(from, { readOnly: true });
  const plan: Array<{
    number: number;
    title: string;
    songId: number;
    sections: NewSection[];
    linesSource: LinesSource;
    before: string;
    after: string;
  }> = [];
  const missing: number[] = [];

  const flatten = (sections: ReadonlyArray<{ lines: readonly SongLine[] }>): string =>
    sections
      .flatMap((section) => section.lines.filter((line) => line.lang === 'ko').map((line) => line.text))
      .join(' / ');

  for (const number of numbers) {
    const fromBackup = readFromBackup(backup, bookId, number);
    const matches = songs.findByEntry(bookId, number);
    if (!fromBackup || matches.length !== 1) {
      missing.push(number);
      continue;
    }
    plan.push({
      number,
      title: fromBackup.title,
      songId: matches[0]!.id,
      sections: fromBackup.sections,
      linesSource: fromBackup.linesSource,
      before: flatten(matches[0]!.sections),
      after: flatten(fromBackup.sections),
    });
  }
  backup.close();

  console.log(`\n되돌릴 곡: ${plan.length}곡  (백업: ${from})`);
  if (missing.length > 0) console.log(`  찾지 못한 번호: ${missing.join(', ')}`);
  console.log();
  for (const item of plan) {
    const same = item.before === item.after;
    console.log(`  ${String(item.number).padStart(3)} ${item.title} ${same ? '— 이미 같습니다' : ''}`);
    if (!same) {
      console.log(`      지금   : ${item.before}`);
      console.log(`      되돌림 : ${item.after}`);
    }
  }

  const changing = plan.filter((item) => item.before !== item.after);
  if (changing.length === 0) {
    console.log('\n되돌릴 것이 없습니다.');
    return;
  }
  if (!apply) {
    console.log('\n미리보기입니다. 실제로 되돌리려면 --apply 를 붙이세요.');
    return;
  }

  const snapshot = snapshotDatabases('before-restore-lyrics');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);

  for (const item of changing) {
    songs.replaceSections(item.songId, item.sections, item.linesSource);
  }
  console.log(`\n되돌렸습니다: ${changing.length}곡`);
}

main();

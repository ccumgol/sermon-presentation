/**
 * 새찬송가 교독문 가져오기 — `~/Desktop/Data/Kyodoc.sqlite` → `data/app.sqlite`
 *
 * ```
 * node scripts/import-kyodoc.ts                  # 미리보기 (아무것도 쓰지 않는다)
 * node scripts/import-kyodoc.ts --apply          # 실제로 넣는다
 * node scripts/import-kyodoc.ts --file <경로>    # 다른 파일
 * ```
 *
 * ## 통일찬송가 것과 **따로** 들어간다
 *
 * 두 찬송가의 교독문은 **번호가 같아도 다른 글**이다 (통일 76편 · 새 137편).
 * `book = 'hymn_new'` 로 넣으므로 이미 있는 통일찬송가 76편(`hymn_old`)은 건드리지 않는다.
 *
 * ## 원본은 읽기만 한다
 *
 * `~/Desktop/Data` 는 사용자가 모으는 자료 폴더다. **여기에 쓰지 않는다.**
 *
 * ## 미리보기가 기본이다
 *
 * 137편이 한 번에 들어가는 작업이라, 어댑터가 잘못 잘랐을 때 눈으로 먼저 봐야 한다.
 * 원본에서 발견한 문제(예: 5번이 내용을 반복한다)는 **고치지 않고 알린다** — 어느 쪽이
 * 맞는지는 교독문 실물을 봐야 알 수 있다.
 */

import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { parseKyodocRows, type KyodocRow } from '../lib/kyodoc-parser.ts';
import { readingSlides } from '../lib/responsive-parser.ts';
import {
  countReadings,
  initReadingStore,
  listReadings,
  READING_BOOK_LABELS,
  upsertReadings,
} from '../server/db/readings.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';

const DEFAULT_FILE = path.join(homedir(), 'Desktop/Data/Kyodoc.sqlite');
/** 이 원본은 새찬송가용이다 */
const BOOK = 'hymn_new' as const;

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const file = argValue('--file') ?? DEFAULT_FILE;

  if (!existsSync(file)) {
    console.error(`파일이 없습니다: ${file}`);
    process.exit(1);
  }

  // 원본은 읽기 전용으로만 연다
  const source = new DatabaseSync(file, { readOnly: true });
  const table = source
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'NEW_KYODOC'")
    .get() as { name: string } | undefined;
  if (!table) {
    console.error(`${file} 에 NEW_KYODOC 표가 없습니다. 다른 형식의 파일인지 확인하세요.`);
    process.exit(1);
  }

  const rows = source
    .prepare('SELECT ID, NAME, DESCRIPTION FROM NEW_KYODOC ORDER BY ID')
    .all() as unknown as KyodocRow[];
  source.close();

  const { readings, problems } = parseKyodocRows(rows);

  console.log(`원본: ${file}`);
  console.log(`넣을 곳: ${READING_BOOK_LABELS[BOOK]} (book = ${BOOK})`);
  console.log(`원본 행 ${rows.length}개 → 읽은 교독문 ${readings.length}편`);

  if (problems.length > 0) {
    console.log('\n⚠ 원본에서 발견한 문제 (고치지 않고 그대로 넣습니다):');
    for (const problem of problems) console.log(`  - ${problem}`);
  }

  if (readings.length === 0) {
    console.error('\n넣을 것이 없습니다.');
    process.exit(1);
  }

  // 번호가 이어지는지 — 한 편이 조용히 빠지면 그 주에 알게 된다
  const numbers = readings.map((reading) => reading.number);
  const missing: number[] = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n += 1) {
    if (!numbers.includes(n)) missing.push(n);
  }

  const totalLines = readings.reduce((sum, reading) => sum + reading.lines.length, 0);
  const totalSlides = readings.reduce((sum, reading) => sum + readingSlides(reading.lines).length, 0);
  const withClosing = readings.filter((reading) => reading.lines.length % 2 === 1).length;

  console.log(
    `\n번호 ${Math.min(...numbers)}~${Math.max(...numbers)} · ` +
      `빠진 번호 ${missing.length > 0 ? missing.join(',') : '없음'}`,
  );
  console.log(`본문 줄 ${totalLines}개 → 화면 ${totalSlides}장 (한 화면에 인도자·회중 두 줄)`);
  console.log(`마지막에 '다같이' 줄이 있는 편: ${withClosing}편`);

  console.log('\n처음 세 편:');
  for (const reading of readings.slice(0, 3)) {
    const slides = readingSlides(reading.lines);
    console.log(`\n  ${reading.number}. ${reading.title}  (줄 ${reading.lines.length} · 화면 ${slides.length})`);
    const first = slides[0];
    if (first) {
      console.log(`    인도자: ${first.leader.slice(0, 52)}`);
      console.log(`    회중  : ${first.people?.slice(0, 52) ?? '(짝 없음)'}`);
    }
  }

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 넣으려면 --apply 를 붙이세요.');
    return;
  }

  initReadingStore();

  // 되돌릴 길을 먼저 만든다 — app.sqlite 에는 순서표·템플릿도 함께 있다
  const snapshot = snapshotDatabases('before-kyodoc');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);

  const beforeNew = countReadings(BOOK);
  const beforeOld = countReadings('hymn_old');
  const written = upsertReadings(readings, path.basename(file), BOOK);
  const afterNew = countReadings(BOOK);

  console.log(`\n넣었습니다: ${written}편 (${READING_BOOK_LABELS[BOOK]} ${beforeNew} → ${afterNew})`);

  // 되살려 대조한다 — 저장이 잘못되면 예배 중에 알게 된다
  const saved = listReadings(BOOK);
  const savedLines = saved.reduce((sum, reading) => sum + reading.lines.length, 0);
  console.log(
    saved.length === readings.length && savedLines === totalLines
      ? `확인: ${saved.length}편 · 줄 ${savedLines}개를 다시 읽었습니다`
      : `⚠ 다시 읽은 결과가 다릅니다 (${saved.length}편 · 줄 ${savedLines})`,
  );

  // 통일찬송가 것을 건드리지 않았는지 — 이 스크립트가 지켜야 하는 경계다
  const afterOld = countReadings('hymn_old');
  console.log(
    afterOld === beforeOld
      ? `확인: ${READING_BOOK_LABELS.hymn_old} ${afterOld}편은 그대로입니다`
      : `⚠ ${READING_BOOK_LABELS.hymn_old} 이 ${beforeOld} → ${afterOld} 로 바뀌었습니다`,
  );
}

main();

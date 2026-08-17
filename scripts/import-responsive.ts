/**
 * 교독문 가져오기 — `~/Desktop/Data/교독문_*.txt` → `data/app.sqlite`
 *
 * ```
 * node scripts/import-responsive.ts                    # 미리보기 (아무것도 쓰지 않는다)
 * node scripts/import-responsive.ts --apply            # 실제로 넣는다
 * node scripts/import-responsive.ts --file <경로>      # 다른 파일
 * ```
 *
 * ## 원본은 읽기만 한다
 *
 * `~/Desktop/Data/` 는 사용자가 모으는 자료 폴더다. **여기에 쓰지 않는다.**
 * 성경 DB·찬양곡집과 같은 규칙이다.
 *
 * ## 미리보기가 기본이다
 *
 * `--apply` 를 붙이지 않으면 무엇이 들어갈지만 보여 준다. 76편이 한 번에 들어가는
 * 작업이라, 파서가 잘못 잘랐을 때 눈으로 먼저 봐야 한다.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { parseResponsiveReadings, readingSlides } from '../lib/responsive-parser.ts';
import { countReadings, initReadingStore, listReadings, upsertReadings } from '../server/db/readings.ts';

const DEFAULT_FILE = path.join(homedir(), 'Desktop/Data/교독문_개역개정.txt');

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

  const { readings, problems } = parseResponsiveReadings(readFileSync(file, 'utf8'));

  console.log(`원본: ${file}`);
  console.log(`읽은 교독문: ${readings.length}편`);

  if (problems.length > 0) {
    console.log('\n⚠ 파일에서 발견한 문제 (조용히 넘기지 않습니다)');
    for (const problem of problems) console.log(`  - ${problem}`);
  }

  if (readings.length === 0) {
    console.error('\n넣을 것이 없습니다. 파일 모양을 확인하세요 (제목은 들여쓰기 + "번호. 제목").');
    process.exit(1);
  }

  // 번호가 이어지는지 — 76편 중 하나가 조용히 빠지면 그 주에 알게 된다
  const numbers = readings.map((r) => r.number);
  const missing: number[] = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n += 1) {
    if (!numbers.includes(n)) missing.push(n);
  }

  const totalLines = readings.reduce((sum, r) => sum + r.lines.length, 0);
  const totalSlides = readings.reduce((sum, r) => sum + readingSlides(r.lines).length, 0);
  const withClosing = readings.filter((r) => r.lines.length % 2 === 1).length;

  console.log(`\n번호 ${Math.min(...numbers)}~${Math.max(...numbers)} · 빠진 번호 ${missing.length > 0 ? missing.join(',') : '없음'}`);
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
  const before = countReadings();
  const written = upsertReadings(readings, path.basename(file));
  const after = countReadings();

  console.log(`\n넣었습니다: ${written}편 (DB ${before} → ${after})`);

  // 되살려 대조한다 — 저장이 잘못되면 예배 중에 알게 된다
  const saved = listReadings();
  const savedLines = saved.reduce((sum, r) => sum + r.lines.length, 0);
  const ok = saved.length === after && savedLines >= totalLines;
  console.log(ok ? `확인: ${saved.length}편 · 줄 ${savedLines}개를 다시 읽었습니다` : '⚠ 다시 읽은 결과가 다릅니다');
}

main();

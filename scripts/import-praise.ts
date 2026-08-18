/**
 * 복음성가집 가져오기 — `~/Desktop/Data/Praise/<곡집>/` → `data/songs.sqlite`
 *
 * ```
 * node scripts/import-praise.ts                    # 미리보기 (아무것도 쓰지 않는다)
 * node scripts/import-praise.ts --apply            # 실제로 넣는다
 * node scripts/import-praise.ts --apply --replace  # 이미 넣은 것을 지우고 다시
 * node scripts/import-praise.ts --book 시와찬미     # 한 곡집만
 * ```
 *
 * ## 원본은 읽기만 한다
 *
 * `~/Desktop/Data/Praise` 는 사용자가 모으는 자료 폴더다. **여기에 쓰지 않는다.**
 * 성경 DB·교독문과 같은 규칙이다.
 *
 * ## 넣기 전에 스냅샷을 뜬다
 *
 * `data/songs.sqlite` 에는 사용자가 직접 손보고 **승인한 가사**가 들어 있고 git 에 없다
 * (협업 규칙 0.2). 3,000곡을 한 번에 넣는 작업이라 되돌릴 길을 먼저 만든다.
 *
 * ## 넣는 가사는 'auto' 다
 *
 * `lines_source = 'auto'` 로 넣는다. 그래야 '검토' 탭에 올라와 사람이 확인할 수 있고,
 * 나중에 사람이 손본 곡은 자동 작업에서 빠진다.
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

import { parsePraiseSong, type ParsedPraiseSong } from '../lib/praise-parser.ts';
import * as songbooks from '../server/db/songbooks.ts';
import * as songs from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';
import { paths } from '../server/paths.ts';

/** 가져올 곡집 — 폴더 이름과 DB 설정. 여기 없는 폴더는 건드리지 않는다. */
const BOOKS: ReadonlyArray<{
  folder: string;
  id: string;
  name: string;
  shortLabel: string;
  /** CP949 로 저장된 곡집이 있다 (실측: 많은물소리·시와찬미) */
  encoding: string;
  /** 1~4. 새찬송가=1 · 통일찬송가=2 · 기타=4 를 이미 쓰므로 3 만 비어 있다 */
  quickSlot?: number;
}> = [
  { folder: '많은물소리', id: 'many_waters', name: '많은물소리', shortLabel: '물', encoding: 'windows-949' },
  { folder: '시와찬미', id: 'psalm_praise', name: '시와찬미', shortLabel: '시', encoding: 'windows-949' },
  {
    folder: '찬미예수 2000',
    id: 'chanmi2000',
    name: '찬미예수 2000',
    shortLabel: '찬',
    encoding: 'utf-8',
    // 2,062곡으로 가장 크다 — 비어 있는 하나뿐인 슬롯을 여기 준다
    quickSlot: 3,
  },
];

const SOURCE_ROOT = process.env.SERMON_PRAISE_DIR ?? path.join(homedir(), 'Desktop/Data/Praise');

interface BookReport {
  book: (typeof BOOKS)[number];
  parsed: ParsedPraiseSong[];
  /** 읽지 못한 파일 — 조용히 넘기지 않는다 */
  skipped: string[];
  /** 서로 다른 곡이 같은 번호를 쓰는 경우 (원본 수집 오류) */
  duplicates: Array<{ number: number; titles: string[] }>;
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readBook(book: (typeof BOOKS)[number]): BookReport | undefined {
  const dir = path.join(SOURCE_ROOT, book.folder);
  if (!existsSync(dir)) {
    console.error(`폴더가 없습니다: ${dir}`);
    return undefined;
  }

  const parsed: ParsedPraiseSong[] = [];
  const skipped: string[] = [];
  const byNumber = new Map<number, string[]>();

  for (const entry of readdirSync(dir).sort()) {
    if (!entry.toLowerCase().endsWith('.txt')) continue;
    const full = path.join(dir, entry);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      skipped.push(`${entry} (읽을 수 없음)`);
      continue;
    }

    const stem = entry.replace(/\.txt$/i, '');
    let body: string;
    try {
      body = new TextDecoder(book.encoding).decode(readFileSync(full));
    } catch (err) {
      skipped.push(`${entry} (${book.encoding} 로 읽지 못함)`);
      continue;
    }

    const song = parsePraiseSong(stem, body);
    if (!song) {
      skipped.push(`${entry} (이름이나 본문을 해석하지 못함)`);
      continue;
    }
    parsed.push(song);
    byNumber.set(song.number, [...(byNumber.get(song.number) ?? []), song.title]);
  }

  const duplicates = [...byNumber.entries()]
    .filter(([, titles]) => titles.length > 1)
    .map(([number, titles]) => ({ number, titles }))
    .sort((a, b) => a.number - b.number);

  return { book, parsed, skipped, duplicates };
}

function describe(report: BookReport): void {
  const { book, parsed, skipped, duplicates } = report;
  const lines = parsed.reduce((sum, s) => sum + s.sections.reduce((a, x) => a + x.lines.length, 0), 0);
  const multi = parsed.filter((s) => s.sections.length > 1).length;
  const chorus = parsed.filter((s) => s.sections.some((x) => x.kind === 'chorus')).length;
  const numbers = parsed.map((s) => s.number);

  console.log(`\n■ ${book.name} (${book.folder})`);
  console.log(`   곡 ${parsed.length} · 줄 ${lines} · 절이 둘 이상인 곡 ${multi} · 후렴 있는 곡 ${chorus}`);
  if (numbers.length > 0) {
    console.log(`   번호 ${Math.min(...numbers)}~${Math.max(...numbers)}`);
  }
  if (duplicates.length > 0) {
    console.log(`   ⚠ 같은 번호를 쓰는 다른 곡 ${duplicates.length}건 — 원본 파일 이름을 고쳐야 합니다`);
    for (const dup of duplicates.slice(0, 5)) {
      console.log(`       ${dup.number}번: ${dup.titles.join(' / ')}`);
    }
    if (duplicates.length > 5) console.log(`       ... 그 밖 ${duplicates.length - 5}건`);
  }
  if (skipped.length > 0) {
    console.log(`   ⚠ 건너뛴 파일 ${skipped.length}개`);
    for (const s of skipped.slice(0, 5)) console.log(`       ${s}`);
  }

  const sample = parsed[0];
  if (sample) {
    console.log(`   예시 — ${sample.number}. ${sample.title}`);
    for (const section of sample.sections.slice(0, 2)) {
      console.log(`       [${section.label}] ${section.lines[0]?.text.slice(0, 34) ?? ''}`);
    }
  }
}

/** 리포트를 파일로 남긴다 — 중복 번호는 사람이 원본을 고쳐야 하므로 목록이 필요하다 */
function writeReport(reports: BookReport[]): string {
  mkdirSync(paths.reportsDir, { recursive: true });
  const out = path.join(paths.reportsDir, 'praise-import.md');

  const body = [
    '# 복음성가집 가져오기 리포트',
    '',
    `원본: \`${SOURCE_ROOT}\``,
    '',
    ...reports.flatMap((r) => {
      const lines = r.parsed.reduce((sum, s) => sum + s.sections.reduce((a, x) => a + x.lines.length, 0), 0);
      return [
        `## ${r.book.name}`,
        '',
        `- 곡 ${r.parsed.length}개 · 줄 ${lines}개`,
        `- 인코딩 \`${r.book.encoding}\``,
        '',
        ...(r.duplicates.length > 0
          ? [
              `### 같은 번호를 쓰는 다른 곡 (${r.duplicates.length}건)`,
              '',
              '원본 파일 이름을 고쳐야 합니다. 번호로 찾을 때 둘이 함께 나옵니다.',
              '',
              ...r.duplicates.map((d) => `- **${d.number}번**: ${d.titles.join(' / ')}`),
              '',
            ]
          : ['같은 번호를 쓰는 곡 없음.', '']),
        ...(r.skipped.length > 0
          ? [`### 건너뛴 파일 (${r.skipped.length})`, '', ...r.skipped.map((s) => `- ${s}`), '']
          : []),
      ];
    }),
  ].join('\n');

  writeFileSync(out, body, 'utf8');
  return out;
}

function applyBook(report: BookReport, replace: boolean): void {
  const { book, parsed } = report;
  const source = `praise:${book.id}`;
  const db = songs.conn();

  // 곡집이 없으면 만든다
  if (!songbooks.getSongbook(db, book.id)) {
    songbooks.createSongbook(db, {
      id: book.id,
      name: book.name,
      shortLabel: book.shortLabel,
      numbered: true,
      ...(book.quickSlot !== undefined ? { quickSlot: book.quickSlot } : {}),
      sourceNote: `${book.folder} (${parsed.length}곡)`,
    });
    console.log(`   곡집을 만들었습니다: ${book.name}`);
  }

  const existing = songs.countSongs(book.id);
  if (existing > 0) {
    if (!replace) {
      console.log(`   이미 ${existing}곡이 있습니다 — 건너뜁니다. 다시 넣으려면 --replace 를 쓰세요.`);
      return;
    }
    const removed = songs.deleteBySource(source);
    console.log(`   이전에 넣은 ${removed}곡을 지웠습니다`);
  }

  let added = 0;
  for (const song of parsed) {
    songs.createSong({
      title: song.title,
      sections: song.sections,
      entries: [{ songbookId: book.id, number: song.number }],
      source,
      // 자동으로 나눈 결과다 — '검토' 탭에 올라와 사람이 확인한다
      linesSource: 'auto',
    });
    added += 1;
  }
  songbooks.markImported(db, book.id, `${book.folder} · ${added}곡`);
  console.log(`   넣었습니다: ${added}곡`);
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const replace = process.argv.includes('--replace');
  const only = argValue('--book');

  const targets = only ? BOOKS.filter((b) => b.folder === only || b.id === only) : BOOKS;
  if (targets.length === 0) {
    console.error(`모르는 곡집: ${only}\n고를 수 있는 것: ${BOOKS.map((b) => b.folder).join(' / ')}`);
    process.exit(1);
  }

  console.log(`원본: ${SOURCE_ROOT}`);
  console.log('※ 원본 폴더는 읽기만 합니다.');
  // '악보' 폴더는 그림이라 가사가 없다 — 목록에 두지 않아 실수로 읽지 않는다
  console.log('※ 악보 폴더(찬미예수 2000 악보)는 가져오지 않습니다.');

  const reports: BookReport[] = [];
  for (const book of targets) {
    const report = readBook(book);
    if (report) {
      reports.push(report);
      describe(report);
    }
  }

  if (reports.length === 0) {
    console.error('\n읽을 곡집이 없습니다.');
    process.exit(1);
  }

  const total = reports.reduce((sum, r) => sum + r.parsed.length, 0);
  const dupTotal = reports.reduce((sum, r) => sum + r.duplicates.length, 0);
  console.log(`\n합계: ${total}곡 · 같은 번호 충돌 ${dupTotal}건`);

  const reportPath = writeReport(reports);
  console.log(`리포트: ${reportPath}`);

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 넣으려면 --apply 를 붙이세요.');
    return;
  }

  // 되돌릴 길을 먼저 만든다 (협업 규칙 0.2 — 승인한 가사가 DB 에만 있다)
  const snapshot = snapshotDatabases('before-praise-import');
  console.log(`\n백업: ${snapshot.files.length}개`);
  for (const file of snapshot.files) console.log(`   ${file}`);

  songs.initSongsDb();
  for (const report of reports) {
    console.log(`\n■ ${report.book.name}`);
    applyBook(report, replace);
  }

  console.log(`\n마친 뒤 곡 수: ${songs.countSongs()}`);
  for (const report of reports) {
    console.log(`   ${report.book.name}: ${songs.countSongs(report.book.id)}곡`);
  }
}

main();

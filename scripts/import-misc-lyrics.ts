/**
 * '기타' 곡집에 곡을 넣는다 — 우리 반입 형식 폴더 → `data/songs.sqlite`
 *
 * ```
 * npm run misc:import -- --dir <폴더>            # 미리보기 (아무것도 쓰지 않는다)
 * npm run misc:import -- --dir <폴더> --apply    # 실제로 넣는다
 * npm run misc:import -- --dir <폴더> --only ok  # 상태가 ok 인 것만
 * ```
 *
 * ## 폴더 형식
 *
 * `제목 - 번호.txt` 파일들과 `_titles.tsv` 한 개.
 *
 * ```
 * file                              ko                  en           state
 * 모든 능력과 모든 권세 - 001.txt      모든 능력과 모든 권세   Above all    ok
 * ```
 *
 * 파일 안은 앱의 가사 형식이다 — `[1절]` 로 절을 나누고 `|` 로 번역을 붙인다.
 * `parseLyrics` 가 그대로 읽는다.
 *
 * ## 이미 있는 제목은 넣지 않는다
 *
 * 같은 제목이 '기타' 곡집에 있으면 건너뛴다. **두 번 돌려도 곡이 겹치지 않는다.**
 * 다른 곡집(찬미예수·시와찬미 등)에 같은 제목이 있는 것은 상관없다 — 이 자료는
 * 한/영 병기라 따로 두기로 했다 (2026-08-29 사용자 결정).
 *
 * ## `lines_source` 는 'imported'
 *
 * 원본 자료의 줄나눔을 가져온 것이다. `manual` 은 **사람이 앱에서 승인 버튼을 누른**
 * 표시이므로 일괄 반입이 찍으면 안 된다 (2026-08-28 에 새찬송가에서 그래서 보호
 * 규칙이 헛돌았다). `imported` 도 자동 작업에서는 똑같이 보호된다.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parseLyrics } from '../lib/lyrics-parser.ts';
import * as songs from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';

const SONGBOOK_ID = 'misc';

interface Row {
  file: string;
  ko: string;
  en: string;
  state: string;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function readTitles(dir: string): Row[] {
  const tsv = path.join(dir, '_titles.tsv');
  if (!existsSync(tsv)) {
    console.error(`❌ ${tsv} 가 없습니다. 곡마다 한국어·영어 제목이 필요합니다.`);
    process.exit(1);
  }
  return readFileSync(tsv, 'utf8')
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const [file, ko, en, state] = l.split('\t');
      return { file: file ?? '', ko: (ko ?? '').trim(), en: (en ?? '').trim(), state: (state ?? '').trim() };
    });
}

interface Plan {
  row: Row;
  sections: songs.SongInput['sections'];
  koLines: number;
  enLines: number;
}

function main(): void {
  const dir = argValue('--dir');
  if (dir === undefined || !existsSync(dir)) {
    console.error('❌ --dir <폴더> 가 필요합니다.');
    process.exit(1);
  }
  const apply = process.argv.includes('--apply');
  const only = argValue('--only');

  songs.initSongsDb();

  const rows = readTitles(dir).filter((r) => (only ? r.state === only : true));
  const existing = new Set(
    songs
      .listSongIds(SONGBOOK_ID)
      .map((id) => songs.normalizeTitle(songs.getSong(id)?.title ?? ''))
      .filter((t) => t.length > 0),
  );

  const plans: Plan[] = [];
  const skippedExisting: string[] = [];
  const skippedEmpty: string[] = [];
  /** 줄이 사라져 넣지 않은 곡 */
  const dropped: string[] = [];

  for (const row of rows) {
    if (existing.has(songs.normalizeTitle(row.ko))) {
      skippedExisting.push(row.ko);
      continue;
    }
    const full = path.join(dir, row.file);
    if (!existsSync(full)) {
      skippedEmpty.push(`${row.ko} (파일 없음)`);
      continue;
    }
    const raw = readFileSync(full, 'utf8');
    const parsed = parseLyrics(raw);
    const sections = parsed.filter((s) => s.lines.length > 0);
    if (sections.length === 0) {
      skippedEmpty.push(`${row.ko} (가사가 비었음)`);
      continue;
    }

    /*
     * **읽은 줄 수가 파일의 줄 수와 같은지 본다.**
     *
     * `|` 줄이 한국어 없이 잇달으면 파서가 같은 줄 번호로 보고 앞엣것을 버린다
     * (같은 `(섹션, 줄번호, 언어)` 는 하나만 남는다). 그러면 **가사가 조용히
     * 사라진다** — 2026-08-29 에 5곡에서 영어 14줄을 그렇게 잃었다.
     * 조용히 넘어가지 않고 그 곡을 통째로 건너뛴다.
     */
    const fileEn = raw.split(/\r?\n/).filter((l) => l.startsWith('|')).length;
    const parsedEn = sections.reduce((n, sec) => n + sec.lines.filter((l) => l.lang !== 'ko').length, 0);
    if (fileEn !== parsedEn) {
      dropped.push(`${row.ko} — 파일에 ${fileEn}줄, 읽힌 것은 ${parsedEn}줄 (한국어 없는 | 줄이 뭉개졌습니다)`);
      continue;
    }
    plans.push({
      row,
      sections,
      koLines: sections.reduce((n, s) => n + s.lines.filter((l) => l.lang === 'ko').length, 0),
      enLines: sections.reduce((n, s) => n + s.lines.filter((l) => l.lang === 'en').length, 0),
    });
  }

  console.log(`곡집 '기타'(${SONGBOOK_ID}) 에 넣을 곡: ${plans.length}곡`);
  console.log(
    `  절 ${plans.reduce((n, p) => n + p.sections.length, 0)}개 · 한국어 ${plans.reduce((n, p) => n + p.koLines, 0)}줄 · 영어 ${plans.reduce((n, p) => n + p.enLines, 0)}줄`,
  );
  if (skippedExisting.length > 0) {
    console.log(`\n이미 있어 건너뛴 곡 ${skippedExisting.length}개: ${skippedExisting.slice(0, 6).join(' · ')}`);
  }
  if (skippedEmpty.length > 0) {
    console.log(`\n⚠ 가사를 읽지 못한 곡 ${skippedEmpty.length}개:`);
    for (const s of skippedEmpty.slice(0, 8)) console.log(`   ${s}`);
  }
  if (dropped.length > 0) {
    console.log(`\n⚠ 줄이 사라져 넣지 않은 곡 ${dropped.length}개:`);
    for (const s of dropped) console.log(`   ${s}`);
  }

  /* 한국어 없이 영어만 있는 절은 알린다 — 예배 화면에 영어만 나간다 */
  const enOnly = plans.flatMap((p) =>
    p.sections
      .filter((s) => s.lines.every((l) => l.lang !== 'ko'))
      .map((s) => `${p.row.ko} [${s.label}]`),
  );
  if (enOnly.length > 0) {
    console.log(`\n한국어 없이 영어만 있는 절 ${enOnly.length}개 (악보에 영어 절이 더 많은 곡):`);
    for (const s of enOnly.slice(0, 8)) console.log(`   ${s}`);
  }

  if (plans.length === 0) {
    console.log('\n넣을 것이 없습니다.');
    return;
  }

  console.log('\n표본 (앞 5곡):');
  for (const p of plans.slice(0, 5)) {
    console.log(`  ${p.row.ko}  (${p.row.en})  절 ${p.sections.length} · 한 ${p.koLines} · 영 ${p.enLines}`);
  }

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 넣으려면 --apply 를 붙이세요.');
    return;
  }

  const snapshot = snapshotDatabases('before-misc-import');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);
  if (snapshot.sameDevice) {
    console.log('  ⚠️ 백업이 원본과 같은 디스크에 있습니다 (SERMON_BACKUP_DIR 로 옮길 수 있습니다).');
  }

  const madeIds: number[] = [];
  for (const p of plans) {
    // entries 를 비우면 '기타' 곡집에 번호 없이 들어간다
    madeIds.push(
      songs.createSong({
        title: p.row.ko,
        ...(p.row.en ? { titleAlt: p.row.en } : {}),
        source: 'hanyoung-score',
        sections: p.sections,
        linesSource: 'imported',
      }),
    );
  }
  console.log(`\n넣었습니다: ${madeIds.length}곡 (lines_source = imported)`);

  // 되살려 대조한다 — 줄 수까지 본다
  let ok = 0;
  const wrong: string[] = [];
  for (const [i, p] of plans.entries()) {
    const got = songs.getSong(madeIds[i]!);
    const ko = got?.sections.reduce((n, s) => n + s.lines.filter((l) => l.lang === 'ko').length, 0) ?? -1;
    const en = got?.sections.reduce((n, s) => n + s.lines.filter((l) => l.lang === 'en').length, 0) ?? -1;
    if (got?.title === p.row.ko && ko === p.koLines && en === p.enLines) ok += 1;
    else wrong.push(`${p.row.ko} — 한 ${ko}/${p.koLines} · 영 ${en}/${p.enLines}`);
  }
  console.log(
    wrong.length === 0
      ? `확인: ${ok}곡을 다시 읽었고 제목·줄 수가 그대로입니다`
      : `⚠ 다시 읽은 결과가 다릅니다 (${ok}/${plans.length}):\n  ${wrong.slice(0, 5).join('\n  ')}`,
  );
}

if (!existsSync('data')) {
  console.error(`data 폴더가 없습니다. 저장소 뿌리에서 실행하세요. (지금: ${path.resolve('.')})`);
  process.exit(1);
}
main();

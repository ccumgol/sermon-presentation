/**
 * 번역 가사 반입 — `<폴더>/언어/곡집/번호.txt` → `data/songs.sqlite`
 *
 * ```
 * node scripts/import-lyrics-lang.ts --dir ~/Desktop/Data/Lyrics            # 미리보기
 * node scripts/import-lyrics-lang.ts --dir ~/Desktop/Data/Lyrics --apply    # 실제로 넣는다
 * node scripts/import-lyrics-lang.ts --dir <경로> --lang en                 # 한 언어만
 * node scripts/import-lyrics-lang.ts --dir <경로> --book hymn_new           # 한 곡집만
 * ```
 *
 * ## 이미 있는 곡에 **번역만** 더한다
 *
 * 곡을 만들지 않는다. `(곡집, 번호)` 로 찾아 그 곡의 해당 언어 줄만 갈아 끼운다.
 * 찾지 못하면 건너뛰고 알린다 — 짐작해서 새 곡을 만들면 같은 곡이 둘이 된다.
 *
 * ## 건드리지 않는 것
 *
 * - **한국어.** 폴더 규약이 `ko` 를 받지 않는다 (`lib/lang-folder.ts`). 사람이 승인한
 *   가사를 파일로 덮어쓰는 길을 아예 두지 않는다.
 * - **다른 번역.** 영어를 넣을 때 中文 은 그대로 둔다.
 * - **`lines_source`.** `replaceSectionLines` 로 줄만 바꾸므로 승인 표시가 유지된다.
 *   번역을 넣었다고 사람이 확인한 한국어가 '자동' 으로 내려가서는 안 된다.
 *
 * ## 미리보기가 기본이다
 *
 * 수백 곡이 한 번에 바뀌는 작업이다. 줄 수가 어긋난 곡이 있으면 **어느 절 몇 줄인지**
 * 먼저 보여 준다 — 찬양에는 성경의 `장:절` 같은 기준이 없어 기계가 맞출 수 없다.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { IMPORTABLE_LANGS, parseLangFolderPath } from '../lib/lang-folder.ts';
import { formatLyrics, parseLyrics } from '../lib/lyrics-parser.ts';
import { mergeSecondaryLyrics } from '../lib/lyrics-merge.ts';
import * as songs from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';
import type { LangCode, Song } from '../shared/types.ts';

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** `~` 를 집 경로로 — 손으로 치는 경로에 흔하다 */
function expand(dir: string): string {
  return dir.startsWith('~') ? path.join(process.env.HOME ?? '', dir.slice(1)) : dir;
}

interface Found {
  file: string;
  lang: LangCode;
  songbookId: string;
  number: number;
  text: string;
}

/** 폴더를 훑어 규약에 맞는 파일만 모은다 */
function collect(root: string): { files: Found[]; skipped: string[] } {
  const files: Found[] = [];
  const skipped: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      // 맥이 만드는 것들 — 없는 파일로 알리면 목록이 지저분해진다
      if (entry.startsWith('.')) continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const parsed = parseLangFolderPath(path.relative(root, full));
      if (!parsed) {
        skipped.push(path.relative(root, full));
        continue;
      }
      files.push({ file: path.relative(root, full), text: readFileSync(full, 'utf8'), ...parsed });
    }
  };

  walk(root);
  files.sort((a, b) => a.file.localeCompare(b.file));
  return { files, skipped };
}

interface Plan {
  found: Found;
  song: Song;
  /** 넣을 글 (`|` 형식) */
  text: string;
  paired: number;
  replaced: number;
  problems: string[];
  dropped: string[];
}

/** 한 파일을 그 곡에 어떻게 넣을지 계산한다. **아무것도 쓰지 않는다.** */
function planOne(found: Found): { plan?: Plan; error?: string } {
  const matches = songs.findByEntry(found.songbookId, found.number);

  if (matches.length === 0) {
    return { error: `${found.file}: 곡을 찾지 못했습니다 (${found.songbookId} ${found.number}번)` };
  }
  if (matches.length > 1) {
    // 조용히 첫 곡을 고르면 엉뚱한 곡에 번역이 들어간다 — 예배 화면에서야 드러난다
    return {
      error:
        `${found.file}: 같은 번호의 곡이 ${matches.length}개입니다 ` +
        `(${matches.map((s) => `id ${s.id} '${s.title}'`).join(', ')}) — 사람이 골라야 합니다`,
    };
  }

  const song = matches[0]!;
  const current = formatLyrics(song.sections);
  const merged = mergeSecondaryLyrics(current, found.text, found.lang);

  if (merged.paired === 0) {
    return { error: `${found.file}: 짝지을 줄이 없습니다 (곡 id ${song.id} '${song.title}')` };
  }

  return {
    plan: {
      found,
      song,
      text: merged.text,
      paired: merged.paired,
      replaced: merged.replaced,
      problems: merged.problems,
      dropped: merged.dropped,
    },
  };
}

/**
 * 계산한 글을 실제로 쓴다.
 *
 * **섹션의 줄만 바꾼다** (`replaceSectionLines`). `replaceSections` 는 섹션을 지우고
 * 다시 만들어 `lines_source` 가 한 값으로 뭉개지는데, 그러면 사람이 승인한 한국어가
 * '자동' 으로 내려간다.
 *
 * 파일에 없는 섹션은 건드리지 않는다 — 3절만 번역했으면 1·2절은 그대로다.
 */
function writeOne(plan: Plan): number {
  const next = parseLyrics(plan.text);
  let touched = 0;

  for (const section of plan.song.sections) {
    const parsed = next.find((candidate) => candidate.label === section.label);
    if (!parsed) continue;

    const before = JSON.stringify(
      [...section.lines].sort((a, b) => a.lineIndex - b.lineIndex || a.lang.localeCompare(b.lang)),
    );
    const after = JSON.stringify(
      [...parsed.lines].sort((a, b) => a.lineIndex - b.lineIndex || a.lang.localeCompare(b.lang)),
    );
    // 바뀐 것이 없으면 쓰지 않는다 — updated_at 만 흔들 이유가 없다
    if (before === after) continue;

    songs.replaceSectionLines(section.id, parsed.lines);
    touched++;
  }

  return touched;
}

function main(): void {
  const apply = process.argv.includes('--apply');
  const dirArg = argValue('--dir');
  const onlyLang = argValue('--lang');
  const onlyBook = argValue('--book');

  if (!dirArg) {
    console.error('폴더를 지정하세요: --dir <경로>');
    console.error('폴더 구조: <경로>/언어/곡집/번호.txt  (예: en/hymn_new/305.txt)');
    console.error(`넣을 수 있는 언어: ${IMPORTABLE_LANGS.join(', ')} (한국어는 받지 않습니다)`);
    process.exit(1);
  }

  const root = expand(dirArg);
  if (!existsSync(root)) {
    console.error(`폴더가 없습니다: ${root}`);
    process.exit(1);
  }

  const { files, skipped } = collect(root);
  const targets = files.filter(
    (f) => (!onlyLang || f.lang === onlyLang) && (!onlyBook || f.songbookId === onlyBook),
  );

  console.log(`폴더: ${root}`);
  console.log(`규약에 맞는 파일 ${files.length}개 · 이번에 볼 것 ${targets.length}개`);
  if (skipped.length > 0) {
    console.log(`\n규약에 맞지 않아 건너뛴 파일 ${skipped.length}개 (언어/곡집/번호.txt 여야 합니다):`);
    for (const file of skipped.slice(0, 10)) console.log(`  - ${file}`);
    if (skipped.length > 10) console.log(`  … 그리고 ${skipped.length - 10}개`);
  }

  if (targets.length === 0) {
    console.log('\n넣을 것이 없습니다.');
    return;
  }

  const plans: Plan[] = [];
  const errors: string[] = [];
  for (const found of targets) {
    const result = planOne(found);
    if (result.plan) plans.push(result.plan);
    if (result.error) errors.push(result.error);
  }

  console.log(`\n넣을 수 있는 곡 ${plans.length}개`);
  const byLang = new Map<LangCode, number>();
  for (const plan of plans) byLang.set(plan.found.lang, (byLang.get(plan.found.lang) ?? 0) + 1);
  for (const [lang, count] of byLang) console.log(`  ${lang}: ${count}곡`);

  console.log('\n처음 다섯 곡:');
  for (const plan of plans.slice(0, 5)) {
    console.log(
      `  ${plan.found.file} → id ${plan.song.id} '${plan.song.title}' ` +
        `(${plan.paired}줄 짝지음${plan.replaced > 0 ? ` · 기존 ${plan.replaced}줄 갈아끼움` : ''})`,
    );
  }

  const withProblems = plans.filter((plan) => plan.problems.length > 0);
  if (withProblems.length > 0) {
    console.log(`\n⚠ 줄 수가 어긋난 곡 ${withProblems.length}개 (넣기는 하지만 확인하세요):`);
    for (const plan of withProblems.slice(0, 10)) {
      console.log(`  ${plan.found.file} — id ${plan.song.id} '${plan.song.title}'`);
      for (const problem of plan.problems) console.log(`      ${problem}`);
    }
    if (withProblems.length > 10) console.log(`  … 그리고 ${withProblems.length - 10}곡`);
  }

  if (errors.length > 0) {
    console.log(`\n넣지 못한 파일 ${errors.length}개:`);
    for (const error of errors.slice(0, 15)) console.log(`  - ${error}`);
    if (errors.length > 15) console.log(`  … 그리고 ${errors.length - 15}개`);
  }

  if (!apply) {
    console.log('\n미리보기입니다. 실제로 넣으려면 --apply 를 붙이세요.');
    return;
  }

  // 되돌릴 길을 먼저 만든다 — 수백 곡이 한 번에 바뀌고 songs.sqlite 는 git 에 없다
  const snapshot = snapshotDatabases('before-lyrics-lang');
  console.log(`\n스냅샷(${snapshot.stamp}): ${snapshot.files.length}개 파일`);
  for (const file of snapshot.files) console.log(`  ${file}`);

  let touchedSongs = 0;
  let touchedSections = 0;
  for (const plan of plans) {
    const sections = writeOne(plan);
    if (sections > 0) {
      touchedSongs++;
      touchedSections += sections;
    }
  }

  console.log(`넣었습니다: 곡 ${touchedSongs}개 · 절 ${touchedSections}개`);

  // 되살려 대조한다 — 넣다 놓친 것이 있으면 예배 중에 알게 된다
  const langs = [...byLang.keys()];
  for (const lang of langs) {
    const count = plans.filter((plan) => plan.found.lang === lang).length;
    const have = plans.filter((plan) => {
      const again = songs.getSong(plan.song.id);
      return again?.sections.some((section) => section.lines.some((line) => line.lang === lang));
    }).length;
    console.log(
      have === count
        ? `확인: ${lang} 가사가 ${have}곡에 들어 있습니다`
        : `⚠ ${lang}: 넣으려던 ${count}곡 중 ${have}곡만 확인됩니다`,
    );
  }
}

main();

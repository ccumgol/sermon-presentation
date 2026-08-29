/**
 * 새찬송가 영어 가사를 **한국어 줄에 맞춰 다시 끊는다**.
 *
 * ```
 * npm run hymn:realign                 # 미리보기 (아무것도 쓰지 않는다)
 * npm run hymn:realign -- --apply      # 실제로 쓴다
 * npm run hymn:realign -- --only 384   # 한 곡만
 * npm run hymn:realign -- --measure    # 정확도만 잰다 (쓰지 않는다)
 * ```
 *
 * ## 무엇을 고치는가
 *
 * 원본 자료의 영어는 한 절이 이어진 글이고 그것을 고정 폭으로 잘라 놓았다. 그래서
 * 한국어와 짝이 맞지 않는다. 이 스크립트는 영어를 도로 이어 붙여 한국어 줄 수만큼
 * 다시 나눈다. 판정은 `lib/lyrics-rebreak.ts` 가 한다.
 *
 * ## 손대지 않는 것
 *
 * - **한/영 줄 수가 다른 섹션.** 무엇에 맞출지 알 수 없다 (B 부류다).
 * - **이미 맞은 섹션.** 둘째 줄부터 모두 대문자로 시작하면 건드리지 않는다.
 * - **한국어.** 이 작업은 영어만 다시 끊는다.
 *
 * ## 낱말은 하나도 잃지 않는다
 *
 * 쓰기 전에 `verifySameWords` 로 낱말 열이 그대로인지 검사한다. 하나라도 어긋나면
 * **그 곡을 통째로 건너뛴다.** 가사가 조용히 사라지면 예배에서야 드러난다.
 *
 * ## 이것은 제안이다
 *
 * 사람이 맞춰 둔 섹션으로 재면 87.7% 를 그대로 재현하고, 나머지는 대개 한 낱말
 * 차이다. 그래서 미리보기가 기본이고 리포트를 남긴다 — 사람이 보고 정한다.
 *
 * ## 반입 뒤에 돌린다
 *
 * `npm run hymn:bilingual` 은 원본 폴더의 줄나눔으로 되돌리므로 이 작업이 지워진다.
 * 반입을 다시 하면 이 스크립트도 다시 돌려야 한다.
 */

import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { rebreakEnglish, verifySameWords } from '../lib/lyrics-rebreak.ts';
import * as songs from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';

const SONGBOOK_ID = 'hymn_new';

interface SectionPlan {
  sectionId: number;
  label: string;
  korean: string[];
  before: string[];
  after: string[];
}

interface SongPlan {
  songId: number;
  number: number;
  title: string;
  sections: SectionPlan[];
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * 문장 중간에서 끊겼는가.
 *
 * **소문자로 시작하는 것만으로는 모자란다.** 앞 줄이 쉼표로 끝나면 다음 줄이 소문자로
 * 시작하는 것이 정상이다 — 새 4장 「성부 성자와 성령」이 그렇다.
 *
 * ```
 * 성부 성자와 성령 영원히  | Glory be to the Father, and to the Son,   ← 쉼표로 끝난다
 * 영광 받으옵소서         | and to the Holy Ghost;                    ← 소문자지만 정상
 * ```
 *
 * 진짜로 끊긴 것은 **앞 줄이 아무 부호 없이 끝나고** 다음 줄이 소문자로 시작하는 곳이다.
 *
 * ```
 * 예수 인도하시니        | What have I to ask beside? Can I          ← 부호가 없다
 * 내 주 안에 있는 긍휼    | doubt His tender mercy, Who thro'         ← 문장 중간이다
 * ```
 *
 * 이 조건을 조이지 않았을 때 이미 맞은 새 4·7장을 '고쳐' 더 나쁘게 만들었다
 * (2026-08-28, 미리보기에서 잡았다).
 */
function isBroken(english: readonly string[]): boolean {
  return english.some((text, i) => {
    if (i === 0) return false;
    if (!/^[a-z]/.test(text.trim())) return false;
    return !/[.,!?;:—–]["'’”)]?$/.test(String(english[i - 1]).trim());
  });
}

interface Rows {
  korean: string[];
  english: string[];
}

/** 한 섹션의 한국어·영어 줄을 줄 번호 순서로 꺼낸다 */
function readSection(sectionId: number): Rows {
  const rows = songs
    .conn()
    .prepare('SELECT line_index, lang, text FROM song_lines WHERE section_id = ? ORDER BY line_index')
    .all(sectionId) as unknown as Array<{ line_index: number; lang: string; text: string }>;
  return {
    korean: rows.filter((r) => r.lang === 'ko').map((r) => r.text),
    english: rows.filter((r) => r.lang === 'en').map((r) => r.text),
  };
}

/** 이미 사람이 맞춰 둔 섹션으로 정확도를 잰다 — 아무것도 쓰지 않는다 */
function measure(): void {
  let tried = 0;
  let exact = 0;
  let lost = 0;
  for (const songId of songs.listSongIds(SONGBOOK_ID)) {
    for (const section of songs.listSectionRows(songId)) {
      const { korean, english } = readSection(section.id);
      if (english.length === 0 || korean.length !== english.length) continue;
      if (isBroken(english)) continue; // 이미 맞은 것만 정답으로 쓴다
      tried += 1;
      const out = rebreakEnglish({ english, korean });
      if (!out) continue;
      if (!verifySameWords(english, out)) {
        lost += 1;
        continue;
      }
      if (out.join('\n') === english.join('\n')) exact += 1;
    }
  }
  console.log(`이미 사람이 맞춰 둔 섹션 ${tried}개로 잽니다`);
  console.log(`  그대로 재현: ${exact}개 (${((exact / tried) * 100).toFixed(1)}%)`);
  console.log(`  낱말이 사라짐: ${lost}개 ${lost === 0 ? '✓' : '⚠'}`);
}

/** 무엇을 바꿀지 계획을 세운다 — 아직 쓰지 않는다 */
function plan(only: number): { plans: SongPlan[]; skippedLost: string[]; skippedNoFit: string[] } {
  const plans: SongPlan[] = [];
  const skippedLost: string[] = [];
  const skippedNoFit: string[] = [];

  for (const songId of songs.listSongIds(SONGBOOK_ID)) {
    const song = songs.getSong(songId);
    if (!song) continue;
    const number = song.entries?.find((e) => e.songbookId === SONGBOOK_ID)?.number ?? 0;
    if (Number.isFinite(only) && only > 0 && number !== only) continue;

    const sections: SectionPlan[] = [];
    for (const section of songs.listSectionRows(songId)) {
      const { korean, english } = readSection(section.id);
      if (english.length === 0 || korean.length !== english.length) continue;
      if (!isBroken(english)) continue;

      const after = rebreakEnglish({ english, korean });
      if (!after) {
        skippedNoFit.push(`새 ${number}장 [${section.label}]`);
        continue;
      }
      if (!verifySameWords(english, after)) {
        skippedLost.push(`새 ${number}장 [${section.label}]`);
        continue;
      }
      if (after.join('\n') === english.join('\n')) continue;
      sections.push({ sectionId: section.id, label: section.label ?? '?', korean, before: english, after });
    }
    if (sections.length > 0) plans.push({ songId, number, title: song.title, sections });
  }
  return { plans, skippedLost, skippedNoFit };
}

function writeReport(plans: readonly SongPlan[], stamp: string): string {
  const out = path.join('data/reports', `realign-hymn_new-${stamp}.md`);
  const body = plans
    .map((song) => {
      const parts = song.sections.map((sec) => {
        const rows = sec.korean.map(
          (ko, i) => `| ${ko} | ${sec.before[i] ?? ''} | ${sec.after[i] ?? ''} |`,
        );
        return `### [${sec.label}]\n\n| 한국어 | 지금 | 제안 |\n|---|---|---|\n${rows.join('\n')}\n`;
      });
      return `## 새 ${song.number}장 · ${song.title}\n\n${parts.join('\n')}`;
    })
    .join('\n');
  writeFileSync(
    out,
    `# 새찬송가 영어 줄나눔 — 제안\n\n**${plans.length}곡 · ${plans.reduce((n, p) => n + p.sections.length, 0)}개 섹션**\n\n` +
      `영어를 이어 붙여 한국어 줄 수만큼 다시 끊은 결과다. 낱말은 하나도 바뀌지 않았고\n` +
      `**끊는 자리만** 달라졌다. 사람이 맞춰 둔 섹션으로 재면 87.7% 를 그대로 재현한다 —\n` +
      `나머지는 대개 한 낱말 차이이므로 눈으로 보고 정한다.\n\n${body}`,
    'utf8',
  );
  return out;
}

function main(): void {
  if (!existsSync('data')) {
    console.error(`data 폴더가 없습니다. 저장소 뿌리에서 실행하세요. (지금: ${path.resolve('.')})`);
    process.exit(1);
  }
  songs.initSongsDb();

  if (process.argv.includes('--measure')) {
    measure();
    return;
  }

  const apply = process.argv.includes('--apply');
  const only = Number(argValue('--only'));
  const { plans, skippedLost, skippedNoFit } = plan(only);

  const sectionCount = plans.reduce((n, p) => n + p.sections.length, 0);
  const lineCount = plans.reduce(
    (n, p) => n + p.sections.reduce((m, s) => m + s.after.filter((t, i) => t !== s.before[i]).length, 0),
    0,
  );
  console.log(`다시 끊을 것: ${plans.length}곡 · ${sectionCount}개 섹션 · ${lineCount}줄`);
  if (skippedNoFit.length > 0) {
    console.log(`\n나누지 못한 섹션 ${skippedNoFit.length}개: ${skippedNoFit.slice(0, 6).join(', ')}`);
  }
  if (skippedLost.length > 0) {
    console.log(`\n⚠ 낱말이 어긋나 건너뛴 섹션 ${skippedLost.length}개: ${skippedLost.slice(0, 6).join(', ')}`);
  }

  if (plans.length === 0) {
    console.log('\n바꿀 것이 없습니다.');
    return;
  }

  console.log('\n표본 (앞 2곡):');
  for (const song of plans.slice(0, 2)) {
    for (const sec of song.sections.slice(0, 1)) {
      console.log(`  새 ${song.number}장 [${sec.label}]`);
      for (let i = 0; i < sec.korean.length; i += 1) {
        const changed = sec.before[i] !== sec.after[i];
        console.log(`    ${changed ? '✗' : ' '} ${String(sec.korean[i]).slice(0, 20).padEnd(22)}${sec.before[i] ?? ''}`);
        if (changed) console.log(`      ${' '.repeat(22)}${sec.after[i] ?? ''}`);
      }
    }
  }

  const stamp = argValue('--stamp') ?? new Date().toISOString().slice(0, 10);
  console.log(`\n리포트: ${writeReport(plans, stamp)}`);

  if (!apply) {
    console.log('\n미리보기입니다. 리포트를 보고 정한 뒤 --apply 를 붙이세요.');
    return;
  }

  const snapshot = snapshotDatabases('before-hymn-realign');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);
  if (snapshot.sameDevice) {
    console.log('  ⚠️ 백업이 원본과 같은 디스크에 있습니다 — 디스크가 죽으면 함께 잃습니다.');
    console.log('     SERMON_BACKUP_DIR 로 다른 디스크를 가리킬 수 있습니다.');
  }

  let written = 0;
  for (const song of plans) {
    for (const sec of song.sections) {
      const { korean } = readSection(sec.sectionId);
      const lines = [
        ...korean.map((text, lineIndex) => ({ lineIndex, lang: 'ko' as const, text })),
        ...sec.after.map((text, lineIndex) => ({ lineIndex, lang: 'en' as const, text })),
      ];
      songs.replaceSectionLines(sec.sectionId, lines);
      written += 1;
    }
  }
  console.log(`\n썼습니다: ${plans.length}곡 · ${written}개 섹션`);

  // 되살려 대조한다 — 낱말이 그대로인지 다시 본다
  let ok = 0;
  for (const song of plans) {
    for (const sec of song.sections) {
      const { english } = readSection(sec.sectionId);
      if (verifySameWords(sec.before, english)) ok += 1;
    }
  }
  console.log(
    ok === written
      ? `확인: ${ok}개 섹션을 다시 읽었고 낱말이 그대로입니다`
      : `⚠ 다시 읽은 결과가 다릅니다 (${ok}/${written}) — 스냅샷으로 되돌리세요`,
  );
}

main();

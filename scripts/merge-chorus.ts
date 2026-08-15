/**
 * 후렴을 각 절 뒤로 되돌린다.
 *
 * **가공을 되돌리는 작업이다.** 원본 찬송가 DB 는 후렴을 각 절 뒤에 인라인으로
 * 반복해 담고 있었고, 가져올 때 `detectRefrain`(절 간 최장 공통 어절 접미사)으로
 * 떼어내 별도 섹션으로 만들었다. 그래서 병합은 새 가공이 아니라 원형 복원이며,
 * 손실이 없다는 것이 구조적으로 보장된다.
 *
 * 왜 되돌리는가 — 두 가지다:
 *
 *  1. **문장이 끊긴다.** 후렴 곡 587곡 중 97곡(17%)은 절이 연결형 어미로 끝나
 *     후렴으로 이어진다. 새48 은 '…찬양하며' + '드리오니 우리 예배 받으소서' 로,
 *     한 서술어가 두 섹션에 쪼개져 있다.
 *  2. **화살표로 순서대로 진행할 수 없다.** 1·2·3·4절 다음에 후렴이 한 번 오는
 *     구조라, 실제 진행(1절→후렴→2절→후렴)과 슬라이드 순서가 다르다.
 *
 * 사용:
 *   npm run chorus:merge              미리보기 (아무것도 쓰지 않는다)
 *   npm run chorus:merge -- --apply
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as store from '../server/db/songs.ts';
import { paths } from '../server/paths.ts';
import type { LangCode, SongLine } from '../shared/types.ts';

interface SectionRow {
  id: number;
  kind: string;
  label: string;
  linesSource: string;
  lines: SongLine[];
}

export interface MergePlan {
  songId: number;
  title: string;
  reference: string;
  /** 절마다 '절 + 후렴' 으로 바뀐 줄 */
  verseUpdates: Array<{ sectionId: number; label: string; lines: SongLine[] }>;
  /** 지울 후렴 섹션 */
  chorusSectionIds: number[];
  /** 절이 연결형 어미로 끝나 후렴과 문장이 이어지는가 (병합이 필수인 곡) */
  continues: boolean;
}

export interface Skipped {
  reference: string;
  title: string;
  reason: string;
}

/** 절이 이런 어미로 끝나면 뒤 문장으로 이어진다 */
const CONTINUING_TAIL = /(의|은|는|을|를|와|과|고|며|서|이|가|도|만|에)$/;

export function isSkipped(value: MergePlan | Skipped): value is Skipped {
  return 'reason' in value;
}

/**
 * 곡 하나의 병합 계획을 세운다 (아직 쓰지 않는다).
 *
 * 계획과 실행을 나눈 이유는 미리보기 때문이다 — 같은 코드가 미리보기와 적용을
 * 만들어야 "미리보기와 결과가 다르다"가 생기지 않는다.
 */
export function planMerge(
  song: ReturnType<typeof store.getSong>,
  sections: readonly SectionRow[],
): MergePlan | Skipped {
  if (!song) return { reference: '?', title: '?', reason: '곡을 찾을 수 없음' };

  const numbered = song.entries.find((entry) => entry.number !== undefined);
  const reference = numbered ? `${numbered.songbookShortLabel}${numbered.number}` : `#${song.id}`;
  const skip = (reason: string): Skipped => ({ reference, title: song.title, reason });

  const choruses = sections.filter((section) => section.kind === 'chorus');
  if (choruses.length === 0) return skip('후렴이 없음');

  const verses = sections.filter((section) => section.kind === 'verse');
  if (verses.length === 0) return skip('절이 없음 — 후렴만 있는 곡');

  // 사람이 손본 곡은 건드리지 않는다 (절·후렴 어느 쪽이든)
  if (sections.some((section) => section.linesSource !== 'auto')) return skip('사람이 확인한 곡');

  // 두 언어가 섞이면 줄 짝(lineIndex)이 깨지므로 손대지 않는다
  const langs = new Set(sections.flatMap((section) => section.lines.map((line) => line.lang)));
  if (langs.size !== 1) return skip('두 언어 이상 — 줄 짝이 깨짐');
  const lang = [...langs][0] as LangCode;

  const chorusLines = choruses.flatMap((section) =>
    [...section.lines].sort((a, b) => a.lineIndex - b.lineIndex).map((line) => line.text),
  );
  if (chorusLines.length === 0) return skip('후렴이 비어 있음');

  const verseUpdates = verses.map((section) => {
    const own = [...section.lines].sort((a, b) => a.lineIndex - b.lineIndex).map((line) => line.text);
    const combined = [...own, ...chorusLines];
    return {
      sectionId: section.id,
      label: section.label,
      lines: combined.map((text, lineIndex) => ({ lineIndex, lang, text })),
    };
  });

  const firstVerseTail = verses[0]!.lines
    .map((line) => line.text)
    .join(' ')
    .trim()
    .split(/\s+/)
    .pop();

  return {
    songId: song.id,
    title: song.title,
    reference,
    verseUpdates,
    chorusSectionIds: choruses.map((section) => section.id),
    continues: firstVerseTail !== undefined && CONTINUING_TAIL.test(firstVerseTail),
  };
}

/** 계획을 실제로 쓴다 — 절을 먼저 채우고 후렴 섹션을 지운다 */
export function applyMerge(plan: MergePlan): void {
  for (const update of plan.verseUpdates) {
    store.replaceSectionLines(update.sectionId, update.lines);
  }
  // 절을 먼저 채운 뒤에 지운다 — 순서가 반대면 중간에 실패했을 때 후렴이 사라진다
  for (const sectionId of plan.chorusSectionIds) {
    store.deleteSection(sectionId);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const bookIndex = args.indexOf('--book');
  const book = bookIndex >= 0 ? args[bookIndex + 1] : undefined;

  store.initSongsDb();

  const plans: MergePlan[] = [];
  const skipped: Skipped[] = [];

  for (const songId of store.listSongIds(book)) {
    const result = planMerge(store.getSong(songId), store.listSectionRows(songId));
    if (isSkipped(result)) skipped.push(result);
    else plans.push(result);
  }

  const mustMerge = plans.filter((plan) => plan.continues);

  process.stdout.write(`\n후렴이 있는 곡: ${plans.length}곡\n`);
  process.stdout.write(`  그중 문장이 이어져 병합이 필수: ${mustMerge.length}곡\n`);
  process.stdout.write(`  건너뜀: ${skipped.length}곡 (${countReasons(skipped)})\n`);

  // 사람이 손본 곡은 이름을 밝힌다 — 자주 쓰는 곡이 조용히 빠지면 예배 중에 발견한다
  const manual = skipped.filter((item) => item.reason === '사람이 확인한 곡');
  if (manual.length > 0) {
    process.stdout.write(
      `\n  ↳ 손본 곡이라 그대로 둔 곡: ${manual.map((item) => `${item.reference} ${item.title}`).join(', ')}\n`,
    );
    process.stdout.write('    병합이 필요하면 가사 편집에서 직접 후렴을 절 뒤에 붙이세요.\n');
  }
  process.stdout.write('\n');

  for (const plan of mustMerge.slice(0, 3)) {
    const first = plan.verseUpdates[0]!;
    process.stdout.write(`── ${plan.reference} ${plan.title}\n`);
    process.stdout.write(`   후: [${first.label}] ${first.lines.map((line) => line.text).join(' / ')}\n`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  mkdirSync(paths.reportsDir, { recursive: true });
  const reportPath = path.join(paths.reportsDir, `chorus-merge-${stamp}.json`);
  writeFileSync(reportPath, JSON.stringify({ applied: apply, plans, skipped }, null, 2));
  process.stdout.write(`\n리포트: ${reportPath}\n`);

  if (!apply) {
    process.stdout.write('\n미리보기입니다. 실제로 바꾸려면 --apply 를 붙이세요.\n');
    return;
  }

  for (const plan of plans) applyMerge(plan);
  process.stdout.write(`\n${plans.length}곡의 후렴을 각 절 뒤로 되돌렸습니다.\n`);
}

function countReasons(skipped: readonly Skipped[]): string {
  const counts = new Map<string, number>();
  for (const item of skipped) counts.set(item.reason, (counts.get(item.reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => `${reason} ${count}`).join(', ');
}

// 테스트에서 import 할 때는 실행하지 않는다
if (import.meta.main) main();

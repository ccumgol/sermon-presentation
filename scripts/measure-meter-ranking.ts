/**
 * 순위 규칙 비교 측정.
 *
 * 운율 후보가 여럿일 때 무엇을 먼저 볼지(일관성·주기·세밀함)는 세 곡만 놓고
 * 정할 수 없었다 — 새8 은 세밀한 쪽이 맞고 새256 은 규칙적인 쪽이 맞는데 두
 * 기준이 곡마다 엇갈렸다. 그래서 전체 코퍼스에 각 규칙을 돌려 비교한다.
 *
 * 품질 지표는 '구가 끊겼는가'의 대리 지표 세 개다:
 *
 *  - **꼬리 조각** — 행이 1글자 어절로 끝나는 비율. '그 피로 이' | '몸 사셨으니'
 *    처럼 수식어가 뒤 행과 갈라진 경우를 잡는다
 *  - **머리 조각** — 행이 1글자 어절로 시작하는 비율
 *  - **절 간 편차** — 같은 멜로디의 절들이 얼마나 다르게 잘렸는가
 *
 * 어느 지표도 완벽하지 않지만, 세 개가 함께 낮아지면 실제로 좋아진 것이다.
 * 아무것도 쓰지 않는다.
 */

import { meterCandidates, type MeterAlignment } from '../lib/meter-align.ts';
import * as store from '../server/db/songs.ts';

type Rule = { name: string; pick: (candidates: readonly MeterAlignment[]) => MeterAlignment | null };

const CONSISTENT = 1.0;

/** 짝수 행이 있으면 짝수만, 그다음 일관성으로 좁힌다 (모든 규칙의 공통 전처리) */
function narrow(candidates: readonly MeterAlignment[]): MeterAlignment[] {
  const even = candidates.filter((candidate) => candidate.lineCount % 2 === 0);
  const byParity = even.length > 0 ? even : [...candidates];
  const consistent = byParity.filter((candidate) => candidate.deviation <= CONSISTENT);
  return consistent.length > 0 ? consistent : byParity;
}

const RULES: Rule[] = [
  {
    name: '짝수 → 일관성 → 주기 → 세밀함',
    pick: (all) => {
      const pool = narrow(all);
      return (
        [...pool].sort((a, b) => a.irregularity - b.irregularity || b.lineCount - a.lineCount)[0] ?? null
      );
    },
  },
  {
    name: '짝수 → 일관성 → 세밀함 → 주기',
    pick: (all) => {
      const pool = narrow(all);
      return (
        [...pool].sort((a, b) => b.lineCount - a.lineCount || a.irregularity - b.irregularity)[0] ?? null
      );
    },
  },
  {
    name: '짝수 → 일관성 → 편차 → 주기',
    pick: (all) => {
      const pool = narrow(all);
      return (
        [...pool].sort((a, b) => a.deviation - b.deviation || a.irregularity - b.irregularity)[0] ?? null
      );
    },
  },
  {
    name: '짝수 없이 (기존) 주기 → 세밀함',
    pick: (all) => {
      const consistent = all.filter((candidate) => candidate.deviation <= CONSISTENT);
      const pool = consistent.length > 0 ? consistent : [...all];
      return (
        [...pool].sort((a, b) => a.irregularity - b.irregularity || b.lineCount - a.lineCount)[0] ?? null
      );
    },
  },
];

interface Score {
  songs: number;
  lines: number;
  tailFragments: number;
  headFragments: number;
  deviationSum: number;
  oddLineCount: number;
  lineCounts: Map<number, number>;
}

function emptyScore(): Score {
  return {
    songs: 0,
    lines: 0,
    tailFragments: 0,
    headFragments: 0,
    deviationSum: 0,
    oddLineCount: 0,
    lineCounts: new Map(),
  };
}

function accumulate(score: Score, alignment: MeterAlignment): void {
  score.songs++;
  score.deviationSum += alignment.deviation;
  if (alignment.lineCount % 2 === 1) score.oddLineCount++;
  score.lineCounts.set(alignment.lineCount, (score.lineCounts.get(alignment.lineCount) ?? 0) + 1);

  for (const verse of alignment.verses) {
    for (const line of verse.lines) {
      const words = line.trim().split(/\s+/);
      score.lines++;
      // 1글자 어절로 끝나거나 시작하면 앞뒤 행과 이어지던 말이 갈라진 신호다
      if ((words.at(-1) ?? '').length === 1) score.tailFragments++;
      if ((words[0] ?? '').length === 1) score.headFragments++;
    }
  }
}

function main(): void {
  store.initSongsDb();

  const allCandidates: MeterAlignment[][] = [];
  for (const songId of store.listSongIds()) {
    const sections = store.listSectionRows(songId).filter((section) => section.kind === 'verse');
    const verses = sections.map((section) =>
      section.lines
        .filter((line) => line.lang === 'ko')
        .sort((a, b) => a.lineIndex - b.lineIndex)
        .map((line) => line.text)
        .join(' '),
    );
    const candidates = meterCandidates(verses.filter((verse) => verse.trim().length > 0));
    if (candidates.length > 0) allCandidates.push(candidates);
  }

  process.stdout.write(`\n후보가 있는 곡: ${allCandidates.length}곡\n\n`);

  const rows: string[] = [];
  for (const rule of RULES) {
    const score = emptyScore();
    for (const candidates of allCandidates) {
      const picked = rule.pick(candidates);
      if (picked) accumulate(score, picked);
    }
    const pct = (n: number): string => `${((n / score.lines) * 100).toFixed(2)}%`;
    rows.push(
      [
        rule.name.padEnd(28),
        `꼬리조각 ${pct(score.tailFragments).padStart(6)}`,
        `머리조각 ${pct(score.headFragments).padStart(6)}`,
        `평균편차 ${(score.deviationSum / score.songs).toFixed(3)}`,
        `홀수행 ${String(score.oddLineCount).padStart(4)}곡`,
        `행수분포 ${[...score.lineCounts].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(' ')}`,
      ].join('  '),
    );
  }
  for (const row of rows) process.stdout.write(`${row}\n`);
  process.stdout.write('\n측정만 했습니다 — 아무것도 쓰지 않았습니다.\n');
}

if (import.meta.main) main();

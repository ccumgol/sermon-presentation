/**
 * 찬양 자료 폴더 점검 — **읽기 전용**.
 *
 * `~/Desktop/Data/Praise` 같은 수집 폴더를 훑어 가져오기 전에 고쳐야 할 것을
 * 목록으로 만든다. 원본은 절대 고치지 않는다 — 무엇을 고칠지는 사람이 정한다.
 *
 * 폴더 규약 (현재 구조를 그대로 채택했다):
 *
 *   Praise/
 *     찬미예수 2000/              ← 폴더 이름 = 곡집 이름
 *       1 나를 사랑하는 자들이.txt  ← 「번호 제목」 = 곡
 *       ...
 *     찬미예수 2000 악보/          ← 이름에 '악보' 가 붙으면 악보 폴더
 *       0001.bmp  또는 (1889).bmp  ← 번호로 가사와 잇는다
 *
 * 사용:
 *   npm run praise:check
 *   npm run praise:check -- ~/Desktop/Data/Praise
 */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { paths } from '../server/paths.ts';

/** 가사로 인정할 확장자 — txt 와 md 를 함께 받는다 */
const LYRIC_EXTENSIONS = new Set(['.txt', '.md']);
const SCORE_EXTENSIONS = new Set(['.bmp', '.png', '.jpg', '.jpeg', '.gif', '.pdf']);

/** 이보다 짧은 파일은 가사가 아니라 수집 실패로 본다 */
const MIN_LYRIC_BYTES = 30;
/** 표시 한 행의 기준 폭 (템플릿 기본값과 같다) */
const MAX_LINE_CHARS = 24;

interface SongFile {
  file: string;
  number?: number;
  title?: string;
  bytes: number;
  text: string;
}

interface BookReport {
  book: string;
  songs: number;
  /** 번호 → 파일 (중복 검출용) */
  duplicates: Array<{ number: number; files: string[] }>;
  missingNumbers: number[];
  noNumber: string[];
  noTitle: string[];
  tooShort: string[];
  /** 섹션 구분 방식별 파일 수 */
  sectionStyles: Record<string, number>;
  singleBlock: number;
  longLines: number;
  totalLines: number;
  scores: { files: number; matched: number; unmatched: number[] } | null;
}

/** macOS 는 파일명을 NFD 로 저장한다 — 비교·표시 전에 NFC 로 맞춘다 */
function nfc(value: string): string {
  return value.normalize('NFC');
}

function expandHome(target: string): string {
  return target.startsWith('~') ? path.join(os.homedir(), target.slice(1)) : target;
}

/** 「42 제목」 / 「42. 제목」 / 「42」 를 번호와 제목으로 */
function parseName(stem: string): { number?: number; title?: string } {
  const match = /^(\d+)\s*[.)\]]?\s*(.*)$/.exec(nfc(stem));
  if (!match) return { title: nfc(stem).trim() || undefined };

  const title = match[2]!.trim();
  return { number: Number(match[1]), ...(title.length > 0 ? { title } : {}) };
}

function readSongs(dir: string): SongFile[] {
  return readdirSync(dir)
    .filter((name) => LYRIC_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .filter((name) => !name.startsWith('_') && !name.startsWith('.'))
    .map((name) => {
      const full = path.join(dir, name);
      const text = readFileSync(full, 'utf8');
      return {
        file: nfc(name),
        bytes: statSync(full).size,
        text,
        ...parseName(path.basename(name, path.extname(name))),
      };
    })
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.file.localeCompare(b.file));
}

/** 악보 파일명에서 번호를 뽑는다 — `0801.bmp` 와 `(1889).bmp` 둘 다 쓰인다 */
function scoreNumber(stem: string): number | null {
  const match = /^\(?(\d+)\)?$/.exec(nfc(stem).trim());
  return match ? Number(match[1]) : null;
}

function classifySections(text: string): string[] {
  const styles: string[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim());

  if (lines.some((line) => /^\d+$/.test(line))) styles.push('숫자만');
  if (lines.some((line) => /^[[(].{1,10}[\])]$/.test(line))) styles.push('괄호 라벨');
  if (lines.some((line) => /^(후렴|간주|브릿지|bridge|chorus)\s*\d*$/i.test(line))) styles.push('맨 라벨');
  if (/\n\s*\n/.test(text.trim())) styles.push('빈 줄');

  return styles.length > 0 ? styles : ['구분 없음'];
}

function checkBook(dir: string, scoreDir: string | null): BookReport {
  const songs = readSongs(dir);

  const byNumber = new Map<number, string[]>();
  for (const song of songs) {
    if (song.number === undefined) continue;
    byNumber.set(song.number, [...(byNumber.get(song.number) ?? []), song.file]);
  }

  const numbers = [...byNumber.keys()].sort((a, b) => a - b);
  const missingNumbers =
    numbers.length > 0
      ? Array.from({ length: numbers[numbers.length - 1]! - numbers[0]! + 1 }, (_, i) => numbers[0]! + i).filter(
          (n) => !byNumber.has(n),
        )
      : [];

  const sectionStyles: Record<string, number> = {};
  let singleBlock = 0;
  let longLines = 0;
  let totalLines = 0;

  for (const song of songs) {
    for (const style of classifySections(song.text)) {
      sectionStyles[style] = (sectionStyles[style] ?? 0) + 1;
    }
    const blocks = song.text.trim().split(/\n\s*\n/).filter((block) => block.trim().length > 0);
    if (blocks.length <= 1) singleBlock++;

    for (const line of song.text.split(/\r?\n/)) {
      const bare = line.trim().replace(/\s/g, '');
      if (bare.length === 0) continue;
      totalLines++;
      if (bare.length > MAX_LINE_CHARS) longLines++;
    }
  }

  let scores: BookReport['scores'] = null;
  if (scoreDir !== null && existsSync(scoreDir)) {
    const found = new Set<number>();
    for (const name of readdirSync(scoreDir)) {
      if (!SCORE_EXTENSIONS.has(path.extname(name).toLowerCase())) continue;
      const number = scoreNumber(path.basename(name, path.extname(name)));
      if (number !== null) found.add(number);
    }
    scores = {
      files: found.size,
      matched: [...found].filter((n) => byNumber.has(n)).length,
      unmatched: [...found].filter((n) => !byNumber.has(n)).sort((a, b) => a - b),
    };
  }

  return {
    book: nfc(path.basename(dir)),
    songs: songs.length,
    duplicates: [...byNumber].filter(([, files]) => files.length > 1).map(([number, files]) => ({ number, files })),
    missingNumbers,
    noNumber: songs.filter((song) => song.number === undefined).map((song) => song.file),
    noTitle: songs.filter((song) => song.number !== undefined && song.title === undefined).map((song) => song.file),
    tooShort: songs.filter((song) => song.bytes < MIN_LYRIC_BYTES).map((song) => song.file),
    sectionStyles,
    singleBlock,
    longLines,
    totalLines,
    scores,
  };
}

function firstLineOf(dir: string, file: string): string {
  const text = readFileSync(path.join(dir, file), 'utf8');
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !/^\d+$/.test(l));
  return line ?? '';
}

function renderReport(reports: Array<{ report: BookReport; dir: string }>): string {
  const out: string[] = ['# 찬양 자료 점검', ''];

  for (const { report, dir } of reports) {
    out.push(`## ${report.book}`, '');
    out.push(`- 곡 ${report.songs}개, 총 ${report.totalLines}행`);
    if (report.scores) {
      out.push(
        `- 악보 ${report.scores.files}개 · 번호로 매칭 ${report.scores.matched}개` +
          (report.scores.unmatched.length > 0 ? ` · 짝 없음 ${report.scores.unmatched.length}개` : ''),
      );
    }
    out.push(
      `- 24자 초과 행 ${report.longLines}개 (${((report.longLines / Math.max(1, report.totalLines)) * 100).toFixed(1)}%)`,
    );
    out.push(`- 섹션 구분: ${Object.entries(report.sectionStyles).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
    out.push(`- 한 블록뿐인 곡: ${report.singleBlock}개 (절 구분이 없어 통째로 한 화면이 됩니다)`, '');

    const hasIssue =
      report.duplicates.length + report.noNumber.length + report.noTitle.length + report.tooShort.length > 0 ||
      report.missingNumbers.length > 0;

    if (!hasIssue) {
      out.push('고칠 것이 없습니다.', '');
      continue;
    }

    out.push('### 고쳐야 할 것', '');

    if (report.noTitle.length > 0) {
      out.push('**파일명에 제목이 없습니다** — 내용 첫 줄을 제목으로 붙이면 됩니다.', '');
      for (const file of report.noTitle) {
        out.push(`- \`${file}\` → 첫 줄: \`${firstLineOf(dir, file).slice(0, 40)}\``);
      }
      out.push('');
    }

    if (report.duplicates.length > 0) {
      out.push('**번호가 중복됩니다** — 한쪽 번호를 고쳐 주세요.', '');
      for (const { number, files } of report.duplicates) {
        out.push(`- ${number}번: ${files.map((f) => `\`${f}\``).join(', ')}`);
      }
      out.push('');
    }

    if (report.noNumber.length > 0) {
      out.push(`**번호가 없습니다** (${report.noNumber.length}개) — 번호 없는 곡집이면 그대로 둬도 됩니다.`, '');
      for (const file of report.noNumber.slice(0, 20)) out.push(`- \`${file}\``);
      if (report.noNumber.length > 20) out.push(`- … 외 ${report.noNumber.length - 20}개`);
      out.push('');
    }

    if (report.tooShort.length > 0) {
      out.push(`**내용이 거의 없습니다** (${MIN_LYRIC_BYTES}바이트 미만, ${report.tooShort.length}개)`, '');
      for (const file of report.tooShort.slice(0, 20)) out.push(`- \`${file}\``);
      out.push('');
    }

    if (report.missingNumbers.length > 0) {
      const shown = report.missingNumbers.slice(0, 40).join(', ');
      out.push(
        `**빠진 번호** ${report.missingNumbers.length}개: ${shown}` +
          (report.missingNumbers.length > 40 ? ' …' : ''),
        '',
      );
    }
  }

  out.push('---', '', '원본은 읽기 전용으로만 열었습니다 — 아무 파일도 고치지 않았습니다.', '');
  return out.join('\n');
}

function main(): void {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const root = expandHome(args[0] ?? '~/Desktop/Data/Praise');

  if (!existsSync(root)) {
    process.stdout.write(`폴더가 없습니다: ${root}\n`);
    process.exitCode = 1;
    return;
  }

  const entries = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '.venv')
    .map((entry) => nfc(entry.name));

  // '… 악보' 폴더는 같은 이름의 가사 폴더에 딸린 것으로 본다
  const lyricDirs = entries.filter((name) => !/악보|score|sheet/i.test(name));
  const reports: Array<{ report: BookReport; dir: string }> = [];

  for (const name of lyricDirs) {
    const dir = path.join(root, name);
    const scoreName = entries.find((other) => other !== name && other.startsWith(name) && /악보|score|sheet/i.test(other));
    reports.push({
      report: checkBook(dir, scoreName ? path.join(root, scoreName) : null),
      dir,
    });
  }

  if (reports.length === 0) {
    process.stdout.write(`가사 폴더를 찾지 못했습니다: ${root}\n`);
    return;
  }

  const markdown = renderReport(reports);
  mkdirSync(paths.reportsDir, { recursive: true });
  const reportPath = path.join(paths.reportsDir, 'praise-check.md');
  writeFileSync(reportPath, markdown);

  process.stdout.write(markdown);
  process.stdout.write(`\n리포트: ${reportPath}\n`);
}

if (import.meta.main) main();

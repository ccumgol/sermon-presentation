/**
 * 영어 가사에서 **낱말이 줄을 넘어 쪼개진 곳**을 찾는다. 읽기만 한다.
 *
 * ```
 * node scripts/report-hyphen-linebreaks.ts                 # 반입 폴더
 * node scripts/report-hyphen-linebreaks.ts --dir <경로>
 * ```
 *
 * ## 왜 따로 세는가
 *
 * 악보용 음절 하이픈(`Cleans-ing`)은 한 줄 안에 있으면 기계적으로 붙일 수 있다.
 * 그러나 **하이픈이 줄 끝이나 줄 머리에 오면** 낱말이 두 줄에 걸쳐 있다는 뜻이고,
 * 그것은 줄 나눔 자체가 잘못됐다는 신호다 — 붙이려면 두 줄을 합쳐야 하므로
 * 자동으로 처리할 수 없다. 사람이 봐야 하는 목록이 이 스크립트의 결과다.
 *
 * ## 합친 낱말이 말이 되는지도 본다
 *
 * 합쳐 놓고 보면 `Bidvy` `Sochained` 처럼 뜻이 없는 것이 나온다. 그것은 줄 나눔이
 * 아니라 **글자가 사라진 것**이다 (2026-08-28: 파서가 `en` 을 언어 표로 먹었다).
 * 그래서 합친 결과를 함께 적어 사람이 알아볼 수 있게 한다.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseLyrics } from '../lib/lyrics-parser.ts';

const DEFAULT_DIR = path.join(
  process.env.HOME ?? '',
  'Desktop/Playground/가사모음/build/찬양자료.한영.후렴병합/새찬송가',
);

interface Hit {
  number: number;
  title: string;
  label: string;
  /** 합쳐질 낱말 — 뜻이 없으면 글자가 사라졌다는 신호다 */
  word: string;
  before: string;
  after: string;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/**
 * 줄 끝 조각 + 줄 머리 조각을 하나의 낱말로 잇는다.
 *
 * 자료에는 하이픈 앞에 공백이 있는 꼴(`cre-a -`)과 없는 꼴(`straighten`)이 섞여 있다.
 * 공백 있는 꼴을 놓치면 앞 조각이 빈 값이 되어 `tion` `ior` 처럼 뒤 토막만 남는다.
 */
function joinWord(before: string, after: string): string {
  const WORD = "[A-Za-z'’-]+";
  const tail =
    new RegExp(`(${WORD})\\s*-\\s*$`).exec(before)?.[1] ??
    new RegExp(`(${WORD})\\s*$`).exec(before)?.[1] ??
    '';
  const head = /^\s*-?\s*([A-Za-z'’-]*)/.exec(after)?.[1] ?? '';
  return (tail + head).replace(/-/g, '');
}

function scan(dir: string): Hit[] {
  const hits: Hit[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
    const number = Number(/ - (\d+)\.txt$/.exec(file)?.[1]);
    if (!Number.isInteger(number)) continue;
    const title = file.replace(/ - \d+\.txt$/, '');

    for (const section of parseLyrics(readFileSync(path.join(dir, file), 'utf8'))) {
      const en = section.lines.filter((l) => l.lang === 'en');
      for (let i = 1; i < en.length; i += 1) {
        const before = (en[i - 1]!.text ?? '').trim();
        const after = (en[i]!.text ?? '').trim();
        if (!/-\s*$/.test(before) && !/^-/.test(after)) continue;
        hits.push({ number, title, label: section.label, word: joinWord(before, after), before, after });
      }
    }
  }
  return hits.sort((a, b) => a.number - b.number || a.label.localeCompare(b.label));
}

const dir = argValue('--dir') ?? DEFAULT_DIR;
const hits = scan(dir);
const songs = new Set(hits.map((h) => h.number));

console.log(`대상: ${dir}`);
console.log(`낱말이 줄을 넘어 쪼개진 곳: ${hits.length}곳 · ${songs.size}곡\n`);

const width = Math.max(8, ...hits.map((h) => h.word.length));
console.log(`  ${'번호'.padEnd(6)}${'절'.padEnd(8)}${'합쳐질 낱말'.padEnd(width + 2)}앞 줄 끝 / 뒷 줄 머리`);
for (const h of hits) {
  const tail = h.before.length > 26 ? `…${h.before.slice(-26)}` : h.before;
  const head = h.after.length > 26 ? `${h.after.slice(0, 26)}…` : h.after;
  console.log(
    `  ${String(h.number).padStart(4)}  ${h.label.padEnd(8)}${h.word.padEnd(width + 2)}${tail}  ⏎  ${head}`,
  );
}

const stamp = argValue('--stamp') ?? 'latest';
const out = path.join('data/reports', `hyphen-linebreak-hymn_new-${stamp}.md`);
const rows = hits
  .map((h) => `| 새 ${h.number} | ${h.title} | ${h.label} | \`${h.word}\` | ${h.before} | ${h.after} |`)
  .join('\n');
writeFileSync(
  out,
  `# 새찬송가 — 낱말이 줄을 넘어 쪼개진 곳\n\n대상: \`${dir}\`\n\n**${hits.length}곳 · ${songs.size}곡**\n\n` +
    `줄 끝이나 줄 머리에 하이픈이 있다는 것은 한 낱말이 두 줄에 걸쳐 있다는 뜻이다.\n` +
    `기계적으로 붙일 수 없다 — 줄 나눔 자체를 고쳐야 한다.\n\n` +
    `'합쳐질 낱말' 이 뜻 없는 글자면 줄 나눔이 아니라 **글자가 사라진 것**이다.\n\n` +
    `| 번호 | 제목 | 절 | 합쳐질 낱말 | 앞 줄 | 뒷 줄 |\n|---|---|---|---|---|---|\n${rows}\n`,
  'utf8',
);
console.log(`\n적었습니다: ${out}`);

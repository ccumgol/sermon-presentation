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
  /** 파일 이름 — 사람이 열어 고칠 대상이다 */
  file: string;
  label: string;
  /** 앞 줄·뒷 줄이 원본 파일의 몇 번째 줄인가 (1부터) */
  beforeLine: number;
  afterLine: number;
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

/**
 * 파서가 찾은 줄이 **원본 파일의 몇 번째 줄인가** 를 되짚는다.
 *
 * 파서는 줄 번호를 돌려주지 않는다. 그러나 사람이 손으로 고치려면 줄 번호가 있어야
 * 한다 — 없으면 645개 파일에서 눈으로 찾아야 한다. 그래서 원본 줄을 앞에서부터
 * 훑으며 짝을 맞춘다.
 *
 * **앞으로만 나아간다** (`cursor`). 새 94장처럼 1·2·3절의 가사가 완전히 같은 곡이
 * 있어서, 되짚기를 매번 처음부터 하면 세 곳이 모두 같은 줄을 가리킨다.
 */
function makeLocator(rawLines: readonly string[]) {
  let cursor = 0;
  return (text: string): number => {
    /*
     * **줄 전체로 맞춘다.** 앞 24자만 보면 새 94장처럼 여러 줄이 같은 말로 시작하는
     * 곡에서 엉뚱한 줄을 가리킨다 (`I'd rath-er have Je-sus than …` 이 여섯 번 나온다).
     * 못 찾으면 0 을 돌려 알린다 — 짐작해 채우지 않는다.
     */
    for (let i = cursor; i < rawLines.length; i += 1) {
      if (rawLines[i]!.includes(text)) {
        cursor = i;
        return i + 1; // 사람이 세는 방식 (1부터)
      }
    }
    return 0;
  };
}

function scan(dir: string): Hit[] {
  const hits: Hit[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.txt')).sort()) {
    const number = Number(/ - (\d+)\.txt$/.exec(file)?.[1]);
    if (!Number.isInteger(number)) continue;
    const title = file.replace(/ - \d+\.txt$/, '');

    const text = readFileSync(path.join(dir, file), 'utf8');
    const rawLines = text.split(/\r?\n/);
    const locate = makeLocator(rawLines);

    for (const section of parseLyrics(text)) {
      const en = section.lines.filter((l) => l.lang === 'en');
      for (let i = 1; i < en.length; i += 1) {
        const before = (en[i - 1]!.text ?? '').trim();
        const after = (en[i]!.text ?? '').trim();
        if (!/-\s*$/.test(before) && !/^-/.test(after)) continue;
        hits.push({
          number,
          title,
          file,
          label: section.label,
          beforeLine: locate(before),
          afterLine: locate(after),
          word: joinWord(before, after),
          before,
          after,
        });
      }
    }
  }
  return hits.sort((a, b) => a.number - b.number || a.beforeLine - b.beforeLine);
}

const dir = argValue('--dir') ?? DEFAULT_DIR;
const hits = scan(dir);
const songs = new Set(hits.map((h) => h.number));

console.log(`대상: ${dir}`);
console.log(`낱말이 줄을 넘어 쪼개진 곳: ${hits.length}곳 · ${songs.size}곡`);

/*
 * **곡별로 묶어 보여 준다.** 사람이 고치는 단위가 파일 하나이므로, 번호순 한 줄짜리
 * 목록보다 '이 파일에서 이 줄들' 이 훨씬 빠르다.
 */
const byFile = new Map<string, Hit[]>();
for (const h of hits) {
  const list = byFile.get(h.file) ?? [];
  list.push(h);
  byFile.set(h.file, list);
}

for (const [file, list] of byFile) {
  console.log(`\n── 새 ${list[0]!.number}장  ${list[0]!.title}  (${list.length}곳) ──`);
  console.log(`   ${file}`);
  for (const h of list) {
    const mark = h.beforeLine === 0 || h.afterLine === 0 ? ' ⚠줄을 되짚지 못했습니다' : '';
    console.log(`   ${String(h.beforeLine).padStart(4)},${String(h.afterLine).padEnd(5)}[${h.label}] → ${h.word}${mark}`);
    console.log(`        ${h.before}`);
    console.log(`        ${h.after}`);
  }
}

const stamp = argValue('--stamp') ?? 'latest';
const out = path.join('data/reports', `hyphen-linebreak-hymn_new-${stamp}.md`);
const body = [...byFile.values()]
  .map((list) => {
    const head = `## 새 ${list[0]!.number}장 · ${list[0]!.title} — ${list.length}곳\n\n\`${list[0]!.file}\`\n`;
    const rows = list
      .map(
        (h) =>
          `| ${h.beforeLine}·${h.afterLine} | ${h.label} | \`${h.word}\` | ${h.before} | ${h.after} |`,
      )
      .join('\n');
    return `${head}\n| 줄 | 절 | 합쳐질 낱말 | 앞 줄 | 뒷 줄 |\n|---|---|---|---|---|\n${rows}\n`;
  })
  .join('\n');

writeFileSync(
  out,
  `# 새찬송가 — 낱말이 줄을 넘어 쪼개진 곳\n\n대상: \`${dir}\`\n\n**${hits.length}곳 · ${songs.size}곡**\n\n` +
    `줄 끝이나 줄 머리에 하이픈이 있다는 것은 한 낱말이 두 줄에 걸쳐 있다는 뜻이다.\n` +
    `기계적으로 붙일 수 없다 — 줄 나눔 자체를 고쳐야 한다.\n\n` +
    `'줄' 은 원본 파일의 줄 번호(앞·뒤)다. '합쳐질 낱말' 이 뜻 없는 글자면 줄 나눔이\n` +
    `아니라 **글자가 사라진 것**이다.\n\n다시 세려면 \`npm run report:hyphen\`.\n\n${body}`,
  'utf8',
);
console.log(`\n적었습니다: ${out}`);

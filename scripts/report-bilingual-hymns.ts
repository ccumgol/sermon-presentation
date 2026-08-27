/**
 * 새찬송가 한/영 대조 리포트 — **읽기만 한다.**
 *
 * ```
 * node scripts/report-bilingual-hymns.ts              # 새찬송가
 * node scripts/report-bilingual-hymns.ts --book hymn_old
 * node scripts/report-bilingual-hymns.ts --only A,B    # 갈래를 골라
 * ```
 *
 * ## 왜 `report:missing-en` 과 따로 있는가
 *
 * 기존 리포트는 **짝이 없는 줄**을 센다(282줄·119곡). 그런데 실제 문제는 그것이 아니다.
 *
 * 영어가 한국어 줄에 맞춰 들어간 게 아니라, **한 덩이 글을 30자쯤에서 기계적으로 자른**
 * 상태다. 그래서 줄 수가 맞아도 뜻이 어긋난다 — 새 305장이 4=4 인데도
 *
 * ```
 * ko: 나 같은 죄인 살리신     en: Amazing grace! how sweet the
 * ko: 주 은혜 놀라워         en: sound! That saved a wretch like
 * ```
 *
 * `the / sound!` 처럼 낱말과 문장이 줄 사이에서 끊긴다. 줄 수만 세는 리포트에서는
 * 이 곡이 **'정상'** 으로 잡힌다. 그래서 세는 기준을 하나 더 둔다.
 *
 * ## 끊김을 어떻게 판정하는가
 *
 * **둘째 줄 이후인데 소문자로 시작하면** 문장 중간에서 끊긴 것으로 본다.
 * 영어 찬송 가사는 행마다 대문자로 시작하는 것이 관례이고, 실측에서 **첫 줄이 소문자인
 * 경우는 645곡 중 0건**이었다 — 무작위가 아니라 순서대로 자른 증거다.
 *
 * 완벽한 판정은 아니다(`'Tis`·고유명사 등). 그래서 이 리포트는 **작업 목록**이고,
 * 무엇을 고칠지는 사람이 내용을 보고 정한다.
 *
 * ## 갈래
 *
 * | 갈래 | 뜻 |
 * |---|---|
 * | **A** | 영어가 전혀 없다 |
 * | **B** | 영어 줄이 한국어보다 적다 (한 덩이를 적은 줄에 밀어 넣었다) |
 * | **C** | 줄 수는 맞지만 문장이 끊긴다 |
 * | **D** | 문제 없음 — 손댈 필요 없다 |
 *
 * ## 우선순위는 '실제로 부른 곡'
 *
 * 645곡을 다 손볼 수는 없다. `use_count` 가 있는 곡을 맨 앞에 둔다 — 교회가 실제로
 * 부르는 곡부터 고치면 몇십 곡으로 효과가 난다.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { DatabaseSync } from 'node:sqlite';

import { DATA_DIR } from '../server/paths.ts';

type Kind = 'A' | 'B' | 'C' | 'D';

interface Line {
  lang: string;
  index: number;
  text: string;
}
interface Section {
  label: string;
  ko: Line[];
  en: Line[];
  brokenIndexes: number[];
}
interface Song {
  number: number;
  id: number;
  title: string;
  titleAlt: string | null;
  useCount: number;
  ko: number;
  en: number;
  broken: number;
  sections: Section[];
  kind: Kind;
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 둘째 줄 이후인데 소문자로 시작 = 문장 중간에서 끊겼다 */
function isBroken(line: Line): boolean {
  return line.index > 0 && /^[a-z]/.test(line.text.trim());
}

function collect(db: DatabaseSync, book: string): Song[] {
  const songRows = db
    .prepare(
      `SELECT e.number no, s.id, s.title, s.title_alt alt, s.use_count uc
       FROM song_entries e JOIN songs s ON s.id = e.song_id
       WHERE e.songbook_id = ? ORDER BY e.number`,
    )
    .all(book) as unknown as Array<{ no: number; id: number; title: string; alt: string | null; uc: number }>;

  const secStmt = db.prepare('SELECT id, label FROM song_sections WHERE song_id = ? ORDER BY position');
  const lineStmt = db.prepare(
    'SELECT lang, line_index, text FROM song_lines WHERE section_id = ? ORDER BY line_index',
  );

  return songRows.map((row) => {
    const sections: Section[] = [];
    let ko = 0;
    let en = 0;
    let broken = 0;

    for (const sec of secStmt.all(row.id) as unknown as Array<{ id: number; label: string }>) {
      const all = (lineStmt.all(sec.id) as unknown as Array<{ lang: string; line_index: number; text: string }>).map(
        (l) => ({ lang: l.lang, index: l.line_index, text: l.text ?? '' }),
      );
      const koLines = all.filter((l) => l.lang === 'ko');
      const enLines = all.filter((l) => l.lang === 'en');
      const brokenIndexes = enLines.filter(isBroken).map((l) => l.index);

      ko += koLines.length;
      en += enLines.length;
      broken += brokenIndexes.length;
      sections.push({ label: sec.label ?? '?', ko: koLines, en: enLines, brokenIndexes });
    }

    const kind: Kind = en === 0 ? 'A' : en < ko ? 'B' : broken > 0 ? 'C' : 'D';
    return { number: row.no, id: row.id, title: row.title, titleAlt: row.alt, useCount: row.uc, ko, en, broken, sections, kind };
  });
}

/** 한 곡의 줄을 한국어·영어 나란히 */
function renderSong(song: Song, showAll: boolean): string[] {
  const out: string[] = [];
  const alt = song.titleAlt ? ` → ${song.titleAlt}` : ' → **원제 없음**';
  const used = song.useCount > 0 ? ` · 송출 ${song.useCount}회` : '';
  out.push(`#### 새 ${song.number}장 「${song.title}」${alt}`);
  out.push('');
  out.push(`한국어 ${song.ko}줄 · 영어 ${song.en}줄 · 끊김 ${song.broken}곳${used}`);
  out.push('');

  for (const sec of song.sections) {
    const clean = sec.en.length === sec.ko.length && sec.brokenIndexes.length === 0;
    if (clean && !showAll) continue;

    const gap = sec.en.length < sec.ko.length ? ` · 영어 ${sec.ko.length - sec.en.length}줄 모자람` : '';
    out.push(`**[${sec.label}]** 한국어 ${sec.ko.length} · 영어 ${sec.en.length}${gap}`);
    out.push('');
    out.push('| # | 한국어 | 영어 | |');
    out.push('|---|---|---|---|');
    const rows = Math.max(sec.ko.length, sec.en.length);
    for (let i = 0; i < rows; i += 1) {
      const k = sec.ko[i]?.text ?? '—';
      const e = sec.en[i]?.text ?? '**없음**';
      const flag = sec.brokenIndexes.includes(i) ? '⚠ 문장 중간' : sec.en[i] ? '' : '⚠ 빈 줄';
      out.push(`| ${i} | ${k} | ${e} | ${flag} |`);
    }
    out.push('');
  }
  return out;
}

function main(): void {
  const book = argValue('--book') ?? 'hymn_new';
  const only = (argValue('--only') ?? 'A,B,C').split(',').map((s) => s.trim().toUpperCase());

  const db = new DatabaseSync(path.join(DATA_DIR, 'songs.sqlite'), { readOnly: true });
  const bookName =
    (db.prepare('SELECT name FROM songbooks WHERE id = ?').get(book) as unknown as { name?: string } | undefined)
      ?.name ?? book;
  const songs = collect(db, book);
  db.close();

  const by = (k: Kind) => songs.filter((s) => s.kind === k);
  const problems = songs.filter((s) => s.kind !== 'D');
  const used = problems.filter((s) => s.useCount > 0).sort((a, b) => b.useCount - a.useCount);

  const L: string[] = [];
  L.push(`# ${bookName} 한/영 대조 리포트`);
  L.push('');
  L.push(`> 생성 ${new Date().toISOString().slice(0, 10)} · \`node scripts/report-bilingual-hymns.ts\``);
  L.push('> **읽기만 한 리포트입니다.** 데이터를 바꾸지 않았습니다.');
  L.push('');
  L.push('## 요약');
  L.push('');
  L.push('| 갈래 | 뜻 | 곡 수 |');
  L.push('|---|---|---|');
  L.push(`| **A** | 영어가 전혀 없다 | ${by('A').length} |`);
  L.push(`| **B** | 영어 줄이 한국어보다 적다 | ${by('B').length} |`);
  L.push(`| **C** | 줄 수는 맞지만 문장이 끊긴다 | ${by('C').length} |`);
  L.push(`| D | 문제 없음 | ${by('D').length} |`);
  L.push(`| | **손볼 곡 합계** | **${problems.length}** / ${songs.length} |`);
  L.push('');
  L.push(
    `줄 합계 — 한국어 ${songs.reduce((a, s) => a + s.ko, 0).toLocaleString()} · ` +
      `영어 ${songs.reduce((a, s) => a + s.en, 0).toLocaleString()} · ` +
      `끊김 ${songs.reduce((a, s) => a + s.broken, 0).toLocaleString()}곳`,
  );
  L.push('');
  L.push('### 왜 이렇게 됐나');
  L.push('');
  L.push('영어가 한국어 줄에 맞춰 들어간 것이 아니라, **한 덩이 글을 30자쯤에서 기계적으로**');
  L.push('자른 상태입니다. 그래서 줄 수가 맞아도 뜻이 어긋납니다(갈래 C).');
  L.push('');
  L.push('```');
  L.push('ko: 나 같은 죄인 살리신     en: Amazing grace! how sweet the');
  L.push('ko: 주 은혜 놀라워         en: sound! That saved a wretch like');
  L.push('```');
  L.push('');
  L.push('`the / sound!` 처럼 낱말과 문장이 줄 사이에서 끊깁니다. **판정 기준**은');
  L.push('"둘째 줄 이후인데 소문자로 시작" 입니다 — 첫 줄이 소문자인 경우는 0건이었습니다.');
  L.push('');
  L.push('---');
  L.push('');

  // ── 우선순위 ──
  L.push(`## 1. 먼저 고칠 곡 — 실제로 부른 곡 ${used.length}곡`);
  L.push('');
  L.push('645곡을 다 손볼 수는 없습니다. 송출 기록이 있는 곡부터 고치면 몇십 곡으로 효과가 납니다.');
  L.push('');
  L.push('| 번호 | 제목 | 갈래 | 송출 | ko/en | 끊김 |');
  L.push('|---|---|---|---|---|---|');
  for (const s of used) {
    L.push(`| ${s.number} | ${s.title} | ${s.kind} | ${s.useCount}회 | ${s.ko}/${s.en} | ${s.broken} |`);
  }
  L.push('');
  L.push('### 내용');
  L.push('');
  for (const s of used) L.push(...renderSong(s, true));
  L.push('---');
  L.push('');

  // ── 갈래별 ──
  const titles: Record<Kind, string> = {
    A: '영어가 전혀 없는 곡',
    B: '영어 줄이 한국어보다 적은 곡',
    C: '줄 수는 맞지만 문장이 끊긴 곡',
    D: '문제 없는 곡',
  };
  let n = 2;
  for (const kind of ['A', 'B', 'C'] as Kind[]) {
    if (!only.includes(kind)) continue;
    const list = by(kind);
    L.push(`## ${n}. 갈래 ${kind} — ${titles[kind]} (${list.length}곡)`);
    n += 1;
    L.push('');
    L.push('번호: ' + (list.map((s) => s.number).join(', ') || '없음'));
    L.push('');
    if (list.length === 0) continue;

    L.push('| 번호 | 제목 | 원제 | ko/en | 끊김 |');
    L.push('|---|---|---|---|---|');
    for (const s of list) {
      L.push(`| ${s.number} | ${s.title} | ${s.titleAlt ?? '**없음**'} | ${s.ko}/${s.en} | ${s.broken} |`);
    }
    L.push('');
    // A·B 는 내용까지, C 는 490곡이라 목록만 (우선순위 곡의 내용은 1장에 있다)
    if (kind !== 'C') {
      L.push('### 내용');
      L.push('');
      for (const s of list) L.push(...renderSong(s, kind === 'A'));
    } else {
      L.push('> C 는 490곡이라 내용을 싣지 않았습니다. 위 **1장**에 송출 기록이 있는 곡의');
      L.push('> 내용이 있고, 특정 곡을 보려면 `--only C` 없이 번호로 찾아보세요.');
      L.push('');
    }
    L.push('---');
    L.push('');
  }

  L.push(`## 손댈 필요 없는 곡 (${by('D').length}곡)`);
  L.push('');
  L.push('번호: ' + (by('D').map((s) => s.number).join(', ') || '없음'));
  L.push('');

  const dir = path.join(DATA_DIR, 'reports');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `bilingual-${book}-${new Date().toISOString().slice(0, 10)}.md`);
  writeFileSync(file, L.join('\n') + '\n', 'utf8');

  console.log(`${bookName} ${songs.length}곡`);
  console.log(`  A 영어 없음            ${String(by('A').length).padStart(3)}곡`);
  console.log(`  B 줄이 부족            ${String(by('B').length).padStart(3)}곡`);
  console.log(`  C 줄 수는 맞지만 끊김   ${String(by('C').length).padStart(3)}곡`);
  console.log(`  D 문제 없음            ${String(by('D').length).padStart(3)}곡`);
  console.log(`  ─── 손볼 곡 합계       ${String(problems.length).padStart(3)}곡`);
  console.log();
  console.log(`  실제로 부른 곡 중 문제 있는 것: ${used.length}곡`);
  console.log();
  console.log(`리포트: ${file}`);
}

main();

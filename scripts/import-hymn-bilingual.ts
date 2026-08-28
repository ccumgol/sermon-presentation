/**
 * 새찬송가 한/영 병기 자료 반입 — 외부 폴더 → `data/songs.sqlite`
 *
 * ```
 * npm run hymn:bilingual -- --dir <폴더>            # 미리보기 (아무것도 쓰지 않는다)
 * npm run hymn:bilingual -- --dir <폴더> --apply    # 실제로 넣는다
 * npm run hymn:bilingual -- --dir <폴더> --only 150 # 한 곡만
 * ```
 *
 * ## 사람이 콕 집어 허용하는 두 가지
 *
 * ```
 * --allow-text-change 624,638   가사 글자가 달라도 넣는다
 * --keep-amen 624               줄 끝 아멘을 표시로 빼내지 않는다 (아멘이 가사인 곡)
 * ```
 *
 * 둘 다 **번호를 적어야** 듣는다. 전체를 끄는 스위치는 두지 않았다 — 그러면
 * 아무도 보지 않은 채 645곡의 가사가 바뀔 수 있다. 어느 곡을 왜 허용했는지가
 * 명령줄에 남아야 한다 (2026-08-28 사용자 요청: '원본과 다를 수 있는데 이 가사가 맞다').
 *
 * ## 이것은 '줄나눔을 바꾸고 영어를 더하는' 작업이다
 *
 * 점검해 보니 아멘을 뺀 한국어 **글자**가 645곡 중 644곡에서 DB 와 똑같았다
 * (2026-08-23). 즉 이 자료는 다른 가사가 아니라 **같은 가사를 다르게 끊고 영어를
 * 붙인 것**이다. 사용자가 그 줄나눔을 쓰기로 했다.
 *
 * 그래서 **가사 글자가 다른 곡은 넣지 않는다.** 줄나눔을 바꾸기로 한 작업이 조용히
 * 가사를 바꾸는 작업이 되면 안 된다 (실제로 628번이 걸린다 — 외부 자료에 '태초부터'가
 * 빠져 있다).
 *
 * ## 손보는 것 셋
 *
 * 1. **웹 찌꺼기**를 뗀다 (`© Daum Corp.` — 645곡 중 340곡에 있었다).
 *    판정은 `lib/hymn-scrape-clean.ts`.
 * 2. **음절 하이픈**을 뗀다 (`rug-ged` → `rugged`). 판정은 `lib/hymn-hyphen.ts`.
 * 3. **아멘**을 가사에서 빼고 `has_amen` 으로 옮긴다. 이 앱은 아멘을 플래그로 다루므로
 *    가사에 남겨 두면 화면에 두 번 나간다.
 * 4. 절 라벨·`|` 짝은 `parseLyrics` 가 그대로 읽는다 (형식이 이미 우리 규격이다).
 *
 * ## `lines_source` 를 'manual' 로 넣는 이유
 *
 * 사람이 밖에서 손으로 맞춘 자료다. `auto` 로 넣으면 `lyrics:realign`·`chorus:merge`
 * 같은 자동 작업이 **이 줄나눔을 다시 헤집을 수 있다.** 'manual' 은 '자동은 손대지
 * 말라' 는 뜻이고, 지금 필요한 것이 정확히 그것이다.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { isAmenSection, stripAmenEnglish, stripAmenMarker } from '../lib/hymn-amen.ts';
import { stripSyllableHyphens, type Dictionary } from '../lib/hymn-hyphen.ts';
import { stripScrapeArtifacts } from '../lib/hymn-scrape-clean.ts';
import { formatLyrics, parseLyrics } from '../lib/lyrics-parser.ts';
import * as songs from '../server/db/songs.ts';
import { snapshotDatabases } from '../server/db/snapshot.ts';
import type { SongLine, SongSection } from '../shared/types.ts';

/** `replaceSections` 가 받는 모양 — 아직 id·position 이 없는 상태 */
type NewSection = { kind: SongSection['kind']; label: string; lines: SongLine[] };

const SONGBOOK_ID = 'hymn_new';
const SONGBOOK = '새찬송가';
const DICT_PATHS = ['/usr/share/dict/words', '/usr/share/dict/web2'];

function argValue(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function loadDictionary(): Dictionary {
  for (const file of DICT_PATHS) {
    if (!existsSync(file)) continue;
    return new Set(
      readFileSync(file, 'utf8')
        .split('\n')
        .map((word) => word.trim().toLowerCase())
        .filter((word) => word.length > 0),
    );
  }
  // 사전이 없으면 규칙만으로는 하이픈을 가릴 수 없다 — 조용히 잘못 붙이지 않는다
  throw new Error(`영어 사전을 찾지 못했습니다 (${DICT_PATHS.join(' 또는 ')})`);
}

/**
 * 비교용 — 공백·문장부호를 털어 낸 글자만 남긴다.
 *
 * **아멘은 줄마다 떼어 낸 뒤에 부른다.** 전에는 이 함수가 '맨 끝 아멘 하나' 만 뗐는데,
 * 반입 쪽은 **모든 줄**의 아멘을 떼고 있었다. 그래서 절마다 아멘이 붙은 곡
 * (19·29·624번)이 '가사가 다르다' 로 잘못 걸렸다 — 실제 차이는 아멘뿐이었다.
 */
function squash(text: string): string {
  return text.normalize('NFC').replace(/[\s·.,!?~-]+/g, '');
}

/** 여러 줄에서 아멘 표시를 떼고 이어 붙인다 (양쪽을 **같은 방법으로** 견주기 위해) */
function squashLines(lines: readonly string[]): string {
  return squash(lines.map((line) => stripAmenMarker(line).text).join(''));
}

interface Candidate {
  number: number;
  title: string;
  songId: number;
  sections: NewSection[];
  /** 가사에서 뺀 아멘이 있었나 */
  amen: boolean;
  /** 하이픈을 남긴 낱말 */
  keptHyphens: string[];
  /** 웹 찌꺼기를 뗀 줄 수 */
  scrubbed: number;
  /** 맨 끝 영어 Amen 을 표시로 옮겼나 (1 또는 0) */
  trailingAmen: number;
  before: { sections: number; koLines: number; enLines: number };
  after: { sections: number; koLines: number; enLines: number };
}

function countLines(sections: ReadonlyArray<{ lines: readonly SongLine[] }>, lang: string): number {
  return sections.reduce(
    (sum, section) => sum + section.lines.filter((line) => line.lang === lang).length,
    0,
  );
}

/**
 * **곡의 맨 끝 영어 `Amen` 을 뗀다** — 뗐으면 새 배열을, 뗄 것이 없으면 받은 것을 그대로 돌려준다.
 *
 * 한국어 원본에 아멘이 없어 짝 맞추기로 걸리지 않는 곡이 151곡 있었다 (새 1장
 * 「만복의 근원 하나님」의 `Praise Father, Son, and Holy Ghost. Amen`, 2026-08-28 실측).
 * 그대로 두면 영어에만 아멘이 두 번 나간다 — 본문에 한 번, `has_amen` 슬라이드로 한 번.
 *
 * **맨 끝 한 줄만** 본다. 절마다 아멘이 붙은 곡(새 181장은 4절 모두)은 표시 하나로
 * 바꾸면 나머지가 사라지므로 건드리지 않고 보고만 한다.
 */
function stripTrailingEnglishAmen(sections: readonly NewSection[]): NewSection[] {
  if (sections.length === 0) return sections as NewSection[];
  const lastIndex = sections.length - 1;
  const lines = sections[lastIndex]!.lines;
  const enIndex = lines.map((line, i) => ({ line, i })).filter((x) => x.line.lang !== 'ko').at(-1);
  if (enIndex === undefined) return sections as NewSection[];

  const stripped = stripAmenEnglish(enIndex.line.text);
  if (stripped === enIndex.line.text || stripped.length === 0) return sections as NewSection[];

  return sections.map((section, i) =>
    i !== lastIndex
      ? section
      : {
          ...section,
          lines: section.lines.map((line, j) =>
            j === enIndex.i ? { ...line, text: stripped } : line,
          ),
        },
  );
}

/** `--allow-text-change 624,638` 처럼 쉼표로 적은 번호를 읽는다 */
function numberSet(raw: string | undefined): ReadonlySet<number> {
  if (raw === undefined) return new Set();
  const out = new Set<number>();
  for (const part of raw.split(',')) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

function main(): void {
  const dir = argValue('--dir');
  if (dir === undefined || !existsSync(dir)) {
    console.error('❌ --dir <폴더> 가 필요합니다 (한/영 병기 txt 가 든 폴더).');
    process.exitCode = 1;
    return;
  }
  const apply = process.argv.includes('--apply');
  const only = Number(argValue('--only'));
  const allowTextChange = numberSet(argValue('--allow-text-change'));
  const keepAmen = numberSet(argValue('--keep-amen'));
  const dict = loadDictionary();

  if (allowTextChange.size > 0) {
    console.log(`가사 글자가 달라도 넣는 곡: ${[...allowTextChange].join(', ')}`);
  }
  if (keepAmen.size > 0) {
    console.log(`아멘을 가사로 두는 곡: ${[...keepAmen].join(', ')}`);
  }


  const ready: Candidate[] = [];
  const skippedText: Array<{ number: number; title: string; why: string }> = [];
  /** `--allow-text-change` 로 가사 글자가 바뀌는 것을 허용한 곡 */
  const forcedText: Array<{ number: number; title: string; why: string }> = [];
  const skippedMissing: number[] = [];
  const badName: string[] = [];

  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.txt')) continue;
    const stem = file.slice(0, -4);
    const match = /^(.*) - (\d+)$/.exec(stem);
    if (!match) {
      badName.push(file);
      continue;
    }
    const number = Number(match[2]);
    if (Number.isFinite(only) && only > 0 && number !== only) continue;

    /*
     * 같은 번호를 두 곡이 가질 수 있다(실측 35건). 그때는 **고르지 않는다** —
     * 조용히 첫 곡을 집으면 엉뚱한 곡의 가사를 덮고, 그것은 예배 화면에서야 드러난다.
     */
    const matches = songs.findByEntry(SONGBOOK_ID, number);
    if (matches.length !== 1) {
      skippedMissing.push(number);
      continue;
    }
    const target = { id: matches[0]!.id, title: matches[0]!.title };

    const raw = readFileSync(path.join(dir, file), 'utf8');
    const parsed = parseLyrics(raw);

    // ── 손보기 ①②: 하이픈을 떼고 아멘을 뺀다 ──────────────────
    const keptHyphens: string[] = [];
    let amen = false;
    let scrubbed = 0;
    let trailingAmen = 0;
    const sections: NewSection[] = parsed
      .filter((section) => {
        // `[아멘]` 섹션은 가사가 아니라 표시다 — 통째로 버리고 플래그로 옮긴다
        if (!isAmenSection(section.label)) return true;
        amen = true;
        return false;
      })
      .map((section) => {
        /*
         * **한국어를 먼저 훑어 어느 줄에서 아멘을 뗐는지 적어 둔다.** 그 줄에서만
         * 영어의 `Amen` 도 뗀다 — 한쪽만 떼면 그 줄의 짝이 어긋난다.
         */
        const amenAt = new Set<number>();
        if (!keepAmen.has(number)) {
          for (const line of section.lines) {
            if (line.lang !== 'ko') continue;
            if (stripAmenMarker(line.text).had) amenAt.add(line.lineIndex);
          }
        }

        const lines = section.lines
          .map((line) => {
            if (line.lang !== 'ko') {
              // 찌꺼기를 먼저 뗀다 — 하이픈 판정이 `© Daum Corp.` 를 낱말로 보지 않게
              const scrubbedLine = stripScrapeArtifacts(line.text);
              if (scrubbedLine.changed) scrubbed += 1;
              if (scrubbedLine.text.length === 0) return { ...line, text: '' };
              const cleaned = stripSyllableHyphens(scrubbedLine.text, dict);
              keptHyphens.push(...cleaned.kept);
              const text = amenAt.has(line.lineIndex)
                ? stripAmenEnglish(cleaned.text)
                : cleaned.text;
              return { ...line, text };
            }
            /*
             * 끝에 붙은 아멘은 가사가 아니라 표시다 (줄 전체가 아멘이면 본문이다).
             * 단 `--keep-amen` 으로 집은 곡은 아멘이 **가사**다 — 새 624장
             * 「우리 모두 찬양해」는 `우리 모두 찬양해 아멘` 이 네 번 나온다.
             * 표시 하나로 바꾸면 화면에 아멘이 한 번만 나온다.
             */
            if (keepAmen.has(number)) return line;
            const marker = stripAmenMarker(line.text);
            if (marker.had) amen = true;
            return { ...line, text: marker.text };
          })
          .filter((line) => line.text.length > 0);

        return { kind: section.kind, label: section.label, lines };
      })
      .filter((section) => section.lines.length > 0);

    /*
     * **곡의 맨 끝 영어 `Amen` 도 표시다.** 한국어 원본에 아멘이 없어 위 짝 맞추기로는
     * 걸리지 않는 곡이 151곡 있었다 (새 1장 「만복의 근원 하나님」의
     * `Praise Father, Son, and Holy Ghost. Amen`). 그대로 두면 영어에만 아멘이
     * 두 번 나간다 — 본문에 한 번, `has_amen` 슬라이드로 한 번.
     *
     * **맨 끝 한 줄만** 본다. 절마다 아멘이 붙은 곡(새 181장)은 절 수만큼 있으므로
     * 표시 하나로 바꾸면 나머지가 사라진다 — 건드리지 않고 아래에서 보고한다.
     */
    const trimmed = keepAmen.has(number) ? sections : stripTrailingEnglishAmen(sections);
    if (trimmed !== sections) {
      amen = true;
      trailingAmen = 1;
    }

    // ── 가사 글자가 같은지 본다 (줄나눔만 바꾸는 작업이다) ──────
    const incomingKo = squashLines(
      sections.flatMap((s) => s.lines.filter((l) => l.lang === 'ko').map((l) => l.text)),
    );
    const currentSections = matches[0]!.sections;
    const currentKo = squashLines(
      currentSections.flatMap((s) => s.lines.filter((l) => l.lang === 'ko').map((l) => l.text)),
    );
    if (incomingKo !== currentKo) {
      let at = 0;
      while (at < Math.min(incomingKo.length, currentKo.length) && incomingKo[at] === currentKo[at]) at++;
      const why = `${at}자까지 같음 · 외부 ${incomingKo.length}자 / DB ${currentKo.length}자`;
      /*
       * `--allow-text-change` 로 집은 곡은 사람이 '이 가사가 맞다' 고 판정한 것이다.
       * 넘기되 **무엇을 넘겼는지 보고한다** — 조용히 지나가면 안 된다.
       */
      if (!allowTextChange.has(number)) {
        skippedText.push({ number, title: target.title, why });
        continue;
      }
      forcedText.push({ number, title: target.title, why });
    }

    ready.push({
      number,
      title: target.title,
      songId: target.id,
      sections: trimmed,
      amen,
      keptHyphens,
      scrubbed,
      trailingAmen,
      before: {
        sections: currentSections.length,
        koLines: countLines(currentSections, 'ko'),
        enLines: countLines(currentSections, 'en'),
      },
      after: {
        sections: trimmed.length,
        koLines: countLines(trimmed, 'ko'),
        enLines: countLines(trimmed, 'en'),
      },
    });
  }

  // ── 보고 ────────────────────────────────────────────────────
  console.log(`\n넣을 곡: ${ready.length}곡`);
  const amenCount = ready.filter((c) => c.amen).length;
  const enTotal = ready.reduce((sum, c) => sum + c.after.enLines, 0);
  const changedBreaks = ready.filter((c) => c.before.koLines !== c.after.koLines).length;
  const scrubbedLines = ready.reduce((sum, c) => sum + c.scrubbed, 0);
  const scrubbedSongs = ready.filter((c) => c.scrubbed > 0).length;
  console.log(`  영어 줄 ${enTotal}줄 · 아멘을 뺀 곡 ${amenCount}곡 · 줄나눔이 바뀌는 곡 ${changedBreaks}곡`);
  console.log(`  ⚠️ 웹 찌꺼기를 뗀 줄 ${scrubbedLines}줄 / ${scrubbedSongs}곡 (원본에 '© Daum Corp.' 등이 붙어 있었습니다)`);
  const trailingAmenSongs = ready.filter((c) => c.trailingAmen > 0).length;
  if (trailingAmenSongs > 0) {
    console.log(`  맨 끝 영어 Amen 을 표시로 옮긴 곡 ${trailingAmenSongs}곡 (한국어에는 아멘이 없던 곡)`);
  }

  if (badName.length > 0) console.log(`\n이름 규약(제목 - 번호.txt)이 아닌 파일 ${badName.length}개: ${badName.slice(0, 3).join(', ')}`);
  if (skippedMissing.length > 0) {
    console.log(`\nDB 에서 곡을 하나로 특정하지 못한 번호 ${skippedMissing.length}개: ${skippedMissing.slice(0, 10).join(', ')}`);
  }

  if (forcedText.length > 0) {
    console.log(`\n★ 가사 글자가 바뀌는데 **허용한** 곡 ${forcedText.length}곡 (--allow-text-change):`);
    for (const item of forcedText) console.log(`   ${item.number} ${item.title} — ${item.why}`);
  }

  if (skippedText.length > 0) {
    console.log(`\n⚠️ 가사 글자가 달라 **넣지 않는** 곡 ${skippedText.length}곡:`);
    for (const item of skippedText) console.log(`   ${item.number} ${item.title} — ${item.why}`);
    console.log('   (줄나눔을 바꾸는 작업이므로 가사 내용까지 바꾸지 않습니다. 이 곡은 손으로 보세요.)');
  }

  const kept = new Map<string, number>();
  for (const item of ready) for (const word of item.keptHyphens) kept.set(word, (kept.get(word) ?? 0) + 1);
  if (kept.size > 0) {
    const top = [...kept].sort((a, b) => b[1] - a[1]).slice(0, 12);
    console.log(`\n하이픈을 남긴 낱말 ${kept.size}종 (복합어로 봤습니다):`);
    console.log(`   ${top.map(([w, c]) => `${w}(${c})`).join(' · ')}`);
  }

  console.log('\n표본 (앞 5곡):');
  for (const item of ready.slice(0, 5)) {
    console.log(
      `  ${String(item.number).padStart(3)} ${item.title.slice(0, 18).padEnd(20)}` +
        ` 절 ${item.before.sections}→${item.after.sections}` +
        ` · 한 ${item.before.koLines}→${item.after.koLines}` +
        ` · 영 ${item.before.enLines}→${item.after.enLines}${item.amen ? ' · 아멘' : ''}`,
    );
  }

  if (ready.length === 0) {
    console.log('\n넣을 것이 없습니다.');
    return;
  }
  if (!apply) {
    console.log('\n미리보기입니다. 실제로 넣으려면 --apply 를 붙이세요.');
    return;
  }

  // 되돌릴 수 없는 작업이다 — 쓰기 전에 스냅샷 (CLAUDE.md '데이터를 바꿀 때')
  const snapshot = snapshotDatabases('before-hymn-bilingual');
  console.log(`\n스냅샷(${snapshot.stamp}):`);
  for (const saved of snapshot.files) console.log(`  ${saved}`);

  for (const item of ready) {
    songs.replaceSections(item.songId, item.sections, 'manual');
    if (item.amen) songs.updateSongMeta(item.songId, { hasAmen: true });
  }

  console.log(`\n넣었습니다: ${ready.length}곡 (lines_source = manual)`);
  const check = songs.getSong(ready[0]!.songId);
  console.log(`확인: ${ready[0]!.number}번 섹션 ${check?.sections.length}개 · 첫 줄 "${check?.sections[0]?.lines[0]?.text.slice(0, 24)}"`);
}

main();

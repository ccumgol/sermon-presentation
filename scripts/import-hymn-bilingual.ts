/**
 * 새찬송가 한/영 병기 자료 반입 — 외부 폴더 → `data/songs.sqlite`
 *
 * ```
 * npm run hymn:bilingual -- --dir <폴더>            # 미리보기 (아무것도 쓰지 않는다)
 * npm run hymn:bilingual -- --dir <폴더> --apply    # 실제로 넣는다
 * npm run hymn:bilingual -- --dir <폴더> --only 150 # 한 곡만
 * ```
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
 * `[아멘]` 섹션인가 — 통째로 버릴 대상이다.
 *
 * 원본을 전수 조사하니 아멘이 두 가지로 적혀 있었다 (2026-08-25):
 *
 * | 어떻게 | 몇 곡 | 뜻 |
 * |---|---|---|
 * | `[아멘]` 섹션 + `아멘` 한 줄 | 294 | 예배 표시 → 섹션째 버리고 `has_amen` |
 * | 가사 줄 끝에 `… 아멘` | 13 | 같은 표시 → 그 낱말만 뗀다 |
 *
 * 628번의 `아멘 아멘 아멘` 은 **둘 다 아니다** — `[1절]` 안의 가사다. 그래서 라벨로
 * 가른다. 줄 모양만 보면 그 곡의 본문을 지워 버린다.
 */
function isAmenSection(label: string): boolean {
  return /^아\s*멘$/.test(label.trim());
}

/**
 * 줄 끝에 붙은 **표시로서의 아멘**을 뗀다.
 *
 * ## `아멘 아멘 아멘` 은 건드리지 않는다
 *
 * 628번의 첫 줄이 그렇다 — 그 곡은 **가사 자체가 아멘**이다. 줄 전체가 아멘이면
 * 표시가 아니라 본문이므로 그대로 둔다.
 */
function stripAmenMarker(text: string): { text: string; had: boolean } {
  const trimmed = text.trim();
  if (/^(아\s*멘\s*)+$/.test(trimmed)) return { text: trimmed, had: false };
  const without = trimmed.replace(/\s*아\s*멘\s*$/, '').trim();
  return { text: without, had: without !== trimmed && without.length > 0 };
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
  before: { sections: number; koLines: number; enLines: number };
  after: { sections: number; koLines: number; enLines: number };
}

function countLines(sections: ReadonlyArray<{ lines: readonly SongLine[] }>, lang: string): number {
  return sections.reduce(
    (sum, section) => sum + section.lines.filter((line) => line.lang === lang).length,
    0,
  );
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
  const dict = loadDictionary();


  const ready: Candidate[] = [];
  const skippedText: Array<{ number: number; title: string; why: string }> = [];
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
    const sections: NewSection[] = parsed
      .filter((section) => {
        // `[아멘]` 섹션은 가사가 아니라 표시다 — 통째로 버리고 플래그로 옮긴다
        if (!isAmenSection(section.label)) return true;
        amen = true;
        return false;
      })
      .map((section) => ({
      kind: section.kind,
      label: section.label,
      lines: section.lines
        .map((line) => {
          if (line.lang !== 'ko') {
            // 찌꺼기를 먼저 뗀다 — 하이픈 판정이 `© Daum Corp.` 를 낱말로 보지 않게
            const scrubbedLine = stripScrapeArtifacts(line.text);
            if (scrubbedLine.changed) scrubbed += 1;
            if (scrubbedLine.text.length === 0) return { ...line, text: '' };
            const cleaned = stripSyllableHyphens(scrubbedLine.text, dict);
            keptHyphens.push(...cleaned.kept);
            return { ...line, text: cleaned.text };
          }
          // 끝에 붙은 아멘은 가사가 아니라 표시다 (줄 전체가 아멘이면 본문이다)
          const marker = stripAmenMarker(line.text);
          if (marker.had) amen = true;
          return { ...line, text: marker.text };
        })
        .filter((line) => line.text.length > 0),
    })).filter((section) => section.lines.length > 0);

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
      skippedText.push({
        number,
        title: target.title,
        why: `${at}자까지 같음 · 외부 ${incomingKo.length}자 / DB ${currentKo.length}자`,
      });
      continue;
    }

    ready.push({
      number,
      title: target.title,
      songId: target.id,
      sections,
      amen,
      keptHyphens,
      scrubbed,
      before: {
        sections: currentSections.length,
        koLines: countLines(currentSections, 'ko'),
        enLines: countLines(currentSections, 'en'),
      },
      after: {
        sections: sections.length,
        koLines: countLines(sections, 'ko'),
        enLines: countLines(sections, 'en'),
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

  if (badName.length > 0) console.log(`\n이름 규약(제목 - 번호.txt)이 아닌 파일 ${badName.length}개: ${badName.slice(0, 3).join(', ')}`);
  if (skippedMissing.length > 0) {
    console.log(`\nDB 에서 곡을 하나로 특정하지 못한 번호 ${skippedMissing.length}개: ${skippedMissing.slice(0, 10).join(', ')}`);
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

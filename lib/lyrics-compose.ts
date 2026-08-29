/**
 * **두 칸으로 편집한 가사를 하나로 합친다** — 한국어 칸 + 다른 언어 칸 → `|` 형식.
 *
 * ## 왜 필요한가
 *
 * 전에는 편집 수단이 넷이었다 — 격자·전체 지우기·원문 붙여넣기·타언어 창. 각각
 * 성격이 달라 무엇을 쓸지 고르는 것부터 일이었다 (2026-08-29 사용자). 그리고 타언어
 * 창은 **한국어가 읽기 전용**이라 한국어를 고치려면 다른 수단으로 옮겨 가야 했다.
 *
 * 이제 두 칸을 나란히 두고 양쪽을 고친다. 이 함수가 그 둘을 `|` 형식으로 합친다.
 *
 * ## 한국어가 구조를 정한다
 *
 * 절 나눔(`[1절]`)과 줄 수는 **한국어 칸을 따른다.** 두 칸이 어긋날 때 무엇을 믿을지
 * 정해 두지 않으면 저장할 때마다 결과가 달라진다. 다른 언어 칸은 **줄 번호로만** 짝짓고,
 * 넘치거나 모자란 것은 버리지 않고 `problems` 로 알린다.
 *
 * ## 손대지 않은 언어는 지키지 않는다 — 되살린다
 *
 * 곡에 세 언어가 있을 때 두 칸으로 편집하면 나머지 하나가 사라질 수 있다. 그래서
 * 원래 가사에서 그 언어를 뽑아 두었다가 **줄 번호 그대로** 되돌려 붙인다.
 */

import { formatLyrics, parseLyrics } from './lyrics-parser.ts';
import type { LangCode, SongLine, SongSection } from '../shared/types.ts';

/** 한 절의 줄 수 견주기 */
export interface SectionCount {
  label: string;
  primary: number;
  secondary: number;
}

export interface ComposeResult {
  /** `|` 형식 가사 — 저장할 값 */
  text: string;
  counts: SectionCount[];
  /** 사람이 봐야 하는 것. 조용히 버리지 않는다 */
  problems: string[];
}

/** 한 칸의 원문을 절 → 줄 목록으로 읽는다. 절 머리가 없으면 통째로 한 절이다 */
function readBlock(text: string): Array<{ label: string; lines: string[] }> {
  const out: Array<{ label: string; lines: string[] }> = [];
  let current: { label: string; lines: string[] } | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = { label: header[1]!.trim(), lines: [] };
      out.push(current);
      continue;
    }
    if (line.length === 0) continue;
    if (!current) {
      current = { label: '1절', lines: [] };
      out.push(current);
    }
    current.lines.push(line);
  }
  return out;
}

/**
 * `[라벨]` 로 시작하는 원문을 만든다 — 사람이 편집할 칸에 넣을 값.
 *
 * `parseLyrics` 의 결과(`id`·`position` 이 없다)와 DB 의 `SongSection` 을 모두 받는다 —
 * 편집 칸을 채울 때는 앞엣것, 저장된 곡을 열 때는 뒤엣것이 온다.
 */
export function toBlock(
  sections: ReadonlyArray<Pick<SongSection, 'label' | 'lines'>>,
  lang: LangCode,
): string {
  return sections
    .map((section) => {
      const lines = [...section.lines]
        .filter((l) => l.lang === lang)
        .sort((a, b) => a.lineIndex - b.lineIndex)
        .map((l) => l.text);
      return `[${section.label}]\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

/**
 * 두 칸을 합친다.
 *
 * @param primaryText 한국어 칸 — 절 나눔과 줄 수를 정한다
 * @param secondaryText 다른 언어 칸 — 줄 번호로 짝짓는다
 * @param secondaryLang 그 언어
 * @param keep 손대지 않은 언어를 되살리기 위한 원래 가사 (`|` 형식)
 */
export function composeLyrics(
  primaryText: string,
  secondaryText: string,
  secondaryLang: LangCode,
  keep?: { text: string; langs: readonly LangCode[]; primaryLang?: LangCode },
): ComposeResult {
  const primaryLang: LangCode = keep?.primaryLang ?? 'ko';
  const koBlocks = readBlock(primaryText);
  const enBlocks = readBlock(secondaryText);
  const problems: string[] = [];
  const counts: SectionCount[] = [];

  /** 라벨로 먼저 찾고, 없으면 순서로 짝짓는다 — 라벨을 한쪽만 고쳤을 수 있다 */
  const byLabel = new Map<string, string[]>();
  for (const block of enBlocks) if (!byLabel.has(block.label)) byLabel.set(block.label, block.lines);
  const usedLabels = new Set<string>();

  /* 손대지 않은 언어를 절·줄 번호로 꺼내 둔다 */
  const others = (keep?.langs ?? []).filter((l) => l !== primaryLang && l !== secondaryLang);
  const kept = new Map<string, SongLine[]>();
  if (others.length > 0 && keep) {
    for (const section of parseLyrics(keep.text, { primaryLang })) {
      kept.set(
        section.label,
        section.lines.filter((l) => others.includes(l.lang)),
      );
    }
  }

  const sections: SongSection[] = [];
  koBlocks.forEach((block, index) => {
    const fromLabel = byLabel.get(block.label);
    const secondary = fromLabel ?? enBlocks[index]?.lines ?? [];
    if (fromLabel) usedLabels.add(block.label);

    counts.push({ label: block.label, primary: block.lines.length, secondary: secondary.length });
    if (secondary.length > block.lines.length) {
      problems.push(
        `${block.label}: ${secondary.length - block.lines.length}줄이 남습니다 (한국어 ${block.lines.length}줄)`,
      );
    }

    const lines: SongLine[] = [];
    block.lines.forEach((text, lineIndex) => {
      lines.push({ lineIndex, lang: primaryLang, text });
      const other = secondary[lineIndex];
      if (other !== undefined && other.length > 0) {
        lines.push({ lineIndex, lang: secondaryLang, text: other });
      }
    });
    for (const line of kept.get(block.label) ?? []) {
      if (line.lineIndex < block.lines.length) lines.push(line);
    }

    sections.push({
      id: -(index + 1),
      kind: 'verse',
      label: block.label,
      position: index,
      lines,
    });
  });

  for (const block of enBlocks) {
    if (byLabel.has(block.label) && !usedLabels.has(block.label) && block.lines.length > 0) {
      problems.push(`${block.label}: 한국어 쪽에 같은 절이 없습니다`);
    }
  }
  if (koBlocks.length === 0) problems.push('한국어 칸이 비었습니다');

  return { text: formatLyrics(sections, primaryLang), counts, problems };
}

/**
 * 다른 언어 가사 붙이기 — 이미 있는 주 언어 줄에 짝지어 끼운다.
 *
 * ## 왜 따로 두는가
 *
 * 가사 편집 칸에서 손으로 `|` 줄을 끼우면 4절 × 4줄만 해도 16번을 정확히 맞춰야 한다.
 * 한 줄이 밀리면 **어느 번역이 어느 줄에 붙는지가 어긋난 채** 저장되고, 화면에서야
 * 드러난다. 번역만 순서대로 붙여 넣게 하고 짝은 기계가 맞춘다.
 *
 * ## 지키는 것 넷
 *
 * 1. **주 언어를 고치지 않는다.** 사람이 승인한 글이다 (`lines_source='manual'`).
 * 2. **다른 언어를 지우지 않는다.** 中文 을 붙일 때 English 가 사라지면 안 된다.
 *    (이것이 실제로 고장났던 자리다 — 언어 구분 없이 모든 `|` 줄을 갈아 끼웠다.)
 * 3. **넘친 줄을 조용히 버리지 않는다.** `dropped` 로 돌려주고 `problems` 에 적는다.
 * 4. **결과는 제안이다.** 글자만 만들고 저장은 사람이 편집 칸을 보고 누른다.
 *
 * 언어를 다루는 일은 `lyrics-parser.ts` 에 맡긴다 — 언어 표(`|en`)를 읽고 쓰는
 * 규칙이 두 곳에 있으면 어긋난다.
 */

import { formatLyrics, parseLyrics, type ParsedSection } from './lyrics-parser.ts';
import type { LangCode } from '../shared/types.ts';

/** 붙여 넣은 번역을 절 단위로 끊은 묶음 */
interface SecondaryBlock {
  /** `[2절]` 처럼 라벨을 함께 준 경우에만 찬다 */
  label?: string;
  lines: string[];
}

export interface MergeResult {
  /** 편집 칸에 채울 글 */
  text: string;
  /** 짝지은 줄 수 */
  paired: number;
  /** 그 언어의 있던 줄을 갈아 끼운 수 */
  replaced: number;
  /** 자리가 없어 넣지 못한 줄 — **버린 것이 아니라 알리는 것** */
  dropped: string[];
  /** 사람이 봐야 하는 것들 */
  problems: string[];
}

const SECTION_HEADER = /^\[(.+)\]$/;

/**
 * 붙여 넣은 번역을 절 단위로 끊는다.
 *
 * 빈 줄이 절 경계다. 여러 번 이어져도 하나로 본다 — 웹에서 복사하면 빈 줄이
 * 두세 개씩 붙어 오는 일이 흔하다. `[..]` 라벨이 있으면 그것을 우선한다.
 */
function splitSecondary(text: string): SecondaryBlock[] {
  const blocks: SecondaryBlock[] = [];
  let current: SecondaryBlock | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();

    if (line.length === 0) {
      // 빈 줄 = 절 경계. 다음 글자를 만날 때 새 묶음을 연다
      current = null;
      continue;
    }

    const header = SECTION_HEADER.exec(line);
    if (header) {
      current = { label: header[1]!.trim(), lines: [] };
      blocks.push(current);
      continue;
    }

    if (!current) {
      current = { lines: [] };
      blocks.push(current);
    }
    current.lines.push(line);
  }

  return blocks.filter((block) => block.lines.length > 0);
}

/**
 * 라벨이 맞는 묶음을 고른다.
 *
 * 웹에서 절 순서가 뒤바뀐 채로 복사되는 일이 있어, 라벨을 준 경우에는 순서보다
 * 라벨을 믿는다. 라벨이 없으면 **순서대로** 짝짓는다.
 */
function pickBlock(
  blocks: SecondaryBlock[],
  used: Set<number>,
  label: string,
  index: number,
): number {
  const byLabel = blocks.findIndex((block, i) => !used.has(i) && block.label === label);
  if (byLabel >= 0) return byLabel;

  // 라벨로 못 찾으면 순서 — 아직 안 쓴 것 중 가장 앞
  if (!used.has(index) && blocks[index] && blocks[index]!.label === undefined) return index;
  return blocks.findIndex((_, i) => !used.has(i));
}

/**
 * 번역을 주 언어 줄에 짝지어 편집 칸용 글을 만든다.
 *
 * @param primaryText 편집 칸에 있는 글 (이미 다른 언어 줄이 있어도 된다)
 * @param secondaryText 붙여 넣은 번역만 (절 사이는 빈 줄)
 * @param lang 붙이는 언어 — 이 언어의 줄만 갈아 끼운다
 * @param primaryLang 기준이 되는 언어
 */
export function mergeSecondaryLyrics(
  primaryText: string,
  secondaryText: string,
  lang: LangCode = 'en',
  primaryLang: LangCode = 'ko',
): MergeResult {
  const blocks = splitSecondary(secondaryText);

  // 붙일 것이 없으면 아무것도 하지 않는다 — 원본을 그대로 돌려준다
  if (blocks.length === 0) {
    return { text: primaryText, paired: 0, replaced: 0, dropped: [], problems: [] };
  }

  const sections = parseLyrics(primaryText, { primaryLang });
  const problems: string[] = [];
  const dropped: string[] = [];
  const used = new Set<number>();
  let paired = 0;
  let replaced = 0;

  const next: ParsedSection[] = sections.map((section, index) => {
    const pick = pickBlock(blocks, used, section.label, index);
    const block = pick >= 0 ? blocks[pick] : undefined;
    if (pick >= 0) used.add(pick);

    /*
     * 기준이 되는 줄 — 이 언어의 줄에 번역을 붙인다.
     *
     * 주 언어 줄이 없는 절(번역만 있는 절)은 첫 언어를 기준으로 삼는다.
     * 그러지 않으면 붙일 자리가 없다고 잘못 알린다.
     */
    const anchors = section.lines
      .filter((line) => line.lang === primaryLang)
      .sort((a, b) => a.lineIndex - b.lineIndex);
    const anchorIndexes =
      anchors.length > 0
        ? anchors.map((line) => line.lineIndex)
        : [...new Set(section.lines.map((line) => line.lineIndex))].sort((a, b) => a - b);

    if (!block) {
      problems.push(`${section.label}: 짝지을 번역이 없습니다 — 기존 언어만 나갑니다`);
      return section;
    }

    // 이 언어의 있던 줄만 걷어낸다. **다른 언어는 그대로 둔다.**
    const kept = section.lines.filter((line) => line.lang !== lang);
    replaced += section.lines.length - kept.length;

    const added = block.lines.slice(0, anchorIndexes.length).map((text, i) => ({
      lineIndex: anchorIndexes[i]!,
      lang,
      text,
    }));
    paired += added.length;

    // 넘친 번역 — 넣을 자리가 없다. **버리지 않고 알린다**
    const extra = block.lines.slice(anchorIndexes.length);
    if (extra.length > 0) {
      dropped.push(...extra);
      problems.push(
        `${section.label}: 번역이 ${extra.length}줄 남았습니다 (기준 ${anchorIndexes.length}줄) — ` +
          extra.map((line) => `'${line}'`).join(', '),
      );
    }

    const short = anchorIndexes.length - block.lines.length;
    if (short > 0) {
      problems.push(`${section.label}: 번역이 ${short}줄 모자랍니다 — 그 줄은 기준 언어만 나갑니다`);
    }

    return { ...section, lines: [...kept, ...added] };
  });

  // 기준 절보다 번역 절이 많은 경우 — 남은 묶음을 통째로 알린다
  const leftover = blocks.filter((_, i) => !used.has(i));
  if (leftover.length > 0) {
    for (const block of leftover) dropped.push(...block.lines);
    problems.push(
      `번역 절이 ${leftover.length}개 더 있습니다 (기준 절 ${sections.length}개) — ` +
        '넣을 자리가 없어 빼 두었습니다',
    );
  }

  return { text: formatLyrics(next, primaryLang), paired, replaced, dropped, problems };
}

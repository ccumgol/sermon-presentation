/**
 * 영어 가사 붙이기 — 이미 있는 한국어 줄에 영어를 짝지어 끼운다.
 *
 * ## 왜 따로 두는가
 *
 * 가사 편집 칸에서 손으로 `|` 줄을 끼우면 4절 × 4줄만 해도 16번을 정확히 맞춰야 한다.
 * 한 줄이 밀리면 **어느 영어가 어느 한국어의 번역인지가 어긋난 채** 저장되고,
 * 화면에서야 드러난다. 영어만 순서대로 붙여 넣게 하고 짝은 기계가 맞춘다.
 *
 * ## 지키는 것 셋
 *
 * 1. **한국어를 고치지 않는다.** 사람이 승인한 글이다 (`lines_source='manual'`).
 *    이 파일은 한국어 줄을 읽기만 하고 그대로 다시 쓴다.
 * 2. **영어를 조용히 버리지 않는다.** 자리가 없어 남으면 `dropped` 로 돌려주고
 *    `problems` 에 적는다. 조용히 사라지면 그 절만 영어가 빠진 채로 예배에 나간다.
 * 3. **결과는 제안이다.** 여기서는 글자만 만들고, 저장은 사람이 편집 칸을 보고 누른다.
 */

/** 붙여 넣은 영어를 절 단위로 끊은 묶음 */
interface SecondaryBlock {
  /** `[2절]` 처럼 라벨을 함께 준 경우에만 찬다 */
  label?: string;
  lines: string[];
}

export interface MergeResult {
  /** 편집 칸에 채울 글 (`|` 형식) */
  text: string;
  /** 짝지은 줄 수 */
  paired: number;
  /** 있던 `|` 줄을 갈아 끼운 수 */
  replaced: number;
  /** 자리가 없어 넣지 못한 영어 줄 — **버린 것이 아니라 알리는 것** */
  dropped: string[];
  /** 사람이 봐야 하는 것들 */
  problems: string[];
}

/** 절 머리글 `[1절]` */
const SECTION_HEADER = /^\[(.+)\]$/;

/**
 * 붙여 넣은 영어를 절 단위로 끊는다.
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

/** 한국어 쪽 한 절 — 줄과, 그 줄 뒤에 붙어 있던 `|` 줄의 개수 */
interface PrimarySection {
  header: string;
  lines: string[];
  /** 원래 있던 `|` 줄 수 (갈아 끼운 수를 세기 위해) */
  existing: number;
}

/**
 * 편집 칸의 글을 절·줄로 읽는다.
 *
 * 있던 `|` 줄은 **떼어 낸다** — 새로 붙이는 영어로 갈아 끼우기 때문이다.
 * 남겨 두면 한 줄에 영어가 두 벌 쌓여 어느 것이 최신인지 알 수 없게 된다.
 */
function readPrimary(text: string): PrimarySection[] {
  const sections: PrimarySection[] = [];
  let current: PrimarySection | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;

    const header = SECTION_HEADER.exec(line);
    if (header) {
      current = { header: line, lines: [], existing: 0 };
      sections.push(current);
      continue;
    }

    if (line.startsWith('|')) {
      if (current) current.existing += 1;
      continue;
    }

    if (!current) {
      // 절 머리글 없이 시작한 글 — 있는 그대로 한 절로 본다
      current = { header: '', lines: [], existing: 0 };
      sections.push(current);
    }
    current.lines.push(line);
  }

  return sections.filter((section) => section.lines.length > 0);
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
  section: PrimarySection,
  index: number,
): number {
  const label = SECTION_HEADER.exec(section.header)?.[1]?.trim();

  if (label !== undefined) {
    const byLabel = blocks.findIndex((block, i) => !used.has(i) && block.label === label);
    if (byLabel >= 0) return byLabel;
  }

  // 라벨로 못 찾으면 순서 — 아직 안 쓴 것 중 가장 앞
  if (!used.has(index) && blocks[index] && blocks[index]!.label === undefined) return index;
  return blocks.findIndex((_, i) => !used.has(i));
}

/**
 * 영어를 한국어 줄에 짝지어 `|` 형식의 글을 만든다.
 *
 * @param primaryText 편집 칸에 있는 글 (한국어, 이미 `|` 줄이 있어도 된다)
 * @param secondaryText 붙여 넣은 영어만 (절 사이는 빈 줄)
 */
export function mergeSecondaryLyrics(primaryText: string, secondaryText: string): MergeResult {
  const blocks = splitSecondary(secondaryText);
  const sections = readPrimary(primaryText);

  // 붙일 것이 없으면 아무것도 하지 않는다 — 원본을 그대로 돌려준다
  if (blocks.length === 0) {
    return { text: primaryText, paired: 0, replaced: 0, dropped: [], problems: [] };
  }

  const problems: string[] = [];
  const dropped: string[] = [];
  const used = new Set<number>();
  let paired = 0;
  let replaced = 0;

  const out: string[] = [];

  sections.forEach((section, index) => {
    const pick = pickBlock(blocks, used, section, index);
    const block = pick >= 0 ? blocks[pick] : undefined;
    if (pick >= 0) used.add(pick);

    const name = SECTION_HEADER.exec(section.header)?.[1] ?? `${index + 1}번째 묶음`;

    if (section.header.length > 0) out.push(section.header);

    section.lines.forEach((line, lineIndex) => {
      out.push(line);
      const english = block?.lines[lineIndex];
      if (english !== undefined) {
        out.push(`| ${english}`);
        paired += 1;
      }
    });

    if (block) {
      replaced += Math.min(section.existing, section.lines.length);

      // 넘친 영어 — 넣을 자리가 없다. **버리지 않고 알린다**
      const extra = block.lines.slice(section.lines.length);
      if (extra.length > 0) {
        dropped.push(...extra);
        problems.push(
          `${name}: 영어가 ${extra.length}줄 남았습니다 (한국어 ${section.lines.length}줄) — ` +
            extra.map((line) => `'${line}'`).join(', '),
        );
      }

      const short = section.lines.length - block.lines.length;
      if (short > 0) {
        problems.push(`${name}: 영어가 ${short}줄 모자랍니다 — 그 줄은 한국어만 나갑니다`);
      }
    } else {
      problems.push(`${name}: 짝지을 영어가 없습니다 — 한국어만 나갑니다`);
    }

    out.push('');
  });

  // 한국어 절보다 영어 절이 많은 경우 — 남은 묶음을 통째로 알린다
  const leftover = blocks.filter((_, i) => !used.has(i));
  if (leftover.length > 0) {
    for (const block of leftover) dropped.push(...block.lines);
    problems.push(
      `영어 절이 ${leftover.length}개 더 있습니다 (한국어 절 ${sections.length}개) — ` +
        '넣을 자리가 없어 빼 두었습니다',
    );
  }

  return { text: out.join('\n').trim(), paired, replaced, dropped, problems };
}

/**
 * 가사 비교 격자 — 줄마다 여러 언어를 모아 보는 모델.
 *
 * ## 왜 이 모양인가
 *
 * 찬양에는 성경의 `장:절` 같은 **외부 기준이 없다.** `line_index 0` 이 무엇인지
 * 정해 주는 권위가 없어 언어별 줄 수가 어긋날 수 있다 — 새찬송가 1장이 그 예다
 * (한국어 2줄, 영어 원문 4줄). 그래서 기계가 맞출 수 없고 사람이 눈으로 봐야 한다.
 *
 * 그 판단을 도우려면 **같은 줄의 여러 언어가 붙어 있어야** 한다. 언어를 열로 놓으면
 * 편집 칸 479px 에 865px 이 필요해 좌우 스크롤이 생긴다(1440×900 실측). 그래서
 * **줄로 묶고 언어를 행으로** 놓는다 — 각 언어가 전체 폭을 쓴다.
 *
 * ## 없는 줄을 빠뜨리지 않는다
 *
 * 짝이 없는 자리는 `text: null` 로 남긴다. 목록에서 빼 버리면 화면에 아무것도
 * 안 보여 '이 줄은 번역이 없다' 를 알 수 없다. 넣을 자리가 보여야 넣는다.
 */

import type { LangCode } from '../shared/types.ts';
import type { ParsedSection } from './lyrics-parser.ts';

export interface GridCell {
  lang: LangCode;
  /** 그 언어의 글. **없으면 `null`** — 빈 문자열과 구분한다 */
  text: string | null;
}

export interface GridRow {
  lineIndex: number;
  /** 고른 언어 순서대로 — 화면 위아래 순서가 된다 */
  cells: GridCell[];
}

export interface GridSection {
  label: string;
  rows: GridRow[];
  /** 언어별 줄 수 — 절 단위로 먼저 어긋남을 알린다 */
  counts: Record<LangCode, number>;
  /**
   * 줄 수가 어긋났는가.
   *
   * **아예 없는 언어는 어긋남으로 보지 않는다** — 그것은 '아직 안 넣음' 이고,
   * 어긋남은 '넣었는데 수가 안 맞음' 이다. 둘을 같이 알리면 아직 시작도 안 한
   * 언어 때문에 경고가 온 절에 뜬다.
   */
  uneven: boolean;
}

/** 편집 칸의 구조를 격자로 바꾼다 */
export function buildGrid(
  sections: readonly ParsedSection[],
  langs: readonly LangCode[],
): GridSection[] {
  return sections.map((section) => {
    const counts: Record<LangCode, number> = {};
    for (const lang of langs) counts[lang] = 0;
    for (const line of section.lines) {
      // 고르지 않은 언어는 세지 않는다 (격자에 칸이 없으므로)
      const current = counts[line.lang];
      if (current !== undefined) counts[line.lang] = current + 1;
    }

    // 줄 번호는 **어느 언어든 있는 것을 모두** 모은다. 주 언어에만 맞추면
    // 번역이 더 긴 절에서 뒤쪽 번역 줄이 화면에서 사라진다.
    const indexes = [...new Set(section.lines.map((line) => line.lineIndex))].sort((a, b) => a - b);

    const rows: GridRow[] = indexes.map((lineIndex) => ({
      lineIndex,
      cells: langs.map((lang) => ({
        lang,
        text: section.lines.find((l) => l.lineIndex === lineIndex && l.lang === lang)?.text ?? null,
      })),
    }));

    const present = langs.filter((lang) => (counts[lang] ?? 0) > 0);
    const sizes = new Set(present.map((lang) => counts[lang]));

    return { label: section.label, rows, counts, uneven: sizes.size > 1 };
  });
}

/**
 * 한 칸의 글을 바꾼다. **새 배열을 돌려준다.**
 *
 * 빈 글(공백만)이면 그 줄을 지운다 — 빈 줄이 화면에 나가면 가사 사이에 구멍이 생긴다.
 */
export function setCell(
  sections: readonly ParsedSection[],
  sectionIndex: number,
  lineIndex: number,
  lang: LangCode,
  text: string,
): ParsedSection[] {
  const target = sections[sectionIndex];
  if (!target) return [...sections];

  const trimmed = text.trim();
  const others = target.lines.filter((line) => !(line.lineIndex === lineIndex && line.lang === lang));
  const lines =
    trimmed.length === 0 ? others : [...others, { lineIndex, lang, text: trimmed }];

  // 화면에 그리는 순서대로 정렬해 둔다 — 저장 글에서도 읽기 쉬운 순서가 된다
  lines.sort((a, b) => a.lineIndex - b.lineIndex);

  return sections.map((section, index) =>
    index === sectionIndex ? { ...section, lines } : section,
  );
}

/** 한 언어를 통째로 지운다 — 되돌릴 수 없으므로 부르는 쪽에서 확인을 받는다 */
export function removeLang(
  sections: readonly ParsedSection[],
  lang: LangCode,
): ParsedSection[] {
  return sections.map((section) => ({
    ...section,
    lines: section.lines.filter((line) => line.lang !== lang),
  }));
}

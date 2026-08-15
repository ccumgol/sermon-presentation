/**
 * 본문(Passage) → 슬라이드 배열.
 *
 * 다역본을 함께 띄울 때 **같은 절이 같은 슬라이드에** 오도록 절 번호로 정렬한다.
 * 주 역본(첫 블록)의 절 순서를 기준으로 삼는다.
 *
 * 역본마다 절 분할이 달라 보조 역본에 해당 절이 없을 수 있다(공동번역 31,258절 vs
 * 개역개정 31,102절). Phase 2 에서는 없는 절을 조용히 건너뛴다.
 * 병합 절 처리(1-2절을 한 절로 합친 역본)는 Phase 3 에서 다룬다.
 */

import type { Passage, PassageBlock, SlidePayload, Verse } from '../shared/types.ts';

export type PagingMode =
  /** 한 화면에 1절 */
  | 'verse'
  /** 한 화면에 2절 */
  | 'pair'
  /** 구간 전체를 한 화면에 */
  | 'all'
  /** 실측 높이 기준 자동 분할 — Phase 3. 현재는 'pair' 와 같다. */
  | 'auto';

const PAGE_SIZE: Record<PagingMode, number> = {
  verse: 1,
  pair: 2,
  all: Number.POSITIVE_INFINITY,
  auto: 2,
};

/** 절을 가리키는 안정적인 키 */
function verseKey(v: Pick<Verse, 'book' | 'chapter' | 'verse'>): string {
  return `${v.book}:${v.chapter}:${v.verse}`;
}

/**
 * 정렬 기준이 될 블록. 주 역본에 본문이 없으면(헬라어로 구약 조회 등)
 * 실제로 절이 있는 첫 블록으로 넘어간다 — 화면이 비는 것을 막는다.
 */
function pickReferenceBlock(blocks: PassageBlock[]): PassageBlock | undefined {
  return blocks.find((b) => !b.unavailable && b.verses.length > 0);
}

function chunk<T>(items: T[], size: number): T[][] {
  if (!Number.isFinite(size)) return items.length > 0 ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function buildSlides(passage: Passage, mode: PagingMode = 'pair'): SlidePayload[] {
  const reference = pickReferenceBlock(passage.blocks);
  if (!reference) return [];

  const pages = chunk(reference.verses.map(verseKey), PAGE_SIZE[mode]);

  return pages.map((keys, index) => {
    const keySet = new Set(keys);

    const blocks: PassageBlock[] = passage.blocks.map((block) => ({
      ...block,
      verses: block.verses.filter((v) => keySet.has(verseKey(v))),
    }));

    return {
      kind: 'bible',
      reference: passage.referenceAbbr,
      blocks,
      // 소제목은 첫 슬라이드에만 — 매 화면 반복하면 본문 자리를 잡아먹는다
      ...(index === 0 && passage.heading ? { heading: passage.heading } : {}),
    };
  });
}

/** 슬라이드 각각이 실제로 표시할 절 범위 — 컨트롤 패널 목록에 쓴다 */
export function describeSlide(slide: SlidePayload): string {
  if (slide.kind !== 'bible') return '';
  const primary = slide.blocks.find((b) => b.verses.length > 0);
  if (!primary || primary.verses.length === 0) return '';

  const first = primary.verses[0]!;
  const last = primary.verses[primary.verses.length - 1]!;

  if (first.chapter === last.chapter) {
    return first.verse === last.verse
      ? `${first.chapter}:${first.verse}`
      : `${first.chapter}:${first.verse}-${last.verse}`;
  }
  return `${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`;
}

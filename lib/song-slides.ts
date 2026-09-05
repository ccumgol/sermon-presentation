/**
 * 찬양 섹션 → 슬라이드.
 *
 * 2언어 표시의 핵심은 `lineIndex` 페어링이다. 같은 lineIndex 를 가진 줄들이
 * 한 묶음이 되어 화면에서 위아래(또는 좌우)로 짝지어 나온다.
 * 통짜 텍스트로 저장했다면 이 대응을 만들 방법이 없다 (계획서 §3.2).
 */

import type { LangCode, SlidePayload, Song, SongLine, SongSection } from '../shared/types.ts';

/** 한 화면에 담을 줄 수 */
export type LinesPerSlide = 1 | 2 | 4 | 'section';

export interface SongSlideOptions {
  /** 표시할 언어 — 순서가 표시 순서다. 첫 번째가 주 언어. */
  langs: LangCode[];
  linesPerSlide?: LinesPerSlide;
  /** 저작권 표기를 붙일지 */
  includeCredit?: boolean;
  /** 표시 한 행의 최대 글자 수 — 이 폭에 맞춰 운율 행을 짝으로 묶는다 */
  maxCharsPerLine?: number;
}

/** 템플릿이 지정하지 않았을 때의 표시 행 폭 */
export const DEFAULT_MAX_CHARS_PER_LINE = 24;

/**
 * 섹션의 줄을 lineIndex 별 묶음으로 만든다.
 *
 * 선택한 언어 중 그 줄에 없는 언어는 조용히 빠진다 — 한국어만 있는 찬송가에
 * 영어를 함께 켜도 빈 자리가 생기지 않는다.
 */
export function pairLines(section: SongSection, langs: readonly LangCode[]): SongLine[][] {
  const maxIndex = section.lines.reduce((max, line) => Math.max(max, line.lineIndex), -1);
  const groups: SongLine[][] = [];

  for (let index = 0; index <= maxIndex; index++) {
    const atIndex = section.lines.filter((line) => line.lineIndex === index);
    // 요청한 언어 순서대로 담는다 (표시 순서 = 요청 순서)
    const group = langs.flatMap((lang) => atIndex.filter((line) => line.lang === lang));
    if (group.length > 0) groups.push(group);
  }

  return groups;
}

/** 한 묶음에서 가장 긴 언어의 글자 수 (공백 제외) */
function groupWidth(group: readonly SongLine[]): number {
  return group.reduce((max, line) => Math.max(max, line.text.replace(/\s/g, '').length), 0);
}

/** 인접한 두 묶음을 합친다 — 언어별로 이어 붙여 줄 짝을 유지한다 */
function mergePair(first: readonly SongLine[], second: readonly SongLine[]): SongLine[] {
  const langs = [...new Set([...first, ...second].map((line) => line.lang))];

  return langs.map((lang) => {
    const texts = [first, second]
      .map((group) => group.find((line) => line.lang === lang)?.text)
      .filter((text): text is string => text !== undefined);
    return { lineIndex: first[0]!.lineIndex, lang, text: texts.join(' ') };
  });
}

/**
 * 저장된 운율 행을 표시 폭에 맞춰 묶는다.
 *
 * 가사는 악보의 운율 행 단위로 저장한다 (새256 = 9.9.9.9). 화면 구성에 따라
 * 필요한 행 길이가 다르므로, 표시할 때 인접 행을 **짝으로** 묶어 폭을 맞춘다.
 *
 *   9.9.9.9  --24자-->  19.19   (하단 두 줄 템플릿)
 *   9.9.9.9  --12자-->  9.9.9.9 (전체화면 큰 글씨)
 *
 * **반드시 짝으로 묶는다.** 3개를 2+1 로 묶으면 행 길이가 들쭉날쭉해지고 홀수
 * 행이 되어 2줄씩 표시에서 마지막 한 줄이 혼자 남는다. 그래서 절반으로 나누어
 * 떨어질 때만, 그리고 결과가 짝수(또는 1행)일 때만 묶는다.
 *
 * 모든 짝이 폭 안에 들어와야 묶는다 — 일부만 묶으면 운율이 깨진다.
 */
export function fitLinesToWidth(groups: readonly SongLine[][], maxChars: number): SongLine[][] {
  let current = [...groups];

  while (current.length >= 2 && current.length % 2 === 0) {
    const halved = current.length / 2;
    // 결과가 홀수면 2줄씩 표시에서 고아 줄이 생긴다 (1행은 예외 — 나눌 것이 없다)
    if (halved !== 1 && halved % 2 !== 0) break;

    const merged: SongLine[][] = [];
    for (let index = 0; index < current.length; index += 2) {
      merged.push(mergePair(current[index]!, current[index + 1]!));
    }
    if (merged.some((group) => groupWidth(group) > maxChars)) break;

    current = merged;
  }

  return current;
}

/** items 를 pages 장에 균등하게 나눈다 (앞장이 한 줄 더 많다) */
function distribute<T>(items: T[], pages: number): T[][] {
  const base = Math.floor(items.length / pages);
  const extra = items.length % pages;

  const out: T[][] = [];
  let cursor = 0;
  for (let page = 0; page < pages; page++) {
    const size = base + (page < extra ? 1 : 0);
    out.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return out;
}

/**
 * 줄을 화면 단위로 나눈다 — **고아 줄을 만들지 않는다.**
 *
 * 앞에서부터 기계적으로 잘라 담으면 3줄짜리 절이 '2줄 + 1줄'이 되어 마지막
 * 한 줄이 혼자 다음 화면으로 넘어간다. 찬송가 섹션의 30%(1,484/4,877)가
 * 홀수 줄이라 2줄씩 설정에서 실제로 자주 일어난다. 가사는 구가 이어지는데
 * 화면이 끊기면 회중이 따라 부르지 못한다.
 *
 * 그래서 두 가지를 한다:
 *  1. 필요한 장수를 먼저 정하고 **균등 분배** (6줄·4줄씩 → 4+2 가 아니라 3+3)
 *  2. 그래도 마지막 장이 한 줄뿐이면 장수를 하나 줄인다
 *     (한 장에 `size + 1` 줄까지만 허용 — 넘치면 출력 페이지가 배율로 줄인다)
 */
export function chunkWithoutOrphans<T>(items: T[], size: number): T[][] {
  if (!Number.isFinite(size) || size <= 0) return items.length > 0 ? [items] : [];
  if (items.length === 0) return [];

  const pages = Math.ceil(items.length / size);
  const even = distribute(items, pages);

  // 마지막 장이 한 줄뿐이면 한 장 줄여 붙인다.
  // '1줄씩'은 모든 화면이 한 줄인 것이 의도이므로 고아로 보지 않는다.
  if (size > 1 && pages > 1 && even[even.length - 1]!.length === 1) {
    const merged = distribute(items, pages - 1);
    if (merged[0]!.length <= size + 1) return merged;
  }

  return even;
}

/**
 * 저작권·출처 표기.
 *
 * 수록 곡집이 여러 개면 첫 번째(정렬 순서상 가장 앞선 곡집)만 쓴다 —
 * 화면 아래 한 줄에 여러 곡집 번호를 늘어놓으면 읽히지 않는다.
 * '기타'처럼 번호가 없는 곡집은 표기에서 뺀다.
 */
function creditOf(song: Song): string | undefined {
  const parts: string[] = [];

  const numbered = song.entries.find((entry) => entry.number !== undefined);
  if (numbered) parts.push(`${numbered.songbookName} ${numbered.number}장`);

  if (song.copyright) parts.push(song.copyright);
  if (song.ccliNumber) parts.push(`CCLI ${song.ccliNumber}`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** 섹션 하나를 슬라이드 배열로 */
export function buildSectionSlides(
  song: Song,
  section: SongSection,
  options: SongSlideOptions,
): SlidePayload[] {
  const paired = pairLines(section, options.langs);
  if (paired.length === 0) return [];

  /*
   * 저장된 운율 행을 표시 폭에 맞춰 묶는다 (9.9.9.9 → 19.19).
   *
   * **사람이 앱에서 직접 친 줄(`manual`)은 묶지 않는다.** 친 줄 자체가 의도이고,
   * 가사 편집 칸이 '줄바꿈이 그대로 화면 줄이 됩니다' 라고 약속한다. 묶으면 그 약속이
   * 깨진다 — 12줄을 쳤는데 4줄이 한 화면에 나갔다 (2026-09-01 사용자 신고).
   *
   * 찬송가(`auto`·`imported`)는 그대로 묶는다. 짧은 운율 행을 한 줄씩 띄우면 화면이
   * 텅 비기 때문이고, 그 모습이 이미 예배에서 쓰이고 있다.
   */
  const groups =
    section.linesSource === 'manual'
      ? paired
      : fitLinesToWidth(paired, options.maxCharsPerLine ?? DEFAULT_MAX_CHARS_PER_LINE);

  const perSlide = options.linesPerSlide ?? 2;
  const pages = perSlide === 'section' ? [groups] : chunkWithoutOrphans(groups, perSlide);
  const credit = options.includeCredit ? creditOf(song) : undefined;

  return pages.map((lines, index) => ({
    kind: 'song',
    title: song.title,
    sectionLabel: section.label,
    // 절 번호는 첫 장에만 — 출력 페이지는 슬라이드 하나만 받아 앞뒤를 볼 수 없다
    ...(index === 0 ? { sectionStart: true } : {}),
    lines,
    ...(credit ? { credit } : {}),
  }));
}

/**
 * 이 슬라이드가 **그 절의 첫 장**인가.
 *
 * 절이 길면 여러 장으로 나뉘는데(`1절 1/2`, `1절 2/2`), 번호는 첫 장에만 붙인다.
 * 이어지는 장에도 붙으면 같은 번호가 연달아 보여 절이 바뀐 것처럼 읽힌다.
 *
 * 라벨 문자열('1절 1/2')을 파싱하지 않고 **앞 슬라이드와 섹션을 비교**한다 —
 * 라벨 형식이 바뀌어도 판정이 깨지지 않는다.
 */
export function isSectionStart(slide: SlidePayload, previous: SlidePayload | undefined): boolean {
  if (slide.kind !== 'song') return false;
  if (!previous || previous.kind !== 'song') return true;
  return previous.sectionLabel !== slide.sectionLabel;
}

/**
 * 섹션 라벨에서 **절 번호 접두사**를 만든다 — `'1절'` → `'1. '`.
 *
 * 찬송가는 절이 여럿이라, 목록에서 가사만 보면 몇 절인지 바로 안 보인다.
 * 사용자가 실제로 쓰는 표기가 `'1. 주 믿는 사람 일어나…'` 라 그 형식을 따른다.
 *
 * 후렴·브리지처럼 **번호가 없는 섹션은 접두사를 붙이지 않는다** — 목록의 라벨 칸에
 * 이미 '후렴' 이 보이므로, 없는 번호를 지어내는 것보다 비워 두는 편이 정확하다.
 */
export function verseNumberPrefix(sectionLabel: string | undefined): string {
  const matched = /(\d+)/.exec(sectionLabel ?? '');
  return matched ? `${matched[1]}. ` : '';
}

/** 슬라이드 라벨 — 컨트롤 패널 목록용. `'1절'` 또는 `'1절 1/2'` */
export function describeSongSlide(slide: SlidePayload, indexInSection: number, totalInSection: number): string {
  if (slide.kind !== 'song') return '';
  return totalInSection > 1 ? `${slide.sectionLabel} ${indexInSection + 1}/${totalInSection}` : slide.sectionLabel;
}

export interface SongDeck {
  slides: SlidePayload[];
  labels: string[];
  /**
   * 슬라이드마다 **몇 번째 섹션**의 것인지 (`sequence` 를 준 경우 그 순서 기준).
   *
   * 악보 맞추기가 이걸 쓴다 — 절이 바뀌는 자리를 알아야 악보의 어느 단인지 정할 수
   * 있다. 슬라이드의 `sectionLabel` 로는 안 된다: 라벨이 같은 섹션이 둘인 곡이 있다
   * (실제 자료에 `1절 2절 2절` 이 있다).
   */
  slideSections: number[];
  /** 섹션마다 줄이 몇 개인지 — `slideSections` 와 같은 순서·기준이다 */
  sectionLines: number[];
}

/**
 * 곡 전체 슬라이드에 라벨을 붙인다.
 * 섹션 안에서 몇 번째인지 표시해야 오퍼레이터가 위치를 알 수 있다.
 */
export function buildSongDeck(
  song: Song,
  options: SongSlideOptions & { sequence?: number[] },
): SongDeck {
  const order = options.sequence
    ? options.sequence.flatMap((id) => {
        const section = song.sections.find((s) => s.id === id);
        return section ? [section] : [];
      })
    : [...song.sections].sort((a, b) => a.position - b.position);

  const slides: SlidePayload[] = [];
  const labels: string[] = [];
  const slideSections: number[] = [];

  for (const [sectionIndex, section] of order.entries()) {
    const sectionSlides = buildSectionSlides(song, section, options);
    for (const [index, slide] of sectionSlides.entries()) {
      slides.push(slide);
      labels.push(describeSongSlide(slide, index, sectionSlides.length));
      slideSections.push(sectionIndex);
    }
  }

  return {
    slides,
    labels,
    slideSections,
    sectionLines: order.map((section) => new Set(section.lines.map((line) => line.lineIndex)).size),
  };
}

/** 곡이 실제로 가진 언어 목록에서 표시 가능한 조합을 추린다 */
export function availableLangs(song: Song): LangCode[] {
  const order = ['ko', 'en', 'zh', 'ja'];
  return [...song.langs].sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

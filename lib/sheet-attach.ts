/**
 * 곡 슬라이드에 **악보 조각을 붙인다.**
 *
 * `lib/sheet-match.ts` 가 '슬라이드 → 몇 번째 단' 을 정하고, 여기서는 그것을
 * 화면이 쓸 수 있는 `SheetRef`(주소 + 자를 범위 %)로 바꾼다.
 *
 * 두 단계를 나눈 이유: 배분 규칙은 자료를 보고 고쳐 나갈 부분이고(모양 짐작·비례),
 * 여기는 픽셀을 퍼센트로 옮기는 계산이라 바뀔 일이 없다. 섞으면 배분을 고칠 때마다
 * 좌표 계산까지 다시 봐야 한다.
 */

import { sheetFileName } from './sheet-files.ts';
import { guessLayout, matchSlidesToSystems, type SheetLayout } from './sheet-match.ts';
import type { SheetRef, SlidePayload } from '../shared/types.ts';

/** 한 장의 단 경계 — `song_sheets` 에 담긴 것과 같은 모양 */
export interface SheetInfo {
  songbookId: string;
  number: number;
  /** 기울기를 편 뒤의 그림 높이 (픽셀) — 퍼센트로 옮기는 기준이다 */
  height: number;
  systems: ReadonlyArray<{ from: number; to: number }>;
}

/** 악보 그림 주소. 정적 라우트(`/sheets/`)와 짝이다 — 한쪽만 바꾸면 그림이 안 뜬다 */
export function sheetSrc(songbookId: string, number: number): string {
  return `/sheets/${songbookId}/${sheetFileName(number)}`;
}

/**
 * 픽셀 범위를 **0~100%** 로 옮긴다.
 *
 * 출력 페이지의 `image` 슬라이드 `crop` 이 퍼센트를 받기 때문이다. 픽셀을 그대로
 * 보내면 그림 크기를 화면이 알아야 하는데, 화면은 그림이 다 받아지기 전에 그린다.
 *
 * 끝은 **아래 경계를 포함**한다 — `to` 는 마지막 픽셀 행이므로 `+1` 해야 그 행까지 보인다.
 */
export function toPercentCrop(from: number, to: number, height: number): { top: number; bottom: number } {
  if (height <= 0) return { top: 0, bottom: 100 };
  const top = Math.max(0, Math.min(100, (from / height) * 100));
  const bottom = Math.max(top, Math.min(100, ((to + 1) / height) * 100));
  // 높이가 0 이 되면 화면이 그림을 무한대로 키운다 — 최소한의 두께를 남긴다
  return bottom - top < 0.1 ? { top, bottom: Math.min(100, top + 0.1) } : { top, bottom };
}

/**
 * 배분이 **흔들릴 수 있는가** — 짐작한 모양의 '한 번 지나가는 줄 수' 와 단 수를 견준다.
 *
 * 붙일 때와 조작 화면에 알릴 때가 **같은 것을 써야** 한다. 두 곳에 따로 적으면
 * 화면은 '괜찮다' 는데 실제로는 어긋나는 일이 생긴다.
 *
 * 실측(2,061곡): 맞는 곡 1,525(74.0%) · 어긋나는 곡 536(26.0%).
 */
export function isUncertain(
  sectionLines: readonly number[],
  systemCount: number,
  layout: SheetLayout,
): boolean {
  if (sectionLines.length === 0 || systemCount <= 0) return false;
  const total = sectionLines.reduce((sum, lines) => sum + lines, 0);
  const expected = layout === 'shared' ? Math.max(...sectionLines) : total;
  if (expected <= 0) return false;
  return Math.abs(systemCount - expected) > Math.max(1, expected * 0.25);
}

/** 조작 화면이 '이 곡에 악보가 어떤 상태인지' 를 보여 주는 데 쓰는 요약 */
export interface SheetSummary {
  songbookId: string;
  number: number;
  systemCount: number;
  layout: SheetLayout;
  /**
   * 위 `layout` 이 **사람이 정한 것**인가 (아니면 짐작).
   *
   * 화면이 '자동' 과 '내가 골랐다' 를 구별해 보여 줘야 한다 — 구별이 없으면 고쳐 둔
   * 곡을 다시 만지게 되고, 되돌릴 수 있다는 것도 모른다.
   */
  chosen: boolean;
  /** 배분이 흔들릴 수 있다 — 화면이 알려야 한다 */
  uncertain: boolean;
  /** 단 줄 수가 5가 아닌 단이 있어 사람이 봐야 하는 장 */
  needsReview: boolean;
}

export interface AttachOptions {
  /** 슬라이드마다 몇 번째 섹션의 것인지 */
  slideSections: readonly number[];
  /** 섹션마다 줄이 몇 개인지 — 모양 짐작과 비례 배분에 쓴다 */
  sectionLines: readonly number[];
  sheet: SheetInfo;
  /** 짐작 대신 쓸 모양. 사람이 고쳐 둔 값이 있으면 그것을 넘긴다 */
  layout?: SheetLayout;
}

/**
 * 곡 슬라이드에 `sheet` 를 붙인 새 배열을 돌려준다. **원본은 건드리지 않는다.**
 *
 * 곡 슬라이드가 아닌 것(저작권 표기 등)은 그대로 둔다 — 악보를 붙일 자리가 없다.
 *
 * 배분이 흔들릴 수 있는 곡이면 `uncertain` 을 세운다. 줄 수와 단 수가 어긋나는
 * 곡이 전체의 26% 라(`lib/sheet-match.ts` 실측) 조작 화면이 이를 알려야 한다.
 */
export function attachSheets(slides: readonly SlidePayload[], options: AttachOptions): SlidePayload[] {
  const { slideSections, sectionLines, sheet } = options;
  const systemCount = sheet.systems.length;
  if (systemCount === 0) return [...slides];

  const layout = options.layout ?? guessLayout(sectionLines, systemCount);
  const matched = matchSlidesToSystems(slideSections, sectionLines, systemCount, layout);

  // 어긋나면 어느 단인지 틀릴 수 있다. 화면을 막지는 않고 표시만 한다
  const uncertain = isUncertain(sectionLines, systemCount, layout);
  const src = sheetSrc(sheet.songbookId, sheet.number);

  return slides.map((slide, index) => {
    if (slide.kind !== 'song') return slide;
    const system = sheet.systems[matched[index] ?? -1];
    if (!system) return slide;

    const ref: SheetRef = {
      src,
      crop: toPercentCrop(system.from, system.to, sheet.height),
      system: (matched[index] ?? 0) + 1,
      systemCount,
      ...(uncertain ? { uncertain: true } : {}),
    };
    return { ...slide, sheet: ref };
  });
}

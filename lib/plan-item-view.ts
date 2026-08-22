/**
 * '예배 순서' 항목의 **보여 주기 규칙** — 순수 함수와 상수.
 *
 * `PlanPanel.tsx` 에서 떼어냈다 (검토 2026-08-22 R-4). 그 파일이 3,147줄이 되어
 * 규칙(최대 800줄)을 크게 넘겼고, 여기 있는 것들은 화면 상태를 전혀 보지 않으므로
 * **떼어내면 테스트할 수 있다.**
 *
 * React 를 쓰지 않는다. 화면을 그리는 것은 `src/control/` 에 남는다.
 */

import type { CueItem, ItemTextStyle, SlidePayload, SongEntry } from '../shared/types.ts';
import { isSectionStart, verseNumberPrefix } from './song-slides.ts';

/** 성경 탭과 같은 한도 — 세 역본을 넘기면 한 화면에 들어가지 않는다 */
export const MAX_SECONDARY = 2;

/**
 * 곡집·번호 표기 — `새찬송가 1장`. 제목 슬라이드에 쓴다.
 *
 * 번호가 있는 **첫** 수록만 쓴다. 한 곡이 새찬송가·통일찬송가에 함께 실린 경우가 있는데
 * 둘을 다 적으면 화면 한 줄이 길어진다. 번호 없는 곡집('기타')은 건너뛴다.
 */
export function songLabelOf(entries: readonly SongEntry[]): string | undefined {
  const numbered = entries.find((entry) => entry.number !== undefined);
  return numbered ? `${numbered.songbookName} ${numbered.number}장` : undefined;
}

/** 추가 바에서 고를 수 있는 항목 종류 */
export type AddKind =
  | 'bible' | 'song' | 'liturgy' | 'reading' | 'order' | 'notice' | 'quote' | 'blank' | 'divider';

export const ADD_KINDS: ReadonlyArray<{ kind: AddKind; icon: string; label: string; hint: string }> = [
  { kind: 'bible', icon: '📖', label: '성경', hint: '요 3:16 · 시 23 · 롬 8:28-30' },
  { kind: 'song', icon: '🎵', label: '찬양', hint: '새 305 · 나 같은 죄인 · 은혜' },
  { kind: 'liturgy', icon: '🙏', label: '주기도문·사도신경', hint: '본문 전체 · 개역개정 / 개역한글' },
  { kind: 'reading', icon: '🔁', label: '교독문', hint: '번호나 제목 · 인도자와 회중이 한 화면에' },
  { kind: 'order', icon: '📋', label: '순서 표시', hint: '대표기도 · 설교 제목(둘째 줄에 설교자)' },
  { kind: 'notice', icon: '📝', label: '광고', hint: '여러 줄로 쓰면 그대로 나갑니다' },
  { kind: 'quote', icon: '💬', label: '인용구', hint: '설교 중 띄울 성경 절 — 창 1:1-6 을 넣으면 낱개 6줄이 됩니다' },
  { kind: 'blank', icon: '⬛', label: '공백', hint: '화면을 비웁니다' },
  { kind: 'divider', icon: '▾', label: '구분', hint: '예배 부름 · 찬양 · 말씀 …' },
];

/**
 * 순서 표시의 빠른 선택 — 매주 같은 이름을 다시 타이핑하지 않게 한다.
 *
 * 예배 순서 이름은 교회마다 다르므로 **고정 목록이 아니라 시작점**이다.
 * 여기 없는 순서는 입력창에 직접 쓴다.
 *
 * 주기도문·사도신경은 여기 없다 — 제목만 띄우는 것이 아니라 **본문 전체**를 띄우므로
 * 별도 항목(🙏)이다. 제목만 띄우고 싶다면 입력창에 직접 쓰면 된다.
 */
export const ORDER_PRESETS = [
  '예배 부름',
  '대표기도',
  '성경 봉독',
  '봉헌',
  '성찬',
  '설교 제목',
  '광고',
  '축도',
] as const;

/**
 * 교독문·전례문의 **폰트와 글자 크기**.
 *
 * 이 순서들은 화면을 글자로 채우고 회중이 멀리서 따라 읽는다. 예배당 크기·좌석 거리가
 * 교회마다 달라 그 자리에서 조절할 수 있어야 한다 (2026-08-18 사용자 요청).
 *
 * **행간은 따라 커지지 않는다** — 템플릿이 절대 행간(`lineGapPx`)을 쓰므로 글자만 커진다.
 * 배수로 두면 글자를 키울 때 줄 사이가 함께 벌어져 화면이 헐거워졌다.
 */
/**
 * 이 크기에서 줄이 감길지 어림한다.
 *
 * **어림값이다.** 정확한 값은 실제로 그려 봐야 알지만(출력 페이지 측정 장치),
 * 크기를 끌 때마다 측정하면 느리고 전례문은 자동 분할 경로에 없다.
 * 계수는 1920×1080 에서 실측해서 정했다 — 고딕 84px 에서 21자가 1314px(자당 0.745em),
 * 명조는 더 넓다.
 *
 * 감기는 것 자체가 오류는 아니지만, **함께 읽는 본문은 줄이 감기면 호흡이 어긋난다.**
 * 그래서 막지 않고 알린다.
 */
export const SAFE_WIDTH_PX = 1680;
export const CHAR_WIDTH_EM = { sans: 0.75, serif: 0.82 } as const;

export function wrapsAtScale(
  longestLineChars: number,
  baseFontSize: number,
  style: ItemTextStyle | undefined,
): boolean {
  if (longestLineChars <= 0) return false;
  const em = CHAR_WIDTH_EM[style?.font ?? 'sans'];
  const width = longestLineChars * baseFontSize * (style?.scale ?? 1) * em;
  return width > SAFE_WIDTH_PX;
}

export const ITEM_ICONS: Record<CueItem['type'], string> = {
  bible: '📖',
  song: '🎵',
  text: '📝',
  liturgy: '🙏',
  reading: '🔁',
  blank: '⬛',
  divider: '▾',
};

/** 새 순서표의 기본 구조 — 빈 화면은 무엇을 할 수 있는지 알려 주지 못한다 */
export const DEFAULT_GROUPS = ['예배 부름', '찬양', '말씀', '광고'];

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function itemIcon(item: CueItem): string {
  if (item.type === 'text') {
    // 옛 순서표에 남아 있는 자유 글자 인용구. 지금은 만들 수 없다 (아래 참고)
    if (item.variant === 'quote') return '💬';
    if (item.variant === 'order') return '📋';
    return '📝';
  }
  // 인용구는 성경 항목이지만 목록에서 본문 낭독과 구별돼야 한다
  if (item.type === 'bible' && item.quote) return '💬';
  return ITEM_ICONS[item.type];
}

/**
 * 슬라이드 줄에 보여 줄 한 줄 요약 — 목록이 조밀해야 진행이 보인다.
 * `previous` 는 절 번호를 **첫 장에만** 붙이기 위해 앞 슬라이드를 본다.
 */
export function slideSummary(slide: SlidePayload, previous?: SlidePayload): string {
  switch (slide.kind) {
    case 'song': {
      // 몇 절인지 가사 앞에 붙인다 — 목록에서 가사만 보면 절을 구분할 수 없다.
      // 이어지는 장에는 붙이지 않는다(같은 번호가 연달아 보이면 절이 바뀐 것처럼 읽힌다).
      const prefix = isSectionStart(slide, previous) ? verseNumberPrefix(slide.sectionLabel) : '';
      return prefix + slide.lines.map((group) => group.map((line) => line.text).join(' / ')).join(' · ');
    }
    case 'text':
      return slide.lines.join(' · ');
    case 'order':
      return slide.presenter ? `${slide.title} — ${slide.presenter}` : slide.title;
    case 'reading':
      // 인도자 / 회중 두 줄이 한 화면이므로 목록에서도 함께 보여 준다
      return slide.people ? `${slide.leader} / ${slide.people}` : slide.leader;
    case 'bible':
      return slide.blocks
        .flatMap((block) => block.verses.map((verse) => verse.text))
        .join(' ');
    default:
      return '(공백)';
  }
}

export function textVariantLabel(variant: 'notice' | 'quote' | 'order' | undefined): string {
  if (variant === 'quote') return '인용구';
  if (variant === 'order') return '순서 표시';
  return '광고';
}

/** 항목의 부가 설명 — 한 줄에 들어가야 하므로 짧게 */
export function itemMeta(item: CueItem): string {
  switch (item.type) {
    case 'bible':
      return item.secondary.length > 0 ? `${item.primary} +${item.secondary.length}` : item.primary;
    case 'song':
      return `${item.langs.join('/')} · ${item.lines ?? 2}줄씩`;
    case 'text': {
      const label = textVariantLabel(item.variant);
      // 순서 표시는 둘째 줄(설교자 등)이 있으면 함께 보여 준다
      const rest = item.content.split(/\r?\n/).slice(1).join(' ').trim();
      return rest ? `${label} · ${rest}` : label;
    }
    default:
      return '';
  }
}

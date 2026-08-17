/**
 * 주기도문·사도신경 — 회중이 함께 읽는 고정 본문.
 *
 * ## 어느 판본인가
 *
 * **출석 교회에서 쓰는 본문**을 사용자가 직접 준 것이다 (2026-08-17).
 * 낱말·표기·문장부호를 그대로 옮겼다 — 이 파일은 교회 주보가 기준이다.
 *
 * | 키 | 이름 |
 * |---|---|
 * | `new` | 개역개정 (기본) |
 * | `traditional` | 개역한글 |
 *
 * 키를 `nkrv`/`krv` 로 바꾸지 않은 이유는 **이미 저장된 순서표가 이 값을 담고 있어서**다.
 * 이름만 바꿔도 화면에 보이는 것은 다 바뀐다.
 *
 * ## 왜 순서표에 본문을 복사하지 않고 여기에 두는가
 *
 * 순서표(CueItem)에는 **무엇을 띄울지만** 담고(`textId` + `version`) 본문은 여기서 온다.
 * 찬양 항목이 가사가 아니라 `songId` 를 담는 것과 같은 이유다:
 *
 *  - 판본을 바꾸는 것이 **한 글자 바꾸기**로 끝난다 (본문을 다시 쓰지 않는다)
 *  - 오탈자를 고치면 **이미 저장된 모든 순서표에 반영된다.** 본문을 복사해 두면
 *    지난주 순서표에는 틀린 글자가 그대로 남는다
 *
 * ## 낱말은 그대로, 끊는 자리는 다시 잡았다
 *
 * 받은 본문의 줄바꿈에는 **붙여 넣은 폭에서 생긴 자리**가 섞여 있었다
 * (개역한글 주기도문의 '뜻이 하늘에서 이룬 것 같이 땅에서도 / 이루어지이다').
 * 그대로 두면 화면에서 구가 끊긴다 — 찬양 가사에서 고쳤던 그 문제다.
 *
 * 그래서 **낱말은 한 자도 바꾸지 않고**, 끊는 자리만 의미 단위로 다시 잡았다.
 * 회중이 소리 내어 함께 읽는 본문이라 끊는 자리가 곧 호흡이다.
 *
 * 한 줄은 찬양과 같은 24자 기준을 지킨다 (`DEFAULT_MAX_CHARS_PER_LINE`).
 * 테스트가 이 한도를 강제하므로, 본문을 고칠 때 긴 줄이 몰래 들어가지 않는다.
 *
 * ## 그래도 다르면
 *
 * 항목에 직접 고친 본문을 담을 수 있다 (`CueItem` 의 `overrideLines`).
 * 고친 본문이 있으면 그것이 이긴다.
 */

import { chunkWithoutOrphans } from './song-slides.ts';

export type LiturgyId = 'lords-prayer' | 'apostles-creed';

/** `new` = 개역개정 · `traditional` = 개역한글 (키는 저장된 순서표 때문에 유지) */
export type LiturgyVersion = 'new' | 'traditional';

/** 처음 넣을 때의 판본 — 개역개정 */
export const DEFAULT_LITURGY_VERSION: LiturgyVersion = 'new';

/** 한 장에 몇 줄을 담을지. `0` 은 '전체를 한 장에'. */
export type LiturgyPerSlide = 0 | 2 | 4 | 6;

/**
 * 기본 4줄.
 *
 * 2줄이면 장이 너무 자주 넘어가 함께 읽는 흐름이 끊기고, 6줄이면 뒷자리에서
 * 글자가 작아진다. 회중이 따라 읽는 본문이라 찬양(2줄)보다는 넉넉해야 한다.
 */
export const DEFAULT_LITURGY_PER_SLIDE: LiturgyPerSlide = 4;

export interface LiturgyVersionText {
  /** 화면·토글에 쓰는 이름 */
  label: string;
  lines: readonly string[];
}

export interface LiturgyText {
  id: LiturgyId;
  /** 순서표에 보이는 이름 */
  title: string;
  versions: Readonly<Record<LiturgyVersion, LiturgyVersionText>>;
}

const LORDS_PRAYER: LiturgyText = {
  id: 'lords-prayer',
  title: '주기도문',
  versions: {
    new: {
      label: '개역개정',
      lines: [
        '하늘에 계신 우리 아버지',
        '아버지의 이름을 거룩하게 하시며',
        '아버지의 나라가 오게 하시며',
        '아버지의 뜻이 하늘에서와 같이',
        '땅에서도 이루어지게 하소서',
        '오늘 우리에게 일용할 양식을 주시고',
        '우리가 우리에게 잘못한 사람을',
        '용서하여 준 것같이',
        '우리 죄를 용서하여 주시고',
        '우리를 시험에 빠지지않게 하시고',
        '악에서 구하소서',
        '나라와 권능과 영광이',
        '영원히 아버지의 것입니다. 아멘.',
      ],
    },
    traditional: {
      label: '개역한글',
      lines: [
        '하늘에 계신 우리 아버지여',
        '이름이 거룩히 여김을 받으시오며',
        '나라이 임하옵시며',
        '뜻이 하늘에서 이룬 것 같이',
        '땅에서도 이루어지이다,',
        '오늘날 우리에게 일용할 양식을 주옵시고',
        '우리가 우리에게 죄 지은 자를',
        '사하여 준 것같이',
        '우리의 죄를 사하여 주옵시고,',
        '우리를 시험에 들게 하지 마옵시고,',
        '다만 악에서 구하옵소서.',
        '대개 나라와 권세와 영광이',
        '아버지께 영원히 있사옵나이다. 아멘.',
      ],
    },
  },
};

const APOSTLES_CREED: LiturgyText = {
  id: 'apostles-creed',
  title: '사도신경',
  versions: {
    new: {
      label: '개역개정',
      lines: [
        '나는 전능하신 아버지 하나님,',
        '천지의 창조주를 믿습니다.',
        '나는 그의 유일하신 아들,',
        '우리 주 예수그리스도를 믿습니다.',
        '그는 성령으로 잉태되어',
        '동정녀 마리아에게서 나시고,',
        '본디오 빌라도에게 고난을 받아',
        '십자가에 못 박혀 죽으시고,',
        '장사된 지 사흘 만에',
        '죽은 자 가운데서 다시 살아나셨으며,',
        '하늘에 오르시어 전능하신',
        '아버지 하나님 우편에 앉아 계시다가,',
        '거기로부터 살아 있는 자와 죽은 자를',
        '심판하러 오십니다.',
        '나는 성령을 믿으며,',
        '거룩한 공교회와 성도의 교제와',
        '죄를 용서받는 것과 몸의 부활과',
        '영생을 믿습니다. 아멘.',
      ],
    },
    traditional: {
      label: '개역한글',
      lines: [
        '전능하사 천지를 만드신',
        '하나님 아버지를 내가 믿사오며,',
        '그 외아들 우리 주',
        '예수 그리스도를 믿사오니,',
        '이는 성령으로 잉태하사',
        '동정녀 마리아에게 나시고,',
        "'본디오 빌라도'에게 고난을 받으사,",
        '십자가에 못박혀 죽으시고,',
        '장사한지 사흘만에',
        '죽은 자 가운데서 다시 살아나시며,',
        '하늘에 오르사,',
        '전능하신 하나님 우편에 앉아 계시다가,',
        '저리로서 산자와 죽은 자를',
        '심판하러 오시리라.',
        '성령을 믿사오며,',
        '거룩한 공회와,',
        '성도가 서로 교통하는 것과,',
        '죄를 사하여 주시는 것과,',
        '몸이 다시 사는 것과,',
        '영원히 사는 것을 믿사옵나이다. 아멘.',
      ],
    },
  },
};

export const LITURGY_TEXTS: readonly LiturgyText[] = [LORDS_PRAYER, APOSTLES_CREED];

/** 모르는 id 면 undefined — 부르는 쪽이 '본문을 찾지 못했습니다' 로 알린다 */
export function findLiturgy(id: string): LiturgyText | undefined {
  return LITURGY_TEXTS.find((text) => text.id === id);
}

/** 저장된 값이 아는 id 인가 (서버 검증용) */
export function isLiturgyId(value: unknown): value is LiturgyId {
  return typeof value === 'string' && LITURGY_TEXTS.some((text) => text.id === value);
}

export function isLiturgyVersion(value: unknown): value is LiturgyVersion {
  return value === 'new' || value === 'traditional';
}

export function isLiturgyPerSlide(value: unknown): value is LiturgyPerSlide {
  return value === 0 || value === 2 || value === 4 || value === 6;
}

/**
 * 항목이 실제로 띄울 줄들.
 *
 * 직접 고친 본문(`overrideLines`)이 있으면 그것이 이긴다 — 사람이 손본 것을
 * 자동 데이터가 덮어쓰면 안 된다 (찬양의 '승인'과 같은 원칙).
 */
export function liturgyLines(
  id: string,
  version: LiturgyVersion,
  overrideLines?: readonly string[],
): readonly string[] | undefined {
  if (overrideLines && overrideLines.length > 0) return overrideLines;
  return findLiturgy(id)?.versions[version]?.lines;
}

/**
 * 줄들을 화면 단위로 나눈다.
 *
 * 고아 줄(마지막 장에 한 줄만)을 피하는 계산은 찬양과 똑같은 문제라
 * `song-slides` 의 것을 그대로 쓴다 — 회중이 함께 읽다가 화면이 끊기면
 * 따라 읽지 못하는 것도 같다.
 */
export function liturgySlides(
  lines: readonly string[],
  perSlide: LiturgyPerSlide = DEFAULT_LITURGY_PER_SLIDE,
): string[][] {
  if (lines.length === 0) return [];
  if (perSlide === 0) return [[...lines]];
  return chunkWithoutOrphans([...lines], perSlide);
}

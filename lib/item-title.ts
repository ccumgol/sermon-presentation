/**
 * 항목 제목 — 청중이 다음을 준비하도록 띄우는 한 줄.
 *
 * ## 왜 필요한가
 *
 * 성경·찬양·교독문·전례문은 **여러 장**이라, 순서표에서 항목을 먼저 누르고 그 안의
 * 장을 눌러야 화면에 나간다. 항목을 누르는 그 순간이 '다음은 이것' 이라고 알릴 가장
 * 자연스러운 자리다 (사용자 요청, 2026-08-19).
 *
 * ## 항목이 담은 것만 쓴다
 *
 * DB 를 뒤지지 않는다. 곡을 지웠거나 교독문을 아직 가져오지 않은 PC 에서도 순서표에
 * 무엇이었는지 남아야 하기 때문이다 (`songTitle` 을 항목에 담는 이유와 같다).
 * 그래서 곡집·번호도 항목에 저장한다 — 없으면 제목만 띄운다. 예배 중 조회가 실패해
 * 제목이 안 뜨는 일이 없어야 한다.
 *
 * ## 없으면 `undefined`
 *
 * 한 장짜리 항목(광고·순서 표시·공백)은 그 줄이 곧 슬라이드다. 제목을 따로 띄우면
 * 같은 것이 두 번 나간다. 구분은 화면에 나가지 않는다.
 */

import { findLiturgy } from './liturgy-texts.ts';
import type { CueItem } from '../shared/types.ts';

/**
 * 이 항목의 제목 한 줄. 띄울 것이 없으면 `undefined`.
 *
 * `describeItem`(순서표 목록에 쓰는 라벨)과 **일부러 다르다.** 목록은 조작자가 읽고,
 * 이것은 **회중이 읽는다.** 그래서 '교독문 15. 시편 51편'(목록)이 아니라
 * '교독문 15, 시편 51편'(화면)이고, 찬양에는 곡집·번호를 앞에 붙인다.
 */
export function itemTitle(item: CueItem): string | undefined {
  switch (item.type) {
    case 'bible': {
      const ref = item.ref.trim();
      return ref.length > 0 ? ref : undefined;
    }

    case 'song': {
      // 곡집·번호 + 제목. 둘 중 하나만 있어도 띄운다
      const parts = [item.songLabel?.trim(), item.songTitle.trim()].filter(
        (part): part is string => part !== undefined && part.length > 0,
      );
      return parts.length > 0 ? parts.join(' ') : undefined;
    }

    case 'reading': {
      const title = item.readingTitle?.trim();
      // 쉼표로 잇는다 — 목록의 '15. 시편 51편' 과 달리 화면에서는 한 문장처럼 읽힌다
      return title ? `교독문 ${item.readingNumber}, ${title}` : `교독문 ${item.readingNumber}`;
    }

    case 'liturgy': {
      // 판본(개역개정/개역한글)은 붙이지 않는다 — 회중에게는 뜻이 없다
      return findLiturgy(item.textId)?.title;
    }

    // 한 장짜리와 구분은 제목을 띄우지 않는다
    default:
      return undefined;
  }
}

/**
 * 이 항목이 제목을 띄울 수 있는 종류인지.
 *
 * 화면(버튼을 켤지)을 정하는 데 쓴다 — 실제 글자는 `itemTitle` 이 만든다.
 */
export function hasTitle(item: CueItem): boolean {
  return itemTitle(item) !== undefined;
}

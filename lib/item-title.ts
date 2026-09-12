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
      /*
       * **인용구는 제목을 띄우지 않는다.**
       *
       * '타이틀 없이 바로 창 1:1 … 이 나오면 좋겠다' 가 요청이었다 (2026-08-20).
       * 설교 중 한 절을 잠깐 띄우는 것인데 앞에 참조 한 장이 먼저 나가면, 두 번
       * 넘겨야 본문이 보이고 흐름이 끊긴다.
       *
       * 절 참조 자체는 필요하면 슬라이드 안에 나온다 (템플릿·항목의 '참조 표기').
       */
      if (item.quote) return undefined;
      const ref = item.ref.trim();
      return ref.length > 0 ? ref : undefined;
    }

    case 'song': {
      /*
       * **곡집·번호는 적지 않는다** (2026-09-12 사용자 요청).
       *
       * 전에는 '많은물소리 265장 이 땅의 황무함을 보소서' 처럼 나갔다. 회중에게
       * 곡집 이름과 번호는 뜻이 없다 — 손에 든 것이 없으면 찾아볼 데도 없고,
       * 제목 앞에 붙은 글자가 길수록 정작 제목이 작아진다.
       *
       * 교독문·주기도문이 이미 같은 규칙이다 (아래 `reading`·`liturgy` 참고) —
       * 찬양만 예외였다.
       *
       * 곡집·번호가 필요하면 **슬라이드 안의 저작권 줄**에 나온다
       * (`lib/song-slides.ts` 의 `creditOf`, 템플릿의 '저작권 표기').
       *
       * 제목이 비어 있을 때만 곡집·번호라도 띄운다 — 빈 화면보다는 낫다.
       */
      const title = item.songTitle.trim();
      if (title.length > 0) return title;
      const label = item.songLabel?.trim();
      return label !== undefined && label.length > 0 ? label : undefined;
    }

    case 'reading': {
      const title = item.readingTitle?.trim();
      /*
       * 쉼표로 잇는다 — 목록의 '15. 시편 51편' 과 달리 화면에서는 한 문장처럼 읽힌다.
       *
       * **어느 찬송가인지는 적지 않는다.** 회중에게는 뜻이 없다 — 그날 쓰는 것이 무엇인지
       * 이미 알고 있고, '새 교독문 15' 라고 나가면 무슨 말인지 오히려 헷갈린다.
       * 판본을 적지 않는 것(주기도문)과 같은 이유다.
       */
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

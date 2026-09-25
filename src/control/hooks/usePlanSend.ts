/**
 * **예배 순서 탭에서 화면으로 내보내는 것 전부.**
 *
 * `PlanPanel` 에서 떼어냈다(2026-09-07 R-4). 이 화면의 본업이 여기다 —
 * 틀리면 **예배 중에 엉뚱한 것이 나가거나 아무것도 나가지 않는다.**
 * 2,500줄짜리 컴포넌트 안에 있어서 검사를 붙일 수 없었다.
 *
 * ## 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 끊겼으면 **아무것도 보내지 않는다** | 간 줄 알고 다음 동작을 하면 화면이 어긋난다 |
 * | 템플릿을 **슬라이드보다 먼저** 보낸다 | 순서가 반대면 옛 판으로 한 번 그려졌다가 바뀌어 화면이 튄다 |
 * | 순서표가 올라가 있으면 **그 자리로 점프**한다 | 단독으로 올리면 진행 위치를 잃는다 |
 * | 사람이 무언가를 송출하면 **자동 진행을 끈다** | 예배가 시작된 것이다 |
 * | 인용구는 **직전 화면을 기억**한다 | 설교 중 잠깐 띄우고 돌아와야 한다 |
 * | 풀린 것이 없으면 **오류를 낸다** | 조용히 빈 화면을 내보내지 않는다 |
 * | 자동 넘김은 **다음 한 번만** 예약한다 | 반복 타이머는 사람이 손으로 넘겼을 때 두 장이 연달아 넘어간다 |
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { buildPlanDeck, describeItem, itemsInGroup, resumeIndex } from '../../../lib/plan-deck.ts';
import { itemTitle } from '../../../lib/item-title.ts';
import { templateIdFor as pickTemplateId, type TemplateChoice } from '../../../lib/plan-item-template.ts';
import {
  AUTO_HOLD_MS_DEFAULT,
  type ClientMsg, type CueItem, type Deck, type ServicePlan, type SlidePayload,
} from '../../../shared/types.ts';
import { ApiError } from '../api.ts';
import type { Resolved } from './usePlanPreview.ts';

/** 화면에 알릴 것들 — 이 훅은 상태를 갖지 않고 부르는 쪽의 것을 쓴다 */
export interface SendFeedback {
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
}

export interface PlanSendOptions {
  /** 지금 올라가 있는 덱 (없으면 `null`) */
  deck: Deck | null;
  currentIndex: number;
  connected: boolean;
  send: (msg: ClientMsg) => boolean;
  items: readonly CueItem[];
  /** 지금 열어 둔 순서표 — 전체를 올릴 때 이름과 기본 설정을 쓴다 */
  plan: ServicePlan | null;
  /** 항목을 슬라이드로 푸는 것 (usePlanPreview) */
  resolveItem: (item: CueItem) => Promise<Resolved>;
  /** 어느 템플릿으로 나갈지 고르는 데 필요한 것들 */
  templateChoice: TemplateChoice;
  feedback: SendFeedback;
}

/** `usePlanSend` 가 내놓는 것. 화면 컴포넌트가 **이 객체째로** 받는다 */
export type PlanSend = ReturnType<typeof usePlanSend>;

export function usePlanSend(options: PlanSendOptions) {
  const {
    deck, currentIndex, connected, send, items, plan, resolveItem, templateChoice,
    feedback: { setBusy, setError, setNotice },
  } = options;

  /**
   * 인용구를 띄우기 직전 화면 — '직전으로' 가 여기로 되돌린다.
   */
  const [before, setBefore] = useState<{ slide: SlidePayload; label: string } | null>(null);

  /**
   * 예배 전 안내 자동 진행 — 지금 돌고 있는 구분. `null` 이면 자동 진행이 아니다.
   *
   * 예배가 시작되면 반드시 멈춰야 하므로, 다른 항목을 송출하거나 순서표를 올리면
   * 곧바로 끈다. 돌고 있다는 것이 화면에 크게 보여야 한다.
   */
  const [auto, setAuto] = useState<{ dividerId: string; holdMs: number; loop: boolean } | null>(null);

  /**
   * 단독으로 올린 항목의 id. 순서표 전체를 올렸을 때는 `null` 이고
   * 그때는 덱의 `groups` 로 어디가 나가고 있는지 판정한다.
   */
  const [liveItemId, setLiveItemId] = useState<string | null>(null);

  const templateIdFor = useCallback(
    (item: CueItem) => pickTemplateId(item, templateChoice),
    [templateChoice],
  );

  /** 지금 화면에 나가고 있는 슬라이드 (직전으로 되돌리기용) */
  const liveSlide = deck?.slides[currentIndex];
  const liveLabel = deck?.labels[currentIndex];

  /**
   * 항목을 송출한다.
   *
   * 전체 덱이 올라가 있고 이 항목의 경계를 찾을 수 있으면 **그 위치로 점프**한다.
   * 그러면 이후 화살표 진행이 순서표 전체를 따라간다.
   * 올라가 있지 않으면 **그 항목만 단독으로** 올린다 — 순서를 벗어나 급히 띄울 때.
   */
  const sendItem = useCallback(
    async (item: CueItem, slideIndex = 0) => {
      if (!connected || item.type === 'divider') return;
      // 사람이 무언가를 송출하면 예배가 시작된 것이다 — 자동 진행을 끈다
      setAuto(null);

      /*
       * 인용구를 띄우기 전 화면을 기억한다 — `↩ 직전으로` 가 여기로 돌아온다.
       *
       * 두 가지를 다 본다: 새 인용구(성경 절)와, 옛 순서표에 남아 있는 자유 글자
       * 인용구. 광고와 인용구의 **유일한 실제 차이**가 이 동작이므로, 기능이 바뀌어도
       * 잃지 않는다 ('설교 중 잠깐 띄울 내용' 이라는 뜻 그대로다).
       */
      const isQuote =
        (item.type === 'bible' && item.quote === true) ||
        (item.type === 'text' && item.variant === 'quote');
      if (isQuote && liveSlide) {
        setBefore({ slide: liveSlide, label: liveLabel ?? '' });
      }

      // 쓸 템플릿을 **슬라이드보다 먼저** 올린다 (항목 지정 → 예배 기본 설정 순).
      // 순서가 반대면 옛 템플릿으로 한 번 그려졌다가 바뀌어 화면이 튄다.
      const useTemplate = templateIdFor(item);
      if (typeof useTemplate === 'number') send({ t: 'template:set', id: useTemplate });

      const groupIndex = items.filter((i) => i.type !== 'divider').findIndex((i) => i.id === item.id);
      const group = deck?.groups?.[groupIndex];

      if (group && deck) {
        send({ t: 'goto', index: group.startIndex + slideIndex });
        setLiveItemId(null); // groups 로 판정한다
        return;
      }

      try {
        const resolved = await resolveItem(item);
        if (resolved.slides.length === 0) {
          setError(resolved.error ?? '표시할 내용이 없습니다');
          return;
        }
        send({
          t: 'deck:load',
          payload: {
            reference: describeItem(item),
            slides: resolved.slides,
            labels: resolved.labels,
            index: Math.min(slideIndex, resolved.slides.length - 1),
          },
        });
        setLiveItemId(item.id);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : '송출하지 못했습니다');
      }
    },
    // templateIdFor 가 여기 있어야 한다. 없던 동안 **기본 템플릿을 바꾼 직후
    // ▶ 를 누르면 이전 값이 나갔다** (2026-09-07 실측: -8 로 바꿨는데 -1 이 나갔고,
    // 항목을 옮겨 이 함수가 다시 만들어진 뒤에야 -8 이 나갔다).
    [connected, items, deck, send, resolveItem, liveSlide, liveLabel, templateIdFor],
  );

  /**
   * 화면에 나가 있는 항목을 고쳤으면 **다시 보낸다.**
   *
   * 없으면 폰트·글자 크기를 돌려도 화면이 그대로다 — 다시 ▶ 를 눌러야 반영된다.
   * 이 값들은 '돌려 보면서 맞추는' 성격이라, 눈이 따라오지 않으면 옵션이 없는 것과 같다
   * (실사용에서 '변경되지 않는다'로 보고된 증상이 이것이다).
   *
   * **단독 송출 중일 때만** 한다. 순서표 전체가 올라가 있으면 덱을 통째로 바꾸는 셈이라
   * 예배 중에 진행 위치를 잃는다 — 담당자 크기·글자 조정이 쓰는 규칙과 같다.
   *
   * 짧게 모아 한 번만 보낸다. 슬라이더를 끌면 값이 연달아 바뀌는데, 교독문은 본문을
   * 서버에서 다시 읽어 오므로(비동기) 늦게 온 옛 응답이 새 화면을 덮을 수 있다.
   */
  const liveRefresh = useRef<number | null>(null);
  const refreshLive = useCallback(
    (item: CueItem): void => {
      if (liveItemId !== item.id) return;
      if (liveRefresh.current !== null) clearTimeout(liveRefresh.current);
      liveRefresh.current = window.setTimeout(() => {
        liveRefresh.current = null;
        // 보고 있던 장에 그대로 머문다 — 크기를 만질 때마다 첫 장으로 돌아가면 못 쓴다.
        // 장 수가 줄어드는 경우(4줄씩 → 전체 한 장)는 sendItem 이 잘라 준다.
        void sendItem(item, currentIndex);
      }, 120);
    },
    [liveItemId, sendItem, currentIndex],
  );

  // 남은 타이머가 사라진 화면을 향해 쏘지 않게 한다
  useEffect(
    () => () => {
      if (liveRefresh.current !== null) clearTimeout(liveRefresh.current);
    },
    [],
  );

  /**
   * 항목 제목 한 줄을 띄운다 — 회중이 다음을 준비하도록.
   *
   * **그 항목이 쓸 템플릿을 함께 올린다.** 그러면 제목이 곧이어 나올 본문과 **같은
   * 자리·같은 모양**으로 뜬다. 활성 템플릿을 그대로 쓰면 앞 순서(순서 표시 등)의
   * 큰 명조가 남아 성경 참조가 엉뚱하게 커진다.
   *
   * **슬라이드 한 장짜리 덱으로 보낸다.** 덱 없이 한 장만 올리는 길도 있었지만
   * (`t: 'show'`) 그러면 올라가 있던 순서표가 버려져 진행 위치를 잃는다. 그래서
   * 아무도 쓰지 않았고, 2026-09-03 에 그 길을 지웠다.
   */
  const sendTitle = useCallback(
    (item: CueItem) => {
      if (!connected) return;
      const title = itemTitle(item);
      if (!title) return;

      const useTemplate = templateIdFor(item);
      if (typeof useTemplate === 'number') send({ t: 'template:set', id: useTemplate });

      send({
        t: 'deck:load',
        payload: {
          reference: `${describeItem(item)} (제목)`,
          slides: [{ kind: 'text', lines: [title] }],
          labels: ['제목'],
          index: 0,
        },
      });
      setLiveItemId(null);
    },
    [connected, send, items, templateIdFor],
  );

  /** 인용구를 띄우기 직전 화면으로 되돌린다 */
  const restoreBefore = useCallback(() => {
    if (!before || !connected) return;
    send({
      t: 'deck:load',
      payload: { reference: before.label || '직전', slides: [before.slide], labels: [before.label], index: 0 },
    });
    setBefore(null);
    setLiveItemId(null);
  }, [before, connected, send]);

  /**
   * 예배 전 안내를 시작한다 — 이 구분이 거느린 항목만 덱으로 올리고 자동으로 넘긴다.
   *
   * 전체 순서표를 올리지 않는 이유는, 예배 전 안내가 **예배 순서의 일부가 아니라
   * 그 앞의 시간**이기 때문이다. 예배를 시작할 때는 '예배용으로 올리기' 를 새로 누른다.
   */
  async function startAuto(divider: Extract<CueItem, { type: 'divider' }>): Promise<void> {
    const group = itemsInGroup(items, divider.id);
    if (group.length === 0) {
      setError(`'${divider.label}' 아래에 항목이 없습니다`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const result = await buildPlanDeck(divider.label, group, resolveItem);
      if (result.deck.slides.length === 0) {
        setError('올릴 수 있는 항목이 없습니다');
        return;
      }
      if (result.failed.length > 0) {
        setNotice(
          `${result.failed.length}개 항목을 건너뛰었습니다: ` +
            result.failed.map((f) => `${describeItem(f.item)} (${f.error})`).join(', '),
        );
      }
      send({ t: 'deck:load', payload: result.deck });
      setLiveItemId(null);
      setAuto({
        dividerId: divider.id,
        holdMs: divider.auto?.holdMs ?? AUTO_HOLD_MS_DEFAULT,
        loop: divider.auto?.loop !== false,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '시작하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  const slideCount = deck?.slides.length ?? 0;
  const hold = auto?.holdMs ?? AUTO_HOLD_MS_DEFAULT;

  /**
   * 자동 진행 타이머.
   *
   * 슬라이드가 바뀔 때마다 **다음 한 번**만 예약한다. 반복 타이머를 쓰면
   * 사람이 중간에 손으로 넘겼을 때 남은 시간이 어긋나 두 장이 연달아 넘어간다.
   */
  useEffect(() => {
    if (!auto || !connected) return;
    const total = slideCount;
    if (total === 0) return;

    const timer = setTimeout(() => {
      if (currentIndex >= total - 1) {
        // 예배 **전** 안내라 처음으로 돌아간다 (예배 중 덱은 순환하지 않는다)
        if (auto.loop) send({ t: 'goto', index: 0 });
        else setAuto(null);
      } else {
        send({ t: 'next' });
      }
    }, hold);

    return () => clearTimeout(timer);
    // 의존성은 **원시값만** 둔다. 전에 `deck?.slides` 를 넣었는데 상태가 올 때마다
    // 새 배열이라 타이머가 계속 처음부터 다시 걸렸다.
  }, [auto, connected, currentIndex, slideCount, hold, send]);

  /** 순서표 전체를 하나의 덱으로 올린다 (순서대로 진행할 때) */
  async function loadForService(): Promise<void> {
    if (!plan || items.length === 0) return;

    /*
     * **보던 자리를 지킬 것인가** (2026-09-25 사용자 요청).
     *
     * 올린 뒤 항목을 고치면 화면이 따라오지 않아 다시 올려야 하는데, 그때마다
     * 첫 장으로 갔다 — 예배 중반에 오타 하나 고치면 맨 처음으로 튀었다.
     *
     * 지킬 수 있는 경우는 **지금 이 순서표가 올라가 있을 때뿐**이다. 두 가지를 본다:
     *   · 예배 전 안내가 도는 중이 아니다 — 그건 예배 앞의 시간이고, 거기서
     *     '올리기' 를 누르는 것은 **예배를 시작한다**는 뜻이라 첫 장이 맞다.
     *   · 올라가 있는 묶음이 이 순서표다 (`reference`). 다른 순서표나 성경 조회에서
     *     넘어온 것이면 짚을 자리가 없다.
     */
    const resumeFrom = auto === null && deck?.reference === plan.name ? deck : null;

    setBusy(true);
    setError(null);
    setNotice(null);
    // 예배가 시작된다 — 자동 진행을 끈다
    setAuto(null);

    try {
      const result = await buildPlanDeck(plan.name, items, resolveItem);
      if (result.deck.slides.length === 0) {
        setError('올릴 수 있는 항목이 없습니다');
        return;
      }
      /*
       * 항목이 템플릿을 지정하지 않았으면 예배 기본 설정을 경계에 실어 보낸다.
       * 이게 없으면 순서표를 올려 진행할 때만 기본 설정이 빠진다.
       *
       * **항목 id 로 찾는다** (2026-09-25 에 고쳤다). 전에는 `groups[i]` 와
       * `비-divider 항목[i]` 를 자리 번호로 짝지었는데, 못 푼 항목은 경계에서
       * 빠지므로 **앞에 실패가 하나만 있어도 그 뒤가 전부 밀려** 엉뚱한 항목의
       * 템플릿이 실렸다.
       */
      const byId = new Map(items.map((item) => [item.id, item]));
      const withDefaults = {
        ...result.deck,
        groups: result.deck.groups?.map((group) => {
          if (group.templateId !== undefined) return group;
          const item = group.itemId === undefined ? undefined : byId.get(group.itemId);
          const id = item ? templateIdFor(item) : undefined;
          return id === undefined ? group : { ...group, templateId: id };
        }),
      };
      const index = resumeIndex(withDefaults, resumeFrom);
      send({ t: 'deck:load', payload: { ...withDefaults, index } });
      setLiveItemId(null);

      /*
       * 알릴 것을 **한 번에 모아** 쓴다. 배너는 하나뿐이라 두 번 부르면 나중 것이
       * 앞 것을 지운다 — 건너뛴 항목을 그렇게 잃으면 예배 중에 순서가 조용히 사라진다.
       *
       * 건너뛴 것이 먼저다. 그쪽이 손쓸 일이고, 이어붙인 자리는 화면을 보면 안다.
       */
      const lines: string[] = [];
      if (result.failed.length > 0) {
        lines.push(
          `${result.failed.length}개 항목을 건너뛰었습니다: ` +
            result.failed.map((f) => `${describeItem(f.item)} (${f.error})`).join(', '),
        );
      }
      if (index > 0) {
        // 경계는 오름차순이라 조건에 맞는 **마지막** 것이 지금 항목이다
        const here = withDefaults.groups?.filter((group) => group.startIndex <= index).at(-1);
        lines.push(
          `보던 자리에서 이어갑니다${here ? ` — ${here.label}` : ''} (처음부터 하려면 PgUp).`,
        );
      }
      if (lines.length > 0) setNotice(lines.join('\n'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '순서표를 올리지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  // ── 지금 무엇이 나가고 있는가 (목록의 빨간 점) ──────────────
  // 송출 상태를 아는 곳이 여기라 판정도 여기서 한다. 화면은 결과만 받는다.

  /** 이 항목이 지금 송출 중인지 */
  const liveItemIndex = (() => {
    // 항목 하나만 올린 경우 — groups 가 없어 기억해 둔 id 로 판정한다
    if (liveItemId) {
      const index = items.findIndex((item) => item.id === liveItemId);
      if (index >= 0) return index;
    }
    if (!deck?.groups || currentIndex < 0) return -1;
    let found = -1;
    deck.groups.forEach((group, index) => {
      if (group.startIndex <= currentIndex) found = index;
    });
    if (found === -1) return -1;
    // groups 는 divider 를 뺀 순서라 원래 배열 위치로 되돌린다
    const withoutDividers = items.filter((item) => item.type !== 'divider');
    const target = withoutDividers[found];
    return target ? items.findIndex((item) => item.id === target.id) : -1;
  })();

  /**
   * 송출 중인 슬라이드가 그 항목의 몇 번째인지 — 펼친 목록에서 빨간 점을 찍을 자리.
   * 순서표 전체를 올린 경우에는 항목 시작 위치를 빼서 구한다.
   */
  const liveSlideIndexInItem = (() => {
    if (!deck) return -1;
    if (liveItemId) return currentIndex; // 항목 하나만 올린 경우 덱이 곧 그 항목이다
    if (!deck.groups || liveItemIndex < 0) return -1;
    const withoutDividers = items.filter((item) => item.type !== 'divider');
    const groupIndex = withoutDividers.findIndex((item) => item.id === items[liveItemIndex]?.id);
    const start = deck.groups[groupIndex]?.startIndex;
    return start === undefined ? -1 : currentIndex - start;
  })();

  /**
   * 순서표 **전체**가 올라간 채로 이 항목이 화면에 나가 있는가.
   *
   * 이때는 항목을 고쳐도 화면이 따라오지 않는다 — 덱을 통째로 다시 만들면 예배 중에
   * 진행 위치를 잃기 때문이다(의도된 제약). ▶ 도 소용없다: 올라간 덱 안에서 goto 로
   * 자리만 옮기므로 옛 슬라이드가 그대로 나온다(실측 확인). 되살리는 길은 다시 올리기뿐이다.
   * 그렇다면 최소한 **왜 안 바뀌는지와 무엇을 눌러야 하는지**는 보여야 한다.
   * 말없이 안 바뀌면 옵션이 고장난 것으로 읽힌다.
   */
  const liveViaPlanDeck = liveItemId === null && liveItemIndex >= 0;

  return {
    /** 지금 화면에 나가고 있는 슬라이드·라벨 */
    liveSlide, liveLabel,
    /** 올라가 있는 덱의 슬라이드 수 */
    slideCount,
    /** 항목 하나를 송출한다 */
    sendItem,
    /** 항목의 제목만 송출한다 */
    sendTitle,
    /** 나가 있는 항목을 고쳤을 때 다시 보낸다 (모아서 한 번) */
    refreshLive,
    /** 인용구를 띄우기 직전 화면으로 되돌린다 */
    restoreBefore,
    /** 예배 전 안내를 시작한다 (그 구분이 거느린 항목만 자동으로 넘긴다) */
    startAuto,
    /** 순서표 전체를 하나의 덱으로 올린다 */
    loadForService,
    before,
    auto, setAuto,
    liveItemId,
    /** 지금 송출 중인 항목의 배열 위치 (없으면 -1) */
    liveItemIndex,
    /** 그 항목의 몇 번째 슬라이드가 나가고 있는지 (없으면 -1) */
    liveSlideIndexInItem,
    /**
     * 순서표 **전체**가 올라간 채로 나가고 있는가.
     * 이때는 항목을 고쳐도 화면이 따라오지 않는다 — 화면이 그 사정을 알려야 한다.
     */
    liveViaPlanDeck,
  };
}

/**
 * 예배 순서 — 실제 예배를 진행하는 화면.
 *
 * 설계 근거는 docs/plan-service-tab.md 에 있다. 요약하면:
 *
 *  - **한 화면에서 전부**. 성경·찬양 검색과 광고 입력을 이 탭 안에서 한다.
 *    성경/찬양 탭을 오가며 준비하는 것은 예배 중에 너무 느리다.
 *  - **선택과 송출을 분리**한다. 항목을 눌러도 화면에 나가지 않는다.
 *    파란 테두리 = 보고 있는 것, 빨간 점 = 실제로 나가고 있는 것.
 *    눌렀다고 바로 나가면 예배 중 사고가 난다.
 *  - **조밀한 목록**. 성경·찬양 탭의 큰 카드가 아니라 한 줄짜리 행이다.
 *    10항목이 한 화면에 들어와야 진행이 보인다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildPlanRows, describeItem, isExpandable, type PlanRow } from '../../../lib/plan-deck.ts';
import {
  baseFontSizeFor,
  itemTemplateFor,
} from '../../../lib/plan-item-template.ts';
import { PlanItemEditor } from '../components/plan/PlanItemEditor.tsx';
import { PlanActions } from '../components/plan/PlanActions.tsx';
import { PlanAddBar } from '../components/plan/PlanAddBar.tsx';
import { PlanCueList } from '../components/plan/PlanCueList.tsx';
import { PlanDefaultsCard } from '../components/plan/PlanDefaultsCard.tsx';
import { PlanDirtyLine } from '../components/plan/PlanDirtyLine.tsx';
import { PlanHead } from '../components/plan/PlanHead.tsx';
import { PlanLoadList } from '../components/plan/PlanLoadList.tsx';
import { PlanNameBar } from '../components/plan/PlanNameBar.tsx';
import type { ClientMsg, Deck, Template, Translation } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { usePlanBackgrounds } from '../hooks/usePlanBackgrounds.ts';
import { usePlanDraft } from '../hooks/usePlanDraft.ts';
import { useFeedback } from '../hooks/useFeedback.ts';
import { usePlanPreview } from '../hooks/usePlanPreview.ts';
import { usePlanSend } from '../hooks/usePlanSend.ts';
import { usePlanStorage } from '../hooks/usePlanStorage.ts';
import { usePlanAdd } from '../hooks/usePlanAdd.ts';

interface Props {
  deck: Deck | null;
  currentIndex: number;
  connected: boolean;
  template: Template | null;
  /** 역본 목록 — 성경 항목의 주·보조 역본을 고르는 데 쓴다 */
  translations: Translation[];
  defaultTranslation: string;
  send: (msg: ClientMsg) => boolean;
}





export function PlanPanel({
  deck, currentIndex, connected, template, translations, defaultTranslation, send,
}: Props): React.JSX.Element {
  /**
   * 편집 중인 것 — 이 화면의 척추다 (usePlanDraft, 2026-09-07 R-4).
   * 읽기·저장과 항목 추가가 둘 다 이것을 붙잡으므로 먼저 떼어냈다.
   */
  const draft = usePlanDraft();
  const {
    plan, items, dirty, cursor, setCursor, expandedId, setExpandedId, patchItems,
  } = draft;

  /** 기본 설정 패널을 펼쳤는지 */
  const [defaultsOpen, setDefaultsOpen] = useState(false);
  /**
   * 항목 편집 칸을 펼쳤는지.
   *
   * 기본은 펼침 — 항목을 고르는 것은 대개 고치려는 것이다. 그런데 '순서 표시' 처럼
   * 슬라이더가 많은 항목은 칸이 길어져 **순서 목록을 화면 밖으로 밀어낸다**
   * (2026-08-18 실측). 접을 수 있게 하고 높이도 제한한다.
   */
  const [detailOpen, setDetailOpen] = useState(true);
  /** 배너 셋 — 화면 블록 아홉 중 일곱이 이걸 쓴다 (useFeedback) */
  const feedback = useFeedback();
  const { busy, setBusy, error, setError, notice, setNotice } = feedback;

  /**
   * 단독으로 송출한 항목 — 빨간 점을 켜기 위해 기억한다.
   *
   * 전체 덱을 올린 경우는 `deck.groups` 로 판정할 수 있지만, 항목 하나만 올리면
   * groups 가 없어 무엇이 나가는지 알 수 없다. 지금 뭐가 나가는지 모르는 것이
   * 예배 중에는 가장 위험하다.
   */

  // 추가 바
  /**
   * 전례문 본문을 고치는 동안의 **날것 그대로의 입력**.
   *
   * 항목에는 빈 줄을 걸러낸 결과만 담긴다. 그 값을 그대로 textarea 에 되돌리면
   * Enter 를 눌러도 빈 줄이 즉시 지워져 줄을 늘릴 수 없다. 그래서 고치는 동안은
   * 입력한 글자를 그대로 보여 주고, 항목에는 걸러낸 결과를 함께 반영한다
   * (미리보기는 타이핑하는 대로 따라온다).
   */
  const [liturgyDraft, setLiturgyDraft] = useState<{ id: string; text: string } | null>(null);
  /**
   * 고른 찬양 항목이 **실제로 가진** 언어.
   *
   * 없는 언어를 켜 놓고 '왜 영어가 안 나오지' 가 되지 않게 흐리게 표시한다
   * (찬양 탭과 같은 규칙). 항목을 고를 때 한 번만 읽는다.
   */
  /** 고른 찬양 항목의 곡 정보 — 언어 버튼을 흐리게 하고, 악보가 있는지 알린다 */
  const [songInfo, setSongInfo] = useState<{ id: number; available: string[]; hasSheet: boolean } | null>(null);


  // 항목을 슬라이드로 푸는 것은 usePlanPreview 로 옮겼다 (2026-09-07 R-4).
  // 송출하지 않는다 — 선택과 송출은 갈라져 있다.
  const previewHook = usePlanPreview({
    items, expandedId, template,
  });
  const { resolveItem, preview, styleTemplates } = previewHook;

  /** 화면에 그릴 줄 목록 — 펼친 항목의 슬라이드가 그 아래에 들어간다 */
  const rows = buildPlanRows(items, expandedId, preview?.slides.length ?? 0);
  const currentRow = rows[Math.min(cursor, rows.length - 1)];
  /** 커서가 가리키는 항목 (슬라이드 줄이면 그 슬라이드의 항목) */
  const current = currentRow ? items[currentRow.itemIndex] : undefined;

  // ── 순서표 읽기·저장 ────────────────────────────────────────
  // usePlanStorage 로 옮겼다 (2026-09-07 R-4).
  // 여기가 사용자 데이터를 쓰는 길이다 — 잘못 덮어쓰면 지난주 순서가 사라진다.
  const storage = usePlanStorage({
    draft,
    feedback: { setBusy, setError, setNotice },
    // 추가 바의 역본을 이 예배의 기본값에서 시작한다 —
    // 순서표 열기와 추가 바 사이에 실제로 있는 유일한 결합이다
    onOpened: (target) => {
      setAddPrimary(target.defaults?.bible?.primary ?? defaultTranslation);
      setAddSecondary(target.defaults?.bible?.secondary ?? []);
    },
  });
  // 화면 컴포넌트에는 **storage 객체째로** 넘긴다 (프롭 일곱을 하나로).
  // PlanPanel 안에 남은 JSX 가 낱개로 쓰는 것은 이제 없다.

  // ── 항목을 슬라이드로 푼다 (선택했을 때 미리보기용) ──────────


  /**
   * 항목이 쓸 템플릿을 고르는 데 필요한 것들 (lib/plan-item-template.ts).
   *
   * **useMemo 로 고정한다** — 송출 함수들이 이걸 의존성으로 쓴다. 매 렌더마다
   * 새 객체가 나오면 그 함수들이 매번 새로 만들어져 고정의 뜻이 없어진다.
   */
  const templateChoice = useMemo(
    () => ({ defaults: plan?.defaults, styleTemplates, template }),
    [plan?.defaults, styleTemplates, template],
  );
  // ── 항목 추가 ───────────────────────────────────────────────
  // usePlanAdd 로 옮겼다 (2026-09-07 R-4).
  const add = usePlanAdd({
    draft,
    rows,
    previewSlideCount: preview?.slides.length ?? 0,
    feedback: { setBusy, setError, setNotice },
    defaultTranslation,
  });
  // 추가 바에는 **add 객체째로** 넘긴다 (프롭 스물다섯을 하나로).
  // 아직 PlanPanel 안에 남은 JSX 가 쓰는 것만 낱개로 꺼낸다.
  const { addKind, setAddPrimary, setAddSecondary, refreshQuotePreview } = add;

  // ── 송출 ────────────────────────────────────────────────────
  // 화면으로 내보내는 것 전부는 usePlanSend 로 옮겼다 (2026-09-07 R-4).
  const sendHook = usePlanSend({
    deck, currentIndex, connected, send, items, plan, resolveItem, templateChoice,
    feedback: { setBusy, setError, setNotice },
  });
  const {
    sendItem, sendTitle, refreshLive, restoreBefore,
    before, auto, setAuto, liveItemId, liveItemIndex, liveViaPlanDeck,
  } = sendHook;


  // 고른 항목이 찬양이면 그 곡의 언어와 **악보 유무**를 읽어 둔다
  const currentSongId = (() => {
    const item = items.find((i) => i.id === expandedId) ?? items[cursor];
    return item && item.type === 'song' ? item.songId : null;
  })();

  useEffect(() => {
    if (currentSongId === null) return;
    if (songInfo?.id === currentSongId) return;
    let alive = true;
    void api
      .song(currentSongId)
      .then((loaded) => {
        // 읽는 사이에 다른 항목으로 옮겼으면 버린다 — 늦게 온 응답이 덮지 않게
        if (alive) {
          setSongInfo({
            id: currentSongId,
            available: loaded.availableLangs,
            hasSheet: loaded.sheet !== undefined,
          });
        }
      })
      // 못 읽어도 순서표 작업은 계속돼야 한다 — 버튼이 흐려지지 않을 뿐이다
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [currentSongId, songInfo?.id]);


  /** 배경으로 쓸 그림 목록 (usePlanBackgrounds) */
  const backgrounds = usePlanBackgrounds({ defaultsOpen, addKind, items });




  // ── 줄을 눌렀을 때 ──────────────────────────────────────────

  /**
   * **이 프로젝트의 핵심 규칙**: 화면에 나가는 것은 언제나 '슬라이드'다.
   *
   * - 슬라이드 줄 → 송출
   * - 여러 장짜리 항목(성경·찬양)의 머리 줄 → **펼치기만**. 화면은 그대로
   * - 한 장짜리 항목(광고·순서 표시·공백) → 그 줄이 곧 슬라이드이므로 송출
   * - 구분 → 아무것도 나가지 않는다
   *
   * 1차 재설계의 "항목을 눌러도 안 나간다"를 "슬라이드를 눌러야 나간다"로 다듬은 것이다
   * (docs/plan-service-tab-3.md). 한 장짜리는 항목과 슬라이드가 같은 것이라 헛걸음만 없앤다.
   */
  const activateRow = useCallback(
    (row: PlanRow | undefined) => {
      if (!row) return;
      const item = items[row.itemIndex];
      if (!item || item.type === 'divider') return;

      if (row.kind === 'slide') {
        void sendItem(item, row.slideIndex);
        return;
      }
      if (isExpandable(item)) {
        const nowOpen = expandedId !== item.id;
        setExpandedId(nowOpen ? item.id : null);

        /*
         * 펼치면서 **제목을 띄운다** (사용자 요청, 2026-08-19).
         *
         * 여러 장짜리 항목은 누른 뒤 그 안의 장을 골라야 화면에 나가므로, 누르는 그
         * 순간이 '다음은 이것' 이라고 알릴 자리다. 접을 때는 띄우지 않는다 —
         * 접는 것은 '이제 안 볼래' 이지 '이걸 알려라' 가 아니다.
         *
         * 예배 기본 설정에서 끌 수 있다. 클릭이 송출을 일으키는 것은 큰 변화라,
         * 항목을 살펴보려고 눌렀을 때 화면이 바뀌는 것이 부담스러울 수 있다.
         */
        if (nowOpen && plan?.defaults?.titleOnSelect !== false) void sendTitle(item);
        return;
      }
      void sendItem(item, 0);
    },
    [items, sendItem, sendTitle, expandedId, plan?.defaults?.titleOnSelect],
  );

  // ── 키보드 ──────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      // Tab 으로 펼치고 Shift+Tab 으로 접는다 (2026-08-15 사용자 결정).
      // ←→ 는 건드리지 않는다 — 송출 중인 덱을 움직이는 손에 익은 조작이다.
      if (event.key === 'Tab') {
        event.preventDefault();
        if (!currentRow) return;
        if (event.shiftKey) {
          setExpandedId(null);
          return;
        }
        const item = items[currentRow.itemIndex];
        if (item && isExpandable(item)) setExpandedId(item.id);
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'j') {
        event.preventDefault();
        setCursor((prev) => Math.min(prev + 1, rows.length - 1));
      } else if (event.key === 'ArrowUp' || event.key === 'k') {
        event.preventDefault();
        setCursor((prev) => Math.max(prev - 1, 0));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        activateRow(currentRow);
      }
      // ←→ 는 가로채지 않는다 — 전역(송출 덱 이동)이 처리한다
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows.length, currentRow, items, activateRow]);

  // ── 렌더 ────────────────────────────────────────────────────


  return (
    <div className="plan-panel">
      {error && (
        <div className="banner error">
          <button type="button" className="close" onClick={() => setError(null)}>닫기</button>
          {error}
        </div>
      )}
      {notice && (
        <div className="banner warn">
          <button type="button" className="close" onClick={() => setNotice(null)}>닫기</button>
          {notice}
        </div>
      )}

      {auto && (
        <div className="banner auto-bar">
          <button type="button" className="close" onClick={() => setAuto(null)}>■ 정지</button>
          ⏱ <b>예배 전 안내 자동 진행 중</b> —{' '}
          {items.find((i) => i.id === auto.dividerId)?.type === 'divider'
            ? describeItem(items.find((i) => i.id === auto.dividerId)!)
            : ''}{' '}
          · {Math.round(auto.holdMs / 1000)}초마다 {auto.loop ? '· 끝나면 처음으로' : '· 끝나면 정지'}
        </div>
      )}

      {/* 한 열 목록 — 3차 재설계에서 오른쪽 열을 없애고 슬라이드를 이 안으로 넣었다 */}
      <div className="plan-single">
        <div className="card plan-list">
          <PlanHead storage={storage} plan={plan} busy={busy} />

          {plan && (
            <>
              <PlanActions
                storage={storage}
                draft={draft}
                send={sendHook}
                feedback={feedback}
                plan={plan}
                connected={connected}
                defaultsOpen={defaultsOpen}
                setDefaultsOpen={setDefaultsOpen}
              />
              {defaultsOpen && (
                <PlanDefaultsCard
                  storage={storage}
                  draft={draft}
                  add={add}
                  preview={previewHook}
                  backgrounds={backgrounds}
                  feedback={feedback}
                  plan={plan}
                  translations={translations}
                  defaultTranslation={defaultTranslation}
                />
              )}
            </>
          )}

          <PlanNameBar storage={storage} busy={busy} />

          <PlanLoadList storage={storage} />

          <PlanDirtyLine storage={storage} plan={plan} dirty={dirty} />

          {!plan && <p className="hintline muted">예배 유형을 고르거나 ＋ 로 새로 만드세요.</p>}

          <PlanCueList
            draft={draft}
            send={sendHook}
            preview={previewHook}
            feedback={feedback}
            rows={rows}
            activateRow={activateRow}
            connected={connected}
          />

          <PlanAddBar add={add} plan={plan} translations={translations} backgrounds={backgrounds} />
        </div>
      </div>

      {/*
        선택한 항목의 설정. 오른쪽 열을 없앴으므로 목록 **아래**에 한 덩어리로 둔다.
        목록 안에 끼워 넣으면 줄을 옮길 때마다 목록이 출렁여 진행이 보이지 않는다.
      */}
      {plan && current && currentRow && (
        <PlanItemEditor
          current={current}
          currentRow={currentRow}
          items={items}
          translations={translations}
          connected={connected}
          detailOpen={detailOpen}
          setDetailOpen={setDetailOpen}
          bgFiles={backgrounds.files}
          bgLibrary={backgrounds.library}
          liturgyDraft={liturgyDraft}
          setLiturgyDraft={setLiturgyDraft}
          songInfo={songInfo}
          liveItemId={liveItemId}
          liveItemIndex={liveItemIndex}
          liveViaPlanDeck={liveViaPlanDeck}
          patchItems={patchItems}
          itemTemplateFor={(item) => itemTemplateFor(item, templateChoice)}
          baseFontSizeFor={(item, fallback) => baseFontSizeFor(item, fallback, templateChoice)}
          sendItem={sendItem}
          refreshLive={refreshLive}
          refreshQuotePreview={refreshQuotePreview}
          restoreBefore={restoreBefore}
          before={before}
        />
      )}

      {/*
        이 목록에서만 쓰는 키만 적는다. 송출 키(←→·Space·B·Esc)는 오른쪽 송출 제어에
        같은 내용이 있어, 두 곳에 적으면 자리를 두 번 쓰고 어느 것이 최신인지 흐려진다.
      */}
      <p className="hintline muted plan-keys">
        <b>↑↓</b> 줄 이동 · <b>Tab</b> 펼치기 · <b>Shift+Tab</b> 접기 · <b>Enter</b> 송출
      </p>
    </div>
  );
}

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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildPlanRows, describeItem, isExpandable, moveItem, removeItem, type PlanRow,
} from '../../../lib/plan-deck.ts';
import { LANG_LABELS, ACTIVE_LANGS, toggleLang } from '../../../lib/lang-select.ts';
import {
  baseFontSizeFor,
  itemTemplateFor,
  templateIdFor as pickTemplateId,
} from '../../../lib/plan-item-template.ts';
import { PlanItemEditor } from '../components/PlanItemEditor.tsx';
import { PlanAddBar } from '../components/plan/PlanAddBar.tsx';
import { PlanDirtyLine } from '../components/plan/PlanDirtyLine.tsx';
import { PlanHead } from '../components/plan/PlanHead.tsx';
import { PlanLoadList } from '../components/plan/PlanLoadList.tsx';
import { PlanNameBar } from '../components/plan/PlanNameBar.tsx';
import { BackgroundSelect } from '../components/BackgroundSelect.tsx';
import {
  MAX_SECONDARY, itemIcon, itemMeta, slideSummary, today,
} from '../../../lib/plan-item-view.ts';
import {
  AUTO_HOLD_MS_DEFAULT,
  type ClientMsg, type CueItem, type Deck, type LangCode,
  type Template, type Translation,
} from '../../../shared/types.ts';
import { api } from '../api.ts';
import { usePlanBackgrounds } from '../hooks/usePlanBackgrounds.ts';
import { usePlanDraft } from '../hooks/usePlanDraft.ts';
import { usePlanFeedback } from '../hooks/usePlanFeedback.ts';
import { usePlanPreview } from '../hooks/usePlanPreview.ts';
import { usePlanSend } from '../hooks/usePlanSend.ts';
import { usePlanStorage } from '../hooks/usePlanStorage.ts';
import { usePlanAdd } from '../hooks/usePlanAdd.ts';

/**
 * 찬양 검색에서 한 번에 보여 줄 곡 수. '찬양' 탭(60)보다 적은 이유는
 * 추가 바 아래 한 줄짜리 후보 띠라서 30개 남짓이 두세 줄로 들어가는 한계다.
 */
const SONG_HIT_LIMIT = 30;

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
    plan, setPlan, items, setItems, dirty, setDirty,
    cursor, setCursor, expandedId, setExpandedId, patchItems, patchDefaults,
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
  /** 배너 셋 — 화면 블록 아홉 중 일곱이 이걸 쓴다 (usePlanFeedback) */
  const feedback = usePlanFeedback();
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

  const listRef = useRef<HTMLDivElement>(null);

  // 항목을 슬라이드로 푸는 것은 usePlanPreview 로 옮겼다 (2026-09-07 R-4).
  // 송출하지 않는다 — 선택과 송출은 갈라져 있다.
  const { resolveItem, preview, previewError, styleTemplates } = usePlanPreview({
    items, expandedId, template,
  });

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
  // 아직 PlanPanel 안에 남은 JSX 가 쓰는 것만 낱개로 꺼낸다.
  const {
    templates, saved, openPlan, saveCurrent, setNameBar, setLoadOpen,
    loadOpen, saveLabel, planNoun,
  } = storage;

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
  const templateIdFor = useCallback(
    (item: CueItem) => pickTemplateId(item, templateChoice),
    [templateChoice],
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
  const { addKind, setAddPrimary, setAddSecondary, readingBook, refreshQuotePreview } = add;

  // ── 송출 ────────────────────────────────────────────────────
  // 화면으로 내보내는 것 전부는 usePlanSend 로 옮겼다 (2026-09-07 R-4).
  const {
    liveSlide, liveLabel, slideCount,
    sendItem, sendTitle, refreshLive, restoreBefore, startAuto, loadForService,
    before, auto, setAuto, liveItemId,
    liveItemIndex, liveSlideIndexInItem, liveViaPlanDeck,
  } = usePlanSend({
    deck, currentIndex, connected, send, items, plan, resolveItem, templateChoice,
    feedback: { setBusy, setError, setNotice },
  });


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

  // 커서가 화면 밖으로 나가지 않게
  useEffect(() => {
    listRef.current?.querySelector('.cue-row.current, .cue-divider.current')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

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
              {/*
                한 줄로 합쳤다 (2026-08-18). 전에는 '예배용으로 올리기' 가 한 줄을 통째로
                쓰고 보조 버튼이 또 한 줄을 써서, 순서 목록이 그만큼(53px) 좁아졌다.
                랩탑(높이 900px)에서 목록이 285px 밖에 안 됐다.
              */}
              <div className="plan-head plan-actions">
                {/*
                  '예배용으로 올리기' — 순서표 전체를 하나의 덱으로 올리는 **주 동작**이다.
                  110eac5 의 한 줄 합치기에서 이 버튼만 빠져(회귀), 순서표 전체를 올릴 길이
                  없어졌다. 항목마다 ▶ 를 누르는 것으로는 화살표로 끝까지 진행할 수 없다.
                  .plan-actions > button.primary 의 `flex: 2` 는 원래 이 버튼 자리다.
                */}
                <button
                  type="button"
                  className="primary grow"
                  onClick={() => void loadForService()}
                  disabled={!connected || busy || items.length === 0}
                  title="순서표 전체를 하나로 올립니다. 이후 화살표로 끝까지 진행합니다."
                >
                  예배용으로 올리기
                </button>
                {/*
                  **열어 둔 것에 그대로 저장한다.** 유형이면 '템플릿 업데이트',
                  저장된 순서면 '저장하기' — 이름을 다시 치지 않는다.
                  전에는 저장된 순서에 이 버튼이 회색이라, 불러와 고친 것을 남기려면
                  '순서 저장하기' 로 긴 이름을 똑같이 맞혀 쳐야 했다 (2026-09-03).
                */}
                <button
                  type="button"
                  className="grow"
                  onClick={() => void saveCurrent()}
                  disabled={busy}
                  title={
                    plan.kind === 'template'
                      ? '지금 고친 내용을 이 유형의 원본으로 굳힙니다'
                      : `지금 고친 내용을 '${plan.name}' 에 그대로 저장합니다`
                  }
                >
                  {saveLabel}
                </button>
                <button
                  type="button"
                  className="grow"
                  onClick={() => {
                    setLoadOpen(false);
                    // 유형에서는 '이번 회차' 를 새로 만드는 것이니 날짜를 붙여 준다.
                    // 순서에서는 이미 그 회차라, 지금 이름에서 고쳐 쓰게 둔다.
                    setNameBar({
                      kind: 'plan',
                      value: plan.kind === 'template' ? `${today()} ${plan.name}` : plan.name,
                    });
                  }}
                  disabled={busy}
                  title={
                    plan.kind === 'template'
                      ? '이번 회차를 따로 남깁니다'
                      : '이 순서를 건드리지 않고 새 이름으로 하나 더 만듭니다'
                  }
                >
                  {plan.kind === 'template' ? '순서 저장하기' : '다른 이름으로 저장'}
                </button>
                <button
                  type="button"
                  className="grow"
                  onClick={() => { setNameBar(null); setLoadOpen((prev) => !prev); }}
                  disabled={busy}
                  title="저장해 둔 순서를 엽니다"
                >
                  순서 불러오기
                </button>
                <button
                  type="button"
                  className={defaultsOpen ? 'primary' : undefined}
                  onClick={() => setDefaultsOpen((prev) => !prev)}
                  title="이 예배에서 기본으로 쓸 템플릿·역본"
                >
                  기본 설정
                </button>
              </div>

              {defaultsOpen && (
                <div className="card plan-defaults">
                  <p className="hintline muted">
                    이 예배 전체의 기본값입니다. <b>항목에서 따로 지정한 것만</b> 예외가 됩니다.
                    템플릿은 이미 만든 항목에도 곧바로 적용되고, 역본·언어는 <b>앞으로 넣는</b> 항목에 채워집니다.
                  </p>

                  {/*
                    교독문·주기도문·사도신경 배경은 한 곳에서 정한다.
                    사용자 요구: 이 셋은 '무조건' 배경을 깐다 (2026-08-18).
                    여기서 고르면 앞으로 넣는 항목이 자동으로 이 배경을 받는다.
                  */}
                  <div className="row detail-controls">
                    <label title="교독문·주기도문·사도신경에 함께 쓰입니다">교독문·전례문 배경</label>
                    <BackgroundSelect
                      value={plan.defaults?.readingBackground}
                      library={backgrounds.library}
                      uploaded={backgrounds.files}
                      onChange={(readingBackground) => patchDefaults((c) => ({ ...c, readingBackground }))}
                    />
                  </div>

                  {([
                    ['bible', '성경'],
                    ['song', '찬양'],
                    ['order', '순서 표시'],
                    ['text', '광고·인용구'],
                  ] as const).map(([key, label]) => (
                    <div className="row detail-controls" key={key}>
                      <label>{label} 템플릿</label>
                      <select
                        value={plan.defaults?.templates?.[key] ?? ''}
                        onChange={(e) => {
                          const value = e.target.value === '' ? undefined : Number(e.target.value);
                          patchDefaults((c) => ({
                            ...c,
                            templates: { ...c.templates, [key]: value },
                          }));
                        }}
                      >
                        <option value="">지정 안 함 (지금 템플릿 유지)</option>
                        {styleTemplates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}

                  <div className="row detail-controls translation-pick">
                    <label>성경 역본</label>
                    <select
                      value={plan.defaults?.bible?.primary ?? defaultTranslation}
                      onChange={(e) => {
                        const next = e.target.value;
                        patchDefaults((c) => ({
                          ...c,
                          bible: {
                            ...c.bible,
                            primary: next,
                            secondary: (c.bible?.secondary ?? []).filter((id) => id !== next),
                          },
                        }));
                        setAddPrimary(next);
                        setAddSecondary((prev) => prev.filter((id) => id !== next));
                      }}
                    >
                      {translations.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <span className="candidates">
                      {translations
                        .filter((t) => t.id !== (plan.defaults?.bible?.primary ?? defaultTranslation))
                        .map((t) => {
                          const current2 = plan.defaults?.bible?.secondary ?? [];
                          const active = current2.includes(t.id);
                          return (
                            <button
                              key={t.id}
                              type="button"
                              className={active ? 'primary' : undefined}
                              onClick={() => {
                                const next = active
                                  ? current2.filter((id) => id !== t.id)
                                  : current2.length >= MAX_SECONDARY
                                    ? current2
                                    : [...current2, t.id];
                                patchDefaults((c) => ({ ...c, bible: { ...c.bible, secondary: next } }));
                                setAddSecondary(next);
                              }}
                              disabled={!active && (plan.defaults?.bible?.secondary?.length ?? 0) >= MAX_SECONDARY}
                            >
                              {t.shortName}
                            </button>
                          );
                        })}
                    </span>
                  </div>

                  <div className="row detail-controls">
                    <label>성경 화면 넘김</label>
                    <select
                      value={plan.defaults?.bible?.paging ?? 'verse'}
                      onChange={(e) =>
                        patchDefaults((c) => ({ ...c, bible: { ...c.bible, paging: e.target.value } }))
                      }
                    >
                      <option value="verse">1절씩</option>
                      <option value="auto">자동 (화면에 맞춰)</option>
                      <option value="pair">2절씩</option>
                      <option value="all">구간 전체</option>
                    </select>

                    {/*
                      찬양 표시 언어 기본값 — 이 칸도 없었다. 항목마다 고르는 것은
                      가능해졌지만, 한/영으로 예배하는 교회는 매주 곡마다 누르게 된다.
                      '앞으로 넣는 항목'에 채워지는 값이다 (이미 있는 항목은 그대로).
                    */}
                    <label title="앞으로 넣는 찬양 항목에 채워집니다">찬양 표시 언어</label>
                    <span className="candidates">
                      {ACTIVE_LANGS.map((lang) => {
                        const currentLangs = (plan.defaults?.song?.langs ?? ['ko']) as LangCode[];
                        const active = currentLangs.includes(lang);
                        return (
                          <button
                            key={lang}
                            type="button"
                            className={active ? 'primary' : undefined}
                            onClick={() =>
                              patchDefaults((c) => ({
                                ...c,
                                song: { ...c.song, langs: toggleLang(currentLangs, lang) },
                              }))
                            }
                          >
                            {LANG_LABELS[lang] ?? lang}
                          </button>
                        );
                      })}
                    </span>

                    <label>찬양 화면 넘김</label>
                    <select
                      value={plan.defaults?.song?.lines ?? '2'}
                      onChange={(e) =>
                        patchDefaults((c) => ({ ...c, song: { ...c.song, lines: e.target.value } }))
                      }
                    >
                      <option value="1">1줄씩</option>
                      <option value="2">2줄씩</option>
                      <option value="4">4줄씩</option>
                      <option value="section">섹션 전체</option>
                    </select>
                  </div>

                  {/*
                    클릭이 송출을 일으키는 것은 큰 변화라 끌 수 있게 둔다. 없으면 켠
                    것으로 보므로(요청받은 기능이 기본으로 동작해야 한다) false 만 저장된다.
                  */}
                  <div className="row detail-controls">
                    <label title="성경·찬양·교독문·주기도문·사도신경에 해당합니다">
                      항목을 누르면 제목 띄우기
                    </label>
                    <span className="candidates">
                      {(
                        [
                          [true, '켬'],
                          [false, '끔'],
                        ] as const
                      ).map(([on, label]) => (
                        <button
                          key={label}
                          type="button"
                          className={(plan.defaults?.titleOnSelect !== false) === on ? 'primary' : undefined}
                          onClick={() => patchDefaults((c) => ({ ...c, titleOnSelect: on }))}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                    <span className="muted output-style-hint">
                      여러 장짜리 항목을 펼칠 때 '창 1:1-6' 처럼 제목 한 줄이 나갑니다
                    </span>
                  </div>

                  {/*
                    **기본 설정에도 저장 버튼을 둔다.**

                    이 값들은 따로 저장되는 것이 아니라 **순서표 안에** 함께 담긴다
                    (`service_plans.defaults`). 그래서 저장하는 곳은 위의 버튼 하나뿐이다.
                    그런데 '저장하기 를 눌러야 남습니다' 만 적어 두면 그 버튼이 순서를
                    저장하는 것으로 보여, '기본 설정 저장 버튼은 어디 있나' 를 찾게 된다
                    (2026-09-03 사용자 보고). 같은 동작을 같은 이름으로 여기에도 둔다 —
                    설정을 만진 자리에서 그대로 누를 수 있어야 한다.
                  */}
                  <div className="row defaults-save">
                    <span className="hintline muted grow">
                      이 값들은 <b>순서표에 함께 담깁니다</b> — 따로 저장하는 곳은 없습니다.
                      {dirty
                        ? ' 아직 저장되지 않았습니다.'
                        : ` 지금은 '${plan.name}' 에 저장된 상태입니다.`}
                    </span>
                    <button
                      type="button"
                      className={dirty ? 'primary' : undefined}
                      onClick={() => void saveCurrent()}
                      disabled={busy}
                      title={`기본 설정과 순서를 함께 '${plan.name}' ${planNoun}에 저장합니다 (위의 버튼과 같습니다)`}
                    >
                      {saveLabel}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          <PlanNameBar storage={storage} busy={busy} />

          <PlanLoadList storage={storage} />

          <PlanDirtyLine storage={storage} plan={plan} dirty={dirty} />

          {!plan && <p className="hintline muted">예배 유형을 고르거나 ＋ 로 새로 만드세요.</p>}

          {plan && (
            <div className="cue-list" ref={listRef}>
              {items.length === 0 && <p className="hintline muted">아래에서 항목을 추가하세요.</p>}

              {rows.map((row, rowIndex) => {
                const item = items[row.itemIndex];
                if (!item) return null;
                const isCursor = rowIndex === cursor;

                // ── 구분(그룹 머리글) ──
                if (row.kind === 'divider' && item.type === 'divider') {
                  const running = auto?.dividerId === item.id;
                  return (
                    <div
                      key={item.id}
                      className={`cue-divider${isCursor ? ' current' : ''}${running ? ' auto' : ''}`}
                      onClick={() => setCursor(rowIndex)}
                    >
                      <span className="label">
                        {item.label}
                        {item.auto && <span className="auto-tag" title="예배 전 안내 — 자동으로 넘어갑니다">⏱</span>}
                      </span>
                      <span className="actions">
                        {/*
                          **꺼져 있을 때도 자리를 보여 준다.**
                          전에는 자동 넘김을 켜기 전까지 구분 행에 아무 표시가 없어서
                          이 기능이 있는 줄도 몰랐다 ('▶ 를 눌러도 안 된다' 신고,
                          2026-09-01). 흐린 ⏱ 을 누르면 켜지고 그 자리에 ▶ 가 생긴다 —
                          켜는 곳과 시작하는 곳이 같아야 헤매지 않는다.
                        */}
                        {item.auto ? (
                          <button
                            type="button"
                            className="go"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (running) setAuto(null);
                              else void startAuto(item);
                            }}
                            disabled={!connected || busy}
                            title={running ? '자동 진행 정지' : '예배 전 안내 시작 (자동으로 넘어갑니다)'}
                          >
                            {running ? '■' : '▶'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              patchItems(
                                items.map((i) =>
                                  i.id === item.id
                                    ? { ...i, auto: { holdMs: AUTO_HOLD_MS_DEFAULT, loop: true } }
                                    : i,
                                ),
                              );
                            }}
                            title="예배 전 안내로 쓰기 — 켜면 ▶ 가 생겨 자동으로 넘어갑니다"
                          >
                            ⏱
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, row.itemIndex, row.itemIndex - 1)); }}
                          disabled={row.itemIndex === 0}
                          title="위로"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, row.itemIndex, row.itemIndex + 1)); }}
                          disabled={row.itemIndex === items.length - 1}
                          title="아래로"
                        >
                          ↓
                        </button>
                        <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(removeItem(items, item.id)); }} title="삭제">✕</button>
                      </span>
                    </div>
                  );
                }

                // ── 펼친 항목의 슬라이드 줄 ──
                if (row.kind === 'slide') {
                  const slide = preview?.slides[row.slideIndex];
                  const isLiveSlide =
                    row.itemIndex === liveItemIndex && liveSlideIndexInItem === row.slideIndex;
                  return (
                    <div
                      key={`${item.id}-s${row.slideIndex}`}
                      className={`cue-slide-row${isCursor ? ' current' : ''}${isLiveSlide ? ' live' : ''}`}
                      onClick={() => { setCursor(rowIndex); void sendItem(item, row.slideIndex); }}
                      title="눌러서 송출"
                    >
                      <span className="live-dot" title={isLiveSlide ? '송출 중' : undefined} />
                      <span className="num">{preview?.labels[row.slideIndex] || row.slideIndex + 1}</span>
                      <span className="text">
                        {slide ? slideSummary(slide, preview?.slides[row.slideIndex - 1]) : ''}
                      </span>
                    </div>
                  );
                }

                // ── 항목 줄 ──
                const isLive = row.itemIndex === liveItemIndex;
                const expandable = isExpandable(item);
                const expanded = expandedId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`cue-row${isCursor ? ' current' : ''}${isLive ? ' live' : ''}${expanded ? ' expanded' : ''}`}
                    onClick={() => { setCursor(rowIndex); activateRow(row); }}
                    title={expandable ? '눌러서 펼치기 (Tab)' : '눌러서 송출'}
                  >
                    <span className="live-dot" title={isLive ? '송출 중' : undefined} />
                    <span className="twisty">{expandable ? (expanded ? '▾' : '▸') : ''}</span>
                    <span className="icon">{itemIcon(item)}</span>
                    <span className="body">
                      <span className="title">{describeItem(item)}</span>
                      <span className="meta">{itemMeta(item)}</span>
                    </span>

                    {/* 이 항목이 어느 템플릿으로 나가는지 — 여기서 바로 바꾼다 */}
                    <select
                      className="row-template"
                      value={'templateId' in item && item.templateId !== undefined ? item.templateId : ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        const value = e.target.value === '' ? undefined : Number(e.target.value);
                        patchItems(
                          items.map((i) => (i.id === item.id ? { ...i, templateId: value } : i)),
                        );
                      }}
                      title="이 항목을 송출할 때 쓸 템플릿"
                    >
                      <option value="">템플릿 그대로</option>
                      {styleTemplates.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>

                    <span className="actions">
                      <button
                        type="button"
                        className="go"
                        onClick={(e) => { e.stopPropagation(); void sendItem(item); }}
                        disabled={!connected}
                        title="바로 송출"
                      >
                        ▶
                      </button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, row.itemIndex, row.itemIndex - 1)); }} disabled={row.itemIndex === 0} title="위로">↑</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(moveItem(items, row.itemIndex, row.itemIndex + 1)); }} disabled={row.itemIndex === items.length - 1} title="아래로">↓</button>
                      <button type="button" onClick={(e) => { e.stopPropagation(); patchItems(removeItem(items, item.id)); }} title="삭제">✕</button>
                    </span>
                  </div>
                );
              })}

              {previewError && <p className="hintline error">{previewError}</p>}
            </div>
          )}

          <PlanAddBar add={add} plan={plan} translations={translations} backgrounds={backgrounds} />
        </div>
      </div>

      {/*
        선택한 항목의 설정. 오른쪽 열을 없앴으므로 목록 **아래**에 한 덩어리로 둔다.
        목록 안에 끼워 넣으면 줄을 옮길 때마다 목록이 출렁여 진행이 보이지 않는다.
      */}
      {plan && current && currentRow && (
        <PlanItemEditor
          plan={plan}
          current={current}
          currentRow={currentRow}
          items={items}
          rows={rows}
          translations={translations}
          connected={connected}
          detailOpen={detailOpen}
          setDetailOpen={setDetailOpen}
          auto={auto}
          bgFiles={backgrounds.files}
          bgLibrary={backgrounds.library}
          readingBook={readingBook}
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

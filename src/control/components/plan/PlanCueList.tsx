/**
 * **순서 목록** — 예배를 실제로 진행하는 화면.
 *
 * `PlanPanel` 에서 갈라냈다(2026-09-08). **이 프로젝트에서 가장 조심할 화면이다** —
 * 여기가 틀리면 예배 중에 오퍼레이터가 거짓을 보고 판단한다.
 *
 * ## 여기서 보이는 규칙 (설계 근거는 `PLAN.md`)
 *
 * | | 왜 |
 * |---|---|
 * | **선택과 송출을 가른다** | 파란 테두리 = 보고 있는 것, 빨간 점 = 실제로 나가는 것. 눌렀다고 바로 나가면 예배 중 사고가 난다 |
 * | 한 줄짜리 **조밀한** 행 | 10항목이 한 화면에 들어와야 진행이 보인다 (성경·찬양 탭의 큰 카드가 아니다) |
 * | 펼친 항목의 슬라이드가 **그 아래 줄로** 들어온다 | 3차 재설계에서 오른쪽 열을 없앴다 (`docs/plan-service-tab-3.md`) |
 * | 커서를 옮기면 **화면 안으로 끌어온다** | 20항목짜리에서 커서가 화면 밖에 있으면 어디인지 알 수 없다 |
 */

import { useEffect, useRef } from 'react';

import { describeItem, isExpandable, moveItem, removeItem, type PlanRow } from '../../../../lib/plan-deck.ts';
import { itemIcon, itemMeta, slideSummary } from '../../../../lib/plan-item-view.ts';
import { AUTO_HOLD_MS_DEFAULT, type CueItem, type Template } from '../../../../shared/types.ts';
import type { PlanDraft } from '../../hooks/usePlanDraft.ts';
import type { PlanFeedback } from '../../hooks/usePlanFeedback.ts';
import type { PlanPreview } from '../../hooks/usePlanPreview.ts';
import type { PlanSend } from '../../hooks/usePlanSend.ts';

export function PlanCueList({
  draft, send, preview: previewHook, feedback, rows, activateRow, template, connected,
}: {
  draft: PlanDraft;
  send: PlanSend;
  preview: PlanPreview;
  feedback: PlanFeedback;
  /** 화면에 그릴 줄 목록 — 부모가 만든다 (키보드 처리와 추가 바도 같은 것을 쓴다) */
  rows: readonly PlanRow[];
  /** 줄을 눌렀을 때 — 이 프로젝트의 핵심 규칙이 담긴 함수다 (부모에 둔다) */
  activateRow: (row: PlanRow | undefined) => void;
  /** 지금 화면이 쓰는 템플릿 */
  template: Template | null;
  connected: boolean;
}): React.JSX.Element {
  const {
    plan, items, cursor, setCursor, expandedId, patchItems,
  } = draft;
  const {
    auto, setAuto, sendItem, startAuto, liveItemIndex, liveSlideIndexInItem,
  } = send;
  const { preview, previewError, styleTemplates } = previewHook;
  const { busy, error } = feedback;

  const listRef = useRef<HTMLDivElement>(null);

  // 커서가 화면 밖으로 나가지 않게
  useEffect(() => {
    listRef.current?.querySelector('.cue-row.current, .cue-divider.current')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <>
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
    </>
  );
}

/**
 * 선택한 항목의 편집 칸 — '예배 순서' 목록 **아래**에 한 덩어리로 붙는다.
 *
 * `PlanPanel.tsx` 에서 떼어냈다 (검토 2026-08-22 R-4). 그 파일이 3,147줄이 되어
 * 규칙(최대 800줄)을 크게 넘겼다.
 *
 * ## 왜 프롭이 많은가
 *
 * 이 칸은 목록·송출·자동 진행과 같은 상태를 본다. 상태를 여기로 내려보내지 않고
 * **읽기 값과 콜백만** 받는다 — 편집 칸이 스스로 순서표를 고치면 목록과 어긋난다.
 * 타입을 명시해 두었으므로 빠뜨리면 `tsc` 가 잡는다.
 */

import type React from 'react';

import { describeItem, itemsInGroup, splitOrderText, type PlanRow } from '../../../lib/plan-deck.ts';
import { LANG_LABELS, MAX_LANGS, SELECTABLE_LANGS, toggleLang } from '../../../lib/lang-select.ts';
import {
  DEFAULT_LITURGY_PER_SLIDE, DEFAULT_LITURGY_VERSION, LITURGY_TEXTS, findLiturgy, liturgyLines,
  type LiturgyPerSlide, type LiturgyVersion,
} from '../../../lib/liturgy-texts.ts';
import { MAX_SECONDARY, itemIcon } from '../../../lib/plan-item-view.ts';
import { PRESENTER_SCALE_MAX, PRESENTER_SCALE_MIN, STROKE_MIN } from '../../../lib/order-rhythm.ts';
import { READING_BOOK_LABELS, type BackgroundFile, type ReadingBook } from '../api.ts';
import { BackgroundSelect } from './BackgroundSelect.tsx';
import { DisplayToggles } from './DisplayToggles.tsx';
import { ItemTextStyleControls } from './ItemTextStyleControls.tsx';
import { OrderCharTuner } from './OrderCharTuner.tsx';
import { isComposing } from '../ime.ts';
import {
  AUTO_HOLD_MS_DEFAULT,
  type CueItem, type ItemBackground, type LangCode, type ServicePlan, type SlidePayload,
  type Template, type Translation,
} from '../../../shared/types.ts';

export interface PlanItemEditorProps {
  plan: ServicePlan;
  current: CueItem;
  currentRow: PlanRow;
  items: readonly CueItem[];
  rows: readonly PlanRow[];
  translations: readonly Translation[];
  connected: boolean;
  detailOpen: boolean;
  setDetailOpen: React.Dispatch<React.SetStateAction<boolean>>;
  auto: { dividerId: string; holdMs: number; loop: boolean } | null;
  bgFiles: BackgroundFile[];
  bgLibrary: BackgroundFile[];
  readingBook: ReadingBook;
  liturgyDraft: { id: string; text: string } | null;
  setLiturgyDraft: React.Dispatch<React.SetStateAction<{ id: string; text: string } | null>>;
  songLangs: { id: number; available: string[] } | null;
  liveItemId: string | null;
  liveItemIndex: number;
  liveViaPlanDeck: boolean;
  patchItems: (next: CueItem[] | ((prev: CueItem[]) => CueItem[])) => void;
  itemTemplateFor: (item: CueItem) => Template | null;
  baseFontSizeFor: (item: CueItem, fallback: number) => number;
  sendItem: (item: CueItem, slideIndex?: number) => Promise<void> | void;
  refreshLive: (item: CueItem) => void;
  refreshQuotePreview: (itemId: string, ref: string, translationId: string) => Promise<void>;
  restoreBefore: () => void;
  /** `↩ 직전으로` 가 돌아갈 화면 — 없으면 그 버튼을 숨긴다 */
  before: { slide: SlidePayload; label: string } | null;
}

export function PlanItemEditor({
  plan, current, currentRow, items, rows, translations, connected,
  detailOpen, setDetailOpen, auto, bgFiles, bgLibrary, readingBook,
  liturgyDraft, setLiturgyDraft, songLangs, liveItemId, liveItemIndex, liveViaPlanDeck,
  patchItems, itemTemplateFor, baseFontSizeFor, sendItem, refreshLive, refreshQuotePreview,
  restoreBefore, before,
}: PlanItemEditorProps): React.JSX.Element {
  return (
        <div className={`card plan-settings${detailOpen ? '' : ' collapsed'}`}>
          {/* 제목 줄이 곧 접기 버튼이다 — 따로 아이콘을 두면 좁은 폭에서 자리를 또 쓴다 */}
          <button
            type="button"
            className="plan-detail-title"
            onClick={() => setDetailOpen((prev) => !prev)}
            title={detailOpen ? '편집 칸 접기' : '편집 칸 펼치기'}
          >
            <span className="caret">{detailOpen ? '▾' : '▸'}</span>
            <span className="icon">{itemIcon(current)}</span>
            <span className="plan-detail-name">{describeItem(current)}</span>
            {liveItemIndex === (currentRow?.itemIndex ?? -1) && <span className="live-tag">송출 중</span>}
          </button>

          {detailOpen && (
            <div className="plan-detail-body">

          {before && (
            <div className="row" style={{ marginBottom: 8 }}>
              <button type="button" onClick={restoreBefore} disabled={!connected}>
                ↩ 직전으로 ({before.label || '이전 화면'})
              </button>
            </div>
          )}

          {current.type === 'divider' && (
            <>
              <div className="row detail-controls">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={Boolean(current.auto)}
                    onChange={(e) =>
                      patchItems(
                        items.map((i) =>
                          i.id === current.id
                            ? e.target.checked
                              ? { ...i, auto: { holdMs: AUTO_HOLD_MS_DEFAULT, loop: true } }
                              : { ...i, auto: undefined }
                            : i,
                        ),
                      )
                    }
                  />
                  예배 전 안내 (자동으로 넘김)
                </label>
              </div>

              {current.auto && (
                <div className="row detail-controls">
                  <label>한 장에 머무는 시간</label>
                  <input
                    type="number"
                    min={1}
                    max={600}
                    value={Math.round((current.auto.holdMs ?? AUTO_HOLD_MS_DEFAULT) / 1000)}
                    onChange={(e) => {
                      const seconds = Math.min(Math.max(Number(e.target.value) || 1, 1), 600);
                      patchItems(
                        items.map((i) =>
                          i.id === current.id && i.type === 'divider' && i.auto
                            ? { ...i, auto: { ...i.auto, holdMs: seconds * 1000 } }
                            : i,
                        ),
                      );
                    }}
                    style={{ width: 72 }}
                  />
                  <span className="muted">초</span>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={current.auto.loop !== false}
                      onChange={(e) =>
                        patchItems(
                          items.map((i) =>
                            i.id === current.id && i.type === 'divider' && i.auto
                              ? { ...i, auto: { ...i.auto, loop: e.target.checked } }
                              : i,
                          ),
                        )
                      }
                    />
                    마지막에서 처음으로
                  </label>
                  <span className="muted">아래 항목 {itemsInGroup(items, current.id).length}개</span>
                </div>
              )}
            </>
          )}

          {current.type === 'song' && (
            <div className="row detail-controls">
              {/*
                표시 언어 — 전에는 이 칸이 없었다. 항목을 만들 때 기본값으로 한 번
                정해지고 그 뒤로 바꿀 길이 없어서, 영어 가사를 넣어도 순서표의 찬양은
                늘 한국어만 나갔다. 규칙(lib/lang-select.ts)은 찬양 탭과 공유한다.
                **순서가 뜻을 갖는다** — 앞에 있는 언어가 화면 위로 간다.
              */}
              <label title="누른 순서대로 위에서 아래로 놓입니다">표시 언어 (최대 {MAX_LANGS})</label>
              <span className="candidates">
                {SELECTABLE_LANGS.map((lang) => {
                  const active = current.langs.includes(lang);
                  const has = songLangs?.id === current.songId ? songLangs.available.includes(lang) : true;
                  return (
                    <button
                      key={lang}
                      type="button"
                      className={active ? 'primary' : undefined}
                      onClick={() => {
                        const next = items.map((i) =>
                          i.id === current.id && i.type === 'song'
                            ? { ...i, langs: toggleLang(i.langs, lang) }
                            : i,
                        );
                        patchItems(next);
                        // 단독 송출 중이면 바로 다시 보내 눈으로 보며 맞춘다
                        const updated = next.find((i) => i.id === current.id);
                        if (updated) refreshLive(updated);
                      }}
                      title={has ? '' : '이 곡에는 이 언어 가사가 없습니다'}
                    >
                      {LANG_LABELS[lang] ?? lang}
                      {!has && ' ·'}
                    </button>
                  );
                })}
              </span>

              {/*
                버튼만 보면 어느 언어가 위인지 알 수 없다 — 버튼 자리는 고정이고
                뜻을 갖는 것은 **고른 순서**다. 순서 행에 'en/ko' 로 나오긴 하지만
                코드라 읽기 어렵다. 두 개를 골랐을 때만 밝힌다.
              */}
              {current.langs.length === 2 && (
                <span className="muted lang-order">
                  위 {LANG_LABELS[current.langs[0]!] ?? current.langs[0]} · 아래{' '}
                  {LANG_LABELS[current.langs[1]!] ?? current.langs[1]}
                </span>
              )}

              <ItemTextStyleControls
                value={current.style}
                showScale={false}
                onChange={(style) => {
                  const next = items.map((i) =>
                    i.id === current.id && i.type === 'song'
                      ? { ...i, ...(style ? { style } : { style: undefined }) }
                      : i,
                  );
                  patchItems(next);
                  const updated = next.find((i) => i.id === current.id);
                  if (updated) refreshLive(updated);
                }}
              />

              {/*
                찬양에는 **참조 표기와 소제목이 없다** — renderSong 이 비운다.
                그래서 뜻이 있는 것은 절 번호뿐이고, 없는 것을 보여 주면 눌러도 아무 일이
                일어나지 않아 고장으로 읽힌다.
              */}
              <DisplayToggles
                value={current.display}
                template={itemTemplateFor(current)}
                keys={['verseNumbers']}
                onChange={(display) => {
                  const next = items.map((i) =>
                    i.id === current.id && i.type === 'song'
                      ? { ...i, ...(display ? { display } : { display: undefined }) }
                      : i,
                  );
                  patchItems(next);
                  const updated = next.find((i) => i.id === current.id);
                  if (updated) refreshLive(updated);
                }}
              />

              <label>화면 넘김</label>
              <select
                value={current.lines ?? '2'}
                onChange={(e) => {
                  const next = items.map((i) => (i.id === current.id ? { ...i, lines: e.target.value } : i));
                  patchItems(next);
                  const updated = next.find((i) => i.id === current.id);
                  if (updated) refreshLive(updated);
                }}
              >
                <option value="1">1줄씩</option>
                <option value="2">2줄씩</option>
                <option value="4">4줄씩</option>
                <option value="section">섹션 전체</option>
              </select>
            </div>
          )}

          {current.type === 'reading' &&
            (() => {
              const reading = current;

              function patchReading(patch: Partial<Extract<CueItem, { type: 'reading' }>>): void {
                const next = items.map((i) =>
                  i.id === reading.id && i.type === 'reading' ? { ...i, ...patch } : i,
                );
                patchItems(next);
                // 배경·폰트·글자 크기를 만지면 화면이 바로 따라와야 맞출 수 있다
                const updated = next.find((i) => i.id === reading.id);
                if (updated) refreshLive(updated);
              }

              return (
                <div className="row detail-controls">
                  {/*
                    어느 찬송가의 교독문인지 **보여만 준다.** 여기서 바꾸면 같은 번호의
                    다른 글이 되어 내용이 통째로 달라진다 — 그럴 때는 항목을 다시 넣는 편이
                    무엇을 고르는지 눈으로 보여 안전하다.
                  */}
                  <label>교독문</label>
                  <span className="muted">
                    {READING_BOOK_LABELS[reading.readingBook ?? 'hymn_old']} · {reading.readingNumber}번
                  </span>

                  <label>배경</label>
                  <BackgroundSelect
                    value={reading.background}
                    library={bgLibrary}
                    uploaded={bgFiles}
                    onChange={(background) => patchReading({ background })}
                  />
                  <ItemTextStyleControls
                    value={reading.style}
                    onChange={(style) => patchReading({ style })}
                    baseFontSize={baseFontSizeFor(reading, 64)}
                  />
                  {liveViaPlanDeck && items[liveItemIndex]?.id === reading.id && (
                    <p className="hintline muted">
                      순서표 전체가 올라가 있어 화면은 그대로입니다 — <b>예배용으로 올리기</b>
                      를 다시 누르면 반영됩니다 (▶ 는 올라간 덱 안에서 자리만 옮깁니다)
                    </p>
                  )}
                </div>
              );
            })()}

          {current.type === 'bible' && (
            <div className="row detail-controls translation-pick">
              <label>역본</label>
              <select
                value={current.primary}
                onChange={(e) => {
                  const next = e.target.value;
                  patchItems(
                    items.map((i) =>
                      i.id === current.id && i.type === 'bible'
                        ? {
                            ...i,
                            primary: next,
                            secondary: i.secondary.filter((id) => id !== next),
                            /*
                             * 인용구의 목록 미리보기는 **옛 역본의 글**이 된다. 지운다 —
                             * 틀린 글자를 보여 주는 것보다 참조만 보이는 편이 낫다.
                             * 곧바로 새 역본으로 다시 채운다 (아래).
                             */
                            ...(i.quote ? { preview: undefined } : {}),
                          }
                        : i,
                    ),
                  );
                  if (current.quote) void refreshQuotePreview(current.id, current.ref, next);
                }}
                title="주 역본"
              >
                {translations.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <span className="candidates">
                {translations
                  .filter((t) => t.id !== current.primary)
                  .map((t) => {
                    const active = current.secondary.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        className={active ? 'primary' : undefined}
                        onClick={() =>
                          patchItems(
                            items.map((i) =>
                              i.id === current.id && i.type === 'bible'
                                ? {
                                    ...i,
                                    secondary: active
                                      ? i.secondary.filter((id) => id !== t.id)
                                      : i.secondary.length >= MAX_SECONDARY
                                        ? i.secondary
                                        : [...i.secondary, t.id],
                                  }
                                : i,
                            ),
                          )
                        }
                        disabled={!active && current.secondary.length >= MAX_SECONDARY}
                        title={`보조 역본 (최대 ${MAX_SECONDARY}개)`}
                      >
                        {t.shortName}
                      </button>
                    );
                  })}
              </span>
            </div>
          )}

          {current.type === 'liturgy' &&
            (() => {
              const liturgy = current;
              const builtin = findLiturgy(liturgy.textId)?.versions[liturgy.version]?.lines ?? [];
              const edited = (liturgy.overrideLines?.length ?? 0) > 0;
              const shown = liturgyLines(liturgy.textId, liturgy.version, liturgy.overrideLines) ?? [];

              function patchLiturgy(patch: Partial<Extract<CueItem, { type: 'liturgy' }>>): void {
                // type 까지 좁혀야 유니온 전체로 퍼지지 않는다
                const next = items.map((i) =>
                  i.id === liturgy.id && i.type === 'liturgy' ? { ...i, ...patch } : i,
                );
                patchItems(next);
                // 판본·배경·폰트·글자 크기·화면 넘김 모두 눈으로 보며 맞추는 값이다
                const updated = next.find((i) => i.id === liturgy.id);
                if (updated) refreshLive(updated);
              }

              /**
               * 고친 본문을 담는다. 내장 본문과 똑같아지면 **지운다** —
               * 같은 글을 굳이 항목에 박아 두면, 나중에 내장 본문의 오탈자를
               * 고쳐도 이 항목만 옛 글자로 남는다.
               */
              function editLines(raw: string): void {
                setLiturgyDraft({ id: liturgy.id, text: raw });
                const lines = raw
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter((line) => line.length > 0);
                const same =
                  lines.length === builtin.length && lines.every((line, i) => line === builtin[i]);
                patchLiturgy({ overrideLines: same || lines.length === 0 ? undefined : lines });
              }

              return (
                <>
                  <div className="row detail-controls">
                    <label>판본</label>
                    <div className="toggle-row">
                      {(Object.entries(findLiturgy(liturgy.textId)?.versions ?? {}) as Array<
                        [LiturgyVersion, { label: string }]
                      >).map(([key, version]) => (
                        <button
                          key={key}
                          type="button"
                          className={`toggle${liturgy.version === key ? ' active' : ''}`}
                          onClick={() => patchLiturgy({ version: key })}
                        >
                          {version.label}
                        </button>
                      ))}
                    </div>

                    <label>배경</label>
                    <BackgroundSelect
                      value={liturgy.background}
                      library={bgLibrary}
                      uploaded={bgFiles}
                      onChange={(background) => patchLiturgy({ background })}
                    />

                    <ItemTextStyleControls
                      value={liturgy.style}
                      onChange={(style) => patchLiturgy({ style })}
                      longestLineChars={shown.reduce((max, l) => Math.max(max, l.length), 0)}
                      baseFontSize={baseFontSizeFor(liturgy, 84)}
                    />

                    <label>화면 넘김</label>
                    <select
                      value={String(liturgy.perSlide ?? DEFAULT_LITURGY_PER_SLIDE)}
                      onChange={(e) =>
                        patchLiturgy({ perSlide: Number(e.target.value) as LiturgyPerSlide })
                      }
                    >
                      <option value="2">2줄씩</option>
                      <option value="4">4줄씩</option>
                      <option value="6">6줄씩</option>
                      <option value="0">전체 한 장</option>
                    </select>

                    {liveViaPlanDeck && items[liveItemIndex]?.id === liturgy.id && (
                      <p className="hintline muted">
                        순서표 전체가 올라가 있어 화면은 그대로입니다 — <b>예배용으로 올리기</b>
                      를 다시 누르면 반영됩니다 (▶ 는 올라간 덱 안에서 자리만 옮깁니다)
                      </p>
                    )}
                  </div>

                  {/* 교회마다 '나라이/나라가' 처럼 갈리는 자리가 있어 직접 고칠 길을 둔다 */}
                  <details className="detail-block">
                    <summary>
                      본문 고치기{edited && <span className="tag"> 직접 고침</span>}
                    </summary>
                    <textarea
                      className="detail-text"
                      rows={Math.min(shown.length + 1, 12)}
                      value={liturgyDraft?.id === liturgy.id ? liturgyDraft.text : shown.join('\n')}
                      onChange={(e) => editLines(e.target.value)}
                      // 손을 떼면 정리된 본문으로 맞춘다 — 무엇이 저장됐는지 눈으로 확인된다
                      onBlur={() => setLiturgyDraft(null)}
                      spellCheck={false}
                    />
                    <p className="hintline muted">
                      한 줄이 화면의 한 줄입니다. 고치면 이 항목에만 적용됩니다.
                    </p>
                    {edited && (
                      <button
                        type="button"
                        onClick={() => {
                          setLiturgyDraft(null);
                          patchLiturgy({ overrideLines: undefined });
                        }}
                      >
                        내장 본문으로 되돌리기
                      </button>
                    )}
                  </details>
                </>
              );
            })()}

          {current.type === 'bible' && (
            <div className="row detail-controls">
              <ItemTextStyleControls
                value={current.style}
                showScale={false}
                onChange={(style) => {
                  const next = items.map((i) =>
                    i.id === current.id && i.type === 'bible'
                      ? { ...i, ...(style ? { style } : { style: undefined }) }
                      : i,
                  );
                  patchItems(next);
                  const updated = next.find((i) => i.id === current.id);
                  if (updated) refreshLive(updated);
                }}
              />

              <DisplayToggles
                value={current.display}
                template={itemTemplateFor(current)}
                keys={['reference', 'headings', 'verseNumbers']}
                onChange={(display) => {
                  const next = items.map((i) =>
                    i.id === current.id && i.type === 'bible'
                      ? { ...i, ...(display ? { display } : { display: undefined }) }
                      : i,
                  );
                  patchItems(next);
                  const updated = next.find((i) => i.id === current.id);
                  if (updated) refreshLive(updated);
                }}
              />

              <label>화면 넘김</label>
              <select
                value={current.paging ?? 'verse'}
                onChange={(e) =>
                  patchItems(items.map((i) => (i.id === current.id ? { ...i, paging: e.target.value } : i)))
                }
              >
                <option value="verse">1절씩</option>
                <option value="auto">자동 (화면에 맞춰)</option>
                <option value="pair">2절씩</option>
                <option value="all">구간 전체</option>
              </select>
            </div>
          )}

          {current.type === 'text' && current.variant === 'order' && (
            <div className="row detail-controls">
              <label>배치</label>
              <select
                value={current.layout ?? 'split'}
                onChange={(e) =>
                  patchItems(
                    items.map((i) =>
                      i.id === current.id ? { ...i, layout: e.target.value === 'stack' ? 'stack' : undefined } : i,
                    ),
                  )
                }
              >
                <option value="split">좌우 (순서 이름 · 담당자 + 밑줄)</option>
                <option value="stack">쌓기 (줄을 그대로)</option>
              </select>

              {/* 좌우 배치일 때만 — 쌓기에는 '오른쪽' 이 없다 */}
              {current.layout !== 'stack' && (
                <>
                  <label title="템플릿의 보조 텍스트 크기를 기준으로 한 배수입니다">담당자 크기</label>
                  <input
                    type="range"
                    min={PRESENTER_SCALE_MIN}
                    max={PRESENTER_SCALE_MAX}
                    step={0.05}
                    value={current.presenterScale ?? 1}
                    onChange={(e) => {
                      const scale = Number(e.target.value);
                      const next = items.map((i) =>
                        i.id === current.id ? { ...i, presenterScale: scale === 1 ? undefined : scale } : i,
                      );
                      patchItems(next);
                      // 단독 송출 중이면 바로 다시 보내 눈으로 보며 맞춘다 (글자 조정과 같은 규칙)
                      const updated = next.find((i) => i.id === current.id);
                      if (updated && liveItemId === current.id) void sendItem(updated);
                    }}
                  />
                  <span className="muted">{Math.round((current.presenterScale ?? 1) * 100)}%</span>
                </>
              )}
            </div>
          )}

          {current.type === 'text' && current.variant === 'order' && (
            <div className="row detail-controls">
              <label title="지정하지 않으면 템플릿의 외곽선 두께를 씁니다">테두리</label>
              {([
                ['순서', 'titleStroke', 'primary'],
                ['담당자', 'presenterStroke', 'secondary'],
              ] as const)
                .filter(([, key]) => key !== 'presenterStroke' || current.layout !== 'stack')
                .map(([label, key, role]) => {
                  // 지정이 없으면 템플릿 값에서 출발한다 — 0 에서 시작하면 조금만 건드려도 튄다
                  const fallback = itemTemplateFor(current)?.text[role].stroke?.width ?? 0;
                  const value = current[key] ?? fallback;
                  return (
                    <span className="knob" key={key}>
                      <span className="tag">{label}</span>
                      <input
                        type="range"
                        min={STROKE_MIN}
                        max={12}
                        step={0.5}
                        value={value}
                        onChange={(e) => {
                          const width = Number(e.target.value);
                          const next = items.map((i) => (i.id === current.id ? { ...i, [key]: width } : i));
                          patchItems(next);
                          const updated = next.find((i) => i.id === current.id);
                          if (updated && liveItemId === current.id) void sendItem(updated);
                        }}
                      />
                      <span className="num">{value}px</span>
                    </span>
                  );
                })}
              <button
                type="button"
                onClick={() => {
                  const next = items.map((i) =>
                    i.id === current.id ? { ...i, titleStroke: undefined, presenterStroke: undefined } : i,
                  );
                  patchItems(next);
                  const updated = next.find((i) => i.id === current.id);
                  if (updated && liveItemId === current.id) void sendItem(updated);
                }}
                disabled={current.titleStroke === undefined && current.presenterStroke === undefined}
                title="템플릿 두께로 되돌리기"
              >
                ↺
              </button>
            </div>
          )}

          {current.type === 'text' && current.variant === 'order' && current.layout !== 'stack' && (
            <OrderCharTuner
              title={splitOrderText(current.content).title}
              charStyles={current.charStyles}
              // 슬라이더의 출발점은 **이 항목이 쓸 템플릿**의 자동 리듬이다.
              // 송출 중인 템플릿을 기준으로 삼으면, 아직 올리지 않은 항목에서
              // 눈금과 실제 화면이 어긋난다.
              rhythm={itemTemplateFor(current)?.behavior.titleRhythm ?? 0}
              rhythmY={itemTemplateFor(current)?.behavior.titleRhythmY ?? 0}
              onChange={(charStyles) => {
                const next = items.map((i) => (i.id === current.id ? { ...i, charStyles } : i));
                patchItems(next);
                // 이 항목을 **단독으로 송출 중**이면 바로 다시 보내 눈으로 보며 맞출 수 있게 한다.
                // 순서표 전체가 올라가 있을 때는 건드리지 않는다 — 예배 중에 덱이
                // 통째로 바뀌면 진행 위치를 잃는다. 그때는 다시 올려야 반영된다.
                const updated = next.find((i) => i.id === current.id);
                if (updated && liveItemId === current.id) void sendItem(updated);
              }}
            />
          )}

          {current.type === 'text' && (
            <>
              {current.variant === 'order' && (
                <p className="hintline muted">첫 줄 = 순서 이름, 다음 줄 = 담당자</p>
              )}
              <textarea
                className="detail-text"
                rows={3}
                value={current.content}
                onChange={(e) =>
                  patchItems(items.map((i) => (i.id === current.id ? { ...i, content: e.target.value } : i)))
                }
                spellCheck={false}
              />
            </>
          )}
            </div>
          )}
        </div>
  );
}

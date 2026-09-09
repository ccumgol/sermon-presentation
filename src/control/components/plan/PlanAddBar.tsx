/**
 * **항목 추가 바** — 열 가지 종류를 한 화면에서 넣는다.
 *
 * `PlanPanel` 에서 갈라냈다(2026-09-08). 여기서 쓰는 이름 스물여덟 중
 * **스물다섯이 `usePlanAdd` 하나**에서 온다 — 낱개로 받으면 프롭이 스물여덟,
 * `add` 객체째로 받으면 넷이다. R-4 가 "프롭 60개짜리 껍데기" 로 멈춘 자리가
 * 여기였고, 훅 분리가 그 문제를 이미 풀어 놓았다.
 *
 * ## 여기서 보이는 규칙
 *
 * | | 왜 |
 * |---|---|
 * | 성경·찬양 검색을 **이 탭 안에서** 한다 | 탭을 오가며 준비하는 것은 예배 중에 너무 느리다 (설계 근거는 `PLAN.md`) |
 * | 종류마다 입력칸이 **바뀐다** (한 줄 ↔ 여러 줄) | 광고·순서 표시는 여러 줄이다 |
 * | 참조를 넣기 **전에** 확인해 보여 준다 | 틀린 참조가 순서표에 들어가면 예배 중에 발견한다 |
 * | 가져오기를 안 했으면 **무엇을 해야 하는지** 알려 준다 | 빈 목록만 보여 주면 고장으로 보인다 |
 */

import { ADD_KINDS, MAX_SECONDARY, ORDER_PRESETS } from '../../../../lib/plan-item-view.ts';
import { LITURGY_TEXTS } from '../../../../lib/liturgy-texts.ts';
import { READING_BOOK_LABELS } from '../../api.ts';
import { isComposing } from '../../ime.ts';
import type { ServicePlan, Translation } from '../../../../shared/types.ts';
import type { PlanAdd } from '../../hooks/usePlanAdd.ts';
import type { PlanBackgrounds } from '../../hooks/usePlanBackgrounds.ts';

export function PlanAddBar({
  add, plan, translations, backgrounds,
}: {
  add: PlanAdd;
  /** 열어 둔 순서표 — 없으면 추가 바를 띄우지 않는다 */
  plan: ServicePlan | null;
  translations: Translation[];
  backgrounds: PlanBackgrounds;
}): React.JSX.Element {
  const {
    addKind, pickKind, addInput, setAddInput, wantsRef, parseOk,
    songHits, songTotal, addPrimary, setAddPrimary, addSecondary, setAddSecondary,
    readingHits, readingBook, setReadingBook, readingCounts, readingTotal,
    pickedFolder, setPickedFolder, addRef,
    addFromInput, addLiturgy, addReading, addSong, addText,
  } = add;

  /** 지금 종류의 입력 안내 문구 */
  const kindHint = ADD_KINDS.find((option) => option.kind === addKind)?.hint ?? '';
  // 순서 표시도 여러 줄이다 — '설교 제목' 아래 줄에 설교자를 넣는다
  const isMultiline = addKind === 'notice' || addKind === 'order';

  return (
    <>
    {plan && (
      <div className="add-bar">
        <div className="kind-row">
          {ADD_KINDS.map((option) => (
            <button
              key={option.kind}
              type="button"
              className={`kind${addKind === option.kind ? ' active' : ''}`}
              onClick={() => pickKind(option.kind)}
              title={option.label}
            >
              {option.icon}
            </button>
          ))}
        </div>

        {addKind === 'blank' ? (
          <button type="button" className="grow" onClick={() => addFromInput()}>공백 추가</button>
        ) : addKind === 'slideshow' ? (
          /*
            폴더를 고른다 — **그림을 하나씩 고르지 않는다.**
            폴더에 넣기만 하면 되는 것이 이 기능의 요점이라, 항목에는 폴더만 담고
            그림은 띄울 때 읽는다. 몇 장인지 함께 보여 준다 —
            1장이면 걸어 두는 썸네일, 여럿이면 구분 행의 자동 넘김이 순환한다.
          */
          (() => {
            const all = [
              ...backgrounds.folders.library.map((f) => ({ ...f, source: 'library' as const })),
              ...backgrounds.folders.data.map((f) => ({ ...f, source: 'data' as const })),
            ];
            /*
              고를 폴더가 하나도 없을 때 빈 드롭다운만 주면 '고장났다' 로 보인다.
              **어디에 넣어야 하는지**를 그 자리에서 알려 준다 (실제 경로로).
            */
            if (all.length === 0) {
              return (
                <span className="hintline muted grow">
                  쓸 수 있는 그림이 없습니다. 아래 폴더에 그림을 넣거나 그 안에 폴더를 만드세요 —{' '}
                  <code>{backgrounds.dirs.library || '~/Desktop/Data/Background'}</code>
                </span>
              );
            }
            return (
              <>
                <select
                  className="grow"
                  value={pickedFolder}
                  onChange={(e) => setPickedFolder(e.target.value)}
                  aria-label="그림 폴더"
                >
                  <option value="">폴더 고르기…</option>
                  {all.map((f) => (
                    <option key={`${f.source}/${f.name}`} value={`${f.source}/${f.name}`}>
                      {f.name === '' ? '(폴더 바로 밑)' : f.name} — {f.count}장{' '}
                      {f.source === 'library' ? '(모아 둔 폴더)' : '(앱 폴더)'}
                    </option>
                  ))}
                </select>
                <button type="button" disabled={pickedFolder.length === 0} onClick={() => addFromInput()}>
                  추가
                </button>
              </>
            );
          })()
        ) : addKind === 'liturgy' ? (
          <div className="candidates liturgy-add">
            {LITURGY_TEXTS.map((text) => (
              <button key={text.id} type="button" onClick={() => addLiturgy(text.id)}>
                {text.title}
              </button>
            ))}
          </div>
        ) : isMultiline ? (
          <textarea
            ref={addRef}
            rows={2}
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || isComposing(e)) return;
              // Enter = 항목 추가(성경·찬양과 같은 동작). 줄바꿈은 Shift+Enter.
              //
              // 이전에는 ⌘Enter 만 추가라서, 광고를 입력하고 Enter 를 눌러도
              // 줄만 바뀌고 아무것도 추가되지 않았다. 광고는 한 줄짜리 항목을
              // 여러 개 넣는 경우가 대부분이라 Enter 를 추가로 둔다.
              if (e.shiftKey) return;
              e.preventDefault();
              addFromInput();
            }}
            placeholder={kindHint}
            spellCheck={false}
          />
        ) : (
          <input
            ref={addRef}
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={(e) => {
              // 한글은 마지막 글자가 조합 중이라 Enter 가 두 번 처리된다 (ime.ts 참고)
              if (e.key !== 'Enter' || isComposing(e)) return;
              e.preventDefault();
              addFromInput();
            }}
            placeholder={kindHint}
            autoComplete="off"
            spellCheck={false}
          />
        )}

        {wantsRef && (
          <div className="row detail-controls translation-pick">
            <label>역본</label>
            <select
              value={addPrimary}
              onChange={(e) => {
                const next = e.target.value;
                setAddPrimary(next);
                // 주 역본으로 올라온 것은 보조에서 뺀다 — 같은 본문이 두 번 나간다
                setAddSecondary((prev) => prev.filter((id) => id !== next));
              }}
              title="주 역본"
            >
              {translations.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <span className="candidates">
              {translations
                .filter((t) => t.id !== addPrimary)
                .map((t) => {
                  const active = addSecondary.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className={active ? 'primary' : undefined}
                      onClick={() =>
                        setAddSecondary((prev) =>
                          prev.includes(t.id)
                            ? prev.filter((id) => id !== t.id)
                            : prev.length >= MAX_SECONDARY
                              ? prev
                              : [...prev, t.id],
                        )
                      }
                      disabled={!active && addSecondary.length >= MAX_SECONDARY}
                      title={`보조 역본 (최대 ${MAX_SECONDARY}개)`}
                    >
                      {t.shortName}
                    </button>
                  );
                })}
            </span>
          </div>
        )}

        {wantsRef && parseOk && (
          <p className={`hintline ${parseOk.ok ? 'ok' : 'error'}`}>
            {parseOk.text}
            {addKind === 'quote' && parseOk.ok && ' — 절마다 낱개 항목이 됩니다'}
          </p>
        )}
        {isMultiline && <p className="hintline muted">Enter 로 추가 · Shift+Enter 줄바꿈</p>}

        {addKind === 'order' && (
          <div className="candidates">
            {ORDER_PRESETS.map((preset) => (
              <button key={preset} type="button" onClick={() => addText(preset, 'order')}>
                {preset}
              </button>
            ))}
          </div>
        )}

        {addKind === 'reading' && (
          <>
            {/*
              두 찬송가의 교독문은 **번호가 같아도 다른 글**이다 (통일 76편 · 새 137편).
              그래서 번호를 치기 전에 어느 쪽인지 먼저 골라야 한다.
            */}
            <div className="row detail-controls">
              <label>교독문</label>
              <span className="candidates">
                {(['hymn_old', 'hymn_new'] as const).map((book) => {
                  const count = readingCounts?.[book];
                  return (
                    <button
                      key={book}
                      type="button"
                      className={readingBook === book ? 'primary' : undefined}
                      onClick={() => setReadingBook(book)}
                      title={count === 0 ? '아직 가져오지 않았습니다' : undefined}
                    >
                      {READING_BOOK_LABELS[book]}
                      {count !== undefined && ` ${count}편`}
                    </button>
                  );
                })}
              </span>
            </div>

            {readingTotal === 0 && (
              <p className="hintline error">
                {READING_BOOK_LABELS[readingBook]} 교독문이 없습니다. 터미널에서{' '}
                <code>
                  {readingBook === 'hymn_new'
                    ? 'node scripts/import-kyodoc.ts --apply'
                    : 'node scripts/import-responsive.ts --apply'}
                </code>{' '}
                를 실행해 가져오세요.
              </p>
            )}
            {readingHits.length > 0 && (
              <div className="candidates">
                {readingHits.map((hit) => (
                  <button
                    key={hit.number}
                    type="button"
                    onClick={() => addReading(hit)}
                    title={`줄 ${hit.lineCount}개 · 화면 ${hit.slideCount}장`}
                  >
                    {hit.number}. {hit.title}
                  </button>
                ))}
              </div>
            )}
            {readingTotal !== null && readingTotal > 0 && readingHits.length === 0 && (
              <p className="hintline muted">
                찾는 교독문이 없습니다 (전체 {readingTotal}편). 번호나 제목으로 찾아 보세요.
              </p>
            )}
          </>
        )}

        {addKind === 'song' && songHits.length > 0 && (
          <>
            <div className="candidates">
              {songHits.map((hit) => (
                <button key={hit.id} type="button" onClick={() => addSong(hit.id, hit.title, hit.songLabel)}>
                  {hit.label ? `${hit.label} ` : ''}{hit.title}
                </button>
              ))}
            </div>
            {songTotal > songHits.length && (
              <p className="hintline muted">
                {songTotal}곡 중 {songHits.length}곡만 보입니다 — 검색어를 좁히거나 '찬양' 탭에서 찾아 보세요.
              </p>
            )}
          </>
        )}
      </div>
    )}
    </>
  );
}

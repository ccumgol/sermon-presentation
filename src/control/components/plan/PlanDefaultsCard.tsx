/**
 * **이 예배의 기본 설정** — 템플릿 넷 · 성경 역본 · 화면 넘김 · 배경 · 제목 띄우기.
 *
 * `PlanPanel` 에서 갈라냈다(2026-09-08). **안을 더 쪼개지 않았다** — 6행이 한 폼이라
 * 나누면 `<select>` 한 줄짜리 껍데기 여섯이 된다. 213줄은 이 프로젝트가 정한
 * '200~400줄이 적당' 범위 안이고, 프롭도 아홉으로 가드레일(10) 안이다.
 *
 * ## 여기서 보이는 규칙
 *
 * | | 왜 |
 * |---|---|
 * | 기본 설정은 **순서표에 함께 담긴다** | 따로 저장하는 곳이 없다 — 그래서 카드 맨 아래에 같은 저장 버튼을 하나 더 뒀다 (찾아 헤매지 않게) |
 * | 템플릿은 **이미 만든 항목에도** 곧바로 적용된다 | 항목이 지정하지 않았으면 이 값을 따라간다 |
 * | 역본·언어는 **앞으로 추가하는 항목**에만 | 이미 넣은 항목의 역본을 몰래 바꾸면 놀란다 |
 * | 기본 역본을 바꾸면 추가 바도 따라간다 | 두 곳이 다르면 방금 정한 값이 안 먹은 것으로 보인다 (`add`) |
 */

import { BackgroundSelect } from '../BackgroundSelect.tsx';
import { ACTIVE_LANGS, LANG_LABELS, toggleLang } from '../../../../lib/lang-select.ts';
import { MAX_SECONDARY } from '../../../../lib/plan-item-view.ts';
import type { LangCode, ServicePlan, Translation } from '../../../../shared/types.ts';
import type { PlanAdd } from '../../hooks/usePlanAdd.ts';
import type { PlanBackgrounds } from '../../hooks/usePlanBackgrounds.ts';
import type { PlanDraft } from '../../hooks/usePlanDraft.ts';
import type { Feedback } from '../../hooks/useFeedback.ts';
import type { PlanPreview } from '../../hooks/usePlanPreview.ts';
import type { PlanStorage } from '../../hooks/usePlanStorage.ts';

export function PlanDefaultsCard({
  storage, draft, add, preview, backgrounds, feedback, plan, translations, defaultTranslation,
}: {
  storage: PlanStorage;
  draft: PlanDraft;
  /** 열어 둔 순서표 — 부모가 `{plan && …}` 로 걸러 넣는다 */
  plan: ServicePlan;
  /** 기본 역본을 바꾸면 추가 바의 역본도 따라가게 한다 */
  add: PlanAdd;
  preview: PlanPreview;
  backgrounds: PlanBackgrounds;
  feedback: Feedback;
  translations: Translation[];
  defaultTranslation: string;
}): React.JSX.Element {
  const { saveCurrent, saveLabel, planNoun, templates } = storage;
  const { dirty, patchDefaults } = draft;
  const { setAddPrimary, setAddSecondary } = add;
  const { styleTemplates } = preview;
  const { busy } = feedback;

  return (
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
  );
}

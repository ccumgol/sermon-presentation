import { useCallback, useEffect, useRef, useState } from 'react';

import { templateToCssVars } from '../../../lib/template-css.ts';
import type { CanvasBackground, ClientMsg, Template, TextStyle } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { AnchorGrid } from '../components/AnchorGrid.tsx';
import { BackgroundPicker } from '../components/BackgroundPicker.tsx';
import { ColorField, NumberField, TextStyleFields } from '../components/StyleFields.tsx';

interface Props {
  /** 현재 송출에 적용된 템플릿 (서버가 WS 로 밀어 준다) */
  active: Template | null;
  connected: boolean;
  send: (msg: ClientMsg) => boolean;
}

type Draft = Template;

/**
 * 템플릿 편집 패널.
 *
 * 편집 중에는 `style:set` 으로 화면에만 즉시 반영하고(저장하지 않음),
 * '저장'을 눌러야 DB 에 남는다. 그래야 예배 중 실수로 만진 것이 영구화되지 않는다.
 * 내장 프리셋은 수정할 수 없고 '복제' 후 편집한다.
 */
export function TemplatePanel({ active, connected, send }: Props): React.JSX.Element {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 마지막으로 보낸 CSS 변수 — 바뀐 것만 보내 setProperty 호출을 줄인다
  const lastVarsRef = useRef<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      setTemplates(await api.templates());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '템플릿 목록을 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 활성 템플릿이 바뀌면 편집 중이 아닐 때만 초안을 갈아끼운다
  useEffect(() => {
    if (active && !dirty) {
      setDraft(active);
      lastVarsRef.current = templateToCssVars(active);
    }
  }, [active, dirty]);

  /** 초안을 고치고 화면에 즉시 반영한다 (저장은 하지 않음) */
  const patchDraft = useCallback(
    (mutate: (current: Draft) => Draft) => {
      setDraft((current) => {
        if (!current) return current;
        const next = mutate(current);
        const nextVars = templateToCssVars(next);

        const patch: Record<string, string> = {};
        for (const [key, value] of Object.entries(nextVars)) {
          if (lastVarsRef.current[key] !== value) patch[key] = value;
        }
        if (Object.keys(patch).length > 0) send({ t: 'style:set', patch });
        lastVarsRef.current = nextVars;

        setDirty(true);
        return next;
      });
    },
    [send],
  );

  const patchText = (role: keyof Template['text'], patch: Partial<TextStyle>): void =>
    patchDraft((current) => ({
      ...current,
      text: { ...current.text, [role]: { ...current.text[role], ...patch } },
    }));

  async function selectTemplate(id: number): Promise<void> {
    setDirty(false);
    setNotice(null);
    send({ t: 'template:set', id });
  }

  async function save(): Promise<void> {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      if (draft.isBuiltin) {
        // 프리셋은 고칠 수 없다 — 복제해 사용자 템플릿으로 저장한다
        const created = await api.duplicateTemplate(draft.id, `${draft.name} 사본`);
        const saved = await api.updateTemplate(created.id, { ...draft, name: created.name });
        await reload();
        setDirty(false);
        setNotice(`'${saved.name}' 으로 새로 저장했습니다 (프리셋은 그대로 유지)`);
        send({ t: 'template:set', id: saved.id });
      } else {
        await api.updateTemplate(draft.id, draft);
        await reload();
        setDirty(false);
        setNotice('저장했습니다');
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  function revert(): void {
    if (!active) return;
    setDraft(active);
    setDirty(false);
    setNotice(null);
    send({ t: 'style:set', patch: templateToCssVars(active) });
    lastVarsRef.current = templateToCssVars(active);
  }

  async function duplicate(): Promise<void> {
    if (!draft) return;
    setBusy(true);
    try {
      const created = await api.duplicateTemplate(draft.id);
      await reload();
      setDirty(false);
      send({ t: 'template:set', id: created.id });
      setNotice(`'${created.name}' 을 만들었습니다`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '복제하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!draft || draft.isBuiltin) return;
    setBusy(true);
    try {
      await api.deleteTemplate(draft.id);
      await reload();
      setDirty(false);
      setNotice('삭제했습니다');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '삭제하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  function exportJson(): void {
    if (!draft) return;
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `template-${draft.name.replace(/\s+/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!draft) return <p className="hintline muted">템플릿을 불러오는 중…</p>;

  const background = draft.canvas.background;

  return (
    <>
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

      <div className="card">
        <h2>템플릿</h2>
        <div className="row">
          <select
            className="grow"
            value={draft.id}
            onChange={(e) => void selectTemplate(Number(e.target.value))}
            disabled={!connected}
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.isBuiltin ? `[프리셋] ${t.name}` : t.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void duplicate()} disabled={busy}>복제</button>
          <button type="button" onClick={exportJson}>내보내기</button>
        </div>

        {draft.isBuiltin && (
          <p className="hintline muted">
            내장 프리셋입니다. 값을 바꿔 저장하면 프리셋은 그대로 두고 사본이 만들어집니다.
          </p>
        )}

        {!draft.isBuiltin && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>이름</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => patchDraft((c) => ({ ...c, name: e.target.value }))}
            />
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="primary" onClick={() => void save()} disabled={busy || !dirty}>
            {dirty ? '저장' : '변경 없음'}
          </button>
          <button type="button" onClick={revert} disabled={!dirty}>되돌리기</button>
          {!draft.isBuiltin && (
            <button type="button" onClick={() => void remove()} disabled={busy}>삭제</button>
          )}
        </div>
      </div>

      <div className="card">
        <h2>위치</h2>
        <AnchorGrid value={draft.layout.anchor} onChange={(anchor) => patchDraft((c) => ({ ...c, layout: { ...c.layout, anchor } }))} />

        <div className="row" style={{ marginTop: 12 }}>
          <NumberField label="좌우 미세조정" value={draft.layout.offsetX} min={-600} max={600} suffix="px"
            onChange={(offsetX) => patchDraft((c) => ({ ...c, layout: { ...c.layout, offsetX } }))} />
          <NumberField label="상하 미세조정" value={draft.layout.offsetY} min={-400} max={400} suffix="px"
            onChange={(offsetY) => patchDraft((c) => ({ ...c, layout: { ...c.layout, offsetY } }))} />
        </div>

        <h2 style={{ marginTop: 16 }}>여백 (안전 영역)</h2>
        <div className="row">
          {(['top', 'bottom', 'left', 'right'] as const).map((side) => (
            <NumberField
              key={side}
              label={{ top: '위', bottom: '아래', left: '왼쪽', right: '오른쪽' }[side]}
              value={draft.canvas.safeArea[side]}
              min={0}
              max={600}
              suffix="px"
              onChange={(value) =>
                patchDraft((c) => ({
                  ...c,
                  canvas: { ...c.canvas, safeArea: { ...c.canvas.safeArea, [side]: value } },
                }))
              }
            />
          ))}
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <div className="field grow">
            <label>다역본 배치</label>
            <select
              value={draft.layout.direction}
              onChange={(e) =>
                patchDraft((c) => ({ ...c, layout: { ...c.layout, direction: e.target.value as 'column' | 'row' } }))
              }
            >
              <option value="column">위/아래</option>
              <option value="row">좌/우</option>
            </select>
          </div>
          <div className="field grow">
            <label>정렬</label>
            <select
              value={draft.layout.align}
              onChange={(e) =>
                patchDraft((c) => ({ ...c, layout: { ...c.layout, align: e.target.value as 'left' | 'center' | 'right' } }))
              }
            >
              <option value="center">가운데</option>
              <option value="left">왼쪽</option>
              <option value="right">오른쪽</option>
            </select>
          </div>
          <NumberField label="블록 간격" value={draft.layout.gap} min={0} max={120} suffix="px"
            onChange={(gap) => patchDraft((c) => ({ ...c, layout: { ...c.layout, gap } }))} />
        </div>
      </div>

      <div className="card">
        <h2>배경</h2>
        <div className="field">
          <label>모드</label>
          <select
            value={background.mode}
            onChange={(e) => {
              const mode = e.target.value as CanvasBackground['mode'];
              // 모드를 바꿔도 고른 파일은 기억해 둔다 — 오갈 때 매번 다시 고르면 느려진다
              const keptSrc = background.mode === 'image' ? background.src : '';
              const next: CanvasBackground =
                mode === 'transparent'
                  ? { mode: 'transparent' }
                  : mode === 'chroma'
                    ? { mode: 'chroma', color: '#1eff00' }
                    : mode === 'image'
                      ? { mode: 'image', src: keptSrc, fit: 'cover', opacity: 1 }
                      : { mode: 'color', color: '#000000', opacity: 0.5 };
              patchDraft((c) => ({ ...c, canvas: { ...c.canvas, background: next } }));
            }}
          >
            <option value="transparent">투명 (권장)</option>
            <option value="color">단색·반투명 띠</option>
            <option value="chroma">크로마키 단색</option>
            <option value="image">그림</option>
          </select>
        </div>

        {background.mode === 'transparent' && (
          <p className="hintline ok">
            OBS 가 알파 합성하므로 크로마키 필터가 필요 없습니다. 글자 경계가 가장 깨끗합니다.
          </p>
        )}

        {(background.mode === 'color' || background.mode === 'chroma') && (
          <>
            <ColorField
              label="배경 색"
              value={background.color}
              onChange={(color) =>
                patchDraft((c) => ({
                  ...c,
                  canvas: { ...c.canvas, background: { ...(c.canvas.background as { mode: 'color' | 'chroma'; color: string }), color } as CanvasBackground },
                }))
              }
            />
            {background.mode === 'chroma' && (
              <p className="hintline muted">
                OBS 에서 이 색으로 크로마키 필터를 걸어야 합니다. 글자 색과 겹치지 않게 하세요.
              </p>
            )}
          </>
        )}

        {(background.mode === 'image') && (
          <BackgroundPicker
            background={background}
            onChange={(next) => patchDraft((c) => ({ ...c, canvas: { ...c.canvas, background: next } }))}
          />
        )}
      </div>

      <div className="card">
        <h2>글자</h2>
        <TextStyleFields title="주 역본 / 주 언어" style={draft.text.primary} onChange={(p) => patchText('primary', p)} />
        <TextStyleFields title="보조 역본 / 보조 언어" style={draft.text.secondary} onChange={(p) => patchText('secondary', p)} />
        <TextStyleFields title="절 번호" style={draft.text.verseNum} onChange={(p) => patchText('verseNum', p)} />
        <TextStyleFields title="참조 표기" style={draft.text.reference} onChange={(p) => patchText('reference', p)} />
        <TextStyleFields title="소제목" style={draft.text.heading} onChange={(p) => patchText('heading', p)} />
      </div>

      <div className="card">
        <h2>표시 옵션</h2>

        {/* 순서 표시 제목의 리듬 — 글자마다 크기·높이를 달리해 붓글씨처럼 보이게 한다 */}
        <div className="field">
          <label title="순서 표시(대표기도·신앙고백 등) 제목에만 적용됩니다">글자 리듬</label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={draft.behavior.titleRhythm ?? 0}
            onChange={(e) =>
              patchDraft((c) => ({ ...c, behavior: { ...c.behavior, titleRhythm: Number(e.target.value) } }))
            }
          />
          <span className="muted">
            {(draft.behavior.titleRhythm ?? 0) === 0
              ? '끔 (모든 글자 같은 크기)'
              : `±${Math.round((draft.behavior.titleRhythm ?? 0) * 100)}%`}
          </span>
        </div>
        <div className="field">
          <label title="정해 둔 높낮이를 얼마나 강하게 적용할지 — 0 이면 아랫선이 가지런해집니다">글자 높낮이</label>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={draft.behavior.titleRhythmY ?? 0}
            onChange={(e) =>
              patchDraft((c) => ({ ...c, behavior: { ...c.behavior, titleRhythmY: Number(e.target.value) } }))
            }
          />
          <span className="muted">
            {(draft.behavior.titleRhythmY ?? 0) === 0
              ? '끔 (아랫선 가지런히)'
              : `${Math.round((draft.behavior.titleRhythmY ?? 0) * 100)}%`}
          </span>
        </div>

        <p className="hintline muted">
          어절의 <b>첫 글자부터 100% · 96%(↑) · 90%(↓) · 90%(↑)</b> 가 되풀이되고,
          띄어쓰기를 만나면 처음부터 다시 시작합니다. 위 값은 <b>배율</b>이라
          <b>100%</b> 면 이 표 그대로, 0% 면 끔, 200% 면 편차가 두 배입니다.
          같은 글자는 언제나 같은 모양이라 예배마다 화면이 달라지지 않습니다.
        </p>

        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={draft.behavior.showVerseNumbers}
              onChange={(e) => patchDraft((c) => ({ ...c, behavior: { ...c.behavior, showVerseNumbers: e.target.checked } }))}
            />
            절 번호
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.behavior.showHeadings}
              onChange={(e) => patchDraft((c) => ({ ...c, behavior: { ...c.behavior, showHeadings: e.target.checked } }))}
            />
            소제목
          </label>
          <label className="check" title="넘치는 본문을 배율로 줄여 화면에 맞춥니다">
            <input
              type="checkbox"
              checked={draft.behavior.autoFit}
              onChange={(e) => patchDraft((c) => ({ ...c, behavior: { ...c.behavior, autoFit: e.target.checked } }))}
            />
            자동 축소
          </label>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <div className="field grow">
            <label>참조 표기 위치</label>
            <select
              value={draft.behavior.showReference}
              onChange={(e) =>
                patchDraft((c) => ({
                  ...c,
                  behavior: { ...c.behavior, showReference: e.target.value as Template['behavior']['showReference'] },
                }))
              }
            >
              <option value="bottom">아래</option>
              <option value="top">위</option>
              <option value="none">표시 안 함</option>
            </select>
          </div>
          <div className="field grow">
            <label>전환 효과</label>
            <select
              value={draft.behavior.transition.type}
              onChange={(e) =>
                patchDraft((c) => ({
                  ...c,
                  behavior: {
                    ...c.behavior,
                    transition: { ...c.behavior.transition, type: e.target.value as 'none' | 'fade' | 'slide-up' },
                  },
                }))
              }
            >
              <option value="fade">페이드</option>
              <option value="none">없음</option>
            </select>
          </div>
          <NumberField
            label="최소 축소 배율"
            value={Math.round(draft.behavior.autoFitMinScale * 100)}
            min={40}
            max={100}
            suffix="%"
            onChange={(pct) => patchDraft((c) => ({ ...c, behavior: { ...c.behavior, autoFitMinScale: pct / 100 } }))}
          />
          <NumberField
            label="한 행 최대 글자"
            value={draft.behavior.maxCharsPerLine ?? 24}
            min={8}
            max={60}
            suffix="자"
            onChange={(value) => patchDraft((c) => ({ ...c, behavior: { ...c.behavior, maxCharsPerLine: value } }))}
          />
        </div>
        <p className="hintline muted">
          가사는 악보의 운율 행 단위로 저장되고, 이 폭에 맞춰 짝으로 묶여 표시됩니다 —
          24자면 9자 4행이 19자 2행이 되고, 14자면 4행 그대로 나갑니다.
        </p>
        <div className="grid">
        </div>
      </div>
    </>
  );
}

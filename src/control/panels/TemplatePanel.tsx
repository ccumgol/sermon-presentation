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

  /**
   * 지금 값을 그 자리에 저장한다. **프리셋도 덮어쓴다.**
   *
   * 전에는 프리셋이면 강제로 복제했다. 그래서 사본이 쌓이고 같은 이름이 둘이 되어
   * 목록에서 구분이 안 됐다. 이제는 그 자리에 쓰고, **원본은 코드에 남아 있어**
   * '원본 불러오기' 로 언제든 되돌아온다.
   */
  async function save(): Promise<void> {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateTemplate(draft.id, draft);
      await reload();
      setDirty(false);
      setNotice(draft.isBuiltin ? '프리셋을 덮어썼습니다 (원본 불러오기로 되돌릴 수 있습니다)' : '저장했습니다');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  /** 프리셋을 코드의 값으로 되돌린다 — 되돌릴 수 없으므로 확인을 받는다 */
  async function restoreOriginal(): Promise<void> {
    if (!draft) return;
    if (!window.confirm(`'${draft.name}' 을 원본 프리셋으로 되돌립니다. 고친 내용은 사라집니다.`)) return;
    setBusy(true);
    setError(null);
    try {
      const restored = await api.restoreTemplate(draft.id);
      await reload();
      setDirty(false);
      setNotice(`'${restored.name}' 원본을 불러왔습니다`);
      send({ t: 'template:set', id: restored.id });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '되돌리지 못했습니다');
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

  /**
   * 템플릿 전부를 한 파일로 — **손대지 않은 프리셋은 담지 않는다.**
   *
   * 코드가 원본이므로 옮길 필요가 없고, 담으면 파일이 커져 무엇이 내 설정인지
   * 알아보기 어렵다. 담는 것은 **덮어쓴 프리셋 + 사용자 사본**이다.
   */
  function backupTemplates(): void {
    const mine = templates.filter((t) => !t.isBuiltin || t.isOverridden === true);
    if (mine.length === 0) {
      setNotice('내보낼 것이 없습니다 — 프리셋을 고치거나 사본을 만든 뒤에 쓰세요');
      return;
    }
    const blob = new Blob([JSON.stringify({ templates: mine }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `templates-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(`${mine.length}개를 내보냈습니다 (덮어쓴 프리셋 + 사본)`);
  }

  /**
   * 파일에서 되살린다.
   *
   * 프리셋 id(음수)는 **그 프리셋을 덮어쓴다.** 새로 만들면 사본이 되어 프리셋은
   * 원본 그대로 남고, 옮긴 설정이 적용되지 않는다.
   */
  async function restoreTemplatesFromFile(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const parsed = JSON.parse(await file.text()) as { templates?: Template[] };
      const list = Array.isArray(parsed.templates) ? parsed.templates : [];
      if (list.length === 0) throw new ApiError('파일에 템플릿이 없습니다');

      let overwritten = 0;
      let created = 0;
      const skipped: string[] = [];

      for (const item of list) {
        if (typeof item?.name !== 'string' || !item.canvas) {
          skipped.push(String(item?.name ?? '?'));
          continue;
        }
        const { id, isBuiltin: _b, isOverridden: _o, ...rest } = item;
        try {
          if (typeof id === 'number' && id < 0) {
            await api.updateTemplate(id, rest);
            overwritten++;
          } else {
            await api.createTemplate(rest);
            created++;
          }
        } catch {
          skipped.push(item.name);
        }
      }

      await reload();
      setNotice(
        `프리셋 덮어쓰기 ${overwritten}개 · 사본 ${created}개를 불러왔습니다` +
          (skipped.length > 0 ? ` · 건너뜀 ${skipped.length}개 (${skipped.join(', ')})` : ''),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : '불러오지 못했습니다');
    } finally {
      setBusy(false);
    }
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
                {t.isBuiltin ? `[프리셋${t.isOverridden ? '·고침' : ''}] ${t.name}` : t.name}
              </option>
            ))}
          </select>
        </div>

        {draft.isBuiltin && (
          <p className={`hintline ${draft.isOverridden ? 'warn' : 'muted'}`}>
            {draft.isOverridden
              ? '이 프리셋은 고쳐 둔 상태입니다. 원본 불러오기로 코드의 값으로 되돌릴 수 있습니다.'
              : '내장 프리셋입니다. 고쳐 저장하면 이 자리에 덮어씁니다 — 원본은 코드에 남아 언제든 되돌아옵니다.'}
          </p>
        )}

        {/* 프리셋도 이름을 고칠 수 있다 — '교독문' 을 '교독문 (우리 교회)' 로 두고 싶을 수 있다 */}
        <div className="field" style={{ marginTop: 12 }}>
          <label>이름</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => patchDraft((c) => ({ ...c, name: e.target.value }))}
          />
        </div>

        <div className="row template-actions" style={{ marginTop: 12 }}>
          <button type="button" className="primary" onClick={() => void save()} disabled={busy || !dirty}>
            {dirty ? (draft.isBuiltin ? '프리셋 덮어쓰기' : '저장') : '변경 없음'}
          </button>
          <button type="button" onClick={() => void duplicate()} disabled={busy}>사본 만들기</button>
          <button type="button" onClick={revert} disabled={!dirty} title="저장하기 전 값으로">
            편집 취소
          </button>
          {draft.isBuiltin && (
            <button
              type="button"
              onClick={() => void restoreOriginal()}
              disabled={busy || !draft.isOverridden}
              title={draft.isOverridden ? '코드의 원본 값으로 되돌립니다' : '고친 내용이 없습니다'}
            >
              원본 불러오기
            </button>
          )}
          {!draft.isBuiltin && (
            <button type="button" className="del" onClick={() => void remove()} disabled={busy}>
              삭제
            </button>
          )}
        </div>

        {/*
          백업·불러오기는 **템플릿만** 담는 파일이다. 설정 탭의 '데이터 이전' 은 곡·순서표까지
          담으므로 PC 를 옮길 때 쓰고, 이쪽은 화면 꾸밈만 옮길 때 쓴다.
        */}
        <div className="row template-actions" style={{ marginTop: 8 }}>
          <button type="button" onClick={backupTemplates} disabled={busy}>
            프리셋 백업
          </button>
          <label className="file-button">
            프리셋 불러오기
            <input
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                // 같은 파일을 다시 골라도 onChange 가 오도록 값을 비운다
                e.target.value = '';
                if (file) void restoreTemplatesFromFile(file);
              }}
            />
          </label>
          <button type="button" onClick={exportJson} title="지금 고른 템플릿 하나만">
            이 템플릿만 내보내기
          </button>
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

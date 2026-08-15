import { useCallback, useEffect, useState } from 'react';

import { buildPlanDeck, describeItem, moveItem, newItemId, removeItem } from '../../../lib/plan-deck.ts';
import { paginateByMeasure } from '../../../lib/paginator.ts';
import type { ClientMsg, CueItem, Deck, ServicePlan, Template } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { useMeasure } from '../hooks/useMeasure.ts';

interface Props {
  deck: Deck | null;
  currentIndex: number;
  connected: boolean;
  template: Template | null;
  send: (msg: ClientMsg) => boolean;
}

const ITEM_ICONS: Record<CueItem['type'], string> = {
  bible: '📖',
  song: '🎵',
  text: '📝',
  blank: '⬛',
  divider: '▾',
};

/** 오늘 날짜를 YYYY-MM-DD 로 (기본 순서표 이름에 쓴다) */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function PlanPanel({ deck, currentIndex, connected, template, send }: Props): React.JSX.Element {
  const [plans, setPlans] = useState<ServicePlan[]>([]);
  const [plan, setPlan] = useState<ServicePlan | null>(null);
  const [items, setItems] = useState<CueItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 새 항목 입력
  const [newRef, setNewRef] = useState('');
  const [songQuery, setSongQuery] = useState('');
  const [songHits, setSongHits] = useState<Array<{ id: number; title: string; label?: string }>>([]);

  const measurer = useMeasure();

  const reload = useCallback(async () => {
    try {
      setPlans(await api.plans());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '예배 순서를 불러오지 못했습니다');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 곡 검색 (디바운스)
  useEffect(() => {
    if (songQuery.trim().length === 0) {
      setSongHits([]);
      return;
    }
    const timer = setTimeout(() => {
      void api
        .songs(songQuery, 8)
        .then((res) =>
          setSongHits(
            res.hits.map((h) => ({
              id: h.id,
              title: h.title,
              // 번호가 있는 첫 수록 곡집을 라벨로 쓴다 ('새305')
              label: h.entries.filter((e) => e.number !== undefined).map((e) => `${e.songbookShortLabel}${e.number}`)[0],
            })),
          ),
        )
        .catch(() => setSongHits([]));
    }, 200);
    return () => clearTimeout(timer);
  }, [songQuery]);

  function openPlan(target: ServicePlan): void {
    setPlan(target);
    setItems(target.items);
    setDirty(false);
    setNotice(null);
  }

  async function createPlan(): Promise<void> {
    setBusy(true);
    try {
      const created = await api.createPlan(`${today()} 예배`, today(), []);
      await reload();
      openPlan(created.plan);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '만들지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  async function savePlan(): Promise<void> {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.updatePlan(plan.id, { name: plan.name, items });
      setPlan(result.plan);
      setItems(result.plan.items);
      setDirty(false);
      await reload();
      setNotice(
        result.rejected && result.rejected.length > 0
          ? `저장했지만 ${result.rejected.length}개 항목을 버렸습니다: ${result.rejected.join(', ')}`
          : '저장했습니다',
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '저장하지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  function patchItems(next: CueItem[]): void {
    setItems(next);
    setDirty(true);
  }

  function addBible(): void {
    const ref = newRef.trim();
    if (ref.length === 0) return;
    patchItems([...items, { id: newItemId(), type: 'bible', ref, primary: 'nkrv', secondary: [], paging: 'auto' }]);
    setNewRef('');
  }

  function addSong(songId: number, songTitle: string): void {
    patchItems([...items, { id: newItemId(), type: 'song', songId, songTitle, langs: ['ko'], lines: '2' }]);
    setSongQuery('');
    setSongHits([]);
  }

  /**
   * 순서표를 덱으로 풀어 송출한다.
   *
   * 성경 항목은 실측 자동 분할을 거치므로, 예배 순서를 한 번 올려 두면
   * 이후 다음/이전만으로 처음부터 끝까지 진행할 수 있다.
   */
  async function loadForService(): Promise<void> {
    if (!plan || items.length === 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const result = await buildPlanDeck(plan.name, items, async (item) => {
        if (item.type === 'bible') {
          const passage = await api.passage(item.ref, [item.primary, ...item.secondary], item.paging ?? 'auto');
          if (!passage.parse.ok) return { slides: [], labels: [], error: passage.parse.message };
          if (!passage.passage || !passage.deck) return { slides: [], labels: [], error: '본문을 찾지 못했습니다' };

          if ((item.paging ?? 'auto') === 'auto') {
            const paginated = await paginateByMeasure(passage.passage, (slide) =>
              measurer.measure(slide, template ?? undefined),
            );
            if (paginated.slides.length > 0) {
              return {
                slides: paginated.slides,
                labels: paginated.slides.map((_, index) => `${index + 1}`),
              };
            }
          }
          return { slides: passage.deck.slides, labels: passage.deck.labels };
        }

        if (item.type === 'song') {
          const songDeck = await api.songDeck(
            item.songId,
            item.langs,
            item.lines ?? '2',
            undefined,
            template?.behavior.maxCharsPerLine,
          );
          return { slides: songDeck.deck.slides, labels: songDeck.deck.labels };
        }

        if (item.type === 'text') {
          return {
            slides: [{ kind: 'text', lines: item.content.split(/\r?\n/).filter((l) => l.trim().length > 0) }],
            labels: ['텍스트'],
          };
        }

        return { slides: [{ kind: 'blank' }], labels: ['공백'] };
      });

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '순서표를 올리지 못했습니다');
    } finally {
      setBusy(false);
    }
  }

  const activeGroup = deck?.groups?.reduce(
    (found, group, index) => (group.startIndex <= currentIndex ? index : found),
    -1,
  );

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
        <h2>예배 순서</h2>
        <div className="row">
          <select
            className="grow"
            value={plan?.id ?? ''}
            onChange={(e) => {
              const found = plans.find((p) => p.id === Number(e.target.value));
              if (found) openPlan(found);
            }}
          >
            <option value="">— 선택 —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.serviceDate ? `${p.serviceDate} · ` : ''}{p.name} ({p.items.length}항목)
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void createPlan()} disabled={busy}>새로 만들기</button>
        </div>

        {plan && (
          <>
            <div className="field" style={{ marginTop: 12 }}>
              <label>이름</label>
              <input
                type="text"
                value={plan.name}
                onChange={(e) => {
                  setPlan({ ...plan, name: e.target.value });
                  setDirty(true);
                }}
              />
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" className="primary" onClick={() => void loadForService()} disabled={!connected || busy || items.length === 0}>
                예배용으로 올리기
              </button>
              <button type="button" onClick={() => void savePlan()} disabled={busy || !dirty}>
                {dirty ? '저장' : '변경 없음'}
              </button>
            </div>
            {deck?.groups && deck.groups.length > 0 && (
              <p className="hintline ok">
                올려져 있습니다 — {(activeGroup ?? 0) + 1} / {deck.groups.length}번째 항목.
                PgDn·PgUp 으로 항목 단위 이동.
              </p>
            )}
          </>
        )}
      </div>

      {plan && (
        <>
          <div className="card">
            <h2>항목 {items.length > 0 ? `(${items.length})` : ''}</h2>
            {items.length === 0 && <p className="hintline muted">아래에서 본문이나 곡을 추가하세요.</p>}

            <div className="plan-items">
              {items.map((item, index) => {
                const isActive = activeGroup === index && deck?.groups !== undefined;
                return (
                  <div key={item.id} className={`plan-item${isActive ? ' current' : ''}`}>
                    <span className="icon">{ITEM_ICONS[item.type]}</span>
                    <span className="body">
                      <span className="title">{describeItem(item)}</span>
                      {item.type === 'bible' && (
                        <span className="meta">{item.primary}{item.secondary.length > 0 ? ` + ${item.secondary.join(', ')}` : ''}</span>
                      )}
                      {item.type === 'song' && <span className="meta">{item.langs.join('/')} · {item.lines ?? 2}줄씩</span>}
                    </span>
                    <span className="actions">
                      <button type="button" onClick={() => patchItems(moveItem(items, index, index - 1))} disabled={index === 0} title="위로">↑</button>
                      <button type="button" onClick={() => patchItems(moveItem(items, index, index + 1))} disabled={index === items.length - 1} title="아래로">↓</button>
                      <button type="button" onClick={() => patchItems(removeItem(items, item.id))} title="삭제">✕</button>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h2>항목 추가</h2>

            <div className="field">
              <label>성경 본문</label>
              <div className="row">
                <input
                  className="grow"
                  value={newRef}
                  onChange={(e) => setNewRef(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addBible();
                    }
                  }}
                  placeholder="요 3:16-18"
                  spellCheck={false}
                />
                <button type="button" onClick={addBible} disabled={newRef.trim().length === 0}>추가</button>
              </div>
            </div>

            <div className="field" style={{ marginTop: 12 }}>
              <label>찬양</label>
              <input
                value={songQuery}
                onChange={(e) => setSongQuery(e.target.value)}
                placeholder="305 · 나 같은 죄인"
                spellCheck={false}
              />
              {songHits.length > 0 && (
                <div className="candidates">
                  {songHits.map((hit) => (
                    <button key={hit.id} type="button" onClick={() => addSong(hit.id, hit.title)}>
                      {hit.label ? `${hit.label} ` : ''}{hit.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="row" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => patchItems([...items, { id: newItemId(), type: 'blank' }])}>
                공백 추가
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

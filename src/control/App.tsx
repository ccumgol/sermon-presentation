import { useCallback, useEffect, useState } from 'react';

import type { Translation } from '../../shared/types.ts';
import { api, type ServerInfo } from './api.ts';
import { ControlBar } from './components/ControlBar.tsx';
import { LivePreview } from './components/LivePreview.tsx';
import { useLiveState } from './hooks/useLiveState.ts';
import { BiblePanel } from './panels/BiblePanel.tsx';
import { PlanPanel } from './panels/PlanPanel.tsx';
import { ReviewPanel } from './panels/ReviewPanel.tsx';
import { SongPanel } from './panels/SongPanel.tsx';
import { TemplatePanel } from './panels/TemplatePanel.tsx';
import { SettingsPanel } from './panels/SettingsPanel.tsx';

type Tab = 'bible' | 'song' | 'plan' | 'review' | 'template' | 'settings';

/** 입력 중에는 단축키가 동작하지 않아야 한다 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function App(): React.JSX.Element {
  const { status, state, deck, template, connections, outputErrors, dismissErrors, send } = useLiveState();

  const [tab, setTab] = useState<Tab>('bible');
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);

  const connected = status === 'open';

  /**
   * 세로 스크롤바가 차지하는 폭을 한 번 재서 CSS 변수로 둔다.
   *
   * 스크롤되는 목록은 스크롤바만큼 안쪽으로 좁아지는데, 그 위의 검색창·버튼은
   * 그대로라 오른쪽 끝이 어긋나 보인다. 폭은 플랫폼마다 다르고(맥의 오버레이
   * 스크롤바는 0px) CSS 로는 알 수 없어 측정해야 한다.
   */
  useEffect(() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow-y:scroll';
    document.body.appendChild(probe);
    const width = probe.offsetWidth - probe.clientWidth;
    probe.remove();
    document.documentElement.style.setProperty('--scrollbar-w', `${width}px`);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const serverInfo = await api.info();
        setInfo(serverInfo);
        if (serverInfo.bibleReady) {
          setTranslations(await api.translations());
        } else {
          setBootError(
            `성경 DB 가 없습니다. 터미널에서 'npm run bible:build' 를 실행한 뒤 서버를 재시작하세요.`,
          );
          setTab('settings');
        }
      } catch (err) {
        setBootError(err instanceof Error ? err.message : '서버 정보를 불러오지 못했습니다');
      }
    })();
  }, []);

  const onNext = useCallback(() => send({ t: 'next' }), [send]);
  const onPrev = useCallback(() => send({ t: 'prev' }), [send]);
  const onBlank = useCallback(() => send({ t: 'blank', on: !(state?.blank ?? false) }), [send, state?.blank]);
  const onRestore = useCallback(() => send({ t: 'restore' }), [send]);
  const onClear = useCallback(() => send({ t: 'clear' }), [send]);
  const onGroupNext = useCallback(() => send({ t: 'group:next' }), [send]);
  const onGroupPrev = useCallback(() => send({ t: 'group:prev' }), [send]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'ArrowRight':
        case ' ':
          event.preventDefault();
          onNext();
          break;
        case 'ArrowLeft':
          event.preventDefault();
          onPrev();
          break;
        // PgDn/PgUp 은 예배 순서 항목 단위 이동 — 슬라이드 이동은 화살표가 맡는다
        case 'PageDown':
          event.preventDefault();
          onGroupNext();
          break;
        case 'PageUp':
          event.preventDefault();
          onGroupPrev();
          break;
        case 'b':
        case 'B':
          event.preventDefault();
          onBlank();
          break;
        case 'Escape':
          event.preventDefault();
          onRestore();
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onNext, onPrev, onBlank, onRestore, onGroupNext, onGroupPrev]);

  const outputCount = connections.output;
  const live = Boolean(state?.slide) && !(state?.blank ?? false);

  return (
    <div className="app">
      <header className="topbar">
        <nav className="tabs">
          <button type="button" className={`tab${tab === 'bible' ? ' active' : ''}`} onClick={() => setTab('bible')}>
            성경
          </button>
          <button type="button" className={`tab${tab === 'song' ? ' active' : ''}`} onClick={() => setTab('song')}>
            찬양
          </button>
          <button type="button" className={`tab${tab === 'plan' ? ' active' : ''}`} onClick={() => setTab('plan')}>
            예배 순서
          </button>
          <button
            type="button"
            className={`tab${tab === 'review' ? ' active' : ''}`}
            onClick={() => setTab('review')}
          >
            검토
          </button>
          <button
            type="button"
            className={`tab${tab === 'template' ? ' active' : ''}`}
            onClick={() => setTab('template')}
          >
            템플릿
          </button>
          <button
            type="button"
            className={`tab${tab === 'settings' ? ' active' : ''}`}
            onClick={() => setTab('settings')}
          >
            설정
          </button>
        </nav>

        <span className="spacer" />

        <div className="status">
          <span>
            <span className={`dot ${live ? 'live' : 'off'}`} />
            {live ? '송출 중' : '대기'}
          </span>
          <span>
            <span className={`dot ${outputCount > 0 ? 'ok' : 'warn'}`} />
            OBS {outputCount > 0 ? `${outputCount}개 연결` : '미연결'}
          </span>
          <span>
            <span className={`dot ${connected ? 'ok' : 'off'}`} />
            {connected ? '서버 연결됨' : status === 'connecting' ? '연결 중…' : '연결 끊김'}
          </span>
        </div>
      </header>

      <div className="body">
        <main className="main">
          {bootError && <div className="banner error">{bootError}</div>}

          {!connected && !bootError && (
            <div className="banner warn">
              서버와 연결이 끊겼습니다. 자동으로 재연결을 시도하는 동안 조작 버튼이 잠깁니다.
              <br />
              <small>송출 화면은 마지막 내용을 그대로 유지합니다.</small>
            </div>
          )}

          {outputErrors.length > 0 && (
            <div className="banner error">
              <button type="button" className="close" onClick={dismissErrors}>
                닫기
              </button>
              출력 화면에서 오류가 발생했습니다:
              {outputErrors.map((err, index) => (
                <div key={index}>
                  <small>{err.message}</small>
                </div>
              ))}
            </div>
          )}

          {tab === 'bible' && translations.length > 0 && (
            <BiblePanel
              translations={translations}
              defaultTranslation={info?.defaultTranslation ?? 'nkrv'}
              deck={deck}
              currentIndex={deck?.index ?? 0}
              connected={connected}
              template={template}
              send={send}
            />
          )}

          {tab === 'song' && (
            <SongPanel
              deck={deck}
              currentIndex={deck?.index ?? 0}
              connected={connected}
              template={template}
              send={send}
            />
          )}

          {tab === 'plan' && (
            <PlanPanel
              deck={deck}
              currentIndex={deck?.index ?? 0}
              connected={connected}
              template={template}
              send={send}
            />
          )}

          {tab === 'review' && <ReviewPanel connected={connected} template={template} send={send} />}

          {tab === 'template' && <TemplatePanel active={template} connected={connected} send={send} />}

          {tab === 'settings' && <SettingsPanel info={info} />}
        </main>

        <aside className="side">
          <LivePreview state={state} deck={deck} />
        </aside>
      </div>

      <ControlBar
        state={state}
        deck={deck}
        connected={connected}
        onPrev={onPrev}
        onNext={onNext}
        onBlank={onBlank}
        onRestore={onRestore}
        onClear={onClear}
      />
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';

import type { Translation } from '../../shared/types.ts';
import { api, type ServerInfo } from './api.ts';
import { ControlBar } from './components/ControlBar.tsx';
import { LivePreview } from './components/LivePreview.tsx';
import { NextUp } from './components/NextUp.tsx';
import { useLiveState } from './hooks/useLiveState.ts';
import { BiblePanel } from './panels/BiblePanel.tsx';
import { PlanPanel } from './panels/PlanPanel.tsx';
import { ReviewPanel } from './panels/ReviewPanel.tsx';
import { SongPanel } from './panels/SongPanel.tsx';
import { TemplatePanel } from './panels/TemplatePanel.tsx';
import { SettingsPanel } from './panels/SettingsPanel.tsx';
import { useTheme } from './hooks/useTheme.ts';

/** 탭 순서 = 화면에 나오는 순서. 예배 순서가 첫 번째다 — 실제로 가장 많이 쓴다. */
type Tab = 'plan' | 'bible' | 'song' | 'review' | 'template' | 'settings';

/** 입력 중에는 단축키가 동작하지 않아야 한다 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function App(): React.JSX.Element {
  const {
    status, state, deck, template, connections,
    outputErrors, dismissErrors, staleOutput, dismissStale, send,
  } = useLiveState();

  // 기본 탭은 예배 순서. 성경·찬양은 한 종류를 깊게 다룰 때 쓰고,
  // 예배 진행은 찬양·성경·광고가 섞여 순서대로 흐른다.
  const [tab, setTab] = useState<Tab>('plan');
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
      // 패널이 이미 처리한 키는 건드리지 않는다.
      //
      // 예배 순서 탭에서 슬라이드 영역에 포커스가 있으면 ←→ 로 **미리보기 커서**만
      // 움직여야 하는데, 이 검사가 없으면 실제 송출 화면까지 함께 넘어간다.
      // 패널 리스너가 먼저 등록되므로(React 는 자식 effect 를 먼저 실행) 여기서 알 수 있다.
      if (event.defaultPrevented) return;

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
  const theme = useTheme();

  return (
    <div className="app">
      <header className="topbar">
        <nav className="tabs">
          <button type="button" className={`tab${tab === 'plan' ? ' active' : ''}`} onClick={() => setTab('plan')}>
            예배 순서
          </button>
          <button type="button" className={`tab${tab === 'bible' ? ' active' : ''}`} onClick={() => setTab('bible')}>
            성경
          </button>
          <button type="button" className={`tab${tab === 'song' ? ' active' : ''}`} onClick={() => setTab('song')}>
            찬양
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

        {/*
          강사 모니터 — 새 창으로 연다. 설교자 앞 모니터에 전체화면(F11)으로 둔다.
          OBS 를 거치지 않는다 — 회중에게 나가는 화면이 아니라 조작자용 정보다.
        */}
        <button
          type="button"
          className="stage-open"
          onClick={() => window.open('/stage/', 'sermon-stage', 'width=1280,height=720')}
          title="강사(설교자) 모니터를 새 창으로 엽니다. 그 창을 강단 모니터로 옮겨 전체화면으로 두세요."
        >
          강사 모니터
          {connections.stage > 0 && <span className="dot ok" />}
        </button>

        {/*
          프로젝터 — 강사 모니터와 같은 방식으로 새 창을 띄우지만, 보여 주는 것은
          **회중용 내용**이다. TV 가 아니라 프로젝터로 띄울 때 쓴다: 대비가 낮아
          크고 두꺼운 글씨가 필요하므로, 이 창은 활성 템플릿을 따르지 않고
          '전체 — 성경·찬송 겸용' 으로 그린다 (사용자 요청 2026-08-20).

          그래서 OBS 는 '하단 두 줄', 프로젝터는 '전체' 를 **동시에** 쓸 수 있다.
        */}
        <button
          type="button"
          className="stage-open"
          onClick={() => window.open('/projector/', 'sermon-projector', 'width=1280,height=720')}
          title={
            '프로젝터용 화면을 새 창으로 엽니다. 그 창을 프로젝터 화면으로 옮긴 뒤 ' +
            '화면을 한 번 클릭하세요 — 주소줄과 제목줄이 사라집니다 (F 도 같습니다). ' +
            '창 안에서 마우스를 움직이면 글자 크기·색 반전 막대가 나옵니다.'
          }
        >
          프로젝터
          {connections.projector > 0 && <span className="dot ok" />}
        </button>

        {/*
          테마 토글. 기본은 OS 설정을 따르고(`system`), 어긋날 때만 고정한다.
          제목 대신 아이콘 하나로 둔 이유는 상단 바가 예배 중에는 볼 일이 없는 자리라서다.
        */}
        <button
          type="button"
          className="theme-toggle"
          onClick={theme.toggle}
          title={
            theme.choice === 'system'
              ? `화면 밝기 — 지금은 OS 설정(${theme.resolved === 'dark' ? '어둡게' : '밝게'})을 따릅니다`
              : `화면 밝기 — ${theme.choice === 'dark' ? '어둡게' : '밝게'} 고정`
          }
        >
          {theme.resolved === 'dark' ? '🌙' : '☀️'}
          {theme.choice !== 'system' && <span className="pin" aria-hidden="true">•</span>}
        </button>

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

          {staleOutput && (
            <div className="banner warn">
              <button type="button" className="close" onClick={dismissStale}>
                닫기
              </button>
              <b>OBS 브라우저 소스를 새로고침하세요.</b> 연결된 출력 화면
              {staleOutput !== 'main' ? ` (${staleOutput})` : ''}이 앱보다 옛 판입니다.
              <br />
              <small>
                브라우저 소스 더블클릭 → <b>현재 페이지 새로고침</b>. 서버를 재시작해도 OBS 안의
                페이지는 다시 읽히지 않아, 새로 만든 항목이 <b>화면에 나오지 않습니다</b>
                (화면은 비우지 않고 이전 내용을 유지합니다).
              </small>
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
              translations={translations}
              defaultTranslation={info?.defaultTranslation ?? 'nkrv'}
              send={send}
            />
          )}

          {tab === 'review' && <ReviewPanel connected={connected} template={template} send={send} />}

          {tab === 'template' && <TemplatePanel active={template} connected={connected} send={send} />}

          {tab === 'settings' && <SettingsPanel info={info} />}
        </main>

        {/*
          오른쪽 열 = 미리보기(위) + 송출 제어(아래).
          전에는 제어 버튼이 화면 전체 폭 아래에 있었고 이 열 아래는 비어 있었다.
          제어를 여기로 내리면 왼쪽 순서 목록이 그 높이를 되찾는다.
        */}
        <aside className="side">
          <LivePreview state={state} deck={deck} />

          <div className="side-gap">
            <NextUp deck={deck} />
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
        </aside>
      </div>
    </div>
  );
}

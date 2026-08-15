/**
 * WebSocket 허브. 컨트롤 패널과 출력 페이지를 상태 저장소에 연결한다.
 *
 * 설계 요점
 *  - 접속 즉시 전체 스냅샷을 보낸다 → **OBS 브라우저 소스를 새로고침해도 화면이 복구된다.**
 *    이것이 예배 운영에서 가장 중요한 요구사항이다.
 *  - 묶음(deck)은 컨트롤 패널에만 보낸다. 장 전체(150절 이상)를 OBS 쪽으로
 *    매번 보내면 렌더 중 GC 지연이 생길 수 있다.
 *  - 잘못된 메시지 하나가 연결을 끊지 않는다. 무시하고 오류만 되돌려준다.
 */

import type { Server } from 'node:http';

import { WebSocket, WebSocketServer } from 'ws';

import { templateToCssVars } from '../lib/template-css.ts';
import type { ClientMsg, ClientRole, Deck, LiveState, ServerMsg, Template } from '../shared/types.ts';
import { getTemplateOrDefault } from './db/templates.ts';
import { isOutputStale, outputBuildMs } from './output-build.ts';
import * as state from './state.ts';

interface Client {
  socket: WebSocket;
  role: ClientRole;
  layer: string;
}

export interface WsHub {
  /** 현재 접속 수 — 컨트롤 패널의 '출력 연결됨' 표시에 쓴다 */
  counts(): { control: number; output: number };
  /** 템플릿이 바뀌었을 때 모든 화면에 즉시 반영한다 (REST 편집 경로에서 호출) */
  pushTemplate(template: Template): void;
  close(): void;
}

type Logger = { info: (msg: string) => void; warn: (msg: string) => void };

export function createWsHub(server: Server, log: Logger): WsHub {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Map<WebSocket, Client>();

  function send(socket: WebSocket, msg: ServerMsg): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify(msg));
    } catch (err) {
      log.warn(`WS 전송 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function broadcast(msg: ServerMsg, roles?: ClientRole[]): void {
    for (const client of clients.values()) {
      if (roles && !roles.includes(client.role)) continue;
      send(client.socket, msg);
    }
  }

  function counts(): { control: number; output: number } {
    let control = 0;
    let output = 0;
    for (const client of clients.values()) {
      if (client.role === 'control') control++;
      // 컨트롤 패널 안의 미리보기 iframe 은 실제 송출 화면이 아니므로 세지 않는다.
      // 그래야 '출력 연결됨' 표시가 OBS 연결 여부를 정확히 뜻한다.
      else if (client.layer !== 'preview') output++;
    }
    return { control, output };
  }

  /**
   * 템플릿을 보낸다. 전체 객체와 CSS 변수를 함께 넘겨,
   * 출력 페이지는 변수만 적용하고(리렌더 없음) 컨트롤 패널은 편집 폼을 채운다.
   */
  function sendTemplate(socket: WebSocket, template: Template): void {
    send(socket, { t: 'template', payload: template });
    send(socket, { t: 'style:patch', payload: templateToCssVars(template) });
  }

  function broadcastTemplate(template: Template): void {
    for (const client of clients.values()) sendTemplate(client.socket, template);
  }

  /**
   * 접속 수를 컨트롤 패널에 알린다. 폴링 대신 변화 시점에만 보낸다 —
   * 3초마다 REST 를 찌르면 예배 중 로그와 CPU 를 낭비한다.
   */
  function broadcastCounts(): void {
    broadcast({ t: 'connections', payload: counts() }, ['control']);
  }

  // 상태가 바뀌면 모두에게 스냅샷을, 컨트롤에는 묶음까지 보낸다.
  // 부분 패치보다 전체 스냅샷이 단순하고, localhost 에서는 비용도 무시할 만하다.
  const unsubscribe = state.subscribe((live: LiveState, deck: Deck | null) => {
    broadcast({ t: 'state', payload: live });
    broadcast({ t: 'deck', payload: deck }, ['control']);
  });

  function handle(client: Client, msg: ClientMsg): void {
    switch (msg.t) {
      case 'hello':
        // 역할은 최초 hello 로만 정한다
        client.role = msg.role === 'control' ? 'control' : 'output';
        client.layer = msg.layer ?? 'main';
        send(client.socket, { t: 'state', payload: state.getState() });
        // 접속 즉시 템플릿까지 보내야 새로고침 후 스타일이 그대로 복구된다
        sendTemplate(client.socket, getTemplateOrDefault(state.getState().templateId));
        if (client.role === 'control') send(client.socket, { t: 'deck', payload: state.getDeck() });
        log.info(`WS 연결: ${client.role}${client.role === 'output' ? ` (layer=${client.layer})` : ''}`);
        // 역할이 정해진 뒤에 알려야 집계가 맞는다
        broadcastCounts();

        // 옛 판이 붙어 있으면 컨트롤 패널에 알린다.
        // 미리보기 iframe 은 컨트롤 패널과 함께 새로 뜨므로 대상이 아니다.
        if (client.role === 'output' && client.layer !== 'preview' && isOutputStale(msg.loadedAt, outputBuildMs())) {
          log.warn(`출력 페이지가 옛 판입니다 (layer=${client.layer}) — OBS 브라우저 소스를 새로고침하세요`);
          broadcast({ t: 'output:stale', payload: { layer: client.layer ?? 'main' } }, ['control']);
        }
        break;

      case 'show':
        state.show(msg.payload);
        break;

      case 'deck:load':
        state.loadDeck(msg.payload);
        break;

      case 'next':
        state.next();
        break;

      case 'prev':
        state.prev();
        break;

      case 'goto':
        state.goto(msg.index);
        break;

      case 'group:next':
        state.gotoGroup(1);
        break;

      case 'group:prev':
        state.gotoGroup(-1);
        break;

      case 'blank':
        state.setBlank(Boolean(msg.on));
        break;

      case 'restore':
        state.restore();
        break;

      case 'clear':
        state.clear();
        break;

      case 'template:set': {
        const template = getTemplateOrDefault(msg.id);
        // 존재하지 않는 id 였다면 실제로 적용된 템플릿의 id 로 맞춘다
        state.setTemplate(template.id);
        broadcastTemplate(template);
        break;
      }

      case 'style:set':
        // 편집 중 실시간 미리보기용 — 저장하지 않고 화면에만 반영한다.
        // 저장은 컨트롤 패널이 PUT /api/templates/:id 로 한다.
        broadcast({ t: 'style:patch', payload: toCssPatch(msg.patch) });
        break;

      case 'measure:report':
        // Phase 3 자동 분할에서 사용한다. 지금은 받아만 둔다.
        break;

      case 'client:error':
        // 출력 페이지의 오류를 컨트롤 패널에 올려 예배 전에 발견하게 한다
        log.warn(`출력 페이지 오류: ${msg.payload.message}`);
        broadcast({ t: 'output:error', payload: { message: msg.payload.message, url: msg.payload.url } }, ['control']);
        break;

      default:
        send(client.socket, { t: 'error', message: `알 수 없는 메시지: ${(msg as { t: string }).t}` });
    }
  }

  wss.on('connection', (socket) => {
    const client: Client = { socket, role: 'output', layer: 'main' };
    clients.set(socket, client);

    // hello 를 못 받아도 최소한 현재 상태는 보낸다 (구형 클라이언트·수동 접속 대비)
    send(socket, { t: 'state', payload: state.getState() });

    socket.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(String(raw)) as ClientMsg;
      } catch {
        send(socket, { t: 'error', message: 'JSON 파싱 실패' });
        return;
      }
      if (!msg || typeof msg.t !== 'string') {
        send(socket, { t: 'error', message: '메시지 형식이 올바르지 않습니다' });
        return;
      }

      try {
        handle(client, msg);
      } catch (err) {
        // 한 메시지의 실패가 연결을 끊지 않는다
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`WS 처리 실패 (${msg.t}): ${message}`);
        send(socket, { t: 'error', message });
      }
    });

    socket.on('close', () => {
      clients.delete(socket);
      broadcastCounts();
    });

    socket.on('error', (err) => {
      log.warn(`WS 소켓 오류: ${err.message}`);
      clients.delete(socket);
      broadcastCounts();
    });
  });

  return {
    counts,
    pushTemplate: broadcastTemplate,
    close(): void {
      unsubscribe();
      for (const client of clients.values()) client.socket.close();
      clients.clear();
      wss.close();
    },
  };
}

/**
 * style:set 의 값을 CSS 변수 문자열로 바꾼다.
 * 숫자는 px 로 보지 않는다 — 배율(--fit-scale)처럼 단위 없는 값이 있으므로
 * 호출하는 쪽이 단위를 포함한 문자열을 보내는 것이 원칙이다.
 */
function toCssPatch(patch: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) continue;
    out[key] = String(value);
  }
  return out;
}

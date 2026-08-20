/**
 * 서버의 송출 상태에 붙는 훅.
 *
 * 컨트롤 패널도 출력 페이지와 같은 규칙을 따른다:
 *  - 접속 시 전체 스냅샷을 받아 즉시 현재 상태를 반영한다
 *  - 끊기면 지수 백오프로 재연결하고, 그동안 조작 버튼을 잠근다
 *    (누른 것이 반영되지 않았는데 반영된 줄 아는 상황을 막는다)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientMsg, Deck, LiveState, ServerMsg, Template } from '../../../shared/types.ts';

const RECONNECT_MIN = 250;
const RECONNECT_MAX = 5000;

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface OutputError {
  message: string;
  url: string;
  at: number;
}

export interface Connections {
  control: number;
  /** OBS 로 나가는 출력 페이지 수 (미리보기·강사 모니터는 빼고 센다) */
  output: number;
  /** 강사 모니터(`/stage`) 수 — OBS 출력과 섞으면 'OBS 연결됨' 표시가 거짓이 된다 */
  stage: number;
  /** 프로젝터 화면(`/projector`) 수 — 이것도 OBS 출력이 아니다 */
  projector: number;
}

export interface LiveConnection {
  status: ConnectionStatus;
  state: LiveState | null;
  deck: Deck | null;
  /** 현재 송출에 적용된 템플릿. 접속 즉시·변경 시 서버가 밀어 준다. */
  template: Template | null;
  /** 서버가 접속 변화 시점에 밀어 준다 — 폴링하지 않는다 */
  connections: Connections;
  outputErrors: OutputError[];
  dismissErrors: () => void;
  /**
   * 접속한 출력 페이지가 옛 판이라는 알림 (OBS 소스 새로고침 필요).
   * 서버가 출력 파일 수정 시각과 페이지 로드 시각을 비교해 보내 준다.
   */
  staleOutput: string | null;
  dismissStale: () => void;
  send: (msg: ClientMsg) => boolean;
}

function wsUrl(): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws`;
}

export function useLiveState(): LiveConnection {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [state, setState] = useState<LiveState | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [outputErrors, setOutputErrors] = useState<OutputError[]>([]);
  const [staleOutput, setStaleOutput] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connections>({ control: 0, output: 0, stage: 0, projector: 0 });
  const [template, setTemplate] = useState<Template | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const delayRef = useRef(RECONNECT_MIN);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedRef = useRef(false);

  useEffect(() => {
    closedRef.current = false;

    const connect = (): void => {
      if (closedRef.current) return;
      setStatus('connecting');

      let socket: WebSocket;
      try {
        socket = new WebSocket(wsUrl());
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        delayRef.current = RECONNECT_MIN;
        setStatus('open');
        socket.send(JSON.stringify({ t: 'hello', role: 'control' } satisfies ClientMsg));
      };

      socket.onmessage = (event: MessageEvent<string>) => {
        let msg: ServerMsg;
        try {
          msg = JSON.parse(event.data) as ServerMsg;
        } catch {
          return;
        }
        if (!msg || typeof msg.t !== 'string') return;

        if (msg.t === 'state') {
          setState(msg.payload);
        } else if (msg.t === 'deck') {
          setDeck(msg.payload);
        } else if (msg.t === 'template') {
          setTemplate(msg.payload);
        } else if (msg.t === 'connections') {
          setConnections(msg.payload);
        } else if (msg.t === 'output:error') {
          setOutputErrors((prev) => [
            ...prev.slice(-4),
            { message: msg.payload.message, url: msg.payload.url, at: Date.now() },
          ]);
        } else if (msg.t === 'output:stale') {
          setStaleOutput(msg.payload.layer);
        }
      };

      socket.onclose = () => {
        setStatus('closed');
        // 끊긴 동안의 접속 수는 알 수 없다. 오래된 값을 그대로 보여주면
        // OBS 가 붙어 있다고 오해할 수 있으므로 0 으로 되돌린다.
        setConnections({ control: 0, output: 0, stage: 0, projector: 0 });
        scheduleReconnect();
      };

      socket.onerror = () => {
        setStatus('closed');
      };
    };

    const scheduleReconnect = (): void => {
      if (closedRef.current || timerRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        connect();
      }, delayRef.current);
      delayRef.current = Math.min(delayRef.current * 2, RECONNECT_MAX);
    };

    connect();

    return () => {
      closedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      socketRef.current?.close();
    };
  }, []);

  const send = useCallback((msg: ClientMsg): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }, []);

  const dismissErrors = useCallback(() => setOutputErrors([]), []);
  const dismissStale = useCallback(() => setStaleOutput(null), []);

  return {
    status, state, deck, template, connections,
    outputErrors, dismissErrors, staleOutput, dismissStale, send,
  };
}

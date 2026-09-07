// @vitest-environment jsdom
/**
 * **조작 화면이 서버 상태에 붙는 훅** — `src/` 를 겨냥한 첫 검사다.
 *
 * ## 왜 여기부터인가
 *
 * 검사 1,440개가 전부 `lib/`·`server/` 였다. 검수 리포트가 `src/` 커버리지 0 을
 * **'가장 큰 빚'** 으로 지목했는데, 그중에서도 이 훅이 값이 크다 — 컨트롤 화면의
 * 모든 표시(송출 상태·덱·OBS 연결 수·오류 배너)가 여기를 지나고, 예배 중에 이것이
 * 틀리면 **오퍼레이터가 거짓을 보고 판단한다.**
 *
 * ## 여기서 지키는 것
 *
 * | | 왜 |
 * |---|---|
 * | 붙는 즉시 `hello` 를 보낸다 | 서버가 그때 전체 스냅샷을 준다 — 새로고침 후 복구의 전제 |
 * | 끊기면 **접속 수를 0 으로 되돌린다** | 옛 값을 두면 'OBS 가 붙어 있다' 고 오해한다 |
 * | 끊긴 동안 `send` 가 `false` | 누른 것이 안 갔는데 간 줄 아는 상황을 막는다 |
 * | 서버가 거절한 것(`{t:'error'}`)이 배너에 오른다 | 전에는 조용히 버려졌다 (§4.6 D) |
 * | 깨진 메시지에 죽지 않는다 | 예배 중에 화면이 멈추면 안 된다 |
 *
 * ## 틀(harness)
 *
 * 파일 맨 위의 `@vitest-environment jsdom` 이 이 파일만 DOM 환경으로 만든다 —
 * 전역을 바꾸면 `lib/`·`server/` 검사 1,440개가 함께 영향을 받는다.
 * `afterEach(cleanup)` 도 파일마다 명시한다 (`globals: false` 라 자동으로 붙지 않고,
 * 안 붙이면 다음 검사에서 **같은 요소가 두 개** 잡힌다 — 실제로 겪었다).
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLiveState } from '../../src/control/hooks/useLiveState.ts';
import type { ServerMsg } from '../../shared/types.ts';

afterEach(cleanup);

/** 서버 대신 우리가 조종하는 소켓. 진짜로 접속하지 않는다 */
class FakeSocket {
  static instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeSocket.CLOSED;
  }

  // ── 검사가 서버 흉내를 내는 손잡이들 ──
  accept(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }

  deliver(msg: ServerMsg | Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  deliverRaw(data: string): void {
    this.onmessage?.({ data });
  }

  drop(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }

  static get last(): FakeSocket {
    const socket = FakeSocket.instances.at(-1);
    if (!socket) throw new Error('소켓이 만들어지지 않았다 — 훅이 붙지 않은 것이다');
    return socket;
  }
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 붙어서 열린 상태까지 만든다 — 거의 모든 검사의 출발점이다 */
function connected() {
  const hook = renderHook(() => useLiveState());
  act(() => FakeSocket.last.accept());
  return { hook, socket: FakeSocket.last };
}

describe('붙을 때', () => {
  it('이 서버의 /ws 로 붙는다', () => {
    renderHook(() => useLiveState());
    expect(FakeSocket.last.url).toBe(`ws://${location.host}/ws`);
  });

  it('붙기 전에는 connecting 이다', () => {
    const { result } = renderHook(() => useLiveState());
    expect(result.current.status).toBe('connecting');
  });

  it('열리면 **곧바로 hello 를 보낸다** — 서버가 그때 스냅샷을 준다', () => {
    const { socket } = connected();
    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toEqual({ t: 'hello', role: 'control' });
  });

  it('열리면 status 가 open 이다', () => {
    const { hook } = connected();
    expect(hook.result.current.status).toBe('open');
  });
});

describe('서버가 보내는 것을 받는다', () => {
  it('상태·덱·템플릿·접속 수', () => {
    const { hook, socket } = connected();

    act(() => {
      socket.deliver({ t: 'state', payload: { slide: null, blank: false, templateId: -1 } });
      socket.deliver({ t: 'deck', payload: { reference: '요 3:16', slides: [], labels: [], index: 0 } });
      socket.deliver({ t: 'connections', payload: { control: 1, output: 2, stage: 1, projector: 0 } });
    });

    expect(hook.result.current.state).toMatchObject({ blank: false });
    expect(hook.result.current.deck).toMatchObject({ reference: '요 3:16' });
    expect(hook.result.current.connections).toEqual({ control: 1, output: 2, stage: 1, projector: 0 });
  });

  it('출력 페이지의 오류가 배너에 오른다 (어디서 났는지까지)', () => {
    const { hook, socket } = connected();
    act(() => {
      socket.deliver({
        t: 'output:error',
        payload: { message: '배경 파일을 불러오지 못했습니다', url: 'http://localhost:7777/output/' },
      });
    });

    expect(hook.result.current.outputErrors).toHaveLength(1);
    expect(hook.result.current.outputErrors[0]).toMatchObject({
      message: '배경 파일을 불러오지 못했습니다',
      url: 'http://localhost:7777/output/',
    });
  });

  it('★ 서버가 거절한 것도 배너에 오른다 — 전에는 조용히 버려졌다 (§4.6 D)', () => {
    const { hook, socket } = connected();
    act(() => socket.deliver({ t: 'error', message: '묶음을 받지 않았습니다: 슬라이드가 너무 많습니다' }));

    expect(hook.result.current.outputErrors).toHaveLength(1);
    expect(hook.result.current.outputErrors[0]!.message).toContain('슬라이드가 너무 많습니다');
    // 이쪽은 주소가 없다 — 이 조작 화면이 보낸 것을 서버가 거절한 것이라 의미가 없다
    expect(hook.result.current.outputErrors[0]!.url).toBeUndefined();
  });

  it('오류가 쌓여도 다섯 개까지만 둔다 — 배너가 화면을 덮으면 안 된다', () => {
    const { hook, socket } = connected();
    act(() => {
      for (let i = 0; i < 12; i++) socket.deliver({ t: 'error', message: `오류 ${i}` });
    });

    expect(hook.result.current.outputErrors).toHaveLength(5);
    // 최근 것이 남는다
    expect(hook.result.current.outputErrors.at(-1)!.message).toBe('오류 11');
  });

  it('옛 판 출력 페이지 알림을 받는다', () => {
    const { hook, socket } = connected();
    act(() => socket.deliver({ t: 'output:stale', payload: { layer: 'main' } }));
    expect(hook.result.current.staleOutput).toBe('main');
  });

  it('배너는 사람이 닫을 수 있다', () => {
    const { hook, socket } = connected();
    act(() => {
      socket.deliver({ t: 'error', message: '무엇' });
      socket.deliver({ t: 'output:stale', payload: { layer: 'main' } });
    });

    act(() => hook.result.current.dismissErrors());
    act(() => hook.result.current.dismissStale());

    expect(hook.result.current.outputErrors).toEqual([]);
    expect(hook.result.current.staleOutput).toBeNull();
  });
});

describe('깨진 것에 죽지 않는다 — 예배 중에 화면이 멈추면 안 된다', () => {
  it('JSON 이 아닌 것', () => {
    const { hook, socket } = connected();
    act(() => socket.deliverRaw('{{{'));
    expect(hook.result.current.status).toBe('open');
    expect(hook.result.current.state).toBeNull();
  });

  it('`t` 가 없는 것 · 모르는 종류', () => {
    const { hook, socket } = connected();
    act(() => {
      socket.deliver({ payload: '무엇' });
      socket.deliver({ t: '앞으로생길것', payload: 1 });
    });
    expect(hook.result.current.status).toBe('open');
    expect(hook.result.current.outputErrors).toEqual([]);
  });

  it('`null` 이 와도 죽지 않는다', () => {
    const { hook, socket } = connected();
    act(() => socket.deliverRaw('null'));
    expect(hook.result.current.status).toBe('open');
  });
});

describe('끊길 때 — 오퍼레이터가 거짓을 보지 않아야 한다', () => {
  it('★ 접속 수를 0 으로 되돌린다 (옛 값을 두면 OBS 가 붙어 있다고 오해한다)', () => {
    const { hook, socket } = connected();
    act(() => socket.deliver({ t: 'connections', payload: { control: 1, output: 2, stage: 0, projector: 0 } }));
    expect(hook.result.current.connections.output).toBe(2);

    act(() => socket.drop());
    expect(hook.result.current.connections).toEqual({ control: 0, output: 0, stage: 0, projector: 0 });
    expect(hook.result.current.status).toBe('closed');
  });

  it('★ 끊긴 동안 send 는 false — 누른 것이 안 갔는데 간 줄 알면 안 된다', () => {
    const { hook, socket } = connected();
    expect(hook.result.current.send({ t: 'next' })).toBe(true);

    act(() => socket.drop());
    expect(hook.result.current.send({ t: 'next' })).toBe(false);
  });

  it('마지막 상태는 지우지 않는다 — 화면이 스스로 비지 않는 규칙과 같다', () => {
    const { hook, socket } = connected();
    act(() => socket.deliver({ t: 'state', payload: { slide: null, blank: true, templateId: -1 } }));
    act(() => socket.drop());
    expect(hook.result.current.state).toMatchObject({ blank: true });
  });

  it('끊기면 다시 붙는다', () => {
    vi.useFakeTimers();
    renderHook(() => useLiveState());
    act(() => FakeSocket.last.accept());
    expect(FakeSocket.instances).toHaveLength(1);

    act(() => FakeSocket.last.drop());
    act(() => void vi.advanceTimersByTime(300));

    expect(FakeSocket.instances.length).toBeGreaterThan(1);
  });

  it('거듭 끊기면 **간격을 늘린다** — 죽은 서버에 초당 수십 번 매달리지 않는다', () => {
    vi.useFakeTimers();
    renderHook(() => useLiveState());

    const attemptsAfter = (ms: number): number => {
      act(() => FakeSocket.last.drop());
      act(() => void vi.advanceTimersByTime(ms));
      return FakeSocket.instances.length;
    };

    act(() => FakeSocket.last.accept());
    // 첫 재연결은 250ms 안에 온다
    expect(attemptsAfter(250)).toBe(2);
    // 두 번째는 250ms 로는 오지 않는다 (간격이 늘었다)
    expect(attemptsAfter(250)).toBe(2);
    act(() => void vi.advanceTimersByTime(500));
    expect(FakeSocket.instances).toHaveLength(3);
  });
});

describe('떼어낼 때', () => {
  it('소켓을 닫고 더 붙지 않는다', () => {
    vi.useFakeTimers();
    const hook = renderHook(() => useLiveState());
    act(() => FakeSocket.last.accept());

    const socket = FakeSocket.last;
    hook.unmount();
    expect(socket.readyState).toBe(FakeSocket.CLOSED);

    act(() => void vi.advanceTimersByTime(10_000));
    expect(FakeSocket.instances).toHaveLength(1);
  });
});

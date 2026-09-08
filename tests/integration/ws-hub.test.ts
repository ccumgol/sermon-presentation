/**
 * **WebSocket 허브** — 예배 중에 화면이 도는 통로.
 *
 * ## 왜 이 검사가 있는가
 *
 * 컨트롤 패널의 모든 조작과 출력 페이지·강사 모니터·프로젝터·태블릿의 모든 표시가
 * 여기를 지난다. **깨지면 예배가 멈춘다** — 이 저장소에서 비용이 가장 큰 실패다.
 * 그런데 여태 통합 검사가 `ws-style.test.ts` 하나뿐이었다(문장 57%).
 *
 * ## 실제 소켓을 띄운다
 *
 * 흉내(mock)로는 이 파일이 하는 일 — 누구에게 무엇을 보내고 누구에게는 보내지
 * 않는가 — 을 잡을 수 없다. 포트 0 으로 커널이 고른 빈 포트를 쓴다:
 * **사용자의 7777 을 건드리지 않는다** (예배 준비 중일 수 있다).
 *
 * ## 상태는 모듈 하나를 공유한다
 *
 * `server/state.ts` 는 싱글턴이라 검사끼리 새어 나간다. 매번 `state.clear()` 로
 * 되돌린다.
 *
 * ⚠️ **`resetStateForTest()` 를 쓰면 안 된다.** 그 함수는 `listeners.clear()` 까지
 * 해서 **허브의 구독을 끊는다** — 첫 검사 뒤로 상태 변화가 아무 화면에도 가지
 * 않아, 이 파일의 검사 여덟이 한꺼번에 시간 초과로 죽었다 (실제로 겪었다).
 */

import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import { getTemplateOrDefault } from '../../server/db/templates.ts';
import * as state from '../../server/state.ts';
import { createWsHub, type WsHub } from '../../server/ws.ts';
import type { Deck, ServerMsg, SlidePayload } from '../../shared/types.ts';

let app: FastifyInstance;
let hub: WsHub;
let port: number;
const warnings: string[] = [];
const infos: string[] = [];

beforeAll(async () => {
  const built = await buildApp({ getPort: () => port });
  app = built.app;
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;

  hub = createWsHub(app.server, {
    info: (msg) => infos.push(msg),
    warn: (msg) => warnings.push(msg),
  });
});

afterAll(async () => {
  hub.close();
  await app.close();
});

// ── 소켓 다루기 ────────────────────────────────────────────────
//
// 받은 메시지를 전부 모아 둔다. '무엇이 왔나' 뿐 아니라 **'무엇이 오지 않았나'**
// 를 봐야 하는 검사가 많다 (덱을 출력 페이지에 보내지 않는 것 등).

interface Peer {
  socket: WebSocket;
  received: ServerMsg[];
  /**
   * 조건에 맞는 메시지가 올 때까지 기다린다.
   *
   * `from` 을 주면 **그 지점 뒤에 온 것만** 본다. 안 주면 이미 받아 둔 것도
   * 살피는데, 같은 종류가 앞서 온 검사에서는 옛 메시지에 걸려 통과해 버린다
   * (접속 수 통보가 그랬다).
   */
  waitFor: (match: (msg: ServerMsg) => boolean, label?: string, from?: number) => Promise<ServerMsg>;
  /** 이 종류가 온 적 있는가 */
  got: (t: ServerMsg['t']) => ServerMsg[];
  send: (msg: unknown) => void;
  close: () => void;
}

const openPeers: Peer[] = [];

async function connect(hello?: Record<string, unknown>): Promise<Peer> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const received: ServerMsg[] = [];
  const listeners: Array<(msg: ServerMsg) => void> = [];

  socket.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as ServerMsg;
    received.push(msg);
    for (const listen of [...listeners]) listen(msg);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

  const peer: Peer = {
    socket,
    received,
    got: (t) => received.filter((msg) => msg.t === t),
    send: (msg) => socket.send(JSON.stringify(msg)),
    close: () => socket.close(),
    waitFor: (match, label = '메시지', from = 0) =>
      new Promise((resolve, reject) => {
        const found = received.slice(from).find(match);
        if (found) return resolve(found);
        const timer = setTimeout(() => reject(new Error(`${label} 가 오지 않았다`)), 3000);
        const listen = (msg: ServerMsg): void => {
          if (!match(msg)) return;
          clearTimeout(timer);
          listeners.splice(listeners.indexOf(listen), 1);
          resolve(msg);
        };
        listeners.push(listen);
      }),
  };

  openPeers.push(peer);
  if (hello) {
    peer.send(hello);
    /*
     * **`template` 을 기다린다.** `state` 로는 안 된다 — 서버는 붙는 즉시
     * (hello 를 받기 **전에**) `state` 를 한 통 보내므로, 그것을 기다리면
     * hello 가 아직 처리되지 않은 채로 돌아온다. 그 상태로 접속 수를 세어
     * 앞 검사의 소켓이 섞인 것처럼 `output: 3` 이 나왔다.
     * `template` 은 hello 응답으로만 온다.
     */
    await peer.waitFor((msg) => msg.t === 'template', 'hello 응답');
  } else {
    await peer.waitFor((msg) => msg.t === 'state', '접속 직후 상태');
  }
  return peer;
}

/**
 * 붙어 있는 소켓이 모두 닫힐 때까지 기다린다.
 *
 * 클라이언트 쪽 `close` 만 기다리면 **서버가 아직 지우기 전**일 수 있다. 고정된
 * 시간을 두는 대신 **허브의 집계가 0 이 될 때까지** 본다 — 그래야 다음 검사의
 * 접속 수가 흔들리지 않는다 (앞 검사의 소켓 하나가 남아 `output: 3` 이 됐다).
 */
async function closeAll(): Promise<void> {
  await Promise.all(
    openPeers.splice(0).map(
      (peer) =>
        new Promise<void>((resolve) => {
          if (peer.socket.readyState === WebSocket.CLOSED) return resolve();
          peer.socket.once('close', () => resolve());
          peer.socket.close();
        }),
    ),
  );

  for (let tries = 0; tries < 100; tries++) {
    const { control, output, stage, projector } = hub.counts();
    if (control + output + stage + projector === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('소켓이 정리되지 않았다 — 다음 검사의 접속 수가 흔들린다');
}

afterEach(async () => {
  await closeAll();
  // resetStateForTest() 는 허브의 구독까지 끊는다 (머리말) — clear() 로 되돌린다
  state.clear();
  state.setBlank(false);
  warnings.length = 0;
  infos.length = 0;
});

function slide(text: string): SlidePayload {
  return { kind: 'text', lines: [text] } as unknown as SlidePayload;
}

function deckOf(...texts: string[]): Deck {
  return {
    reference: '시험 묶음',
    slides: texts.map(slide),
    labels: texts.map((_, i) => String(i + 1)),
    index: 0,
  };
}

// ─────────────────────────────────────────────────────────────
describe('붙는 즉시 스냅샷을 준다 — 새로고침 후 복구의 전제', () => {
  /**
   * OBS 브라우저 소스를 새로고침해도 화면이 돌아오는 것이 이 앱의 가장 중요한
   * 요구사항이다 (`ws.ts` 머리말). 그 전제가 이 세 통이다.
   */
  it('출력 페이지는 상태와 템플릿을 받는다', async () => {
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });
    await output.waitFor((m) => m.t === 'template', '템플릿');
    await output.waitFor((m) => m.t === 'style:patch', 'CSS 변수');

    expect(output.got('state').length).toBeGreaterThan(0);
  });

  /** hello 를 못 받아도 최소한 현재 상태는 보낸다 (구형 클라이언트·수동 접속) */
  it('hello 없이 붙어도 상태는 온다', async () => {
    const bare = await connect();
    expect(bare.got('state').length).toBeGreaterThan(0);
    // hello 를 안 보냈으므로 템플릿은 오지 않는다
    expect(bare.got('template')).toEqual([]);
  });

  /**
   * 덱은 컨트롤 패널과 **강사 모니터**만 받는다. 강사 모니터는 '다음에 무엇이
   * 오는지' 를 보여 주는 것이 존재 이유다. OBS 로 나가는 출력 페이지에 슬라이드
   * 수백 장을 예배 중에 계속 밀어 넣을 이유는 없다.
   */
  it('덱은 컨트롤과 강사 모니터에만 간다 — 출력 페이지에는 안 간다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    const stage = await connect({ t: 'hello', role: 'output', layer: 'stage' });
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });

    await control.waitFor((m) => m.t === 'deck', '컨트롤 덱');
    await stage.waitFor((m) => m.t === 'deck', '강사 모니터 덱');
    expect(output.got('deck')).toEqual([]);
  });

  /**
   * 프로젝터는 **활성 템플릿을 따르지 않는다.** OBS 가 '하단 두 줄'(카메라 위)일 때
   * 프로젝터는 '전체'(큰 글씨)여야 하고, 둘은 동시에 필요하다.
   */
  it('프로젝터는 다른 템플릿을 받는다', async () => {
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });
    const projector = await connect({ t: 'hello', role: 'output', layer: 'projector' });

    const forOutput = (await output.waitFor((m) => m.t === 'template')) as Extract<ServerMsg, { t: 'template' }>;
    const forProjector = (await projector.waitFor((m) => m.t === 'template')) as Extract<ServerMsg, { t: 'template' }>;

    expect(forProjector.payload.id).not.toBe(forOutput.payload.id);
  });
});

// ─────────────────────────────────────────────────────────────
describe('접속 수 — 틀리면 화면이 거짓을 말한다', () => {
  /**
   * 이것이 틀리면 컨트롤 화면이 'OBS 가 붙어 있다' 고 거짓을 말한다.
   * 강사 모니터·프로젝터·미리보기는 **OBS 로 나가는 화면이 아니다** — 따로 센다.
   */
  it('역할·레이어별로 나눠 센다', async () => {
    await connect({ t: 'hello', role: 'control' });
    await connect({ t: 'hello', role: 'output', layer: 'main' });
    await connect({ t: 'hello', role: 'output', layer: 'main' });
    await connect({ t: 'hello', role: 'output', layer: 'stage' });
    await connect({ t: 'hello', role: 'output', layer: 'projector' });
    await connect({ t: 'hello', role: 'output', layer: 'preview' });

    expect(hub.counts()).toEqual({ control: 1, output: 2, stage: 1, projector: 1 });
  });

  it('컨트롤 패널에 변화를 알린다 (폴링하지 않는다)', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    await connect({ t: 'hello', role: 'output', layer: 'main' });

    const msg = (await control.waitFor(
      (m) => m.t === 'connections' && m.payload.output === 1,
      '접속 수',
    )) as Extract<ServerMsg, { t: 'connections' }>;
    expect(msg.payload.control).toBe(1);
  });

  /**
   * 끊긴 화면을 계속 세면 'OBS 연결됨' 이 영영 켜진 채로 남는다.
   *
   * **집계 함수만 보면 안 된다.** 그것은 `clients` 를 그때그때 세므로, 끊길 때
   * 컨트롤 패널에 **알리는 것을 빼먹어도** 통과한다(변이 검증에서 실제로 통과했다).
   * 사람이 보는 것은 화면의 표시이므로, 컨트롤이 받는 통보까지 본다.
   */
  it('끊으면 컨트롤 화면에 줄어든 수를 알린다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });
    await control.waitFor((m) => m.t === 'connections' && m.payload.output === 1, '붙은 통보');

    // 끊기 직전 지점을 표시한다 — 붙기 전에 왔던 '0' 통보에 걸리지 않게
    const mark = control.received.length;
    await new Promise<void>((resolve) => {
      output.socket.once('close', () => resolve());
      output.close();
    });

    await control.waitFor((m) => m.t === 'connections' && m.payload.output === 0, '끊긴 통보', mark);
    expect(hub.counts().output).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────
describe('deck:load 는 문지기를 지난다', () => {
  /**
   * 이 값은 그대로 `live_state` 에 저장된다. 거대한 묶음 하나가 상태 파일을 부풀리고
   * 서버가 뜰 때마다 그것을 읽게 된다 (보안 감사 L-1).
   */
  it('정상 묶음은 통과하고 모두에게 퍼진다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });

    control.send({ t: 'deck:load', payload: deckOf('첫 장', '둘째 장') });

    await output.waitFor(
      (m) => m.t === 'state' && m.payload.slide !== null,
      '출력 페이지 상태',
    );
    expect(state.getDeck()?.slides).toHaveLength(2);
  });

  it('거부하면 보낸 쪽에 오류를 되돌려준다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    control.send({ t: 'deck:load', payload: { reference: '망가짐' } });

    const error = (await control.waitFor((m) => m.t === 'error', '거부 응답')) as Extract<
      ServerMsg,
      { t: 'error' }
    >;
    expect(error.message).toContain('묶음을 받지 않았습니다');
  });

  /**
   * **조용히 버리지 않는다.** 로그가 없으면 예배 전에 진단할 수 없다 (CLAUDE.md).
   */
  it('거부를 로그로 남긴다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    control.send({ t: 'deck:load', payload: { slides: 'x' } });
    await control.waitFor((m) => m.t === 'error', '거부 응답');

    expect(warnings.some((line) => line.includes('deck:load 거부'))).toBe(true);
  });

  it('거부된 묶음은 상태에 들어가지 않는다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    control.send({ t: 'deck:load', payload: null });
    await control.waitFor((m) => m.t === 'error', '거부 응답');

    expect(state.getDeck()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────
describe('진행 — goto · next · prev 경계', () => {
  async function loadedControl(): Promise<Peer> {
    const control = await connect({ t: 'hello', role: 'control' });
    control.send({ t: 'deck:load', payload: deckOf('1', '2', '3') });
    await control.waitFor((m) => m.t === 'state' && m.payload.slide !== null, '덱 적재');
    return control;
  }

  it('다음·이전으로 움직인다', async () => {
    const control = await loadedControl();
    control.send({ t: 'next' });
    await control.waitFor((m) => m.t === 'state' && m.payload.cursor?.slideIndex === 1, '다음');

    control.send({ t: 'prev' });
    await control.waitFor((m) => m.t === 'state' && m.payload.cursor?.slideIndex === 0, '이전');
  });

  it('goto 로 건너뛴다', async () => {
    const control = await loadedControl();
    control.send({ t: 'goto', index: 2 });
    await control.waitFor((m) => m.t === 'state' && m.payload.cursor?.slideIndex === 2, 'goto');
  });

  /**
   * 범위를 벗어난 값에 **죽지 않는다.** 예배 중 키를 잘못 눌러 서버가 내려가면
   * 그 자체가 최악의 실패다.
   */
  it('범위 밖 goto 는 무시하고 살아 있다', async () => {
    const control = await loadedControl();
    for (const index of [-1, 99, 3]) control.send({ t: 'goto', index });

    // 여전히 응답한다
    control.send({ t: 'goto', index: 1 });
    await control.waitFor((m) => m.t === 'state' && m.payload.cursor?.slideIndex === 1, '복귀');
  });

  it('마지막에서 next, 처음에서 prev 를 눌러도 죽지 않는다', async () => {
    const control = await loadedControl();
    control.send({ t: 'goto', index: 2 });
    await control.waitFor((m) => m.t === 'state' && m.payload.cursor?.slideIndex === 2);
    control.send({ t: 'next' });
    control.send({ t: 'prev' });
    control.send({ t: 'prev' });
    control.send({ t: 'prev' });

    control.send({ t: 'goto', index: 1 });
    await control.waitFor((m) => m.t === 'state' && m.payload.cursor?.slideIndex === 1, '복귀');
  });

  it('블랙 · 복구 · 비우기', async () => {
    const control = await loadedControl();

    control.send({ t: 'blank', on: true });
    await control.waitFor((m) => m.t === 'state' && m.payload.blank === true, '블랙');

    control.send({ t: 'restore' });
    await control.waitFor((m) => m.t === 'state' && m.payload.blank === false, '복구');

    control.send({ t: 'clear' });
    await control.waitFor((m) => m.t === 'state' && m.payload.slide === null, '비우기');
  });
});

// ─────────────────────────────────────────────────────────────
describe('망가진 입력에 죽지 않는다', () => {
  /** 잘못된 메시지 하나가 연결을 끊지 않는다 (`ws.ts` 머리말) */
  it('JSON 이 아니면 오류만 되돌려주고 연결은 살아 있다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    control.socket.send('{망가진');

    const error = (await control.waitFor((m) => m.t === 'error', 'JSON 오류')) as Extract<
      ServerMsg,
      { t: 'error' }
    >;
    expect(error.message).toContain('JSON');
    expect(control.socket.readyState).toBe(WebSocket.OPEN);
  });

  it('t 가 없으면 형식 오류를 알린다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    control.send({ index: 3 });

    const error = (await control.waitFor((m) => m.t === 'error')) as Extract<ServerMsg, { t: 'error' }>;
    expect(error.message).toContain('형식');
  });

  it('모르는 종류는 이름을 붙여 알려 준다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    control.send({ t: '없는종류' });

    const error = (await control.waitFor((m) => m.t === 'error')) as Extract<ServerMsg, { t: 'error' }>;
    expect(error.message).toContain('없는종류');
  });

  /** 처리 중 예외가 나도 연결을 끊지 않고 로그를 남긴다 */
  it('처리 중 실패해도 연결이 살아 있다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    // goto 는 숫자를 기대한다. 이상한 값을 넣어도 다음 메시지가 처리돼야 한다
    control.send({ t: 'goto', index: { 이상한: '값' } });
    control.send({ t: 'blank', on: true });

    await control.waitFor((m) => m.t === 'state' && m.payload.blank === true, '다음 메시지');
    expect(control.socket.readyState).toBe(WebSocket.OPEN);
  });
});

// ─────────────────────────────────────────────────────────────
describe('템플릿과 오류 전달', () => {
  it('template:set 은 모든 화면에 퍼진다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });
    const before = output.got('template').length;

    control.send({ t: 'template:set', id: -2 });
    await output.waitFor((m) => m.t === 'template' && output.got('template').length > before, '새 템플릿');
  });

  /** 없는 id 를 받으면 기본으로 떨어지되, 상태에는 **실제로 적용된** id 가 남아야 한다 */
  it('없는 id 는 기본 템플릿으로 떨어진다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    control.send({ t: 'template:set', id: 999999 });

    const msg = (await control.waitFor(
      (m) => m.t === 'template' && m.payload.id !== 999999,
      '기본 템플릿',
    )) as Extract<ServerMsg, { t: 'template' }>;
    expect(state.getState().templateId).toBe(msg.payload.id);
  });

  /**
   * 출력 페이지의 오류를 컨트롤 패널에 올려 **예배 전에** 발견하게 한다.
   * OBS 창은 아무도 안 보고 있다.
   */
  it('출력 페이지 오류가 컨트롤로 올라간다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });

    output.send({ t: 'client:error', payload: { message: '폰트를 못 읽음', url: '/output/' } });

    const msg = (await control.waitFor((m) => m.t === 'output:error', '오류 전달')) as Extract<
      ServerMsg,
      { t: 'output:error' }
    >;
    expect(msg.payload.message).toBe('폰트를 못 읽음');
    expect(warnings.some((line) => line.includes('폰트를 못 읽음'))).toBe(true);
  });

  /** 출력 페이지끼리는 서로의 오류를 받지 않는다 — 쓸 데가 없다 */
  it('출력 페이지 오류는 다른 출력 페이지로 가지 않는다', async () => {
    const other = await connect({ t: 'hello', role: 'output', layer: 'main' });
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });
    const control = await connect({ t: 'hello', role: 'control' });

    output.send({ t: 'client:error', payload: { message: '어떤 오류', url: '/output/' } });
    await control.waitFor((m) => m.t === 'output:error', '컨트롤 도착');

    expect(other.got('output:error')).toEqual([]);
  });

  it('measure:report 는 받아만 두고 죽지 않는다', async () => {
    const control = await connect({ t: 'hello', role: 'control' });
    control.send({ t: 'measure:report', payload: { anything: true } });
    control.send({ t: 'blank', on: true });
    await control.waitFor((m) => m.t === 'state' && m.payload.blank === true, '다음 메시지');
  });

  /**
   * REST 로 템플릿을 고쳐도 화면이 즉시 따라와야 한다.
   *
   * **진짜 템플릿을 쓴다.** 모양만 흉내 낸 객체를 넘겼더니 `templateToCssVars` 가
   * `anchor` 를 읽다 죽었다 — 검사가 실제 경로를 지나지 않았다는 뜻이다.
   */
  it('pushTemplate 이 모든 화면에 간다', async () => {
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });
    const before = output.got('template').length;

    hub.pushTemplate(getTemplateOrDefault(state.getState().templateId));
    await output.waitFor((m) => m.t === 'template' && output.got('template').length > before, 'pushTemplate');
  });
});

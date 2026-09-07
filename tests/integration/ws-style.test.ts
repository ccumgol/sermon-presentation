/**
 * **`style:set` 이 아무 CSS 나 화면에 넣지 못한다** (점검 S-3 · 보안 감사 L-1).
 *
 * ## 무엇을 겪었나 (2026-09-07, 격리 서버 실측)
 *
 * `style:set` 의 키를 아무것도 가리지 않았다. `{opacity:0, display:none}` 을 보내니
 * 그대로 `style:patch` 로 나가고, 출력 페이지가
 * `root.style.setProperty('display','none')` 을 해서 **송출 화면이 통째로 사라진다.**
 *
 * 더 나쁜 것은 **되돌릴 수 없다**는 점이다 — 템플릿을 다시 보내도 `--` 로 시작하는
 * 변수만 덮으므로 `display` 는 남는다. OBS 소스를 새로고침해야 한다.
 * 예배 중 검은 화면이 이 프로젝트가 꼽는 최악의 결과다.
 *
 * ## 이 파일이 `ws.ts` 의 첫 통합 검사다
 *
 * 여태 WS 허브에는 직접 검사가 없었다(`ws.ts` 379줄). 그래서 실제 소켓을 띄워
 * **정당한 키는 그대로 가고 나쁜 키만 빠지는지**를 양쪽에서 본다.
 */

import type { AddressInfo } from 'node:net';

import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import { createWsHub, type WsHub } from '../../server/ws.ts';
import type { ServerMsg } from '../../shared/types.ts';

let app: FastifyInstance;
let hub: WsHub;
let port: number;
const warnings: string[] = [];

beforeAll(async () => {
  const built = await buildApp({ getPort: () => port });
  app = built.app;
  // 포트 0 = 비어 있는 포트를 커널이 골라 준다. 사용자의 7777 을 건드리지 않는다
  await app.listen({ port: 0, host: '127.0.0.1' });
  port = (app.server.address() as AddressInfo).port;

  hub = createWsHub(app.server, {
    info: () => undefined,
    warn: (msg) => warnings.push(msg),
  });
});

afterAll(async () => {
  hub.close();
  await app.close();
});

function connect(hello: Record<string, unknown>): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.on('open', () => {
      socket.send(JSON.stringify(hello));
      resolve(socket);
    });
    socket.on('error', reject);
  });
}

/** 출력 페이지가 받는 다음 `style:patch` 하나 */
function nextStylePatch(socket: WebSocket, timeoutMs = 3000): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('style:patch 가 오지 않았다')), timeoutMs);
    const onMessage = (raw: unknown): void => {
      const msg = JSON.parse(String(raw)) as ServerMsg;
      if (msg.t !== 'style:patch') return;
      clearTimeout(timer);
      socket.off('message', onMessage);
      resolve(msg.payload as Record<string, string>);
    };
    socket.on('message', onMessage);
  });
}

describe('style:set 은 키를 가려 받는다', () => {
  it('진짜 CSS 속성은 출력 페이지까지 가지 않는다', async () => {
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });
    const control = await connect({ t: 'hello', role: 'control' });
    try {
      // 접속 직후 서버가 보내는 템플릿 패치를 먼저 흘려보낸다 (없어도 넘어간다)
      await nextStylePatch(output, 300).catch(() => undefined);

      const waiting = nextStylePatch(output);
      control.send(
        JSON.stringify({
          t: 'style:set',
          patch: {
            '--primary-size': '80px', // 정당한 값
            backdrop: '', // 정당한 값 (요소를 만들어야 해서 변수가 아니다)
            opacity: '0', // ★ 글자를 지운다
            display: 'none', // ★ 화면을 통째로 지운다
            position: 'fixed',
          },
        }),
      );

      const patch = await waiting;
      expect(patch['--primary-size']).toBe('80px');
      expect(patch).toHaveProperty('backdrop');
      for (const blocked of ['opacity', 'display', 'position']) {
        expect(patch, `${blocked} 가 출력 페이지로 갔다`).not.toHaveProperty(blocked);
      }
    } finally {
      output.close();
      control.close();
    }
  });

  it('버린 키를 로그로 알린다 — 조용히 버리면 진단할 수 없다', () => {
    expect(warnings.some((line) => line.includes('display'))).toBe(true);
  });

  it('정당한 편집은 그대로 통한다 (여기가 막히면 템플릿 편집이 죽는다)', async () => {
    const output = await connect({ t: 'hello', role: 'output', layer: 'main' });
    const control = await connect({ t: 'hello', role: 'control' });
    try {
      await nextStylePatch(output, 300).catch(() => undefined);

      const waiting = nextStylePatch(output);
      control.send(
        JSON.stringify({
          t: 'style:set',
          patch: { '--primary-color': '#ff0000', '--primary-weight': '700', anchor: 'bottom-center' },
        }),
      );

      const patch = await waiting;
      expect(patch).toEqual({
        '--primary-color': '#ff0000',
        '--primary-weight': '700',
        anchor: 'bottom-center',
      });
    } finally {
      output.close();
      control.close();
    }
  });
});

/**
 * Fastify 앱 구성. 실행(listen)과 분리해 테스트에서 그대로 주입할 수 있게 한다.
 *
 * 성경 DB 가 없어도 앱은 뜬다 — 안내 화면을 띄워야 하고,
 * 예배 직전 기동 실패로 아무것도 못 하는 상황을 만들지 않는다.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';

import { DEFAULT_PRIMARY_TRANSLATION, IS_LAN_OPEN } from './config.ts';
import { initAppDb } from './db/app.ts';
import { initPlanStore, countPlans } from './db/plans.ts';
import { initReadingStore } from './db/readings.ts';
import { initSongsDb, countSongs } from './db/songs.ts';
import { initTemplateStore, getTemplateOrDefault } from './db/templates.ts';
import { BibleDbMissingError, initBibleDb, listTranslations } from './db/bible.ts';
import { lanHosts, lanInterfaces } from './lan.ts';
import { ensureDataDirs, paths } from './paths.ts';
import {
  SESSION_COOKIE, isAuthExemptPath, isLoopbackAddress, isTrustedAddress, parseTrustedIps,
  readCookie, wantsHtml,
} from '../lib/lan-auth.ts';
import { verifySession } from './auth.ts';
import { registerLoginRoutes } from './routes/login.ts';
import { registerTabletRoutes } from './routes/tablet.ts';
import { registerBibleRoutes } from './routes/bible.ts';
import { registerBackgroundRoutes } from './routes/backgrounds.ts';
import { registerBackupRoutes } from './routes/backup.ts';
import { registerPlanRoutes } from './routes/plans.ts';
import { registerReadingRoutes } from './routes/readings.ts';
import { registerSongbookRoutes } from './routes/songbooks.ts';
import { registerSongRoutes } from './routes/songs.ts';
import { registerTemplateRoutes } from './routes/templates.ts';
import { getState, initState } from './state.ts';
import type { Template } from '../shared/types.ts';

export interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
  /** 템플릿이 바뀌면 송출 화면에 즉시 반영하기 위한 콜백 (WS 허브가 넣는다) */
  onTemplateChanged?: (template: Template) => void;
  /** 실제 바인딩된 포트를 알려주는 접근자. /api/info 가 사용한다. */
  getPort: () => number;
  /** WS 접속 수 접근자. 허브가 붙기 전에는 0 을 돌려준다. */
  getConnections?: () => { control: number; output: number };
}

export interface BuiltApp {
  app: FastifyInstance;
  bibleReady: boolean;
  stateRestored: { restored: boolean; corrupt: boolean };
}

export async function buildApp(options: BuildAppOptions): Promise<BuiltApp> {
  const app = Fastify({
    logger: options.logger ?? false,
    // 요청 로그를 끈다. 예배 중 터미널에는 실제로 봐야 할 경고만 남아야 한다.
    // 디버깅이 필요하면 LOG_LEVEL=debug 로 켠다.
    //
    // Fastify 6 에서 logController 로 대체될 예정이라 기동 시 폐기 경고가 한 번 뜬다.
    // logController 는 10개 속성을 모두 요구해 부분 지정이 안 되므로,
    // Fastify 6 으로 올릴 때 함께 옮긴다.
    disableRequestLogging: process.env.LOG_LEVEL !== 'debug',
  });

  ensureDataDirs();
  initAppDb();
  initTemplateStore();
  initPlanStore();
  initReadingStore();
  initSongsDb();

  let bibleReady = false;
  try {
    initBibleDb();
    bibleReady = true;
  } catch (err) {
    if (err instanceof BibleDbMissingError) {
      app.log.error(err.message);
    } else {
      throw err;
    }
  }

  const stateRestored = initState();

  /**
   * ── 접속 암호 (보안 감사 권고 4) ─────────────────────────────
   *
   * **이 PC 에서 온 요청은 그대로 통과시키고 LAN 요청만 암호를 묻는다.**
   * 안전 때문이 아니라 예배가 멈추지 않게 하기 위한 구분이다 — OBS 브라우저 소스는
   * 암호를 입력할 수 없고, 오퍼레이터의 패널도 예배 직전에 암호를 물으면 안 된다.
   * 자세한 근거는 `lib/lan-auth.ts` 머리말.
   *
   * LAN 이 닫혀 있으면(기본) 모든 요청이 루프백이라 이 훅은 아무 일도 하지 않는다.
   */
  const trustedIps = parseTrustedIps(process.env.SERMON_TRUSTED_IPS);
  app.addHook('onRequest', async (request, reply) => {
    if (isLoopbackAddress(request.ip)) return;
    if (isTrustedAddress(request.ip, trustedIps)) return;
    if (isAuthExemptPath(request.url)) return;
    if (verifySession(readCookie(request.headers.cookie, SESSION_COOKIE))) return;

    // 사람이 보는 화면이면 로그인으로 보낸다. API·WS 에 HTML 을 주면 안 된다.
    if (wantsHtml(request.headers.accept)) {
      return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`, 302);
    }
    return reply
      .code(401)
      .send({ success: false, data: null, error: '접속 암호가 필요합니다. /login 에서 넣으세요.' });
  });

  // ── 정적 파일 ────────────────────────────────────────────────
  await app.register(fastifyStatic, {
    root: paths.publicDir,
    prefix: '/',
    // '/' 는 아래에서 직접 처리한다 (컨트롤 패널 빌드 여부에 따라 갈린다)
    index: false,
    /**
     * 캐시 정책을 명시한다.
     *
     * `cacheControl: false` 는 헤더를 '생략'할 뿐이어서, Last-Modified 만 있으면
     * 브라우저가 휴리스틱 캐싱으로 오래된 파일을 재검증 없이 쓴다.
     * 실제로 이 때문에 갱신된 output.js 가 반영되지 않는 문제를 겪었다.
     *
     * 출력 페이지는 예배 중 새로고침으로 즉시 최신 파일을 받아야 하므로 no-store.
     * Vite 산출물은 파일명에 해시가 있어 영구 캐시가 안전하다.
     */
    setHeaders(res, pathName) {
      const normalized = pathName.split(path.sep).join('/');
      if (normalized.includes('/app/assets/')) {
        res.header('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.header('Cache-Control', 'no-store, must-revalidate');
      }
    },
  });

  /**
   * 배경 그림·동영상. `data/` 안이라 public 밖에 있으므로 따로 붙인다.
   * 이 폴더만 열어 주고, 파일 이름 검증은 배경 라우트가 맡는다.
   *
   * decorateReply: false — sendFile 데코레이터는 위에서 이미 붙였다(두 번 붙이면 기동 실패).
   */
  await app.register(fastifyStatic, {
    root: paths.backgroundsDir,
    prefix: '/backgrounds/',
    decorateReply: false,
    index: false,
    // 배경은 자주 바뀌지 않지만, 같은 이름으로 덮어썼을 때 옛 파일이 남으면
    // '바꿨는데 그대로'가 되므로 재검증하게 둔다
    setHeaders(res) {
      res.header('Cache-Control', 'no-cache, must-revalidate');
    },
  });

  /**
   * 사용자가 모아 둔 배경 그림 폴더 (`~/Desktop/Data/Background`).
   *
   * **읽기만 한다** — 올리기·삭제·총량 상한은 `data/backgrounds/` 쪽 얘기다.
   * 폴더가 없을 수도 있으므로(다른 PC 에 설치했을 때) 있을 때만 붙인다.
   * 없는데 붙이면 기동이 실패해 예배 준비 자체가 막힌다.
   */
  if (existsSync(paths.backgroundSourceDir)) {
    await app.register(fastifyStatic, {
      root: paths.backgroundSourceDir,
      prefix: '/background-library/',
      decorateReply: false,
      index: false,
      setHeaders(res) {
        res.header('Cache-Control', 'no-cache, must-revalidate');
      },
    });
  }

  const controlPanelBuilt = existsSync(path.join(paths.publicDir, 'app', 'index.html'));

  /**
   * 루트는 컨트롤 패널을 띄운다. 아직 빌드되지 않았다면 안내 페이지로 넘겨
   * '무엇을 실행해야 하는지' 알려준다 — 빈 404 는 처음 설치한 사람을 막는다.
   */
  app.get('/', async (_request, reply) =>
    controlPanelBuilt ? reply.sendFile('app/index.html') : reply.sendFile('index.html'),
  );

  // index:false 로 두었으므로 디렉터리 경로의 index.html 은 직접 연결한다.
  // OBS 가 요청하는 '/output/' 이 여기 걸린다.
  app.get('/output/', async (_request, reply) => reply.sendFile('output/index.html'));

  /**
   * 강사 모니터. OBS 를 거치지 않고 **우리가 직접 띄우는 창**이다 —
   * 설교자 앞 모니터에 전체화면으로 둔다 (2026-08-18, (다)).
   */
  app.get('/stage/', async (_request, reply) => reply.sendFile('stage/index.html'));
  app.get('/stage', async (_request, reply) => reply.redirect('/stage/'));

  /**
   * 프로젝터 화면. 강사 모니터처럼 **우리가 직접 띄우는 창**이지만, 보여 주는 것은
   * 회중용 내용이다 — TV 가 아니라 프로젝터로 띄울 때 쓴다 (2026-08-20 사용자).
   *
   * 출력 페이지의 렌더러를 그대로 쓴다. `public/projector/index.html` 이
   * `/output/output.js` 를 불러오므로, 여기서 따로 줄 것이 없다.
   */
  app.get('/projector/', async (_request, reply) => reply.sendFile('projector/index.html'));
  app.get('/projector', async (_request, reply) => reply.redirect('/projector/'));
  app.get('/app/', async (_request, reply) => reply.sendFile('app/index.html'));

  // 파비콘 요청으로 로그가 지저분해지지 않게 조용히 넘긴다
  app.get('/favicon.ico', async (_request, reply) => reply.code(204).send());

  // ── API ──────────────────────────────────────────────────────
  app.get('/health', async () => ({ ok: true, uptime: process.uptime(), bibleReady }));

  app.get('/api/info', async () => ({
    success: true,
    data: {
      port: options.getPort(),
      outputUrl: `http://localhost:${options.getPort()}/output/?layer=main`,
      controlUrl: `http://localhost:${options.getPort()}/`,
      wsUrl: `ws://localhost:${options.getPort()}/ws`,
      // LAN 에 열려 있을 때만 태블릿 주소를 준다. 닫혀 있는데 주소를 보여 주면
      // '주소는 있는데 접속이 안 된다' 가 된다.
      lanAddresses: IS_LAN_OPEN ? lanHosts().map((h) => `http://${h}:${options.getPort()}/`) : [],
      lanOpen: IS_LAN_OPEN,
      dataDir: paths.dataDir,
      bibleSourceDir: paths.bibleSourceDir,
      bibleReady,
      translationCount: bibleReady ? listTranslations().length : 0,
      songCount: countSongs(),
      planCount: countPlans(),
      defaultTranslation: DEFAULT_PRIMARY_TRANSLATION,
      connections: options.getConnections?.() ?? { control: 0, output: 0 },
    },
    error: null,
  }));

  registerLoginRoutes(app);
  registerTabletRoutes(app, options.getPort);
  await registerSongRoutes(app);
  await registerSongbookRoutes(app);
  await registerPlanRoutes(app);
  await registerReadingRoutes(app);
  await registerBackupRoutes(app);
  await registerBackgroundRoutes(app);

  await registerTemplateRoutes(app, {
    onTemplateChanged: (template) => options.onTemplateChanged?.(template),
    currentTemplateId: () => getState().templateId,
  });

  app.get('/api/template/current', async () => ({
    success: true,
    data: getTemplateOrDefault(getState().templateId),
    error: null,
  }));

  if (bibleReady) {
    await registerBibleRoutes(app, DEFAULT_PRIMARY_TRANSLATION);
  } else {
    app.get('/api/bible/*', async (_request, reply) =>
      reply.code(503).send({
        success: false,
        data: null,
        error: `성경 DB 가 없습니다 (${paths.bibleDb}). 'npm run bible:build' 를 실행하세요.`,
      }),
    );
  }

  return { app, bibleReady, stateRestored };
}

// `lanHosts`·`lanInterfaces` 는 server/lan.ts 로 옮겼다. 기존 import 를 위해 다시 내보낸다.
export { lanHosts, lanInterfaces };

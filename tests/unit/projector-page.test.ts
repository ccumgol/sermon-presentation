/**
 * 프로젝터 화면은 출력 페이지의 렌더러를 **그대로 다시 쓴다.**
 *
 * output.js 는 1044줄이고 성경·찬양·교독문·전례문 렌더러가 모두 들어 있다.
 * 복제하면 두 곳이 갈라진다 — 한쪽만 고친 것을 예배 중에 알게 된다.
 *
 * 그래서 이 테스트는 **파일을 읽어** 재사용 규칙이 깨지지 않았는지 본다.
 * 출력 페이지는 의존성 0 이라 import 할 수 없으므로 이 방법밖에 없다
 * (같은 이유로 output.js 의 다른 규칙들도 파일을 읽어 고정해 두었다).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROJECTOR_LAYER } from '../../lib/projector-view.ts';

const ROOT = path.join(import.meta.dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const OUTPUT_JS = read('public/output/output.js');
const PAGE = read('public/projector/index.html');
const PROJECTOR_JS = read('public/projector/projector.js');

describe('출력 렌더러를 다시 쓴다', () => {
  it('페이지가 /output/output.js 를 불러온다 — 렌더러를 복제하지 않는다', () => {
    expect(PAGE).toContain('/output/output.js');
  });

  it('페이지가 /output/output.css 를 불러온다', () => {
    expect(PAGE).toContain('/output/output.css');
  });

  it('출력 페이지와 같은 DOM id 를 갖는다 — output.js 가 이 id 로 찾는다', () => {
    for (const id of ['backdrop', 'stage', 'slide', 'blocks', 'heading', 'reference', 'credit']) {
      expect(PAGE, `#${id} 가 없으면 output.js 가 조용히 렌더를 멈춘다`).toContain(`id="${id}"`);
    }
  });

  it('렌더러를 복제하지 않았다 — projector.js 에 렌더 함수가 없다', () => {
    expect(PROJECTOR_JS).not.toContain('function renderBible');
    expect(PROJECTOR_JS).not.toContain('function renderSong');
  });
});

describe('layer 는 경로에서 정한다', () => {
  it("output.js 가 '/projector' 경로를 보고 layer 를 정한다", () => {
    expect(OUTPUT_JS).toContain("location.pathname.indexOf('/projector')");
    expect(OUTPUT_JS).toContain(`'${PROJECTOR_LAYER}'`);
  });

  it('쿼리 파라미터에만 의존하지 않는다 — 즐겨찾기에서 빠지면 OBS 로 집계된다', () => {
    expect(OUTPUT_JS).toContain("params.get('layer') || pathLayer");
  });
});

describe('요청대로 지운 것들', () => {
  it('시계·다음 화면·연결 상태·글자 크기 라벨이 없다', () => {
    for (const gone of ['clock', 'next-wrap', 'id="conn"', '다음 화면', '연결 중']) {
      expect(PAGE, `'${gone}' 이 남아 있다 — 요청은 전부 삭제였다`).not.toContain(gone);
    }
  });

  it('막대는 평소에 숨는다 (hidden 속성으로 시작)', () => {
    expect(PAGE).toMatch(/id="bar"[^>]*hidden/);
  });
});

describe('주소줄을 없애는 길이 열려 있다', () => {
  /*
   * 사용자가 스크린샷으로 제목줄·출처줄을 표시하며 물었다 (2026-08-20).
   * 웹페이지가 브라우저 크롬을 지울 방법은 없다 — 전체 화면과 '앱으로 설치' 뿐이다.
   * 그 두 길이 **찾을 수 있게** 열려 있는지 고정한다.
   */
  it('화면을 클릭하면 전체 화면으로 들어간다 — F 를 몰라도 된다', () => {
    expect(PROJECTOR_JS).toContain("document.addEventListener('click'");
    expect(PROJECTOR_JS).toContain('enterFull');
  });

  it('막대를 누른 클릭으로는 들어가지 않는다 — 조작이 전체 화면을 부르면 안 된다', () => {
    expect(PROJECTOR_JS).toContain('el.bar.contains(event.target)');
  });

  it('클릭으로 나가지는 않는다 — 예배 중 실수로 창이 드러나면 안 된다', () => {
    const handler = PROJECTOR_JS.slice(PROJECTOR_JS.indexOf("document.addEventListener('click'"));
    expect(handler.slice(0, handler.indexOf('});'))).not.toContain('exitFullscreen');
  });

  it('전체 화면 선택을 기억한다 — 매주 F 를 찾지 않아도 된다', () => {
    expect(PROJECTOR_JS).toContain('sermon.projector.fullscreen');
  });

  it('마우스 이동으로는 자동 전체화면을 시도하지 않는다 — 브라우저가 거절한다', () => {
    // autoFullOnce 는 click·keydown 에만 걸려 있어야 한다
    const auto = PROJECTOR_JS.split('autoFullOnce()');
    expect(auto.length).toBeGreaterThan(2);
    expect(PROJECTOR_JS).not.toMatch(/mousemove['"]?\s*,\s*autoFullOnce/);
  });

  it("'앱으로 설치' 매니페스트를 걸어 둔다 — 설치판은 주소줄이 없다", () => {
    expect(PAGE).toContain('rel="manifest"');
    const manifest = JSON.parse(read('public/projector/manifest.webmanifest'));
    expect(manifest.display_override).toContain('fullscreen');
    expect(manifest.start_url).toBe('/projector/');
    // 크롬이 설치를 제안하려면 192·512 아이콘이 있어야 한다
    expect(manifest.icons.map((i: { sizes: string }) => i.sizes).sort()).toEqual(['192x192', '512x512']);
  });

  it('아이콘 파일이 실제로 있고 PNG 다', () => {
    for (const size of [192, 512]) {
      const buf = readFileSync(path.join(ROOT, `public/projector/icon-${size}.png`));
      expect(buf.subarray(1, 4).toString('ascii'), `icon-${size}.png 가 PNG 가 아니다`).toBe('PNG');
    }
  });
});

describe('순서 표시 제목이 고른 크기로 나간다', () => {
  /*
   * 자동 리듬은 서버 템플릿에서 끈다(`projector-view.test.ts`). 하지만 사람이 손으로
   * 맞춘 글자별 조정은 렌더러가 **인라인**으로 박으므로 CSS 로만 막을 수 있다.
   * 실제로 사용자 순서표의 '찬양과경배' 가 그랬다 (2026-08-20).
   */
  const CSS = read('public/projector/projector.css');

  it('글자별 인라인 크기를 첫 글자 크기로 되돌린다', () => {
    expect(CSS).toMatch(/body\.projector \.rhythm-char\s*{[^}]*font-size:\s*1em\s*!important/);
  });

  it('높낮이 흔들림도 되돌린다', () => {
    expect(CSS).toMatch(/body\.projector \.rhythm-char\s*{[^}]*transform:\s*none\s*!important/);
  });
});

describe('막대에 있어야 하는 것', () => {
  it('글자 크기 +/- · 반전 · 전체 화면', () => {
    for (const id of ['zoom-out', 'zoom-in', 'invert', 'full']) {
      expect(PAGE).toContain(`id="${id}"`);
    }
  });

  it('넘침을 알리는 자리가 있다 — autoFit 을 껐으므로 사람이 알아야 한다', () => {
    expect(PAGE).toContain('id="overflow"');
  });
});

/**
 * **출력 페이지에도 같은 스타일 키 규칙이 있어야 한다** (점검 S-3 · 감사 L-1).
 *
 * `lib/template-css.ts` 의 `isAllowedStyleKey` 와 짝이다. 출력 페이지는 의존성 0
 * 이라(OBS 내장 브라우저 대비) 그 함수를 가져다 쓸 수 없어 규칙이 양쪽에 있다 —
 * 서버만 고치고 여기를 잊으면, 다른 경로로 온 값이 그대로 화면에 들어간다.
 *
 * import 할 수 없으므로 **파일을 읽어** 확인한다 (이 파일의 다른 검사들과 같은 방법).
 */
describe('출력 페이지가 스타일 키를 가려 받는다', () => {
  it('허용 판정 함수가 있다', () => {
    expect(OUTPUT_JS).toContain('function isAllowedStyleKey');
  });

  it('`--` 로 시작하는 키 + backdrop · anchor 만 받는다', () => {
    const rule = /function isAllowedStyleKey\(key\) \{\s*return ([^;]+);/.exec(OUTPUT_JS);
    expect(rule, 'isAllowedStyleKey 의 본문을 찾지 못했다').not.toBeNull();
    const body = rule![1]!;
    expect(body).toContain("key.indexOf('--') === 0");
    expect(body).toContain("key === 'backdrop'");
    expect(body).toContain("key === 'anchor'");
  });

  it('setProperty 앞에서 그 판정을 실제로 쓴다 — 함수만 두면 소용없다', () => {
    const patchFn = OUTPUT_JS.slice(
      OUTPUT_JS.indexOf('function applyStylePatch'),
      OUTPUT_JS.indexOf('function applyBackdropFromString'),
    );
    expect(patchFn).toContain('if (!isAllowedStyleKey(key))');
    // 판정이 setProperty 보다 앞에 있어야 한다
    expect(patchFn.indexOf('isAllowedStyleKey(key)')).toBeLessThan(patchFn.indexOf('setProperty'));
  });

  it('버린 키를 조작 화면으로 올린다 — 화면에는 아무것도 그리지 않는다', () => {
    const patchFn = OUTPUT_JS.slice(
      OUTPUT_JS.indexOf('function applyStylePatch'),
      OUTPUT_JS.indexOf('function applyBackdropFromString'),
    );
    expect(patchFn).toContain('pendingErrors.push');
  });
});

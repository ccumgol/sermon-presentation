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

/**
 * **배경 폴더를 훑는 길** — 슬라이드쇼가 가리킬 폴더와 그 안의 그림.
 *
 * ## 왜 이 검사가 필요한가
 *
 * 있던 검사(`background-api.test.ts`)는 **목록 API 의 모양**만 봤다. 실제로 폴더에
 * 무엇이 있을 때 무엇이 나오는지는 이 PC 에 무엇이 깔려 있느냐에 달려 있어서,
 * 2026-09-09 실측에서 `routes/backgrounds.ts` 는 **분기 51.1%** 였다.
 *
 * 밟히지 않은 것 중에 이런 것이 있었다:
 *
 * - `listSlideshow` 의 **경로 이탈 막이** (`../` 로 다른 폴더를 들여다보는 것)
 * - 폴더 안의 폴더 · 그림 아닌 파일 · 숨김 파일
 * - 뿌리에 그림이 있을 때 `name: ''` 을 함께 주는 것 (없으면 '고장났다' 로 보인다)
 *
 * ## 진짜 폴더를 만든다
 *
 * 이 코드는 파일시스템을 읽는 것이 전부라 흉내로는 아무것도 확인하지 못한다.
 * **검사용 데이터 폴더**(`.test-data/backgrounds`) 안에만 만들고 끝나면 지운다 —
 * 사용자가 모아 둔 `~/Desktop/Data/Background` 는 읽기 전용이라 손대지 않는다.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../../server/app.ts';
import {
  listBackgroundFolders,
  listBackgrounds,
  listSlideshow,
} from '../../server/routes/backgrounds.ts';
import { paths } from '../../server/paths.ts';
import type { ApiResponse } from '../../shared/types.ts';

let app: FastifyInstance;

/** 이 검사가 만든 것만 지우기 위한 이름표 */
const MARK = 'zz-test-bg';
const root = paths.backgroundsDir;

function put(relative: string, bytes = 3): void {
  const full = path.join(root, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, Buffer.alloc(bytes));
}

beforeAll(async () => {
  app = (await buildApp({ getPort: () => 7777 })).app;
  await app.ready();

  mkdirSync(root, { recursive: true });

  // 뿌리에 놓인 그림 — 하위 폴더를 안 만든 사람의 경우
  put(`${MARK}-loose.jpg`, 11);

  // 한 폴더 안에 그림 · 그림 아닌 것 · 숨김 파일 · 폴더 안의 폴더
  put(`${MARK}-예배/bg_2.png`);
  put(`${MARK}-예배/bg_10.png`);
  put(`${MARK}-예배/bg_1.PNG`); // 대문자 확장자도 그림이다
  put(`${MARK}-예배/메모.txt`);
  put(`${MARK}-예배/영상.mp4`);
  put(`${MARK}-예배/.DS_Store`);
  /*
   * **확장자가 그림인 숨김 파일.** 맥이 USB·네트워크 드라이브에 자동으로 만드는
   * AppleDouble 짝(`._bg_1.png`)이 이 모양이다. 확장자만 보면 그림이라 걸러지지
   * 않는다 — 숨김 판정이 따로 있어야 목록에 유령이 생기지 않는다.
   */
  put(`${MARK}-예배/._bg_1.png`);
  /*
   * **이름이 그림인 폴더.** 확장자만 보면 그림이므로 `statSync` 로 파일인지
   * 확인하지 않으면 폴더가 배경 목록에 들어가고, 골라서 송출하면 그림이 안 뜬다.
   */
  mkdirSync(path.join(root, `${MARK}-예배`, '폴더인데.jpg'), { recursive: true });
  put(`${MARK}-예배/더 안쪽/깊은.jpg`);
  /* 주소에 그대로 쓰면 깨지는 이름 — 공백과 한글 */
  put(`${MARK}-이름/배경 사진 01.jpg`);

  // 그림이 한 장도 없는 폴더
  mkdirSync(path.join(root, `${MARK}-빈폴더`), { recursive: true });
  put(`${MARK}-빈폴더/설명.txt`);

  // 숨김 폴더
  put(`.${MARK}-숨김/bg.jpg`);
});

afterAll(async () => {
  for (const name of [
    `${MARK}-loose.jpg`,
    `${MARK}-예배`,
    `${MARK}-이름`,
    `${MARK}-빈폴더`,
    `.${MARK}-숨김`,
  ]) {
    rmSync(path.join(root, name), { recursive: true, force: true });
  }
  await app.close();
});

const mine = <T extends { name: string }>(items: T[]): T[] =>
  items.filter((one) => one.name.includes(MARK));

describe('폴더 목록', () => {
  it('그림이 든 폴더만 준다 — 빈 폴더·숨김 폴더는 뺀다', () => {
    const names = mine(listBackgroundFolders().data).map((one) => one.name);
    expect(names).toContain(`${MARK}-예배`);
    expect(names).not.toContain(`${MARK}-빈폴더`);
    expect(names).not.toContain(`.${MARK}-숨김`);
  });

  /** 1장이면 걸어 두고 여럿이면 넘어간다 — 사람이 고를 때 그것이 판단 근거다 */
  it('몇 장인지 함께 준다 — 그림만 센다', () => {
    const folder = listBackgroundFolders().data.find((one) => one.name === `${MARK}-예배`);
    // bg_1.PNG · bg_2.png · bg_10.png = 3장.
    // txt · mp4 · 숨김(.DS_Store · ._bg_1.png) · 하위 폴더(더 안쪽 · 폴더인데.jpg)는 빼고
    expect(folder?.count).toBe(3);
  });

  /**
   * 하위 폴더를 하나도 안 만든 사람에게 빈 목록만 주면 '고장났다' 로 보인다
   * (2026-08-30 실제로 그랬다 — 하위 폴더 0개, 뿌리에 13장).
   */
  it('뿌리에 그림이 있으면 뿌리도 고를 수 있게 준다', () => {
    const folders = listBackgroundFolders().data;
    expect(folders[0]?.name).toBe('');
    expect(folders[0]?.count).toBeGreaterThan(0);
  });
});

describe('한 폴더의 그림', () => {
  it('bg_1 · bg_2 · bg_10 순서다 (문자열 비교면 bg_10 이 bg_2 앞에 온다)', () => {
    const names = listSlideshow('data', `${MARK}-예배`).map((one) => one.name);
    expect(names).toEqual(['bg_1.PNG', 'bg_2.png', 'bg_10.png']);
  });

  it('그림이 아닌 것 · 숨김 파일 · 폴더는 빼고 준다', () => {
    const names = listSlideshow('data', `${MARK}-예배`).map((one) => one.name);
    for (const skipped of ['메모.txt', '영상.mp4', '.DS_Store', '._bg_1.png', '폴더인데.jpg', '더 안쪽']) {
      expect(names, skipped).not.toContain(skipped);
    }
  });

  it('용량과 출력 페이지가 쓸 주소를 함께 준다', () => {
    const [first] = listSlideshow('data', `${MARK}-예배`);
    expect(first!.bytes).toBe(3);
    expect(first!.url).toBe(`/backgrounds/${encodeURIComponent(`${MARK}-예배`)}/bg_1.PNG`);
  });

  /**
   * 주소는 출력 페이지가 **그대로 `url()` 에 넣는다.** 공백이나 한글이 날것으로
   * 들어가면 그 배경만 조용히 안 뜬다 — 예배 중에는 검은 화면으로 보인다.
   * 폴더 이름과 파일 이름 **양쪽 다** 인코딩되어야 한다.
   */
  it('공백·한글이 든 이름도 주소로 쓸 수 있다', () => {
    const [only] = listSlideshow('data', `${MARK}-이름`);
    expect(only!.name).toBe('배경 사진 01.jpg');
    expect(only!.url).toBe(
      `/backgrounds/${encodeURIComponent(`${MARK}-이름`)}/${encodeURIComponent('배경 사진 01.jpg')}`,
    );
    expect(only!.url).not.toContain(' ');
    expect(only!.url).not.toContain('배경');
  });

  it('폴더 이름이 비면 뿌리를 본다', () => {
    expect(mine(listSlideshow('data', '')).map((one) => one.name)).toEqual([`${MARK}-loose.jpg`]);
    // `listBackgrounds()` 도 같은 것을 본다
    expect(mine(listBackgrounds()).map((one) => one.name)).toEqual([`${MARK}-loose.jpg`]);
  });

  it('없는 폴더는 빈 목록 — 던지지 않는다', () => {
    expect(listSlideshow('data', '있지도-않은-폴더')).toEqual([]);
  });
});

/**
 * **이 검사가 이 파일의 핵심이다.**
 *
 * 폴더 이름은 화면이 보낸 문자열이고 이 앱은 LAN 에도 열린다. 그대로 이어 붙이면
 * `../../` 로 데이터 폴더 밖을 들여다보게 된다 — 배경 목록이 곧 파일 탐색기가 된다.
 *
 * 부르는 쪽이 이미 걸렀다고 보지 않는다. 두 곳에서 따로 막으면 한쪽이 뒤처진다.
 */
describe('폴더 밖을 들여다보지 못한다', () => {
  it('경로 구분자가 든 이름은 빈 목록', () => {
    for (const bad of ['../..', '../../..', 'a/b', '..\\..', 'a\\b', '/etc', `${MARK}-예배/더 안쪽`]) {
      expect(listSlideshow('data', bad), bad).toEqual([]);
      expect(listSlideshow('library', bad), bad).toEqual([]);
    }
  });

  it('숨김 폴더도 빈 목록', () => {
    expect(listSlideshow('data', `.${MARK}-숨김`)).toEqual([]);
  });
});

describe('슬라이드쇼 API', () => {
  async function slideshow(query: string) {
    const res = await app.inject({ method: 'GET', url: `/api/backgrounds/slideshow${query}` });
    return res.json() as ApiResponse<{ source: string; folder: string; files: Array<{ name: string }> }>;
  }

  it('폴더의 그림을 준다', async () => {
    const body = await slideshow(`?source=data&folder=${encodeURIComponent(`${MARK}-예배`)}`);
    expect(body.success).toBe(true);
    expect(body.data!.source).toBe('data');
    expect(body.data!.files.map((one) => one.name)).toEqual(['bg_1.PNG', 'bg_2.png', 'bg_10.png']);
  });

  /** 무엇을 보고 있는지 돌려줘야 화면이 고른 것과 받은 것을 맞춰 볼 수 있다 */
  it('모르는 출처는 library 로 본다 — 데이터 폴더를 기본으로 삼지 않는다', async () => {
    for (const query of ['', '?source=지어낸것', '?source=DATA']) {
      expect((await slideshow(query)).data!.source, query).toBe('library');
    }
  });

  it('폴더를 안 주면 뿌리다', async () => {
    const body = await slideshow('?source=data');
    expect(body.data!.folder).toBe('');
    expect(body.data!.files.some((one) => one.name === `${MARK}-loose.jpg`)).toBe(true);
  });

  it('API 로도 폴더 밖을 들여다보지 못한다', async () => {
    const body = await slideshow('?source=data&folder=..%2F..');
    expect(body.data!.files).toEqual([]);
  });
});

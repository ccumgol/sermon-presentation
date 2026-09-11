/**
 * **템플릿의 그림 배경이 어느 폴더에서 왔는지 채우는 이주** (2026-09-11 버그 수정).
 *
 * ## 무엇이 잘못됐었나
 *
 * 템플릿의 그림 배경은 **파일 이름만** 담았다. 고르는 목록은 두 폴더를 함께 보여
 * 주는데(`~/Desktop/Data/Background` 와 `data/backgrounds/`), 출력 페이지는 주소를
 * 늘 `/backgrounds/` 로 만들었다. 그래서 **내 배경 폴더에서 고른 그림은 404 가 나고
 * 배경이 조용히 사라졌다** — 데이터 폴더를 안 쓰는 사용자에게는 한 번도 뜬 적이 없다.
 *
 * ## 이 검사가 지키는 것
 *
 * 이주는 **사용자가 저장한 템플릿을 고쳐 쓴다.** 잘못 채우면 예배 화면의 배경이
 * 엉뚱해지고, 사람은 '왜 안 뜨지' 만 보게 된다. 그래서 네 갈래를 못 박는다.
 *
 * | 파일이 어디 있나 | 무엇으로 채우나 | 왜 |
 * |---|---|---|
 * | 데이터 폴더에만 | `data` | |
 * | 내 배경 폴더에만 | `library` | 이것이 고장나 있던 경우다 |
 * | **둘 다** | `data` | 지금까지의 동작이 그쪽이다 — 잘 쓰던 화면을 바꾸지 않는다 |
 * | **어디에도 없다** | **건드리지 않는다** | 나중에 제자리에 넣었을 때 엉뚱한 쪽을 가리키면 안 된다 |
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getConnection } from '../../server/db/app.ts';
import { initTemplateStore } from '../../server/db/templates.ts';
import { paths } from '../../server/paths.ts';
import type { Template } from '../../shared/types.ts';

/** 이 검사가 만든 것만 지우기 위한 이름표 */
const MARK = 'zz-bgsrc';
const ONLY_DATA = `${MARK}-only-data.png`;
const ONLY_LIBRARY = `${MARK}-only-library.png`;
const BOTH = `${MARK}-both.png`;
const NOWHERE = `${MARK}-nowhere.png`;

const madeFiles: string[] = [];
const madeIds: number[] = [];

function put(dir: string, name: string): void {
  mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  writeFileSync(full, Buffer.alloc(3));
  madeFiles.push(full);
}

/**
 * 옛 템플릿 행을 직접 넣는다 (DB 는 JSON 을 그대로 읽는다).
 *
 * `source` 를 주지 않으면 **칸이 아예 없는** 상태가 된다 — 고치기 전에 저장된 모습이다.
 */
function insertLegacy(src: string, source?: 'library' | 'data'): number {
  const config = {
    kind: 'bible',
    canvas: {
      width: 1920,
      height: 1080,
      background: { mode: 'image', src, fit: 'cover', opacity: 1, ...(source ? { source } : {}) },
    },
  };
  const id = Number(
    getConnection()
      .prepare('INSERT INTO templates (name, kind, config, updated_at) VALUES (?, ?, ?, ?)')
      .run(`${MARK} ${src}`, 'bible', JSON.stringify(config), '2026-01-01').lastInsertRowid,
  );
  madeIds.push(id);
  return id;
}

function backgroundOf(id: number): { src: string; source?: string } {
  const row = getConnection().prepare('SELECT config FROM templates WHERE id = ?').get(id) as
    | { config: string }
    | undefined;
  return (JSON.parse(row!.config) as Template).canvas.background as { src: string; source?: string };
}

let ids: Record<string, number>;

beforeAll(() => {
  initTemplateStore();

  put(paths.backgroundsDir, ONLY_DATA);
  put(paths.backgroundSourceDir, ONLY_LIBRARY);
  put(paths.backgroundsDir, BOTH);
  put(paths.backgroundSourceDir, BOTH);

  ids = {
    onlyData: insertLegacy(ONLY_DATA),
    onlyLibrary: insertLegacy(ONLY_LIBRARY),
    both: insertLegacy(BOTH),
    nowhere: insertLegacy(NOWHERE),
    // **사람이 골라 둔 것** — 두 폴더에 다 있지만 내 배경 폴더를 고른 상태
    chosen: insertLegacy(BOTH, 'library'),
  };

  // 기동할 때 도는 것과 같은 것 — 여기서 한 번 더 부른다
  initTemplateStore();
});

afterAll(() => {
  for (const id of madeIds) getConnection().prepare('DELETE FROM templates WHERE id = ?').run(id);
  for (const file of madeFiles) rmSync(file, { force: true });
});

describe('저장된 옛 템플릿의 폴더를 채운다', () => {
  it('데이터 폴더에만 있으면 data', () => {
    expect(backgroundOf(ids.onlyData!).source).toBe('data');
  });

  /** **이것이 고장나 있던 경우다** — 파일은 있는데 404 가 났다 */
  it('내 배경 폴더에만 있으면 library', () => {
    expect(backgroundOf(ids.onlyLibrary!).source).toBe('library');
  });

  it('두 폴더에 다 있으면 data — 지금까지의 동작을 지킨다', () => {
    expect(backgroundOf(ids.both!).source).toBe('data');
  });

  /**
   * 없는 파일에 폴더를 정해 주면, 나중에 **제자리에 넣었을 때 엉뚱한 쪽**을 가리킨다.
   * 모르면 모르는 채로 두는 편이 낫다.
   */
  it('어디에도 없으면 건드리지 않는다', () => {
    expect(backgroundOf(ids.nowhere!).source).toBeUndefined();
    expect(backgroundOf(ids.nowhere!).src).toBe(NOWHERE);
  });

  /**
   * **이미 채워져 있으면 건드리지 않는다.**
   *
   * 두 폴더에 같은 이름이 있을 때 이주는 `data` 를 고른다. 그런데 사람이 화면에서
   * **내 배경 폴더**를 골라 두었다면 그것이 이겨야 한다 — 이주가 덮어쓰면 예배 화면의
   * 배경이 말없이 다른 그림으로 바뀐다.
   */
  it('사람이 골라 둔 폴더를 덮어쓰지 않는다', () => {
    expect(backgroundOf(ids.chosen!).source).toBe('library');
    initTemplateStore();
    expect(backgroundOf(ids.chosen!).source).toBe('library');
  });

  it('파일 이름은 한 글자도 바뀌지 않는다', () => {
    expect(backgroundOf(ids.onlyLibrary!).src).toBe(ONLY_LIBRARY);
  });

  /** 여러 번 불러도 안전해야 한다 — 기동할 때마다 돈다 */
  it('다시 불러도 그대로다', () => {
    initTemplateStore();
    expect(backgroundOf(ids.onlyLibrary!).source).toBe('library');
    expect(backgroundOf(ids.nowhere!).source).toBeUndefined();
  });

  it('검사가 만든 파일이 실제로 그 자리에 있었다 — 헛돌지 않았다는 확인', () => {
    expect(existsSync(path.join(paths.backgroundSourceDir, ONLY_LIBRARY))).toBe(true);
    expect(existsSync(path.join(paths.backgroundsDir, ONLY_DATA))).toBe(true);
  });
});

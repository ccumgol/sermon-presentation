/**
 * **자료 꾸러미를 넣을 때 무엇을 덮고 무엇을 건너뛰는가** (`lib/data-pack.ts`).
 *
 * ## 왜 값이 있는가
 *
 * 이 판정이 틀리면 **사용자가 손본 가사를 조용히 덮는다.** `songs.sqlite` 는
 * git 에 없고 되돌릴 방법이 백업뿐이다 (CLAUDE.md — 실제로 한 번 지웠다).
 * 그런데 2026-09-28 까지 `server/routes/data-pack.ts` 문장 커버리지가 **2.2%** 였다.
 *
 * ## 왜 '행이 0개' 로 못 가르는가 — 이 검사의 핵심
 *
 * 앱은 첫 기동에 **기본 예배 유형 넷을 넣는다.** 그 유형들은 항목까지 들고 있어서
 * (2026-09-12 실측: 주일예배 11개 · 수요예배 6개 …) '비었나' 를 행 수로 물으면
 * 갓 만든 PC 도 '사람 것' 으로 잡힌다. 그러면 새 PC 에 자료가 **안 들어간다** —
 * 이 기능이 쓰이는 바로 그 자리다.
 *
 * 그래서 표마다 '사람이 만든 것' 이 무엇인지 골라 센다:
 * `kind <> 'template'` 순서표 · 템플릿 · 교독문 · 설정.
 *
 * ## 틀
 *
 * 진짜 SQLite 파일을 임시 폴더에 만들어 본다 — 가짜 객체로는 '못 읽으면 어떻게
 * 되는가' 를 확인할 수 없고, 그 경우가 가장 위험하다.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PACK_DATABASES, holdsUserData, isUntouched, planAction } from '../../lib/data-pack.ts';

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sermon-pack-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 갓 만든 app.sqlite — 앱이 첫 기동에 만드는 모습 그대로 */
function freshApp(name: string, opts: { defaultTemplates?: number } = {}): string {
  const file = path.join(dir, name);
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE service_plans (id INTEGER PRIMARY KEY, name TEXT, kind TEXT);
    CREATE TABLE templates (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE responsive_readings (number INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  // 앱이 첫 기동에 넣는 기본 예배 유형 — **사람이 만든 것이 아니다**
  for (let i = 0; i < (opts.defaultTemplates ?? 4); i++) {
    db.prepare("INSERT INTO service_plans (name, kind) VALUES (?, 'template')").run(`기본 유형 ${i + 1}`);
  }
  db.close();
  return file;
}

/** 갓 만든 songs.sqlite — 표만 있고 곡이 없다 */
function freshSongs(name: string): string {
  const file = path.join(dir, name);
  rmSync(file, { force: true });
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT)');
  db.close();
  return file;
}

describe('★ 갓 만든 PC 는 "비어 있다" 로 본다 — 안 그러면 새 PC 에 자료가 안 들어간다', () => {
  it('기본 예배 유형 넷이 있어도 비어 있다 (사람이 만든 것이 아니다)', () => {
    expect(isUntouched(freshApp('fresh-app.sqlite'), 'app.sqlite')).toBe(true);
  });

  it('기본 유형이 몇 개든 마찬가지다', () => {
    expect(isUntouched(freshApp('fresh-app2.sqlite', { defaultTemplates: 12 }), 'app.sqlite')).toBe(true);
  });

  it('곡이 하나도 없는 songs.sqlite 도 비어 있다', () => {
    expect(isUntouched(freshSongs('fresh-songs.sqlite'), 'songs.sqlite')).toBe(true);
  });
});

describe('★ 사람이 손본 흔적이 하나라도 있으면 "사람 것" — 덮지 않는다', () => {
  it('저장한 회차(kind=plan)가 하나 있으면', () => {
    const file = freshApp('used-plan.sqlite');
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO service_plans (name, kind) VALUES ('2026-09-27 주일', 'plan')").run();
    db.close();
    expect(isUntouched(file, 'app.sqlite')).toBe(false);
  });

  it('만든 템플릿이 하나 있으면', () => {
    const file = freshApp('used-tpl.sqlite');
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO templates (name) VALUES ('내 템플릿')").run();
    db.close();
    expect(isUntouched(file, 'app.sqlite')).toBe(false);
  });

  it('가져온 교독문이 있으면', () => {
    const file = freshApp('used-reading.sqlite');
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO responsive_readings (number, title) VALUES (1, '시편 1편')").run();
    db.close();
    expect(isUntouched(file, 'app.sqlite')).toBe(false);
  });

  it('바꾼 설정이 하나 있으면', () => {
    const file = freshApp('used-setting.sqlite');
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO settings (key, value) VALUES ('default_translation', 'niv')").run();
    db.close();
    expect(isUntouched(file, 'app.sqlite')).toBe(false);
  });

  it('★ 곡이 하나라도 있으면 — 손본 가사가 사라지면 되돌릴 방법이 백업뿐이다', () => {
    const file = freshSongs('used-songs.sqlite');
    const db = new DatabaseSync(file);
    db.prepare("INSERT INTO songs (title) VALUES ('주 사랑')").run();
    db.close();
    expect(isUntouched(file, 'songs.sqlite')).toBe(false);
  });
});

describe('★ 못 읽으면 "비었다" 고 보지 않는다 — 모르는 상태에서 덮는 것보다 건너뛴다', () => {
  it('파일이 없으면', () => {
    expect(isUntouched(path.join(dir, '없는파일.sqlite'), 'app.sqlite')).toBe(false);
  });

  it('SQLite 가 아니면 (망가진 파일·다른 형식)', () => {
    const file = path.join(dir, 'broken.sqlite');
    writeFileSync(file, 'this is not a database', 'utf8');
    expect(isUntouched(file, 'app.sqlite')).toBe(false);
  });

  it('표가 없으면 (스키마가 다른 판)', () => {
    const file = path.join(dir, 'other-schema.sqlite');
    rmSync(file, { force: true });
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE something_else (id INTEGER)');
    db.close();
    expect(isUntouched(file, 'app.sqlite')).toBe(false);
  });

  it('songs.sqlite 인데 songs 표가 없으면', () => {
    const file = path.join(dir, 'no-songs-table.sqlite');
    rmSync(file, { force: true });
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE unrelated (id INTEGER)');
    db.close();
    expect(isUntouched(file, 'songs.sqlite')).toBe(false);
  });
});

describe('★ 넣을지 말지 — 네 갈래', () => {
  it('이 PC 에 없으면 넣는다 (잃을 것이 없다)', () => {
    expect(planAction('songs.sqlite', false, false)).toEqual({ action: 'install' });
    expect(planAction('bible.sqlite', false, false)).toEqual({ action: 'install' });
  });

  it('성경은 있어도 덮는다 — 원본에서 만들어 낸 것이라 같은 자료면 같은 결과다', () => {
    expect(planAction('bible.sqlite', true, false)).toEqual({ action: 'replace' });
  });

  it('사람 것인데 비어 있으면 넣는다 — **왜 넣는지 말해 준다**', () => {
    const r = planAction('songs.sqlite', true, true);
    expect(r.action).toBe('install');
    expect(r.reason).toContain('만들어 둔 것이 없습니다');
  });

  it('★ 사람 것에 내용이 있으면 건너뛴다 — **왜 건너뛰는지 말해 준다**', () => {
    const r = planAction('songs.sqlite', true, false);
    expect(r.action).toBe('skip');
    expect(r.reason).toContain('손본 것이 사라지지 않게');
  });

  it('app.sqlite 도 같은 규칙이다 (순서표·설정도 사람 것이다)', () => {
    expect(planAction('app.sqlite', true, false).action).toBe('skip');
    expect(planAction('app.sqlite', true, true).action).toBe('install');
  });

  it('★ 성경은 건너뛰는 일이 없다 — 비었는지 묻지도 않는다', () => {
    expect(planAction('bible.sqlite', true, true).action).toBe('replace');
    expect(planAction('bible.sqlite', true, false).action).toBe('replace');
  });
});

describe('꾸러미에 담기는 셋이 모두 이 판정을 지난다', () => {
  it('새 항목이 늘어도 빠지지 않게 목록을 못 박는다', () => {
    expect([...PACK_DATABASES]).toEqual(['bible.sqlite', 'songs.sqlite', 'app.sqlite']);
  });

  it('★ 사람 것은 가사와 순서표 둘이다 — 성경은 아니다', () => {
    expect(PACK_DATABASES.filter(holdsUserData)).toEqual(['songs.sqlite', 'app.sqlite']);
  });
});

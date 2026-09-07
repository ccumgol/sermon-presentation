/**
 * **번들이 교독문·곡집·악보 상태까지 옮긴다** (점검 P-3, 2026-09-07).
 *
 * 전에는 번들이 찬양·템플릿·순서·설정·폰트만 담았다. 그런데 문서와 CI 주석은
 * **'자료는 설정 탭의 자료 가져오기로 각 PC 에 넣는다'** 고 단언했다. 그래서 받은
 * 사람 PC 에서는
 *
 *  - 교독문 213편(새 137 · 옛 76)이 **없는데** 화면이
 *    `node scripts/import-kyodoc.ts --apply` 를 시켰다 — 설치판에는 터미널이 없다
 *  - 사람이 만든 곡집이 없어 그 곡집 수록 정보가 조용히 **'기타'** 로 떨어졌다
 *  - 155장을 훑어 내린 **악보 검토 판정**이 사라졌다
 *
 * ## 그림은 담지 않는다 — 일부러다
 *
 * `data/sheets/` 는 약 50MB 다. JSON 한 파일에 넣을 수 없어 **폴더를 복사**한다.
 * 대신 단 경계와 사람의 판정은 옮긴다 — 그림을 복사하면 곧바로 이어서 쓸 수 있다.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyBundle, buildBundle, BUNDLE_VERSION, type Bundle } from '../../server/routes/backup.ts';
import { getConnection, initAppDb } from '../../server/db/app.ts';
import * as readings from '../../server/db/readings.ts';
import * as sheets from '../../server/db/sheets.ts';
import * as songbooks from '../../server/db/songbooks.ts';
import * as store from '../../server/db/songs.ts';

const BOOK_ID = 'p3-test-book';
const SHEET_NUMBER = 90001;
const READING_NUMBER = 90002;
const SONG_TITLE = 'P3 이전 시험곡';

function cleanUp(): void {
  const conn = store.conn();
  for (const hit of store.listSongs(100000)) {
    if (hit.title === SONG_TITLE) store.deleteSong(hit.id);
  }
  conn.prepare('DELETE FROM song_sheets WHERE number = ?').run(SHEET_NUMBER);
  if (songbooks.getSongbook(conn, BOOK_ID)) songbooks.deleteSongbook(conn, BOOK_ID);
  getConnection().prepare('DELETE FROM responsive_readings WHERE number = ?').run(READING_NUMBER);
}

let bundle: Bundle;

beforeAll(() => {
  initAppDb();
  store.initSongsDb();
  readings.initReadingStore();
  cleanUp();

  // ① 사용자가 만든 곡집 + 그 곡집에 든 곡
  songbooks.createSongbook(store.conn(), {
    id: BOOK_ID,
    name: 'P3 시험 곡집',
    shortLabel: '험',
    numbered: true,
  });
  store.createSong({
    title: SONG_TITLE,
    entries: [{ songbookId: BOOK_ID, number: 7 }],
    sections: [{ kind: 'verse', label: '1절', lines: [{ lineIndex: 0, lang: 'ko', text: '한 줄' }] }],
  });

  // ② 교독문 (두 벌 중 새찬송가 쪽)
  readings.upsertReadings(
    [{ number: READING_NUMBER, title: 'P3 시험 교독문', lines: ['인도자 줄', '회중 줄'] }],
    'p3-test',
    'hymn_new',
  );

  // ③ 악보 상태 — 단 경계 + **사람이 내린 판정**
  sheets.putSheet(store.conn(), {
    songbookId: BOOK_ID,
    number: SHEET_NUMBER,
    width: 1200,
    height: 1600,
    systems: [{ from: 10, to: 120, lineCount: 5 }],
    needsReview: true,
  });
  sheets.setSheetLayout(store.conn(), BOOK_ID, SHEET_NUMBER, 'shared');
  sheets.setSheetReview(store.conn(), BOOK_ID, SHEET_NUMBER, 'ok');

  bundle = buildBundle();

  // 옮긴 PC 를 흉내 낸다 — 이 자료가 하나도 없는 상태에서 번들을 받는다
  cleanUp();
});

afterAll(() => {
  cleanUp();
});

describe('번들에 담긴다', () => {
  it('판이 2 다 — 새 칸이 있다는 표시', () => {
    expect(bundle.version).toBe(BUNDLE_VERSION);
    expect(BUNDLE_VERSION).toBeGreaterThanOrEqual(2);
  });

  it('교독문이 찬송가 구분과 출처까지 담긴다', () => {
    const found = bundle.readings?.find((reading) => reading.number === READING_NUMBER);
    expect(found).toBeDefined();
    expect(found).toMatchObject({ book: 'hymn_new', source: 'p3-test', title: 'P3 시험 교독문' });
    expect(found!.lines).toEqual(['인도자 줄', '회중 줄']);
  });

  it('사용자가 만든 곡집만 담긴다 — 내장 곡집은 코드가 출처다', () => {
    expect(bundle.songbooks?.some((book) => book.id === BOOK_ID)).toBe(true);
    expect(bundle.songbooks?.every((book) => !book.isBuiltin)).toBe(true);
  });

  it('악보 상태가 담긴다 (그림은 아니다)', () => {
    const found = bundle.sheets?.find((sheet) => sheet.number === SHEET_NUMBER);
    expect(found).toMatchObject({ songbookId: BOOK_ID, layout: 'shared', reviewState: 'ok' });
    // 그림이 딸려 들어가면 안 된다 — 50MB 를 JSON 에 담는 것이 이 결정의 이유다
    expect(JSON.stringify(found)).not.toContain('base64');
  });
});

describe('가져오면 되살아난다', () => {
  beforeAll(() => {
    const result = applyBundle(bundle, 'merge');
    expect(result.readings).toBeGreaterThanOrEqual(1);
    expect(result.songbooks).toBeGreaterThanOrEqual(1);
    expect(result.sheets).toBeGreaterThanOrEqual(1);
  });

  it('교독문이 그 찬송가에 들어온다', () => {
    const found = readings.getReading(READING_NUMBER, 'hymn_new');
    expect(found?.title).toBe('P3 시험 교독문');
    // 다른 찬송가로 새지 않았다
    expect(readings.getReading(READING_NUMBER, 'hymn_old')).toBeUndefined();
  });

  it('곡집이 만들어지고, 곡의 수록 정보가 **기타로 떨어지지 않는다**', () => {
    // ★ 곡집을 곡보다 먼저 만들지 않으면 여기서 'misc' 가 된다
    expect(songbooks.getSongbook(store.conn(), BOOK_ID)).toBeDefined();

    const song = store
      .listSongs(100000)
      .find((hit) => hit.title === SONG_TITLE);
    expect(song).toBeDefined();
    const full = store.getSong(song!.id)!;
    expect(full.entries).toHaveLength(1);
    expect(full.entries[0]).toMatchObject({
      songbookId: BOOK_ID,
      songbookName: 'P3 시험 곡집',
      number: 7,
    });
    // 곡집을 먼저 만들지 않았다면 여기가 'misc'(기타)가 된다
    expect(full.entries[0]!.songbookId).not.toBe('misc');
  });

  it('사람이 내린 악보 판정이 남는다 — 155장을 다시 훑지 않아도 된다', () => {
    const found = sheets.getSheet(store.conn(), BOOK_ID, SHEET_NUMBER);
    expect(found).toMatchObject({ layout: 'shared', reviewState: 'ok', needsReview: true });
    expect(found?.systems).toEqual([{ from: 10, to: 120, lineCount: 5 }]);
  });
});

describe('옛 판(v1) 번들도 그대로 읽는다', () => {
  it('새 칸이 없을 뿐이고, 있는 교독문을 지우지 않는다', () => {
    const before = readings.countReadings('hymn_new');

    const v1: Bundle = {
      format: bundle.format,
      version: 1,
      exportedAt: bundle.exportedAt,
      songs: [],
      templates: [],
      plans: [],
      settings: {},
      fonts: [],
    };
    // ★ replace 여도 교독문을 지우지 않는다 — 옛 번들에는 그 칸이 아예 없어서,
    //   지우고 넣는 방식이면 이 번들을 받은 순간 213편이 사라진다
    const result = applyBundle(v1, 'replace');
    expect(result.readings).toBe(0);
    expect(readings.countReadings('hymn_new')).toBe(before);
  });
});

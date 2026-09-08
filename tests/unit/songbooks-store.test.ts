/**
 * 곡집 저장소 — **되돌릴 수 없는 사용자 데이터를 쓰는 길.**
 *
 * `data/songs.sqlite` 의 가사는 git 에 없다. 되돌릴 방법이 백업뿐이고 실제로 한 번
 * 지웠다 (CLAUDE.md). 그런데 이 파일은 저장소에서 커버리지가 가장 낮은 축이었다
 * (문장 36.7%).
 *
 * ## 메모리 DB 로 검사한다
 *
 * 이 저장소의 함수들은 `DatabaseSync` 를 인자로 받는다 — 사용자 데이터를 건드리지
 * 않고 스키마째 시험할 수 있다. `song_entries` 가 `songs(id)` 를 참조하므로
 * 곡 표도 함께 만든다.
 */

import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  BUILTIN_SONGBOOKS,
  migrateFromHymnalColumns,
  createSongbook,
  deleteSongbook,
  findGaps,
  getSongbook,
  listSongbooks,
  markImported,
  QUICK_SLOT_COUNT,
  SCHEMA,
  SongbookError,
  seedBuiltinSongbooks,
  updateSongbook,
} from '../../server/db/songbooks.ts';

let db: DatabaseSync;

/** 곡 하나를 만들고 id 를 준다 — 수록 정보의 상대가 있어야 한다 */
function addSong(title: string): number {
  const info = db.prepare('INSERT INTO songs (title, created_at) VALUES (?, ?)').run(title, '2026-01-01');
  return Number(info.lastInsertRowid);
}

function enroll(songId: number, songbookId: string, number: number | null = null): void {
  db.prepare('INSERT INTO song_entries (song_id, songbook_id, number) VALUES (?, ?, ?)').run(
    songId,
    songbookId,
    number,
  );
}

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE songs (id INTEGER PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL)');
  db.exec(SCHEMA);
  seedBuiltinSongbooks(db);
});

describe('내장 곡집', () => {
  it('처음부터 셋이 있다', () => {
    expect(listSongbooks(db).map((one) => one.id)).toEqual(['hymn_new', 'hymn_old', 'misc']);
  });

  /** 서버는 뜰 때마다 부른다 — 여러 번 불러도 늘어나면 안 된다 */
  it('다시 심어도 늘지 않는다', () => {
    seedBuiltinSongbooks(db);
    seedBuiltinSongbooks(db);
    expect(listSongbooks(db)).toHaveLength(BUILTIN_SONGBOOKS.length);
  });

  it('내장 표시가 붙는다', () => {
    expect(listSongbooks(db).every((one) => one.isBuiltin)).toBe(true);
  });
});

describe('곡 수 집계', () => {
  it('수록곡을 센다', () => {
    const a = addSong('가');
    const b = addSong('나');
    enroll(a, 'hymn_new', 1);
    enroll(b, 'hymn_new', 2);
    enroll(b, 'hymn_old', 5);

    const books = new Map(listSongbooks(db).map((one) => [one.id, one.songCount]));
    expect(books.get('hymn_new')).toBe(2);
    expect(books.get('hymn_old')).toBe(1);
    expect(books.get('misc')).toBe(0);
  });

  /** 한 곡이 여러 곡집에 실린다 — 그것이 이 구조의 존재 이유다 */
  it('한 곡을 두 곡집이 함께 센다', () => {
    const song = addSong('나 같은 죄인 살리신');
    enroll(song, 'hymn_new', 305);
    enroll(song, 'hymn_old', 405);

    expect(getSongbook(db, 'hymn_new')!.songCount).toBe(1);
    expect(getSongbook(db, 'hymn_old')!.songCount).toBe(1);
  });

  it('없는 곡집은 undefined', () => {
    expect(getSongbook(db, '없는곡집')).toBeUndefined();
  });
});

describe('만들기', () => {
  it('이름만 주면 나머지를 채운다', () => {
    const book = createSongbook(db, { name: '찬미예수 2000' });
    expect(book.name).toBe('찬미예수 2000');
    // 대표 글자를 안 주면 이름 첫 글자
    expect(book.shortLabel).toBe('찬');
    expect(book.numbered).toBe(true);
    expect(book.isBuiltin).toBe(false);
  });

  it('빈 이름은 거절한다', () => {
    expect(() => createSongbook(db, { name: '   ' })).toThrow(SongbookError);
  });

  it('id 를 직접 줄 수 있고, 겹치면 거절한다', () => {
    createSongbook(db, { id: 'chanmi2000', name: '찬미예수' });
    expect(() => createSongbook(db, { id: 'chanmi2000', name: '다른 것' })).toThrow(/이미 있는/);
  });

  /** 한글 이름은 ascii id 로 옮길 수 없다 — 그때는 'book' 에 순번을 붙인다 */
  it('한글 이름이면 id 가 겹치지 않게 순번이 붙는다', () => {
    const first = createSongbook(db, { name: '경배와 찬양' });
    const second = createSongbook(db, { name: '주님의 노래' });
    expect(first.id).not.toBe(second.id);
    expect(getSongbook(db, second.id)).toBeDefined();
  });

  it('영문 이름은 읽을 수 있는 id 가 된다', () => {
    expect(createSongbook(db, { name: 'Hillsong Live' }).id).toBe('hillsong-live');
  });

  it('대표 글자는 두 자까지', () => {
    expect(createSongbook(db, { name: '아무거나', shortLabel: '길게길게' }).shortLabel).toBe('길게');
  });

  it('번호 없는 곡집을 만들 수 있다', () => {
    expect(createSongbook(db, { name: 'CCM', numbered: false }).numbered).toBe(false);
  });
});

describe('바로가기 슬롯', () => {
  /** 슬롯은 하나만 차지한다 — 둘이 같은 자리를 쓰면 버튼이 어느 곡집인지 알 수 없다 */
  it('다른 곡집이 쓰던 슬롯을 가져오면 그쪽이 비워진다', () => {
    const book = createSongbook(db, { name: '새 곡집' });
    // 1번은 내장 '새찬송가' 가 쓰고 있다
    expect(getSongbook(db, 'hymn_new')!.quickSlot).toBe(1);

    updateSongbook(db, book.id, { quickSlot: 1 });

    expect(getSongbook(db, book.id)!.quickSlot).toBe(1);
    expect(getSongbook(db, 'hymn_new')!.quickSlot).toBeUndefined();
  });

  it('범위를 벗어난 값은 비운 것으로 본다', () => {
    const book = createSongbook(db, { name: '가', quickSlot: 99 });
    expect(book.quickSlot).toBeUndefined();
    expect(updateSongbook(db, book.id, { quickSlot: 0 }).quickSlot).toBeUndefined();
    expect(updateSongbook(db, book.id, { quickSlot: QUICK_SLOT_COUNT }).quickSlot).toBe(QUICK_SLOT_COUNT);
  });

  it('null 을 주면 슬롯을 뺀다', () => {
    const book = createSongbook(db, { name: '가', quickSlot: 3 });
    expect(book.quickSlot).toBe(3);
    expect(updateSongbook(db, book.id, { quickSlot: null }).quickSlot).toBeUndefined();
  });
});

describe('고치기', () => {
  it('이름과 대표 글자를 바꾼다', () => {
    const book = createSongbook(db, { name: '옛 이름' });
    const after = updateSongbook(db, book.id, { name: '새 이름', shortLabel: '새' });
    expect(after.name).toBe('새 이름');
    expect(after.shortLabel).toBe('새');
  });

  it('빈 값을 주면 그대로 둔다 — 실수로 이름이 지워지면 안 된다', () => {
    const book = createSongbook(db, { name: '지켜야 할 이름' });
    expect(updateSongbook(db, book.id, { name: '   ' }).name).toBe('지켜야 할 이름');
  });

  /**
   * **내장 곡집의 번호 체계는 바꾸지 않는다.** 찬송가에서 번호를 빼면
   * '새 305' 같은 검색이 통째로 무너진다.
   */
  it('내장 곡집의 번호 체계는 못 바꾼다', () => {
    expect(updateSongbook(db, 'hymn_new', { numbered: false }).numbered).toBe(true);
  });

  it('사용자 곡집의 번호 체계는 바꿀 수 있다', () => {
    const book = createSongbook(db, { name: '가' });
    expect(updateSongbook(db, book.id, { numbered: false }).numbered).toBe(false);
  });

  it('없는 곡집은 거절한다', () => {
    expect(() => updateSongbook(db, '없음', { name: '가' })).toThrow(/찾을 수 없습니다/);
  });
});

describe('지우기 — 본문이 사라지면 안 된다', () => {
  /**
   * 곡집을 지워도 **가사는 남아야 한다.** 다른 곡집에 실려 있지 않은 곡만
   * '기타' 로 옮긴다.
   */
  it('그 곡집에만 있던 곡은 기타로 옮긴다', () => {
    const book = createSongbook(db, { name: '지울 곡집' });
    const only = addSong('여기에만 있는 곡');
    enroll(only, book.id, 1);

    expect(deleteSongbook(db, book.id)).toEqual({ movedToMisc: 1 });
    expect(getSongbook(db, book.id)).toBeUndefined();
    expect(getSongbook(db, 'misc')!.songCount).toBe(1);
    // 곡 자체는 그대로다
    expect(db.prepare('SELECT count(*) AS c FROM songs').get()).toEqual({ c: 1 });
  });

  /** 다른 곡집에도 실려 있으면 옮길 필요가 없다 — 기타가 쓸데없이 불어난다 */
  it('다른 곡집에도 있는 곡은 옮기지 않는다', () => {
    const book = createSongbook(db, { name: '지울 곡집' });
    const shared = addSong('두 곳에 있는 곡');
    enroll(shared, book.id, 1);
    enroll(shared, 'hymn_new', 305);

    expect(deleteSongbook(db, book.id)).toEqual({ movedToMisc: 0 });
    expect(getSongbook(db, 'misc')!.songCount).toBe(0);
    expect(getSongbook(db, 'hymn_new')!.songCount).toBe(1);
  });

  it('빈 곡집은 그냥 사라진다', () => {
    const book = createSongbook(db, { name: '빈 곡집' });
    expect(deleteSongbook(db, book.id)).toEqual({ movedToMisc: 0 });
  });

  /** 내장 곡집을 지우면 '기타' 가 사라져 갈 곳 없는 곡이 생긴다 */
  it('내장 곡집은 지울 수 없다', () => {
    for (const builtin of BUILTIN_SONGBOOKS) {
      expect(() => deleteSongbook(db, builtin.id), builtin.id).toThrow(/내장 곡집은 지울 수 없습니다/);
    }
  });

  it('없는 곡집은 거절한다', () => {
    expect(() => deleteSongbook(db, '없음')).toThrow(/찾을 수 없습니다/);
  });

  /** 이미 기타에도 실려 있으면 두 번 넣지 않는다 (PK 충돌) */
  it('이미 기타에 있는 곡이어도 무너지지 않는다', () => {
    const book = createSongbook(db, { name: '지울 곡집' });
    const song = addSong('양쪽에 있는 곡');
    enroll(song, book.id, 1);
    enroll(song, 'misc', null);

    expect(() => deleteSongbook(db, book.id)).not.toThrow();
    expect(getSongbook(db, 'misc')!.songCount).toBe(1);
  });
});

describe('빠진 번호 찾기 — 가져오기가 일부만 됐는지 본다', () => {
  it('사이에 빈 번호를 찾는다', () => {
    const book = createSongbook(db, { name: '가' });
    for (const n of [1, 2, 5]) enroll(addSong(`곡${n}`), book.id, n);

    expect(findGaps(db, book.id)).toEqual({ missing: [3, 4], max: 5 });
  });

  it('빠진 것이 없으면 빈 목록', () => {
    const book = createSongbook(db, { name: '가' });
    for (const n of [1, 2, 3]) enroll(addSong(`곡${n}`), book.id, n);

    expect(findGaps(db, book.id)).toEqual({ missing: [], max: 3 });
  });

  it('곡이 없으면 0', () => {
    expect(findGaps(db, createSongbook(db, { name: '가' }).id)).toEqual({ missing: [], max: 0 });
  });

  /** 번호 없는 수록곡은 세지 않는다 — 세면 1번부터 전부 '빠짐' 이 된다 */
  it('번호 없는 수록곡은 빼고 본다', () => {
    const book = createSongbook(db, { name: '가', numbered: false });
    enroll(addSong('번호 없음'), book.id, null);
    enroll(addSong('3번'), book.id, 3);

    expect(findGaps(db, book.id)).toEqual({ missing: [1, 2], max: 3 });
  });
});

describe('가져온 표시', () => {
  it('시각과 출처를 남긴다', () => {
    const book = createSongbook(db, { name: '가' });
    markImported(db, book.id, '찬미예수 폴더');

    const after = getSongbook(db, book.id)!;
    expect(after.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(after.sourceNote).toBe('찬미예수 폴더');
  });

  /** 출처를 안 주면 전에 적어 둔 것을 지우지 않는다 */
  it('출처를 안 주면 앞서 적은 것이 남는다', () => {
    const book = createSongbook(db, { name: '가', sourceNote: '처음 출처' });
    markImported(db, book.id);
    expect(getSongbook(db, book.id)!.sourceNote).toBe('처음 출처');
  });
});


/**
 * **옛 스키마에서 곡집 구조로 옮기기.**
 *
 * 재가져오기로 해결할 수도 있었지만, 사용자가 직접 넣은 영어 가사나 손본 곡이
 * 있어 **제자리에서** 옮긴다 — 그래서 이 함수는 사용자 데이터를 통째로 만지는
 * 길이다. 한 번만 도는 코드라고 검사를 빼면, 다음에 손댔을 때 무엇이 깨졌는지
 * 알 방법이 없다.
 */
describe('옛 스키마 이주', () => {
  /** 곡집 구조가 생기기 전의 표를 만든다 */
  function legacyDb(): DatabaseSync {
    const old = new DatabaseSync(':memory:');
    old.exec(`CREATE TABLE songs (
      id INTEGER PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL,
      hymnal TEXT, hymn_number INTEGER, hymn_number_old INTEGER)`);
    old.exec('CREATE INDEX idx_songs_hymnal ON songs(hymnal, hymn_number)');
    old.exec(SCHEMA);
    seedBuiltinSongbooks(old);
    return old;
  }

  function addLegacy(
    target: DatabaseSync,
    title: string,
    hymnal: string | null,
    number: number | null,
    oldNumber: number | null = null,
  ): number {
    const info = target
      .prepare(
        'INSERT INTO songs (title, created_at, hymnal, hymn_number, hymn_number_old) VALUES (?, ?, ?, ?, ?)',
      )
      .run(title, '2026-01-01', hymnal, number, oldNumber);
    return Number(info.lastInsertRowid);
  }

  it('hymnal 컬럼이 없으면 아무 일도 하지 않는다', () => {
    expect(migrateFromHymnalColumns(db)).toBeNull();
  });

  it('새·통 곡을 각 곡집으로 옮긴다', () => {
    const old = legacyDb();
    addLegacy(old, '새찬송가 곡', 'new', 305);
    addLegacy(old, '통일찬송가 곡', 'old', 405);

    const result = migrateFromHymnalColumns(old)!;
    expect(result.entries).toBe(2);
    expect(getSongbook(old, 'hymn_new')!.songCount).toBe(1);
    expect(getSongbook(old, 'hymn_old')!.songCount).toBe(1);
  });

  /** 대응곡은 **양방향**이어야 한다 — 한쪽만 이으면 어느 곡을 열었는지에 따라 달라진다 */
  it('hymn_number_old 로 대응곡을 양방향으로 잇는다', () => {
    const old = legacyDb();
    const newSong = addLegacy(old, '새 305', 'new', 305, 405);
    const oldSong = addLegacy(old, '통 405', 'old', 405);

    expect(migrateFromHymnalColumns(old)!.links).toBe(2);
    const pairs = old.prepare('SELECT song_id, linked_id FROM song_links ORDER BY song_id').all();
    expect(pairs).toEqual([
      { song_id: newSong, linked_id: oldSong },
      { song_id: oldSong, linked_id: newSong },
    ]);
  });

  it('짝이 없으면 잇지 않는다', () => {
    const old = legacyDb();
    addLegacy(old, '짝 없는 곡', 'new', 305, 999);
    expect(migrateFromHymnalColumns(old)!.links).toBe(0);
  });

  /** 곡집이 없던 곡도 어딘가에는 있어야 한다 — 없으면 목록에서 사라진다 */
  it('곡집에 속하지 않은 곡은 기타로 간다', () => {
    const old = legacyDb();
    addLegacy(old, '어디에도 없던 곡', null, null);

    migrateFromHymnalColumns(old);
    expect(getSongbook(old, 'misc')!.songCount).toBe(1);
  });

  it('모르는 hymnal 값은 곡집으로 옮기지 않고 기타로 떨어진다', () => {
    const old = legacyDb();
    addLegacy(old, '이상한 값', '엉뚱', 1);

    expect(migrateFromHymnalColumns(old)!.entries).toBe(0);
    expect(getSongbook(old, 'misc')!.songCount).toBe(1);
  });

  /**
   * 옮긴 뒤 옛 컬럼을 지운다. **인덱스를 먼저 지워야 한다** —
   * SQLite 는 인덱스가 걸린 컬럼을 DROP 하지 못한다
   * (`error in index ... after drop column: no such column: hymnal`).
   */
  it('옛 컬럼과 그 인덱스가 사라진다', () => {
    const old = legacyDb();
    addLegacy(old, '가', 'new', 1);
    migrateFromHymnalColumns(old);

    const names = (old.prepare("SELECT name FROM pragma_table_info('songs')").all() as Array<{ name: string }>).map(
      (one) => one.name,
    );
    expect(names).not.toContain('hymnal');
    expect(names).not.toContain('hymn_number');
    expect(names).not.toContain('hymn_number_old');
  });

  /** 두 번 불러도 탈이 없어야 한다 — 서버는 뜰 때마다 부른다 */
  it('두 번째부터는 null 을 준다', () => {
    const old = legacyDb();
    addLegacy(old, '가', 'new', 1);
    expect(migrateFromHymnalColumns(old)).not.toBeNull();
    expect(migrateFromHymnalColumns(old)).toBeNull();
  });
});

/**
 * JSON 원본 리더 테스트.
 *
 * 현대인의성경만 JSON 형식이라, 이 리더가 조용히 틀리면 한 역본 전체가
 * 어긋난다. 책 이름 해석 실패·형식 오류를 반드시 예외로 드러내야 한다.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readJsonBible, SourceReadError } from '../../scripts/source-reader.ts';

const dir = mkdtempSync(path.join(tmpdir(), 'sermon-json-'));
const files: string[] = [];

function write(name: string, content: unknown): string {
  const filePath = path.join(dir, name);
  writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  files.push(filePath);
  return filePath;
}

afterAll(() => {
  // mkdtemp 로 만든 임시 폴더라 남아도 해가 없지만 정리해 둔다
  rmSync(dir, { recursive: true, force: true });
});

describe('readJsonBible — 정상 입력', () => {
  it('영문 책 이름을 성경책 코드로 해석한다', () => {
    const file = write('ok.json', [
      { book: 'Genesis', chapters: [{ '1': { '1': '태초에' } }] },
      { book: '1 Chronicles', chapters: [{ '2': { '3': '역대상 본문' } }] },
      { book: 'Revelation', chapters: [{ '22': { '21': '아멘' } }] },
    ]);

    const { verses, headings } = readJsonBible(file);
    expect(headings).toEqual([]);
    expect(verses).toEqual([
      { book: 1, chapter: 1, verse: 1, text: '태초에' },
      { book: 13, chapter: 2, verse: 3, text: '역대상 본문' },
      { book: 66, chapter: 22, verse: 21, text: '아멘' },
    ]);
  });

  it('배열·키 순서를 신뢰하지 않고 책·장·절 순으로 정렬한다', () => {
    // SQLite 경로는 ORDER BY 로 정렬돼 오므로 JSON 도 같은 순서를 보장해야 한다
    const file = write('unordered.json', [
      { book: 'Revelation', chapters: [{ '1': { '2': 'b', '1': 'a' } }] },
      { book: 'Genesis', chapters: [{ '2': { '1': 'c' }, '1': { '1': 'd' } }] },
    ]);

    const { verses } = readJsonBible(file);
    expect(verses.map((v) => `${v.book}:${v.chapter}:${v.verse}`)).toEqual([
      '1:1:1',
      '1:2:1',
      '66:1:1',
      '66:1:2',
    ]);
  });

  it('한 책에 여러 장 항목이 흩어져 있어도 모두 읽는다', () => {
    const file = write('spread.json', [
      { book: 'Genesis', chapters: [{ '1': { '1': 'a' } }, { '3': { '1': 'c' } }, { '2': { '1': 'b' } }] },
    ]);
    expect(readJsonBible(file).verses).toHaveLength(3);
  });

  it('빈 문자열 본문도 그대로 넘긴다 (건너뛸지는 빌드가 결정한다)', () => {
    const file = write('empty-text.json', [{ book: 'Genesis', chapters: [{ '1': { '1': '' } }] }]);
    expect(readJsonBible(file).verses[0]?.text).toBe('');
  });
});

describe('readJsonBible — 오류를 조용히 넘기지 않는다', () => {
  it('해석할 수 없는 책 이름은 예외', () => {
    const file = write('bad-book.json', [{ book: 'Nephi', chapters: [{ '1': { '1': 'x' } }] }]);
    expect(() => readJsonBible(file)).toThrow(SourceReadError);
    expect(() => readJsonBible(file)).toThrow(/Nephi/);
  });

  it('모호한 책 이름도 예외 (임의로 고르지 않는다)', () => {
    // 'Jud' 는 Judges/Jude 로 갈린다
    const file = write('ambiguous.json', [{ book: 'Jud', chapters: [{ '1': { '1': 'x' } }] }]);
    expect(() => readJsonBible(file)).toThrow(SourceReadError);
  });

  it('최상위가 배열이 아니면 예외', () => {
    const file = write('not-array.json', { Genesis: {} });
    expect(() => readJsonBible(file)).toThrow(/배열이 아닙니다/);
  });

  it('항목 형식이 틀리면 예외', () => {
    expect(() => readJsonBible(write('no-book.json', [{ chapters: [] }]))).toThrow(SourceReadError);
    expect(() => readJsonBible(write('no-chapters.json', [{ book: 'Genesis' }]))).toThrow(SourceReadError);
  });

  it('장·절 번호가 정수가 아니면 예외', () => {
    const badChapter = write('bad-chapter.json', [{ book: 'Genesis', chapters: [{ 서론: { '1': 'x' } }] }]);
    expect(() => readJsonBible(badChapter)).toThrow(/장 번호/);

    const badVerse = write('bad-verse.json', [{ book: 'Genesis', chapters: [{ '1': { '1a': 'x' } }] }]);
    expect(() => readJsonBible(badVerse)).toThrow(/절 번호/);
  });

  it('깨진 JSON 은 예외', () => {
    const file = write('broken.json', '[{"book": "Genesis"');
    expect(() => readJsonBible(file)).toThrow(/JSON 을 읽을 수 없습니다/);
  });
});

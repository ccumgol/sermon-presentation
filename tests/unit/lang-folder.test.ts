/**
 * 번역 폴더 규약 — `언어/곡집/번호.txt`
 *
 * ## 왜 번호가 파일 이름인가
 *
 * 번역판의 **제목은 기준이 될 수 없다.** `Amazing Grace` 와 `나 같은 죄인 살리신` 은
 * 같은 곡이고, 곡집마다 표기도 다르다. `(곡집, 번호)` 는 사람이 정한 고정 좌표다.
 *
 * 기존 반입(`제목 - 번호.txt`)과 다른 규약을 쓰는 이유도 이것이다 — 그쪽은 곡을
 * **만드는** 일이라 제목이 필요하고, 이쪽은 **찾는** 일이라 번호만 필요하다.
 */

import { describe, expect, it } from 'vitest';

import { parseLangFolderPath } from '../../lib/lang-folder.ts';

describe('경로 읽기', () => {
  it('언어/곡집/번호.txt 를 읽는다', () => {
    expect(parseLangFolderPath('en/hymn_new/305.txt')).toEqual({
      lang: 'en',
      songbookId: 'hymn_new',
      number: 305,
    });
  });

  it('앞에 붙은 경로는 무시한다 — 어디에 두어도 된다', () => {
    expect(parseLangFolderPath('/Users/me/Desktop/Data/Lyrics/zh/hymn_old/405.txt')).toEqual({
      lang: 'zh',
      songbookId: 'hymn_old',
      number: 405,
    });
  });

  it('확장자가 없어도 받는다', () => {
    expect(parseLangFolderPath('ja/chanmi2000/1195')).toEqual({
      lang: 'ja',
      songbookId: 'chanmi2000',
      number: 1195,
    });
  });

  it('번호 앞뒤 공백을 다듬는다', () => {
    expect(parseLangFolderPath('en/hymn_new/ 305 .txt')?.number).toBe(305);
  });
});

describe('받지 않는 것', () => {
  it('아는 언어 코드만 — 폴더 이름이 언어가 아니면 버린다', () => {
    // 'lyrics/hymn_new/305.txt' 처럼 언어 자리에 다른 것이 오면 조용히 넣지 않는다
    expect(parseLangFolderPath('lyrics/hymn_new/305.txt')).toBeUndefined();
  });

  it('한국어는 받지 않는다 — 이 통로는 번역을 넣는 곳이다', () => {
    // ko 를 받으면 승인한 한국어 가사를 파일로 덮어쓰는 길이 생긴다
    expect(parseLangFolderPath('ko/hymn_new/305.txt')).toBeUndefined();
  });

  it('번호가 아니면 버린다', () => {
    expect(parseLangFolderPath('en/hymn_new/Amazing Grace.txt')).toBeUndefined();
    expect(parseLangFolderPath('en/hymn_new/305a.txt')).toBeUndefined();
  });

  it('0 이나 음수는 버린다', () => {
    expect(parseLangFolderPath('en/hymn_new/0.txt')).toBeUndefined();
    expect(parseLangFolderPath('en/hymn_new/-3.txt')).toBeUndefined();
  });

  it('깊이가 모자라면 버린다', () => {
    expect(parseLangFolderPath('en/305.txt')).toBeUndefined();
    expect(parseLangFolderPath('305.txt')).toBeUndefined();
  });

  it('곡집 이름이 비면 버린다', () => {
    expect(parseLangFolderPath('en//305.txt')).toBeUndefined();
  });
});

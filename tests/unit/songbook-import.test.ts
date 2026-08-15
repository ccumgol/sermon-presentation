import { describe, expect, it } from 'vitest';

import { parseSongbookText, summarizeParse } from '../../lib/songbook-import.ts';

describe('parseSongbookText — 번호 + 제목 형식', () => {
  it('번호 머리줄로 곡을 나눈다', () => {
    const text = [
      '42. 주만 바라볼지라',
      '[1절]',
      '주만 바라볼지라',
      '',
      '118. 나의 등뒤에서',
      '나의 등 뒤에서 나를 도우시는 주',
    ].join('\n');

    const { songs, skipped } = parseSongbookText(text);
    expect(skipped).toEqual([]);
    expect(songs).toHaveLength(2);
    expect(songs[0]).toMatchObject({ number: 42, title: '주만 바라볼지라' });
    expect(songs[1]).toMatchObject({ number: 118, title: '나의 등뒤에서' });
  });

  it('번호 뒤 구분자를 여러 형태로 받는다', () => {
    for (const head of ['42. 제목', '42 제목', '42) 제목', '42] 제목']) {
      const { songs } = parseSongbookText(`${head}\n가사`);
      expect(songs[0], head).toMatchObject({ number: 42, title: '제목' });
    }
  });

  it('가사의 섹션 머리와 | 페어링을 그대로 넘긴다', () => {
    const text = ['42. 주만 바라볼지라', '[1절]', '주만 바라볼지라', '| Look to Jesus only'].join('\n');
    const song = parseSongbookText(text).songs[0]!;
    expect(song.lyrics).toContain('| Look to Jesus only');
    expect(song.lyrics).toContain('[1절]');
  });

  it('가사 안의 빈 줄을 곡 경계로 쓰지 않는다', () => {
    // 빈 줄은 섹션 구분이다 — 여기서 곡을 나누면 한 곡이 여러 곡으로 쪼개진다
    const text = ['42. 제목', '[1절]', '가사1', '', '[후렴]', '가사2'].join('\n');
    const { songs } = parseSongbookText(text);
    expect(songs).toHaveLength(1);
    expect(songs[0]!.lyrics).toContain('[후렴]');
  });

  it('가사가 없는 곡은 건너뛰고 알린다', () => {
    const { songs, skipped } = parseSongbookText(['42. 가사 없는 곡', '43. 가사 있는 곡', '가사'].join('\n'));
    expect(songs).toHaveLength(1);
    expect(skipped[0]).toContain('가사 없는 곡');
  });

  it('번호 체계가 없는 곡집에서는 번호 머리줄로 나누지 않는다', () => {
    const { songs } = parseSongbookText('42. 제목처럼 보이는 줄\n가사', { numbered: false });
    expect(songs).toHaveLength(1);
    expect(songs[0]!.number).toBeUndefined();
    expect(songs[0]!.title).toBe('42. 제목처럼 보이는 줄');
  });
});

describe('parseSongbookText — 구분선 형식', () => {
  const text = [
    '---',
    '제목: 주만 바라볼지라',
    '저자: 김명식',
    '[1절]',
    '주만 바라볼지라',
    '---',
    '제목: 나의 등뒤에서',
    '저작권: © 예시',
    'CCLI: 1234567',
    '나의 등 뒤에서',
  ].join('\n');

  it('구분선으로 곡을 나눈다', () => {
    const { songs } = parseSongbookText(text);
    expect(songs).toHaveLength(2);
    expect(songs[0]!.title).toBe('주만 바라볼지라');
    expect(songs[1]!.title).toBe('나의 등뒤에서');
  });

  it('메타 줄을 필드로 읽는다', () => {
    const { songs } = parseSongbookText(text);
    expect(songs[0]!.author).toBe('김명식');
    expect(songs[1]!.copyright).toBe('© 예시');
    expect(songs[1]!.ccliNumber).toBe('1234567');
  });

  it('구분선이 있으면 번호 머리줄을 곡 경계로 쓰지 않는다', () => {
    // 가사 안에 '1. ' 같은 줄이 있어도 곡이 쪼개져서는 안 된다
    const withNumbers = ['---', '제목: 곡', '1. 첫째 줄처럼 보이는 가사', '2. 둘째 줄'].join('\n');
    expect(parseSongbookText(withNumbers).songs).toHaveLength(1);
  });

  it('여러 대시 문자를 구분선으로 본다', () => {
    for (const sep of ['---', '====', '****', '-----']) {
      const { songs } = parseSongbookText([sep, '제목: 곡', '가사'].join('\n'));
      expect(songs, sep).toHaveLength(1);
    }
  });
});

describe('parseSongbookText — 경계 상황', () => {
  it('머리줄 없이 시작하면 첫 줄을 제목으로 본다', () => {
    const { songs } = parseSongbookText('제목 같은 첫 줄\n가사 줄');
    expect(songs[0]).toMatchObject({ title: '제목 같은 첫 줄' });
  });

  it('빈 입력은 빈 결과', () => {
    expect(parseSongbookText('').songs).toEqual([]);
    expect(parseSongbookText('   \n  ').songs).toEqual([]);
  });

  it('제목만 있고 가사가 없으면 건너뛴다', () => {
    const { songs, skipped } = parseSongbookText('제목만 있음');
    expect(songs).toEqual([]);
    expect(skipped).toHaveLength(1);
  });
});

describe('summarizeParse — 가져오기 전 미리보기', () => {
  it('섹션 라벨과 줄 수, 언어를 알려준다', () => {
    const text = [
      '42. 주만 바라볼지라',
      '[1절]',
      '주만 바라볼지라',
      '| Look to Jesus only',
      '[후렴]',
      '후렴 줄',
    ].join('\n');
    const summary = summarizeParse(parseSongbookText(text));

    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ number: 42, title: '주만 바라볼지라' });
    expect(summary[0]!.sectionLabels).toEqual(['1절', '후렴']);
    expect(summary[0]!.langs.sort()).toEqual(['en', 'ko']);
    expect(summary[0]!.lineCount).toBe(3);
  });
});

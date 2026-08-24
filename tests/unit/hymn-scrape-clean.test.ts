/**
 * 웹 찌꺼기 떼기 (한/영 자료 반입).
 *
 * 실제 자료 645곡 중 340곡에 `© Daum Corp.` 이 붙어 있었다. 그대로 넣으면
 * **예배 화면에 나간다.** 동시에 **가사 한복판을 자르지 않는 것**이 더 중요하다.
 */
import { describe, expect, it } from 'vitest';

import { stripScrapeArtifacts } from '../../lib/hymn-scrape-clean.ts';

describe('줄 끝 부스러기를 뗀다', () => {
  it('첨부파일 목록 + 저작권 꼬리 (실제 자료)', () => {
    const line = "ful-fill'd on earth be-low. A-men. zip 파일 jpg 파일 jpg 파일 ppt 파일 © Daum Corp.";
    expect(stripScrapeArtifacts(line)).toEqual({ text: "ful-fill'd on earth be-low. A-men.", changed: true });
  });

  it('etc 로 시작하는 것도 (실제 자료)', () => {
    expect(stripScrapeArtifacts('and all the way. etc 파일 jpg 파일 ppt 파일 © Daum Corp.').text)
      .toBe('and all the way.');
  });

  it('저작권 꼬리만 있는 경우', () => {
    expect(stripScrapeArtifacts('Amazing grace © Daum Corp.').text).toBe('Amazing grace');
  });

  it('줄 전체가 부스러기면 버린다', () => {
    expect(stripScrapeArtifacts('파일')).toEqual({ text: '', changed: true });
    expect(stripScrapeArtifacts('  파일  ')).toEqual({ text: '', changed: true });
  });
});

describe('가사는 한 글자도 건드리지 않는다', () => {
  it('멀쩡한 줄은 그대로', () => {
    for (const line of [
      'Amazing grace how sweet the sound',
      "So I'll cher-ish the old rug-ged cross",
      'A-men.',
    ]) {
      expect(stripScrapeArtifacts(line), line).toEqual({ text: line, changed: false });
    }
  });

  it("'파일' 이 없으면 자르지 않는다", () => {
    const line = 'Praise Him all crea-tures here be-low';
    expect(stripScrapeArtifacts(line).changed).toBe(false);
  });

  it('앞뒤 공백만 다듬는다', () => {
    expect(stripScrapeArtifacts('  Amazing grace  ')).toEqual({ text: 'Amazing grace', changed: false });
  });
});

describe('자르고 남은 부스러기도 본다', () => {
  it('맨 앞의 `파일` 은 확장자가 없어 안 잘린다 (실제 자료)', () => {
    // | 파일 jpg 파일 jpg 파일 ppt 파일 © Daum Corp.
    expect(stripScrapeArtifacts('파일 jpg 파일 jpg 파일 ppt 파일 © Daum Corp.'))
      .toEqual({ text: '', changed: true });
  });

  it('가사가 앞에 있으면 가사는 남는다', () => {
    expect(stripScrapeArtifacts('Ho-ly is the Lord 파일 jpg 파일 © Daum Corp.').text)
      .toBe('Ho-ly is the Lord');
  });
});

describe('줄을 넘어가며 잘린 찌꺼기', () => {
  it('끝에 홀로 남은 확장자를 뗀다 (실제 자료 3줄)', () => {
    expect(stripScrapeArtifacts('earth and heaven be one. A-men. zip').text)
      .toBe('earth and heaven be one. A-men.');
  });

  it("가사에 나올 수 있는 낱말은 건드리지 않는다", () => {
    // `etc`·`txt` 는 규칙에서 뺐다
    expect(stripScrapeArtifacts('and so on, etc').changed).toBe(false);
  });
});

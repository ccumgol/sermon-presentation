import { describe, expect, it } from 'vitest';

import { DEFAULT_MAX_CHARS_PER_LINE } from '../../lib/song-slides.ts';
import {
  DEFAULT_LITURGY_PER_SLIDE,
  DEFAULT_LITURGY_VERSION,
  LITURGY_TEXTS,
  findLiturgy,
  isLiturgyId,
  isLiturgyPerSlide,
  isLiturgyVersion,
  liturgyLines,
  liturgySlides,
} from '../../lib/liturgy-texts.ts';

describe('본문 데이터', () => {
  it('주기도문과 사도신경이 각각 두 판본을 갖는다', () => {
    expect(LITURGY_TEXTS.map((text) => text.id)).toEqual(['lords-prayer', 'apostles-creed']);
    for (const text of LITURGY_TEXTS) {
      expect(Object.keys(text.versions).sort()).toEqual(['new', 'traditional']);
      for (const version of Object.values(text.versions)) {
        expect(version.label.length).toBeGreaterThan(0);
        expect(version.lines.length).toBeGreaterThan(0);
      }
    }
  });

  it('기본 판본은 새번역이다', () => {
    expect(DEFAULT_LITURGY_VERSION).toBe('new');
  });

  /**
   * 이 테스트가 본문 편집의 안전장치다. 회중이 함께 읽는 본문이라
   * 한 줄이 길어지면 뒷자리에서 글자가 작아진다.
   */
  it('모든 줄이 24자 한도를 넘지 않는다', () => {
    const tooLong: string[] = [];
    for (const text of LITURGY_TEXTS) {
      for (const version of Object.values(text.versions)) {
        for (const line of version.lines) {
          if (line.length > DEFAULT_MAX_CHARS_PER_LINE) {
            tooLong.push(`${text.title}/${version.label}: "${line}" (${line.length}자)`);
          }
        }
      }
    }
    expect(tooLong).toEqual([]);
  });

  it('빈 줄이나 앞뒤 공백이 없다', () => {
    for (const text of LITURGY_TEXTS) {
      for (const version of Object.values(text.versions)) {
        for (const line of version.lines) {
          expect(line).toBe(line.trim());
          expect(line.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('두 판본이 실제로 다르다', () => {
    for (const text of LITURGY_TEXTS) {
      expect(text.versions.new.lines).not.toEqual(text.versions.traditional.lines);
    }
  });

  it('아멘으로 끝난다', () => {
    for (const text of LITURGY_TEXTS) {
      for (const version of Object.values(text.versions)) {
        expect(version.lines[version.lines.length - 1]).toMatch(/^아멘\.?$/);
      }
    }
  });
});

describe('조회', () => {
  it('id 로 찾는다', () => {
    expect(findLiturgy('lords-prayer')?.title).toBe('주기도문');
    expect(findLiturgy('apostles-creed')?.title).toBe('사도신경');
  });

  it('모르는 id 는 undefined — 부르는 쪽이 알린다', () => {
    expect(findLiturgy('nicene-creed')).toBeUndefined();
    expect(liturgyLines('nicene-creed', 'new')).toBeUndefined();
  });

  it('저장된 값을 검사한다', () => {
    expect(isLiturgyId('lords-prayer')).toBe(true);
    expect(isLiturgyId('없는것')).toBe(false);
    expect(isLiturgyId(3)).toBe(false);
    expect(isLiturgyVersion('traditional')).toBe(true);
    expect(isLiturgyVersion('old')).toBe(false);
    expect(isLiturgyPerSlide(4)).toBe(true);
    expect(isLiturgyPerSlide(0)).toBe(true);
    expect(isLiturgyPerSlide(3)).toBe(false);
  });

  it('판본을 바꾸면 본문이 바뀐다', () => {
    const neu = liturgyLines('lords-prayer', 'new');
    const old = liturgyLines('lords-prayer', 'traditional');
    expect(neu?.[0]).toBe('하늘에 계신 우리 아버지,');
    expect(old?.[0]).toBe('하늘에 계신 우리 아버지여');
  });

  /** 교회 판본이 다를 때 사용자가 고친 것이 자동 데이터를 이겨야 한다 */
  it('직접 고친 본문이 내장 본문을 이긴다', () => {
    const mine = ['나라가 임하옵시며', '아멘'];
    expect(liturgyLines('lords-prayer', 'new', mine)).toEqual(mine);
    // 빈 배열은 '고치지 않음'으로 본다 — 실수로 다 지웠을 때 빈 화면이 나가면 안 된다
    expect(liturgyLines('lords-prayer', 'new', [])?.[0]).toBe('하늘에 계신 우리 아버지,');
  });
});

describe('화면 나누기', () => {
  it('기본은 4줄씩', () => {
    expect(DEFAULT_LITURGY_PER_SLIDE).toBe(4);
    const slides = liturgySlides(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    expect(slides).toEqual([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
  });

  it('마지막 장에 한 줄만 남기지 않는다 — 균등 분배', () => {
    // 5줄을 앞에서부터 4씩 자르면 4+1 이 되어 마지막 한 줄이 혼자 넘어간다.
    // 함께 읽다 화면이 끊기므로 장수를 먼저 정하고 고르게 나눈다 → 3+2
    expect(liturgySlides(['a', 'b', 'c', 'd', 'e'], 4)).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e'],
    ]);
  });

  it('고르게 나눠도 고아가 남으면 장수를 줄인다', () => {
    // 3줄을 2씩 → 2+1. 고르게 나눠도 마지막이 한 줄이라 한 장으로 합친다
    expect(liturgySlides(['a', 'b', 'c'], 2)).toEqual([['a', 'b', 'c']]);
  });

  it('실제 본문에 한 줄짜리 마지막 장이 없다 — 아멘이 혼자 남지 않는다', () => {
    for (const text of LITURGY_TEXTS) {
      for (const version of Object.values(text.versions)) {
        for (const perSlide of [2, 4, 6] as const) {
          const slides = liturgySlides(version.lines, perSlide);
          const last = slides[slides.length - 1];
          expect(
            last?.length,
            `${text.title}/${version.label} ${perSlide}줄씩: 마지막 장이 "${last?.join(' / ')}"`,
          ).toBeGreaterThan(1);
        }
      }
    }
  });

  it('0 은 전체를 한 장에', () => {
    expect(liturgySlides(['a', 'b', 'c'], 0)).toEqual([['a', 'b', 'c']]);
  });

  it('빈 본문은 빈 배열 — 빈 화면을 만들지 않는다', () => {
    expect(liturgySlides([])).toEqual([]);
  });

  it('실제 본문이 모두 장으로 나뉘고 줄이 하나도 빠지지 않는다', () => {
    for (const text of LITURGY_TEXTS) {
      for (const version of Object.values(text.versions)) {
        for (const perSlide of [0, 2, 4, 6] as const) {
          const slides = liturgySlides(version.lines, perSlide);
          expect(slides.flat()).toEqual([...version.lines]);
        }
      }
    }
  });
});

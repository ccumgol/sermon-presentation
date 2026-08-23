/**
 * 타언어 가사 두 창 편집을 받치는 순수 함수 (2026-08-23).
 *
 * 여기서 지키는 것: **미리 채우기가 있던 번역을 그대로 보여 준다**(빈 창을 주면
 * 사용자가 다시 적어 덮는다), **창을 비우면 그 언어만 걷힌다**(다른 언어는 남는다).
 */
import { describe, expect, it } from 'vitest';

import { ACTIVE_LANGS, KNOWN_LANGS, langChoices } from '../../lib/lang-select.ts';
import {
  compareLineCounts,
  extractSecondaryLyrics,
  mergeSecondaryLyrics,
  stripLang,
} from '../../lib/lyrics-merge.ts';

const BILINGUAL = [
  '[1절]',
  '나 같은 죄인 살리신',
  '| Amazing grace how sweet the sound',
  '주 은혜 놀라와',
  '| That saved a wretch like me',
  '',
  '[2절]',
  '잃었던 생명 찾았고',
  '| I once was lost but now am found',
].join('\n');

describe('언어 목록 구조 — 나중에 켜는 것이 한 줄이어야 한다', () => {
  it('지금 UI 에 내보이는 것은 한국어와 영어뿐', () => {
    expect(ACTIVE_LANGS).toEqual(['ko', 'en']);
  });

  it('이름표와 놓는 순서는 아는 언어 전체를 유지한다 — 데이터를 잃지 않기 위해', () => {
    expect(KNOWN_LANGS).toEqual(['ko', 'en', 'zh', 'ja']);
  });

  it('곡에 이미 있는 언어는 꺼져 있어도 고를 수 있다', () => {
    expect(langChoices([])).toEqual(['ko', 'en']);
    expect(langChoices(['zh'])).toEqual(['ko', 'en', 'zh']);
    expect(langChoices(['en'])).toEqual(['ko', 'en']); // 중복되지 않는다
  });
});

describe('extractSecondaryLyrics — 창을 미리 채운다', () => {
  it('그 언어의 줄만 절 라벨과 함께 꺼낸다', () => {
    expect(extractSecondaryLyrics(BILINGUAL, 'en')).toBe(
      ['[1절]', 'Amazing grace how sweet the sound', 'That saved a wretch like me', '', '[2절]', 'I once was lost but now am found'].join('\n'),
    );
  });

  it('한국어도 같은 방법으로 꺼낸다 — 옆에 두고 줄을 맞추는 기준', () => {
    expect(extractSecondaryLyrics(BILINGUAL, 'ko')).toBe(
      ['[1절]', '나 같은 죄인 살리신', '주 은혜 놀라와', '', '[2절]', '잃었던 생명 찾았고'].join('\n'),
    );
  });

  it('번역이 없는 절도 라벨을 남긴다 — 어디를 채울지 보인다', () => {
    const koOnly = '[1절]\n첫 줄\n\n[2절]\n둘째 절';
    expect(extractSecondaryLyrics(koOnly, 'en')).toBe('[1절]\n\n[2절]');
  });
});

describe('stripLang — 창을 비우면 그 언어만 걷힌다', () => {
  it('영어를 걷어도 한국어는 그대로', () => {
    const stripped = stripLang(BILINGUAL, 'en');
    expect(stripped).not.toContain('Amazing grace');
    expect(stripped).toContain('나 같은 죄인 살리신');
    expect(stripped).toContain('잃었던 생명 찾았고');
  });

  it('다른 언어는 건드리지 않는다', () => {
    const three = '[1절]\n한국어 줄\n|en English line\n|zh 中文行';
    const stripped = stripLang(three, 'en');
    expect(stripped).toContain('中文行');
    expect(stripped).not.toContain('English line');
  });
});

describe('되풀이해도 어긋나지 않는다 — 창에 적는 동안 매번 병합한다', () => {
  it('같은 값을 두 번 병합해도 결과가 같다', () => {
    const paste = '[1절]\nAmazing grace how sweet the sound\nThat saved a wretch like me';
    const once = mergeSecondaryLyrics(BILINGUAL, paste, 'en').text;
    const twice = mergeSecondaryLyrics(once, paste, 'en').text;
    expect(twice).toBe(once);
  });

  it('꺼냈다 다시 넣으면 원래대로 돌아온다', () => {
    const pulled = extractSecondaryLyrics(BILINGUAL, 'en');
    const back = mergeSecondaryLyrics(stripLang(BILINGUAL, 'en'), pulled, 'en').text;
    expect(extractSecondaryLyrics(back, 'en')).toBe(pulled);
  });
});

describe('compareLineCounts — 절별로 견준다', () => {
  it('절마다 기준·번역 줄 수를 준다', () => {
    expect(compareLineCounts(BILINGUAL, 'en')).toEqual([
      { label: '1절', primary: 2, secondary: 2 },
      { label: '2절', primary: 1, secondary: 1 },
    ]);
  });

  it('1절만 채운 상태를 정확히 말한다 — 합계로 보면 잘 하는 사람에게 틀렸다고 한다', () => {
    const text = '[1절]\n가\n| A\n나\n| B\n\n[2절]\n다\n라';
    expect(compareLineCounts(text, 'en')).toEqual([
      { label: '1절', primary: 2, secondary: 2 },
      { label: '2절', primary: 2, secondary: 0 },
    ]);
  });

  it('번역이 넘친 절도 드러난다', () => {
    const text = '[1절]\n가\n| A\n| B';
    const counts = compareLineCounts(text, 'en');
    expect(counts[0]!.primary).toBe(1);
    expect(counts[0]!.secondary).toBeGreaterThanOrEqual(1);
  });
});

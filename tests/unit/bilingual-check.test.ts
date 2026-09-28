/**
 * **영어 가사가 한국어 줄에 맞는지** (`lib/bilingual-check.ts`).
 *
 * ## 왜 값이 있는가
 *
 * 줄 수만 세면 새찬송가 645곡 중 **97.8% 가 정상**으로 나왔다. 실제로 쓸 수 있는
 * 곡은 **36곡뿐**이었다 (2026-08-27 실측). 그 차이를 만드는 규칙이 여기 있다 —
 * 이것이 헛돌면 화면이 '괜찮다' 고 말하는데 예배 중에 가사가 어긋난다.
 *
 * 이 규칙은 **스크립트(`report:bilingual`)와 화면이 함께 쓴다.** 두 곳에 적으면
 * 리포트와 화면이 다른 말을 한다.
 */

import { describe, expect, it } from 'vitest';

import { checkBilingual, describeBilingual, looksBroken } from '../../lib/bilingual-check.ts';
import type { LangCode, SongSection } from '../../shared/types.ts';

const EN = 'en' as LangCode;

/** 한국어·영어 줄을 짝지어 한 구간을 만든다 */
function section(label: string, ko: string[], en: string[] = [], position = 0): SongSection {
  return {
    id: position + 1,
    kind: 'verse',
    label,
    position,
    lines: [
      ...ko.map((text, i) => ({ lineIndex: i, lang: 'ko' as LangCode, text })),
      ...en.map((text, i) => ({ lineIndex: i, lang: EN, text })),
    ],
  } as unknown as SongSection;
}

describe('★ 끊긴 줄 판정 — 둘째 줄 이후인데 소문자로 시작', () => {
  it('첫 줄은 소문자여도 끊긴 것이 아니다 — 실측에서 첫 줄이 소문자인 경우는 0건이었다', () => {
    expect(looksBroken('amazing grace', 0)).toBe(false);
  });

  it('둘째 줄 이후가 소문자면 끊긴 것으로 본다', () => {
    expect(looksBroken('sound! That saved a wretch', 1)).toBe(true);
  });

  it('대문자로 시작하면 정상이다', () => {
    expect(looksBroken('That saved a wretch like me', 1)).toBe(false);
  });

  it("★ 따옴표로 시작하는 줄은 그 다음 글자를 본다 — `'Tis` 가 걸리면 표시가 시끄러워진다", () => {
    expect(looksBroken("'Tis grace hath brought me safe", 1)).toBe(false);
    expect(looksBroken("'tis grace hath brought me safe", 1)).toBe(true);
  });

  it('앞뒤 공백은 보지 않는다', () => {
    expect(looksBroken('   sound! That saved', 1)).toBe(true);
  });

  it('빈 줄은 끊긴 것이 아니다', () => {
    expect(looksBroken('   ', 1)).toBe(false);
  });
});

describe('★ 곡 판정 — 네 갈래', () => {
  it('영어가 전혀 없으면 none', () => {
    const r = checkBilingual([section('1절', ['나 같은 죄인 살리신', '주 은혜 놀라워'])], EN);
    expect(r.grade).toBe('none');
    expect(r.otherLines).toBe(0);
  });

  it('영어 줄이 더 적으면 fewer — 한 덩이를 적은 줄에 밀어 넣은 것이다', () => {
    const r = checkBilingual(
      [section('1절', ['가', '나', '다', '라'], ['Amazing grace how sweet the sound'])],
      EN,
    );
    expect(r.grade).toBe('fewer');
    expect(r.koLines).toBe(4);
    expect(r.otherLines).toBe(1);
  });

  it('★ 줄 수가 맞아도 문장이 끊기면 broken — 이것이 97.8% 를 36곡으로 바꾼 규칙이다', () => {
    // 실제로 있었던 새 305장의 모습 그대로다
    const r = checkBilingual(
      [
        section(
          '1절',
          ['나 같은 죄인 살리신', '주 은혜 놀라워'],
          ['Amazing grace! how sweet the', 'sound! That saved a wretch like'],
        ),
      ],
      EN,
    );
    expect(r.grade).toBe('broken');
    expect(r.koLines).toBe(2);
    expect(r.otherLines).toBe(2);
    expect(r.brokenLines).toBe(1);
  });

  it('줄 수도 맞고 끊긴 곳도 없으면 ok', () => {
    const r = checkBilingual(
      [section('1절', ['나 같은 죄인 살리신', '주 은혜 놀라워'],
        ['Amazing grace, how sweet the sound', 'That saved a wretch like me'])],
      EN,
    );
    expect(r.grade).toBe('ok');
    expect(r.brokenLines).toBe(0);
  });
});

describe('★ 어느 절인지 알려 준다 — 사람이 고칠 자리다', () => {
  it('구간 라벨과 줄 번호를 모은다', () => {
    const r = checkBilingual(
      [
        section('1절', ['가', '나'], ['Amazing grace how', 'sweet the sound'], 0),
        section('후렴', ['다', '라'], ['Praise the Lord', 'Sing His name'], 1),
        section('2절', ['마', '바'], ['Through many dangers', 'toils and snares'], 2),
      ],
      EN,
    );
    expect(r.grade).toBe('broken');
    expect(r.brokenAt).toEqual([
      { label: '1절', indexes: [1] },
      { label: '2절', indexes: [1] },
    ]);
  });

  it('★ 구간 순서(position)대로 본다 — 목록 순서와 화면 순서가 달라지면 안 된다', () => {
    const r = checkBilingual(
      [
        section('2절', ['가', '나'], ['Fine line', 'broken here'], 1),
        section('1절', ['다', '라'], ['Good line', 'also broken'], 0),
      ],
      EN,
    );
    expect(r.brokenAt.map((b) => b.label)).toEqual(['1절', '2절']);
  });

  it('끊긴 곳이 없으면 비어 있다', () => {
    const r = checkBilingual([section('1절', ['가'], ['One line'])], EN);
    expect(r.brokenAt).toEqual([]);
  });
});

describe('사람이 볼 한 줄', () => {
  const of = (sections: SongSection[]) => describeBilingual(checkBilingual(sections, EN));

  it('네 갈래가 서로 다른 말을 한다', () => {
    expect(of([section('1절', ['가'])])).toContain('없습니다');
    expect(of([section('1절', ['가', '나'], ['One'])])).toContain('모자랍니다');
    expect(of([section('1절', ['가', '나'], ['One', 'broken'])])).toContain('끊긴');
    expect(of([section('1절', ['가', '나'], ['One', 'Two'])])).toContain('맞습니다');
  });

  it('★ 숫자를 함께 말한다 — 얼마나 손봐야 하는지 알아야 한다', () => {
    expect(of([section('1절', ['가', '나', '다'], ['One'])])).toContain('1줄');
    expect(of([section('1절', ['가', '나', '다'], ['One'])])).toContain('3줄');
  });
});

describe('다른 언어에도 쓸 수 있다', () => {
  it('lang 을 주면 그 언어를 본다 — 영어만 쓰는 규칙이 아니다', () => {
    const ja = 'ja' as LangCode;
    const s = {
      id: 1, kind: 'verse', label: '1절', position: 0,
      lines: [
        { lineIndex: 0, lang: 'ko' as LangCode, text: '가' },
        { lineIndex: 1, lang: 'ko' as LangCode, text: '나' },
        { lineIndex: 0, lang: ja, text: 'ひとつ' },
      ],
    } as unknown as SongSection;
    expect(checkBilingual([s], ja).grade).toBe('fewer');
    // 영어로 보면 '없다'
    expect(checkBilingual([s], EN).grade).toBe('none');
  });
});

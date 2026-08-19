/**
 * 가사 3개 언어 이상 — `|` 형식의 한계와 그 해법.
 *
 * ## 무엇이 고장났었나
 *
 * `|` 로 시작하는 줄을 **전부 하나의 보조 언어**(기본 `en`)로 태그했다. 그래서
 * 한국어·영어·중국어를 가진 곡을 편집 칸에서 왕복시키면 中文 줄이 `en` 으로 바뀌고,
 * 같은 `(section, line_index, lang)` 이 두 번 생겨 저장이 **HTTP 500** 으로 실패했다.
 * 표시 언어 버튼에 中文·日本語 가 있는데 실제로는 넣을 방법이 없었다.
 *
 * ## 해법
 *
 * `|` 뒤에 **언어 표를 붙일 수 있게** 한다: `|en` `|zh` `|ja`.
 * 표가 없는 `|` 는 예전처럼 기본 보조 언어로 읽는다 — 이미 저장된 순서표와
 * 사용자가 손으로 적어 둔 글이 그대로 열려야 한다.
 *
 * 본문은 지어낸 것을 쓴다 (실제 가사는 저작물).
 */

import { describe, expect, it } from 'vitest';

import { formatLyrics, parseLyrics } from '../../lib/lyrics-parser.ts';

describe('언어 표가 붙은 | 줄', () => {
  it('|en |zh |ja 를 각각 그 언어로 읽는다', () => {
    const sections = parseLyrics(`[1절]
한국어 첫 줄
|en English first
|zh 中文 第一行
|ja 日本語 一行目`);

    expect(sections[0]!.lines).toEqual([
      { lineIndex: 0, lang: 'ko', text: '한국어 첫 줄' },
      { lineIndex: 0, lang: 'en', text: 'English first' },
      { lineIndex: 0, lang: 'zh', text: '中文 第一行' },
      { lineIndex: 0, lang: 'ja', text: '日本語 一行目' },
    ]);
  });

  it('표가 없는 | 는 기본 보조 언어 — 예전 글이 그대로 열린다', () => {
    const sections = parseLyrics(`[1절]
한국어 첫 줄
| English first`);
    expect(sections[0]!.lines[1]).toEqual({ lineIndex: 0, lang: 'en', text: 'English first' });
  });

  it('표와 표 없는 것을 섞어 써도 된다', () => {
    const sections = parseLyrics(`[1절]
한국어
| English
|zh 中文`);
    expect(sections[0]!.lines.map((l) => l.lang)).toEqual(['ko', 'en', 'zh']);
  });

  it('|ko 도 표로 받는다 — 영어를 주 언어로 둔 곡에서 쓴다', () => {
    const sections = parseLyrics(
      `[1절]
English line
|ko 한국어 줄`,
      { primaryLang: 'en' },
    );
    expect(sections[0]!.lines).toEqual([
      { lineIndex: 0, lang: 'en', text: 'English line' },
      { lineIndex: 0, lang: 'ko', text: '한국어 줄' },
    ]);
  });

  it('표 없는 줄과 같은 언어를 표로 적으면 뒤엣것이 이긴다 — 자리를 두 번 차지하지 않는다', () => {
    // 기본 주 언어가 ko 이므로 첫 줄도 ko 다. 둘을 그냥 넣으면 UNIQUE 에 걸린다.
    const sections = parseLyrics(`[1절]
먼저 쓴 줄
|ko 고쳐 쓴 줄`);
    expect(sections[0]!.lines).toEqual([{ lineIndex: 0, lang: 'ko', text: '고쳐 쓴 줄' }]);
  });

  it('표 뒤에 공백이 없어도 읽는다 (|zh中文)', () => {
    const sections = parseLyrics(`[1절]
한국어
|zh中文 줄`);
    expect(sections[0]!.lines[1]).toEqual({ lineIndex: 0, lang: 'zh', text: '中文 줄' });
  });
});

describe('같은 언어를 두 번 적었을 때', () => {
  it('뒤에 적은 것이 이긴다 — 저장이 깨지는 대신 사람의 마지막 뜻을 따른다', () => {
    const sections = parseLyrics(`[1절]
한국어
|en first try
|en second try`);
    const en = sections[0]!.lines.filter((l) => l.lang === 'en');
    expect(en).toHaveLength(1);
    expect(en[0]!.text).toBe('second try');
  });
});

describe('왕복', () => {
  const sections = [
    {
      kind: 'verse' as const,
      label: '1절',
      lines: [
        { lineIndex: 0, lang: 'ko', text: '한국어 첫 줄' },
        { lineIndex: 0, lang: 'en', text: 'English first' },
        { lineIndex: 0, lang: 'zh', text: '中文 第一行' },
        { lineIndex: 1, lang: 'ko', text: '한국어 둘째 줄' },
        { lineIndex: 1, lang: 'en', text: 'English second' },
        { lineIndex: 1, lang: 'zh', text: '中文 第二行' },
      ],
    },
  ];

  it('formatLyrics 가 언어 표를 적는다', () => {
    const text = formatLyrics(sections);
    expect(text).toContain('|en English first');
    expect(text).toContain('|zh 中文 第一行');
  });

  it('세 언어가 왕복해도 그대로 남는다 — 이것이 500 을 내던 자리다', () => {
    const back = parseLyrics(formatLyrics(sections));
    expect(back[0]!.lines).toEqual(sections[0]!.lines);
  });

  it('언어가 소실되지 않는다', () => {
    const back = parseLyrics(formatLyrics(sections));
    expect([...new Set(back[0]!.lines.map((l) => l.lang))].sort()).toEqual(['en', 'ko', 'zh']);
  });

  it('두 언어만 있으면 표 없는 짧은 형태로 적는다 — 손으로 쓰기 쉬운 형태를 지킨다', () => {
    const two = [
      {
        kind: 'verse' as const,
        label: '1절',
        lines: [
          { lineIndex: 0, lang: 'ko', text: '한국어' },
          { lineIndex: 0, lang: 'en', text: 'English' },
        ],
      },
    ];
    expect(formatLyrics(two)).toBe('[1절]\n한국어\n| English');
  });
});

describe('경계', () => {
  it('| 만 있고 내용이 없으면 건너뛴다', () => {
    const sections = parseLyrics('[1절]\n한국어\n|\n|en  ');
    expect(sections[0]!.lines).toHaveLength(1);
  });

  it('언어 표처럼 보이는 낱말은 표로 보지 않는다 (|English 는 본문)', () => {
    // 표는 소문자 2~3글자만 (ko en zh ja grc heb) — 그래야 본문과 헷갈리지 않는다
    const sections = parseLyrics('[1절]\n한국어\n|English text');
    expect(sections[0]!.lines[1]).toEqual({ lineIndex: 0, lang: 'en', text: 'English text' });
  });

  it('첫 줄이 | 로 시작하면 lineIndex 0 에 붙는다', () => {
    const sections = parseLyrics('[1절]\n|en orphan');
    expect(sections[0]!.lines[0]).toEqual({ lineIndex: 0, lang: 'en', text: 'orphan' });
  });
});

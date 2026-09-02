import { describe, expect, it } from 'vitest';

import { parseLyrics } from '../../lib/lyrics-parser.ts';
import { buildSongDeck } from '../../lib/song-slides.ts';
import type { LinesSource, Song } from '../../shared/types.ts';

/*
 * 2026-09-01 — 편집 칸에 12줄을 쳤는데 화면에 4줄이 두 줄로 묶여 나갔다.
 *
 * `fitLinesToWidth` 가 이웃 두 줄을 묶는다. 찬송가는 짧은 운율 행(`나 같은 죄인
 * 살리신` 8자)으로 저장돼 있어 한 줄씩 띄우면 화면이 텅 비므로 그 장치가 필요하다.
 * 그러나 **사람이 앱에서 친 줄은 그 자체가 의도**이고, 편집 칸도 '줄바꿈이 그대로
 * 화면 줄이 됩니다' 라고 약속한다.
 */
function song(text: string, linesSource: LinesSource): Song {
  return {
    id: 1, title: 'x', tags: [], entries: [], langs: ['ko'],
    sections: parseLyrics(text).map((s, i) => ({ ...s, id: i + 1, position: i, linesSource })),
  };
}

/** 짧은 줄 넷 — 이웃끼리 공백 뺀 길이의 합이 24 이하라 묶일 조건이다 */
const SHORT = '[1절]\n내가 주인 삼은 모든 것 내려 놓고\n내 주 되신 주 앞에 나가\n내가 사랑했던 모든 것 내려 놓고\n주님만 사랑해';

describe('사람이 친 줄은 묶지 않는다', () => {
  it('manual — 친 대로 한 줄씩 나간다', () => {
    const deck = buildSongDeck(song(SHORT, 'manual'), { langs: ['ko'], linesPerSlide: 2 });
    expect(deck.slides).toHaveLength(2);
    expect(deck.slides[0]).toMatchObject({ kind: 'song' });
    const first = deck.slides[0] as Extract<typeof deck.slides[0], { kind: 'song' }>;
    expect(first.lines.map((g) => g.map((l) => l.text).join(''))).toEqual([
      '내가 주인 삼은 모든 것 내려 놓고',
      '내 주 되신 주 앞에 나가',
    ]);
  });

  /* 찬송가는 그대로 묶는다 — 그 모습이 이미 예배에서 쓰이고 있다 */
  it('auto·imported — 짧은 운율 행은 묶어 그린다', () => {
    for (const src of ['auto', 'imported'] as const) {
      const deck = buildSongDeck(song(SHORT, src), { langs: ['ko'], linesPerSlide: 2 });
      expect(deck.slides).toHaveLength(1);
      const only = deck.slides[0] as Extract<typeof deck.slides[0], { kind: 'song' }>;
      expect(only.lines.map((g) => g.map((l) => l.text).join(''))).toEqual([
        '내가 주인 삼은 모든 것 내려 놓고 내 주 되신 주 앞에 나가',
        '내가 사랑했던 모든 것 내려 놓고 주님만 사랑해',
      ]);
    }
  });

  it('긴 줄은 manual 이 아니어도 묶이지 않는다 — 폭을 넘기 때문이다', () => {
    const long = '[1절]\n주님 말씀하시면 내가 나아가리다\n주님 뜻이 아니면 내가 멈춰서리다';
    const deck = buildSongDeck(song(long, 'auto'), { langs: ['ko'], linesPerSlide: 2 });
    const only = deck.slides[0] as Extract<typeof deck.slides[0], { kind: 'song' }>;
    expect(only.lines).toHaveLength(2);
  });
});

/*
 * '첫 장이 3줄' 은 묶임과 **다른 장치**다 — 줄 수가 홀수일 때 마지막에 한 줄만
 * 남는 것을 막는다. manual 이어도 그대로 일어난다. 고치는 것이 아니라 알아야 하는 것이다.
 */
describe('홀수 줄은 어느 한 장이 한 줄 더 갖는다', () => {
  it('5줄을 2줄씩 나누면 3장이 아니라 2장이고 앞장이 3줄이다', () => {
    const five = `[1절]\n${['가나다라마바사', '나다라마바사아', '다라마바사아자', '라마바사아자차', '마바사아자차카'].join('\n')}`;
    const deck = buildSongDeck(song(five, 'manual'), { langs: ['ko'], linesPerSlide: 2 });
    expect(deck.slides).toHaveLength(2);
    const [a, b] = deck.slides as Array<Extract<typeof deck.slides[0], { kind: 'song' }>>;
    expect(a!.lines).toHaveLength(3);
    expect(b!.lines).toHaveLength(2);
  });
});

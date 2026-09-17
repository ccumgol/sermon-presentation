/**
 * 설명서 글 안의 **굵게** 와 `코드` 를 가른다.
 *
 * 마크다운 파서가 아니다 — 두 가지만 본다. 설명서 글은 우리가 쓰는 것이라
 * 바깥에서 들어오지 않고, 더 필요해지면 그때는 라이브러리를 들이는 편이 낫다.
 *
 * **짝이 안 맞으면 글자 그대로 둔다.** `2 * 3 * 4` 를 굵게로 읽어 별표를 삼키면
 * 설명서가 거짓말을 한다 — 못 알아보는 것보다 그게 나쁘다.
 */

export type InlineToken = { t: 'text' | 'b' | 'code'; v: string };

/** `**굵게**` 와 `` `코드` `` — 코드 안에서는 굵게를 보지 않는다 */
const PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*/g;

export function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let at = 0;

  for (const match of text.matchAll(PATTERN)) {
    const start = match.index;
    if (start > at) out.push({ t: 'text', v: text.slice(at, start) });

    const [, code, bold] = match;
    if (code !== undefined) out.push({ t: 'code', v: code });
    else if (bold !== undefined) out.push({ t: 'b', v: bold });

    at = start + match[0].length;
  }

  if (at < text.length) out.push({ t: 'text', v: text.slice(at) });
  // 빈 글도 한 조각은 돌려준다 — 부르는 쪽이 빈 배열을 따로 다루지 않게
  return out.length > 0 ? out : [{ t: 'text', v: text }];
}

/**
 * 영어 가사를 **한국어 줄에 맞춰 다시 끊는다**.
 *
 * ## 무엇이 문제인가
 *
 * 새찬송가 영어 자료는 한 절의 영어가 이어진 글이고, 그것을 고정 폭으로 잘라 놓았다.
 * 그래서 한국어와 짝이 맞지 않는다 (2026-08-28 실측 1,618개 섹션).
 *
 * ```
 * 나의 갈 길 다 가도록   | All the way my Savior leads me;
 * 예수 인도하시니        | What have I to ask beside? Can I     ← 넘친다
 * 내 주 안에 있는 긍휼    | doubt His tender mercy, Who thro'    ← 이어진다
 * ```
 *
 * ## 어떻게 끊는가
 *
 * 한 절의 영어를 도로 이어 붙인 뒤 한국어 줄 수만큼 다시 나눈다. 어디서 나눌지는
 * 두 가지를 저울질해 정한다.
 *
 * 1. **문장 부호** — `. ! ? ;` 에서 끊는 것이 가장 좋고, `,` 가 다음이다.
 * 2. **길이 비율** — 한국어 줄이 길면 영어도 길어야 한다. 각 줄의 목표 길이를
 *    한국어 길이 비율로 잡고 어긋난 만큼을 벌점으로 매긴다.
 *
 * 모든 자리를 다 따져 가장 싼 조합을 고른다(동적 계획법). 앞에서부터 욕심껏 끊으면
 * 앞줄이 좋아지고 뒷줄이 망가진다 — 절 전체를 한꺼번에 봐야 한다.
 *
 * ## 낱말은 하나도 잃지 않는다
 *
 * 끊기만 하고 고치지 않는다. `verifySameWords` 로 낱말 열이 그대로인지 검사하며,
 * 부르는 쪽은 이 검사를 반드시 거쳐야 한다 — 가사가 조용히 사라지면 예배에서야 드러난다.
 */

/** 저울질하는 값들 — 실측으로 정한다 (아래 `TUNING` 참고) */
export interface Weights {
  /** 다음 줄이 소문자로 시작할 때의 벌점 */
  lowercase: number;
  /** 앞 줄이 쉼표로 끝날 때의 벌점 */
  comma: number;
  /** 앞 줄이 아무 부호 없이 끝날 때의 벌점 */
  noPunct: number;
  /** 길이가 목표에서 어긋난 만큼에 곱하는 값 */
  length: number;
}

/**
 * 새찬송가 자료로 재서 고른 값 (2026-08-28).
 *
 * **가장 센 신호는 대문자다.** 찬송가는 줄마다 대문자로 시작한다 — 그래서 다음 줄이
 * 소문자로 시작하면 잘못 끊은 것이다. 이 앱의 한/영 리포트도 같은 신호를 쓴다.
 *
 * 다만 `Thy` `Lord` 처럼 경어를 대문자로 적는 곳이 많아 대문자만으로는 한 낱말 차이를
 * 가리지 못한다. 그때 **앞 줄 끝의 문장 부호**가 갈라 준다.
 *
 * 벌점은 **더한다.** 처음엔 대문자면 0 으로 자르고 부호로 깎았는데, 그러면 부호 신호가
 * 통째로 버려져 어떤 값을 넣어도 결과가 같았다 (79.0% 에서 꿈쩍하지 않았다).
 *
 * ## 이 값이 얼마나 맞는가
 *
 * **이미 사람이 맞춰 둔 섹션 634개로 재서 87.7% 를 그대로 재현한다** (낱말 손실 0).
 * 나머지는 대개 한 낱말 차이다. 그래서 이 결과는 **제안**이고 사람이 승인해야 한다.
 * 다시 재려면 `scripts/realign-hymn-english.ts --measure`.
 */
export const TUNING: Weights = { lowercase: 0.6, comma: 0.3, noPunct: 0.5, length: 1.5 };

/** 끊는 자리의 벌점 — 낮을수록 좋다 */
function breakPenalty(prev: string, next: string, w: Weights): number {
  // 찬송가는 줄마다 대문자로 시작한다. 따옴표·괄호로 시작하는 것도 줄머리다
  const startsLine = /^["'‘“(]?[A-Z0-9]/.test(next);
  const hardStop = /[.!?;:]["'’”)]?$/.test(prev);
  const softStop = /[,—–]["'’”)]?$/.test(prev);
  return (startsLine ? 0 : w.lowercase) + (hardStop ? 0 : softStop ? w.comma : w.noPunct);
}

/** 목표 길이의 몇 배까지 한 줄로 허용하는가 — 너무 넓으면 느리고 너무 좁으면 답이 없다 */
const MIN_RATIO = 0.25;
const MAX_RATIO = 3.5;

export interface RebreakInput {
  /** 지금의 영어 줄들 — 이어 붙여 다시 나눈다 */
  english: readonly string[];
  /** 짝이 될 한국어 줄들 — 이 개수만큼 나누고, 길이 비율을 목표로 삼는다 */
  korean: readonly string[];
}

/** 공백을 뺀 글자 수 — 길이 비율의 잣대 */
function weight(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/**
 * 영어를 한국어 줄 수만큼 다시 나눈다.
 *
 * @returns 한국어 줄 수와 같은 길이의 배열. 나눌 수 없으면 `undefined`
 *          (낱말이 줄 수보다 적을 때) — 짐작해 빈 줄을 만들지 않는다.
 */
export function rebreakEnglish(input: RebreakInput, w: Weights = TUNING): string[] | undefined {
  const tokens = input.english.join(' ').split(/\s+/).filter((t) => t.length > 0);
  const n = input.korean.length;
  if (n === 0 || tokens.length < n) return undefined;
  if (n === 1) return [tokens.join(' ')];

  // 토큰 0..i 까지의 누적 글자 수 — 구간 길이를 상수 시간에 구한다
  const cum = [0];
  for (const token of tokens) cum.push(cum.at(-1)! + weight(token));
  const totalEn = cum.at(-1)!;

  const koWeights = input.korean.map(weight);
  const totalKo = koWeights.reduce((a, b) => a + b, 0);
  const target = koWeights.map((w) => (totalKo > 0 ? (totalEn * w) / totalKo : totalEn / n));

  const INF = Number.POSITIVE_INFINITY;
  // dp[j][t] = 토큰 t개를 j줄로 나눈 최소 벌점
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(tokens.length + 1).fill(INF));
  const from: number[][] = Array.from({ length: n + 1 }, () => new Array(tokens.length + 1).fill(-1));
  dp[0]![0] = 0;

  for (let j = 1; j <= n; j += 1) {
    const want = Math.max(1, target[j - 1]!);
    for (let t = j; t <= tokens.length - (n - j); t += 1) {
      for (let s = j - 1; s < t; s += 1) {
        const prev = dp[j - 1]![s]!;
        if (prev === INF) continue;
        const len = cum[t]! - cum[s]!;
        if (len < want * MIN_RATIO && t - s > 1) continue;
        if (len > want * MAX_RATIO) continue;
        // 마지막 줄이 아니면 이 자리에서 끊는 벌점을 함께 문다
        const cut = j === n ? 0 : breakPenalty(tokens[t - 1]!, tokens[t]!, w);
        const cost = prev + (w.length * Math.abs(len - want)) / want + cut;
        if (cost < dp[j]![t]!) {
          dp[j]![t] = cost;
          from[j]![t] = s;
        }
      }
    }
  }

  if (dp[n]![tokens.length] === INF) return undefined;

  const cuts: number[] = [];
  let at = tokens.length;
  for (let j = n; j >= 1; j -= 1) {
    cuts.push(at);
    at = from[j]![at]!;
    if (at < 0) return undefined;
  }
  cuts.push(0);
  cuts.reverse();

  return Array.from({ length: n }, (_, i) => tokens.slice(cuts[i]!, cuts[i + 1]!).join(' '));
}

/**
 * 낱말 열이 그대로인지 본다 — **끊기만 하고 고치지 않는다**는 약속을 지키는 검사다.
 *
 * 부르는 쪽은 쓰기 전에 반드시 이것을 거쳐야 한다.
 */
export function verifySameWords(before: readonly string[], after: readonly string[]): boolean {
  const flat = (lines: readonly string[]): string => lines.join(' ').split(/\s+/).filter(Boolean).join(' ');
  return flat(before) === flat(after);
}

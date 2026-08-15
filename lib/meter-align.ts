/**
 * 절 간 운율 정렬 — 순수 로직.
 *
 * 원본 찬송가 DB 에는 줄바꿈이 없다. 가져올 때 글자 폭만 보고 나눴더니
 * 구 한가운데가 끊겼다 (새찬송가 256장: '묵묵히 참고' | '당하셨네').
 *
 * 폭만 보면 어디를 끊어도 비슷해 보이지만, **같은 곡의 절들은 같은 멜로디**라
 * 행 구조가 서로 같아야 한다는 강한 제약이 있다. 실제 데이터가 이를 보여준다:
 *
 *   새256 (폭 기준 분할 결과)      새256 (절 간 정렬 결과)
 *   1절: 12 / 11 / 13자            1절: 9 / 9 / 9 / 9자
 *   2절: 12 / 13 / 11자            2절: 9 / 9 / 9 / 9자
 *   3절: 13 / 12 / 11자            3절: 9 / 9 / 9 / 9자
 *
 * 절마다 경계가 다르면 음악적으로 불가능한 분할이다. 그래서 행 수 후보마다
 * 절들을 나눠 보고 **절끼리 행 길이가 가장 일치하는 후보**를 고른다.
 *
 * 결과는 여전히 **제안**이다. 사람이 확인한 절은 다시 건드리지 않는다
 * (`song_sections.lines_source`).
 */

/**
 * 한 행이 이보다 짧으면 운율이 아니라 조각이다.
 *
 * '가장 세밀한 후보'를 고르는 규칙과 짝을 이루는 하한이다. 이 값이 없으면
 * 새256(36자)을 6행 6자씩으로 쪼개고, 그러면 '묵묵히 참고 / 당하셨네'가
 * 다시 갈라진다. 한국어 찬송가의 정형 행은 7~12자다.
 */
const MIN_LINE_CHARS = 7;
/** 한 행이 이보다 길면 화면에서 읽기 어렵다 */
const MAX_LINE_CHARS = 14;
/** 이 값 이하의 절간편차는 '절들이 같은 구조'로 본다 */
const CONSISTENT_DEVIATION = 1.0;

export interface AlignedVerse {
  /** 행별 어절 묶음 */
  lines: string[];
  /** 행별 글자 수 (공백 제외) — 판단 근거를 남긴다 */
  lengths: number[];
}

export interface MeterAlignment {
  lineCount: number;
  /** 행 하나의 목표 글자 수 */
  target: number;
  verses: AlignedVerse[];
  /** 절끼리 행 길이가 얼마나 다른가 (0 이면 완전히 같다) */
  deviation: number;
  /** 한 절 안에서 운율이 얼마나 불규칙한가 (0 이면 균일하거나 교대) */
  irregularity: number;
  /** 사람이 확인해야 하는 수준인지 */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * 어절을 `lineCount` 행으로 나눈다 — 각 행 길이가 `target` 에 가깝도록.
 *
 * 그리디나 최대폭 최소화로는 안 된다. 둘 다 '가장 긴 행'만 보기 때문에
 * 목표 길이에서 고르게 벗어난 분할과 한 행만 크게 벗어난 분할을 구별하지
 * 못한다. 편차 제곱합을 최소화하는 DP 라야 실제 악보의 행과 맞는다.
 *
 * 어절 경계에서만 끊으므로 **단어가 쪼개지는 일은 없다.**
 */
export function splitToTarget(
  words: readonly string[],
  lineCount: number,
  target: number | readonly number[],
): string[][] | null {
  const n = words.length;
  if (lineCount < 1 || lineCount > n) return null;

  // 행마다 목표가 다를 수 있다 (8.6.8.6 같은 교대 운율)
  const targetAt = (line: number): number => (typeof target === 'number' ? target : (target[line] ?? 0));

  /** words[i..j) 의 글자 수 (공백 제외) */
  const lengthOf = (i: number, j: number): number => words.slice(i, j).join('').length;

  // cost[k][i] = i 번째 어절부터 k 행으로 나눌 때의 최소 편차 제곱합
  const cost: number[][] = Array.from({ length: lineCount + 1 }, () => new Array<number>(n + 1).fill(Infinity));
  const cutAt: number[][] = Array.from({ length: lineCount + 1 }, () => new Array<number>(n + 1).fill(-1));
  cost[0]![n] = 0;

  for (let k = 1; k <= lineCount; k++) {
    for (let i = n - 1; i >= 0; i--) {
      // 남은 k-1 행에 최소 한 어절씩은 남겨야 한다
      for (let j = i + 1; j <= n - (k - 1); j++) {
        const rest = cost[k - 1]![j]!;
        if (rest === Infinity) continue;
        // k 행 남았다는 것은 지금 채우는 행이 앞에서부터 lineCount - k 번째다
        const deviation = lengthOf(i, j) - targetAt(lineCount - k);
        const candidate = rest + deviation * deviation;
        if (candidate < cost[k]![i]!) {
          cost[k]![i] = candidate;
          cutAt[k]![i] = j;
        }
      }
    }
  }

  if (cost[lineCount]![0] === Infinity) return null;

  const out: string[][] = [];
  let cursor = 0;
  for (let k = lineCount; k >= 1; k--) {
    const next = cutAt[k]![cursor]!;
    out.push([...words.slice(cursor, next)]);
    cursor = next;
  }
  return out;
}

function stdev(values: readonly number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

/** 위치별 표준편차의 평균 — 절들이 얼마나 같은 구조인지 */
function deviationOf(lengthVectors: readonly number[][]): number {
  const lineCount = lengthVectors[0]!.length;
  let total = 0;
  for (let line = 0; line < lineCount; line++) {
    total += stdev(lengthVectors.map((vector) => vector[line]!));
  }
  return total / lineCount;
}

/**
 * 한 절 안에서 행 길이가 얼마나 규칙적인가 (0 이면 완전히 규칙적).
 *
 * **절 간 편차만으로는 행 수를 고를 수 없다.** 새256(36자)은 2·3·4·6행이
 * 모두 편차 0.000 이다 — 모든 절을 같은 방식으로 잘못 자르면 '일관되게'
 * 틀리기 때문이다.
 *
 * 구별 신호는 찬송가 운율 자체에 있다. 실제 운율은 균일하거나(9.9.9.9)
 * 두 길이가 번갈아 나온다(8.6.8.6 — Amazing Grace 의 Common Meter).
 * 반면 폭 기준 분할이 만든 3행 12/11/13 에는 어떤 주기도 없다.
 */
function irregularityOf(vector: readonly number[]): number {
  const uniform = stdev(vector);
  if (vector.length < 4) return uniform;

  // 홀·짝 위치를 따로 봐서 교대 운율을 잡는다
  const even = vector.filter((_, index) => index % 2 === 0);
  const odd = vector.filter((_, index) => index % 2 === 1);
  return Math.min(uniform, (stdev(even) + stdev(odd)) / 2);
}

/**
 * 신뢰도는 **두 가지를 함께** 본다.
 *
 * 절끼리 일치한다는 것만으로는 부족하다. 모든 절을 같은 방식으로 잘못 자르면
 * 편차는 0 이면서 구는 끊긴다. 그래서 '절끼리 같은가'(deviation)와 '운율에
 * 주기가 있는가'(irregularity)를 모두 요구한다.
 *
 * 새8(거룩 거룩 거룩)은 운율이 11.12.12.10 으로 **주기가 없어** 이 방법으로는
 * 행 수를 정할 수 없다. 편차가 0 이어도 high 를 주지 않는 이유다 — 이런 곡은
 * 자동 적용에서 빼고 사람에게 넘긴다.
 */
function confidenceOf(deviation: number, irregularity: number): 'high' | 'medium' | 'low' {
  if (deviation <= 0.5 && irregularity <= 0.35) return 'high';
  if (deviation <= CONSISTENT_DEVIATION && irregularity <= 0.75) return 'medium';
  return 'low';
}

/** 절들의 평균 행 길이 벡터 — 교대 운율을 보존한다 */
function meanVector(lengthVectors: readonly number[][]): number[] {
  return lengthVectors[0]!.map(
    (_, line) => lengthVectors.reduce((sum, vector) => sum + vector[line]!, 0) / lengthVectors.length,
  );
}

/**
 * 절들의 공통 행 구조를 찾는다.
 *
 * **행 수 선택 기준이 중요하다.** 정형 운율의 곡은 여러 후보가 모두 완벽하게
 * 일치한다 — 새305 는 2행(14자)과 4행(7자)이 둘 다 편차 0.00 이다. 4행이 2행의
 * 배수라 음악적으로 둘 다 옳기 때문이다.
 *
 * 이때는 **행이 많은 쪽**을 고른다. 짧은 행은 화면 단위로 다시 묶을 수 있지만
 * (2줄씩·4줄씩), 긴 행은 되돌려 쪼갤 수 없다. 세밀한 쪽이 언제나 더 자유롭다.
 *
 * 절이 하나뿐이면 비교할 대상이 없어 `null` 을 준다 — 추측해서 나누느니
 * 원래대로 두고 사람에게 알리는 편이 낫다.
 */
export function alignVerses(verses: readonly string[]): MeterAlignment | null {
  return pickBest(meterCandidates(verses));
}

/**
 * 가능한 행 구조를 모두 만든다 (순위는 매기지 않는다).
 *
 * 후보 생성과 순위 결정을 나눈 이유는 **순위 규칙을 측정으로 정하기 위해서**다.
 * 세 곡만 놓고는 정할 수 없었다 — 새8 은 세밀한 쪽이 맞고 새256 은 규칙적인
 * 쪽이 맞는데 두 기준이 곡마다 엇갈린다.
 */
export function meterCandidates(verses: readonly string[]): MeterAlignment[] {
  if (verses.length < 2) return [];

  const wordLists = verses.map((verse) => verse.trim().split(/\s+/).filter((word) => word.length > 0));
  if (wordLists.some((words) => words.length === 0)) return [];

  const candidates: MeterAlignment[] = [];
  const maxLineCount = Math.min(...wordLists.map((words) => words.length));

  for (let lineCount = 2; lineCount <= maxLineCount; lineCount++) {
    const uniformTarget =
      wordLists.reduce((sum, words) => sum + words.join('').length / lineCount, 0) / wordLists.length;
    if (uniformTarget < MIN_LINE_CHARS || uniformTarget > MAX_LINE_CHARS) continue;

    const candidate = alignAt(wordLists, lineCount, uniformTarget);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

/**
 * 후보 중 하나를 고른다.
 *
 * 순서:
 *  1. **짝수 행** — 홀수면 2줄씩 표시에서 마지막 한 줄이 혼자 남는다. 화면 구성이
 *     2행·4행·6행 단위이므로 홀수 행은 어느 배수로도 깔끔히 나뉘지 않는다
 *  2. **절 간 일관성** — 같은 멜로디의 절들이 같은 행 길이를 가지면 악보의 행이다
 *  3. **운율 주기** — 균일(9.9.9.9)이나 교대(8.6.8.6)가 실제 찬송가 운율이다
 *  4. **세밀함** — 동점이면 짧은 행. 짧은 행은 표시할 때 다시 묶을 수 있지만
 *     긴 행은 되돌려 쪼갤 수 없다
 *
 * 3·4 의 순서는 `scripts/measure-meter-ranking.ts` 로 1,202곡을 비교해 정했다.
 */
export function pickBest(candidates: readonly MeterAlignment[]): MeterAlignment | null {
  if (candidates.length === 0) return null;

  // 짝수 행이 하나라도 있으면 짝수만 본다
  const even = candidates.filter((candidate) => candidate.lineCount % 2 === 0);
  const byParity = even.length > 0 ? even : candidates;

  // 절들이 같은 구조로 볼 수 있는 후보로 좁힌다
  const consistent = byParity.filter((candidate) => candidate.deviation <= CONSISTENT_DEVIATION);
  const pool = consistent.length > 0 ? consistent : byParity;

  return [...pool].sort(
    (a, b) => a.irregularity - b.irregularity || b.lineCount - a.lineCount,
  )[0]!;
}

/**
 * 행 수를 고정하고 절들을 정렬한다.
 *
 * 균일한 목표 길이로 한 번 나눈 뒤, 그 결과 중 하나를 **행별 목표 벡터**로
 * 삼아 모든 절을 다시 나눈다. 균일 목표만 쓰면 8.6.8.6 처럼 길이가 번갈아
 * 나오는 운율에서 절마다 다른 답이 나온다 (새305 가 실제로 그랬다:
 * 8/6/8/6 과 8/7/7/6 이 섞였다).
 */
function alignAt(
  wordLists: readonly string[][],
  lineCount: number,
  uniformTarget: number,
): MeterAlignment | null {
  const first = wordLists.map((words) => splitToTarget(words, lineCount, uniformTarget));
  if (first.some((split) => split === null)) return null;

  const initial = (first as string[][][]).map((split) => split.map((line) => line.join('').length));

  // 각 절의 결과를 후보 템플릿으로 써 보고 가장 잘 맞는 것을 고른다
  let best: MeterAlignment | null = null;

  for (const template of [...initial, meanVector(initial)]) {
    const splits = wordLists.map((words) => splitToTarget(words, lineCount, template));
    if (splits.some((split) => split === null)) continue;

    const verseLines = (splits as string[][][]).map((split) => split.map((line) => line.join(' ')));
    const lengthVectors = verseLines.map((lines) => lines.map((line) => line.replace(/\s/g, '').length));
    if (Math.min(...lengthVectors.flat()) < 3) continue;

    const deviation = deviationOf(lengthVectors);
    const irregularity = irregularityOf(meanVector(lengthVectors));
    if (best !== null && deviation >= best.deviation) continue;

    best = {
      lineCount,
      target: uniformTarget,
      verses: verseLines.map((lines, index) => ({ lines, lengths: lengthVectors[index]! })),
      deviation,
      irregularity,
      confidence: confidenceOf(deviation, irregularity),
    };
  }

  return best;
}

/**
 * 절이 아닌 섹션(후렴·브릿지)을 절에서 얻은 운율에 맞춰 나눈다.
 *
 * 후렴은 대개 절과 같은 곡조를 쓰므로 목표 길이를 공유한다. 다만 행 수를
 * 비교할 절이 없으므로 길이로만 추정한다 — 신뢰도가 절 정렬보다 낮다.
 */
export function alignToMeter(text: string, target: number): string[] | null {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return null;

  const lineCount = Math.max(1, Math.round(words.join('').length / target));
  if (lineCount > words.length) return null;
  if (lineCount === 1) return [words.join(' ')];

  const split = splitToTarget(words, lineCount, target);
  return split ? split.map((line) => line.join(' ')) : null;
}

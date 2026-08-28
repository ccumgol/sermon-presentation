/**
 * 가사 텍스트 처리 — 순수 로직.
 *
 * 세 가지 일을 한다:
 *  1. 붙여넣기 텍스트 → 섹션·줄·언어 구조 (`|` 페어링)
 *  2. 후렴 자동 검출 (절 간 최장 공통 어절 접미사)
 *  3. 자동 줄나눔 (원본 찬송가 DB 에 줄바꿈이 없다)
 *
 * 2·3 은 **제안**이다. 자동 결과를 그대로 확정하지 않고 사람이 편집 UI 에서
 * 확인한다 — 가사를 조용히 재구성하는 것은 본문을 임의로 고치는 것과 같다.
 */

import type { LangCode, SectionKind, SongLine, SongSection } from '../shared/types.ts';

/** 한 줄에 담을 목표 글자 수. 한국어 기준이며 자동 줄나눔의 기준점이다. */
const DEFAULT_TARGET_CHARS = 20;

// ─────────────────────────────────────────────────────────────
// 1. 붙여넣기 텍스트 파서
// ─────────────────────────────────────────────────────────────

/**
 * 라벨에서 섹션 종류를 추론한다.
 *
 * **검사 순서가 중요하다.** 'Pre-Chorus' 는 'chorus' 를 포함하므로
 * 더 구체적인 것을 먼저 본다. 순서를 바꾸면 프리코러스가 후렴으로 잡힌다.
 */
export function inferSectionKind(label: string): SectionKind {
  const normalized = label.trim().toLowerCase();
  if (/프리|pre-?\s*chorus/.test(normalized)) return 'prechorus';
  if (/후렴|refrain|chorus/.test(normalized)) return 'chorus';
  if (/전주|intro/.test(normalized)) return 'intro';
  if (/브릿지|브리지|bridge/.test(normalized)) return 'bridge';
  if (/태그|tag/.test(normalized)) return 'tag';
  if (/후주|끝|ending|outro/.test(normalized)) return 'ending';
  return 'verse';
}

export interface ParsedSection {
  kind: SectionKind;
  label: string;
  lines: SongLine[];
}

export interface ParseLyricsOptions {
  /** 기본 줄의 언어 */
  primaryLang?: LangCode;
  /** `|` 로 시작한 줄의 언어 */
  secondaryLang?: LangCode;
}

/**
 * 고를 수 있는 언어 표 — `|en` 처럼 `|` 뒤에 붙인다.
 *
 * **정해진 표로만 받는다.** 아무 낱말이나 표로 보면 `|English text` 같은 본문이
 * 언어 표로 잘못 읽힌다. 그래서 아는 코드만 표로 인정하고 나머지는 본문으로 둔다.
 */
const LANG_TAGS: ReadonlyArray<LangCode> = ['ko', 'en', 'zh', 'ja', 'grc', 'heb'];

/**
 * `|zh 中文` · `|zh中文` · `| English` 를 가른다.
 *
 * **언어 표 뒤에 라틴 낱말이 이어지면 표가 아니다.** 이 조건이 없으면 영어 가사
 * `| en-vy, strife` 의 `en` 을 표로 읽고 떼어 버려 `-vy, strife` 가 된다
 * (2026-08-28 실제로 겪었다 — 새 104·215·316·402·520·568장의 `en` 이 DB 에서 사라졌다).
 * 악보용 음절 하이픈이 붙은 자료에서는 `en-` `ja-` `ko-` 로 시작하는 줄이 흔하다.
 *
 * 그래서 표로 인정하는 조건은 뒤가 **공백·줄끝, 또는 라틴 낱말이 아닌 글자**일 때다.
 * `|zh中文` 은 그대로 살고 `| en-vy` 는 본문이 된다.
 */
const SECONDARY_LINE = /^\|\s*(?:([a-z]{2,3})(?![A-Za-z'\u2019-]))?\s*([\s\S]*)$/;

/**
 * 붙여넣기 가사를 구조로 바꾼다.
 *
 * ```
 * [1절]
 * 주 예수보다 더 귀한 것은 없네
 * | I'd rather have Jesus than silver or gold
 * |zh 我寧願有耶穌
 * ```
 *
 * `[...]` 는 섹션 머리, `|` 로 시작하는 줄은 **직전 줄의 번역**이다.
 * 같은 `lineIndex` 를 공유하므로 화면에서 위아래로 짝지어 표시된다.
 *
 * ## 언어 표
 *
 * `|` 뒤에 언어 코드를 붙이면 그 언어가 된다 (`|en` `|zh` `|ja`).
 * 표가 없으면 기본 보조 언어(`secondaryLang`, 기본 `en`)로 읽는다 — 이미 저장된
 * 글과 손으로 적어 둔 것이 그대로 열려야 하기 때문이다.
 *
 * 전에는 표가 없어 **모든 `|` 줄이 하나의 언어**였다. 그래서 3개 언어를 가진 곡은
 * 같은 `(section, line_index, lang)` 이 두 번 생겨 저장이 500 으로 실패했다.
 * 표시 언어 버튼에 中文·日本語 가 있는데 넣을 방법이 없던 원인이다.
 */
export function parseLyrics(text: string, options: ParseLyricsOptions = {}): ParsedSection[] {
  const primaryLang = options.primaryLang ?? 'ko';
  const secondaryLang = options.secondaryLang ?? 'en';

  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let lineIndex = 0;

  const startSection = (label: string): void => {
    current = { kind: inferSectionKind(label), label: label.trim(), lines: [] };
    sections.push(current);
    lineIndex = 0;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;

    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      startSection(header[1]!);
      continue;
    }

    // 섹션 머리가 없는 텍스트로 시작하면 첫 섹션을 자동으로 만든다
    if (!current) startSection('1절');

    if (line.startsWith('|')) {
      const match = SECONDARY_LINE.exec(line);
      const tag = match?.[1];
      // 아는 코드만 표로 본다. 모르는 낱말이면 본문의 일부다 (`|English text`)
      const tagged = match !== null && tag !== undefined && LANG_TAGS.includes(tag);
      const lang = tagged ? tag : secondaryLang;
      const translated = (tagged ? match[2]! : line.slice(1)).trim();
      if (translated.length === 0) continue;

      // 직전 줄의 번역 — 같은 lineIndex 를 쓴다
      const index = Math.max(0, lineIndex - 1);

      /*
       * 같은 언어를 두 번 적었으면 **뒤에 적은 것이 이긴다.**
       * 그냥 넣으면 UNIQUE(section_id, line_index, lang) 에 걸려 저장 전체가
       * 500 으로 실패한다. 사람이 고쳐 쓰다 두 줄이 된 경우가 대부분이므로
       * 마지막 뜻을 따르는 편이 낫다.
       */
      const existing = current!.lines.findIndex(
        (candidate) => candidate.lineIndex === index && candidate.lang === lang,
      );
      if (existing >= 0) current!.lines.splice(existing, 1);

      current!.lines.push({ lineIndex: index, lang, text: translated });
      continue;
    }

    current!.lines.push({ lineIndex, lang: primaryLang, text: line });
    lineIndex++;
  }

  return sections.filter((section) => section.lines.length > 0);
}

/** 구조를 다시 텍스트로 (편집 UI 의 원문 보기·내보내기용) */
export function formatLyrics(
  sections: ParsedSection[] | SongSection[],
  primaryLang = 'ko',
  secondaryLang: LangCode = 'en',
): string {
  const out: string[] = [];

  /*
   * 언어 표(`|en`)를 언제 적는가.
   *
   * 보조 언어가 **하나뿐이고 그것이 기본 보조 언어**라면 표를 적지 않는다.
   * `| English` 가 손으로 쓰기 쉬운 형태이고, 지금까지 쓰던 글과 같아야 한다.
   * 언어가 셋 이상이면 표가 **반드시** 있어야 한다 — 없으면 어느 줄이 어느 언어인지
   * 알 수 없고, 다시 읽을 때 전부 한 언어로 뭉쳐 저장이 깨진다.
   */
  const allLangs = new Set<LangCode>();
  for (const section of sections) for (const line of section.lines) allLangs.add(line.lang);
  const others = [...allLangs].filter((lang) => lang !== primaryLang);
  const needTags = others.length > 1 || (others.length === 1 && others[0] !== secondaryLang);

  for (const section of sections) {
    out.push(`[${section.label}]`);

    const maxIndex = section.lines.reduce((max, l) => Math.max(max, l.lineIndex), -1);
    for (let index = 0; index <= maxIndex; index++) {
      const atIndex = section.lines.filter((l) => l.lineIndex === index);
      const primary = atIndex.find((l) => l.lang === primaryLang) ?? atIndex[0];
      if (primary) out.push(primary.text);
      for (const other of atIndex.filter((l) => l !== primary)) {
        out.push(needTags ? `|${other.lang} ${other.text}` : `| ${other.text}`);
      }
    }
    out.push('');
  }

  return out.join('\n').trim();
}

// ─────────────────────────────────────────────────────────────
// 2. 후렴 검출
// ─────────────────────────────────────────────────────────────

export interface RefrainDetection {
  /** 검출된 후렴 텍스트 (없으면 null) */
  refrain: string | null;
  /** 후렴을 뗀 각 절의 본문 */
  verses: string[];
  /** 공통 접미사의 어절 수 — 신뢰도 판단 근거 */
  words: number;
  /** 사람이 확인해야 하는 수준인지 (짧은 접미사는 우연일 수 있다) */
  confidence: 'high' | 'medium' | 'low';
}

/** 최소 이 길이는 되어야 후렴 후보로 본다 (우연한 일치 배제) */
const MIN_REFRAIN_CHARS = 8;

/**
 * 절들의 **최장 공통 어절 접미사**를 후렴으로 본다.
 *
 * 원본 찬송가 DB 는 후렴을 별도 섹션으로 갖고 있지 않고 각 절 뒤에 인라인으로
 * 반복해 넣어 두었다. 실측 결과 새찬송가 2절 이상 609곡 중 314곡에서 8자 이상
 * 공통 접미사가 나왔고, 그중 189곡은 12어절 이상으로 후렴이 확실하다.
 *
 * 어절 수가 적으면 우연히 같은 말로 끝난 것일 수 있으므로 confidence 로 구분한다.
 */
export function detectRefrain(verses: readonly string[]): RefrainDetection {
  const none = (): RefrainDetection => ({ refrain: null, verses: [...verses], words: 0, confidence: 'low' });
  if (verses.length < 2) return none();

  const tokenized = verses.map((v) => v.trim().split(/\s+/).filter((w) => w.length > 0));
  if (tokenized.some((t) => t.length === 0)) return none();

  let common = 0;
  outer: while (true) {
    const candidate = tokenized[0]![tokenized[0]!.length - 1 - common];
    if (candidate === undefined) break;
    for (const tokens of tokenized) {
      // 절 전체가 후렴이 되어 버리는 것은 막는다 (최소 1어절은 남긴다)
      if (tokens.length - 1 - common < 1) break outer;
      if (tokens[tokens.length - 1 - common] !== candidate) break outer;
    }
    common++;
  }

  if (common === 0) return none();

  const refrain = tokenized[0]!.slice(tokenized[0]!.length - common).join(' ');
  if (refrain.length < MIN_REFRAIN_CHARS) return none();

  return {
    refrain,
    verses: tokenized.map((t) => t.slice(0, t.length - common).join(' ')),
    words: common,
    confidence: common >= 12 ? 'high' : common >= 8 ? 'medium' : 'low',
  };
}

// ─────────────────────────────────────────────────────────────
// 3. 자동 줄나눔
// ─────────────────────────────────────────────────────────────

/**
 * 한 문장을 어절 경계에서 균형 있게 나눈다.
 *
 * 그리디로 채우면 마지막 줄만 짧아져 보기 나쁘다. 그래서 줄 수를 먼저 정하고
 * '가장 긴 줄의 길이'를 최소화하는 방식으로 나눈다 (이분 탐색 + 그리디 검사).
 * 찬송가는 정형 운율이라 이렇게 하면 대개 원래 악보의 행과 맞는다.
 */
export function splitIntoLines(text: string, targetChars = DEFAULT_TARGET_CHARS): string[] {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return [];

  const total = text.trim().length;
  if (total <= targetChars) return [words.join(' ')];

  const lineCount = Math.max(2, Math.round(total / targetChars));
  if (lineCount >= words.length) return words;

  /** 주어진 폭으로 나눌 때 필요한 줄 수 */
  const linesNeeded = (width: number): number => {
    let lines = 1;
    let current = 0;
    for (const word of words) {
      if (word.length > width) return Number.POSITIVE_INFINITY;
      const candidate = current === 0 ? word.length : current + 1 + word.length;
      if (candidate <= width) {
        current = candidate;
      } else {
        lines++;
        current = word.length;
      }
    }
    return lines;
  };

  // 가장 긴 어절 ~ 전체 길이 사이에서, lineCount 줄로 담기는 최소 폭을 찾는다
  let low = Math.max(...words.map((w) => w.length));
  let high = total;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (linesNeeded(mid) <= lineCount) high = mid;
    else low = mid + 1;
  }

  // 찾은 폭으로 실제 분할
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= low) {
      current = candidate;
    } else {
      if (current.length > 0) lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);

  return lines;
}

/** 줄 배열 → SongLine 배열 */
export function toSongLines(lines: readonly string[], lang: LangCode): SongLine[] {
  return lines.map((text, lineIndex) => ({ lineIndex, lang, text }));
}

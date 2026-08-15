/**
 * 곡집 일괄 가져오기 텍스트 파서 — 순수 로직.
 *
 * 복음성가 자료는 대개 텍스트로 돌아다닌다. 형식이 제각각이라 두 가지만 지원하고
 * **해석 결과를 미리 보여준 뒤** 저장하게 한다 (조용히 잘못 넣는 것이 최악이다).
 *
 * 형식 A — 번호 + 제목 머리줄:
 * ```
 * 42. 주만 바라볼지라
 * [1절]
 * 주만 바라볼지라
 * | Look to Jesus only
 *
 * 118. 나의 등뒤에서
 * 나의 등 뒤에서 나를 도우시는 주
 * ```
 *
 * 형식 B — 구분선으로 곡을 나눔 (번호 없는 곡집):
 * ```
 * ---
 * 제목: 주만 바라볼지라
 * 저자: 김명식
 * [1절]
 * 주만 바라볼지라
 * ```
 */

import { parseLyrics, type ParsedSection } from './lyrics-parser.ts';

export interface ParsedSongInput {
  number?: number;
  title: string;
  titleAlt?: string;
  author?: string;
  copyright?: string;
  ccliNumber?: string;
  /** 원문 가사 (서버가 parseLyrics 로 구조화) */
  lyrics?: string;
  /** 이미 구조화된 섹션 */
  sections?: ParsedSection[];
}

export interface SongbookParseResult {
  songs: ParsedSongInput[];
  /** 해석하지 못해 건너뛴 것 */
  skipped: string[];
}

/** '42. 제목' · '42 제목' · '42) 제목' */
const NUMBER_HEAD = /^(\d{1,4})\s*[.)\]]?\s+(.+)$/;

/** 곡 구분선 — 3개 이상의 -, =, * */
const SEPARATOR = /^\s*[-=*]{3,}\s*$/;

/** '제목:' '저자:' 같은 메타 줄 */
const META = /^(제목|title|저자|작사|작곡|author|composer|저작권|copyright|ccli)\s*[:：]\s*(.+)$/i;

function applyMeta(song: ParsedSongInput, key: string, value: string): void {
  const normalized = key.toLowerCase();
  if (/제목|title/.test(normalized)) song.title = value;
  else if (/저자|작사|author/.test(normalized)) song.author = value;
  else if (/작곡|composer/.test(normalized)) song.author = song.author ?? value;
  else if (/저작권|copyright/.test(normalized)) song.copyright = value;
  else if (/ccli/.test(normalized)) song.ccliNumber = value;
}

interface Options {
  /** 번호 체계가 있는 곡집인지. false 면 번호 머리줄을 제목으로 본다. */
  numbered?: boolean;
  secondaryLang?: string;
}

/**
 * 텍스트를 곡 목록으로 해석한다.
 *
 * 구분선이 있으면 그것으로 곡을 나누고, 없으면 '번호 + 제목' 머리줄을 경계로 본다.
 * 어느 쪽으로도 곡을 못 나누면 전체를 한 곡으로 본다 — 사용자가 한 곡만 붙여넣은 경우다.
 */
export function parseSongbookText(text: string, options: Options = {}): SongbookParseResult {
  const numbered = options.numbered !== false;
  const lines = text.split(/\r?\n/);

  const songs: ParsedSongInput[] = [];
  const skipped: string[] = [];

  let current: { head: ParsedSongInput; body: string[] } | null = null;

  const flush = (): void => {
    if (!current) return;
    const lyrics = current.body.join('\n').trim();
    const title = current.head.title.trim();

    if (title.length === 0) {
      skipped.push('제목 없는 덩어리');
    } else if (lyrics.length === 0) {
      skipped.push(`${title}: 가사 없음`);
    } else {
      songs.push({ ...current.head, title, lyrics });
    }
    current = null;
  };

  const hasSeparator = lines.some((line) => SEPARATOR.test(line));

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (SEPARATOR.test(line)) {
      flush();
      // 구분선 뒤에는 메타 줄이 제목을 정한다
      current = { head: { title: '' }, body: [] };
      continue;
    }

    // 메타 줄 (제목:/저자:/…)
    const meta = current ? META.exec(line) : null;
    if (meta && current) {
      applyMeta(current.head, meta[1]!, meta[2]!.trim());
      continue;
    }

    // 번호 + 제목 머리줄 — 구분선이 없을 때만 곡 경계로 본다
    const head = !hasSeparator && numbered ? NUMBER_HEAD.exec(line) : null;
    if (head) {
      flush();
      current = { head: { number: Number(head[1]), title: head[2]!.trim() }, body: [] };
      continue;
    }

    if (line.length === 0) {
      // 빈 줄은 가사 안의 섹션 구분으로 남긴다 (곡 경계로 쓰지 않는다)
      if (current) current.body.push('');
      continue;
    }

    if (!current) {
      // 머리줄 없이 시작한 텍스트 — 첫 줄을 제목으로 본다
      current = { head: { title: line }, body: [] };
      continue;
    }

    current.body.push(rawLine);
  }

  flush();

  return { songs, skipped };
}

/** 가져오기 전에 보여줄 요약 — 구조가 의도대로 잡혔는지 확인용 */
export function summarizeParse(result: SongbookParseResult, secondaryLang = 'en'): Array<{
  number?: number;
  title: string;
  sectionLabels: string[];
  lineCount: number;
  langs: string[];
}> {
  return result.songs.map((song) => {
    const sections = song.sections ?? parseLyrics(song.lyrics ?? '', { secondaryLang });
    return {
      ...(song.number !== undefined ? { number: song.number } : {}),
      title: song.title,
      sectionLabels: sections.map((s) => s.label),
      lineCount: sections.reduce((sum, s) => sum + s.lines.length, 0),
      langs: [...new Set(sections.flatMap((s) => s.lines.map((l) => l.lang)))],
    };
  });
}

/** 컨트롤 패널의 REST 호출. 모든 오류를 명시적으로 다룬다. */

import type {
  ApiResponse, BookMeta, Deck, LangCode, Passage, ParseResult, PlanKind, ReviewQueue,
  ServicePlan, Song, Songbook, SongEntry, SongSearchHit, SongSearchResult, Template, Translation,
} from '../../shared/types.ts';

export interface ServerInfo {
  port: number;
  outputUrl: string;
  controlUrl: string;
  wsUrl: string;
  lanAddresses: string[];
  dataDir: string;
  bibleSourceDir: string;
  bibleReady: boolean;
  translationCount: number;
  songCount: number;
  planCount: number;
  defaultTranslation: string;
  connections: { control: number; output: number };
}

/**
 * 교독문이 어느 찬송가의 것인지.
 *
 * `server/db/readings.ts` 가 원본이지만 클라이언트가 서버를 import 할 수 없어 여기에
 * 적는다. 값이 둘뿐이고 좀처럼 바뀌지 않는다.
 */
export type ReadingBook = 'hymn_old' | 'hymn_new';

export const READING_BOOK_LABELS: Readonly<Record<ReadingBook, string>> = {
  hymn_old: '통일찬송가용',
  hymn_new: '새찬송가용',
};

/** 교독문 목록의 한 줄 — 본문 줄은 담지 않는다 (고르는 데 필요 없다) */
export interface ReadingSummary {
  number: number;
  title: string;
  lineCount: number;
  slideCount: number;
}

/** 배경으로 쓸 수 있는 그림 하나 (동영상은 OBS 가 맡는다) */
export interface BackgroundFile {
  name: string;
  bytes: number;
  url: string;
}

export interface PassageResponse {
  parse: ParseResult;
  passage: Passage | null;
  deck: Deck | null;
  paging?: string;
  unknownTranslations?: string[];
  unavailableTranslations?: string[];
}

class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new ApiError(`서버에 연결할 수 없습니다 (${url})`);
  }

  let body: ApiResponse<T>;
  try {
    body = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError(`응답을 해석할 수 없습니다 (HTTP ${response.status})`);
  }

  if (!response.ok || !body.success || body.data === null) {
    throw new ApiError(body.error ?? `요청이 실패했습니다 (HTTP ${response.status})`);
  }
  return body.data;
}

function send<T>(method: 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<T> {
  return request<T>(url, {
    method,
    ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  });
}

const get = <T,>(url: string): Promise<T> => request<T>(url);

export const api = {
  info: () => get<ServerInfo>('/api/info'),
  translations: () => get<Translation[]>('/api/translations'),
  books: () => get<BookMeta[]>('/api/books'),
  parse: (q: string) => get<ParseResult>(`/api/bible/parse?q=${encodeURIComponent(q)}`),
  passage: (ref: string, translationIds: string[], paging: string) =>
    get<PassageResponse>(
      `/api/bible/passage?ref=${encodeURIComponent(ref)}&t=${encodeURIComponent(translationIds.join(','))}&paging=${paging}`,
    ),

  songs: (q: string, limit = 60, songbookId?: string | null) =>
    get<SongSearchResult>(
      `/api/songs?q=${encodeURIComponent(q)}&limit=${limit}` +
        (songbookId ? `&book=${encodeURIComponent(songbookId)}` : ''),
    ),

  recentSongs: (limit = 12) => get<SongSearchHit[]>(`/api/songs/recent?limit=${limit}`),
  frequentSongs: (limit = 12) => get<SongSearchHit[]>(`/api/songs/frequent?limit=${limit}`),
  incompleteSongs: (songbookId?: string) =>
    get<Array<{ id: number; title: string; entries: SongEntry[]; sectionCount: number; lineCount: number; reason: string }>>(
      '/api/songs/incomplete' + (songbookId ? `?book=${encodeURIComponent(songbookId)}` : ''),
    ),

  songbooks: () => get<Songbook[]>('/api/songbooks'),
  createSongbook: (name: string, shortLabel?: string, numbered = true) =>
    send<Songbook>('POST', '/api/songbooks', { name, shortLabel, numbered }),
  updateSongbook: (id: string, patch: { name?: string; shortLabel?: string; quickSlot?: number | null }) =>
    send<Songbook>('PUT', `/api/songbooks/${encodeURIComponent(id)}`, patch),
  deleteSongbook: (id: string) =>
    send<{ deleted: string; movedToMisc: number }>('DELETE', `/api/songbooks/${encodeURIComponent(id)}`),
  parseSongbookText: (text: string, numbered: boolean) =>
    send<{ songs: Array<{ number?: number; title: string }>; skipped: string[] }>(
      'POST', '/api/songbooks/parse', { text, numbered },
    ),
  importSongbook: (id: string, text: string, mode: 'add' | 'replace') =>
    send<{
      songbook: Songbook; added: number; replaced: number; skipped: string[]; missingNumbers: number[];
    }>('POST', `/api/songbooks/${encodeURIComponent(id)}/import`, { text, mode }),
  setSongEntries: (songId: number, entries: Array<{ songbookId: string; number?: number | null }>) =>
    send<Song>('PUT', `/api/songs/${songId}/entries`, { entries }),
  song: (id: number) => get<{ song: Song; availableLangs: LangCode[] }>(`/api/songs/${id}`),
  songDeck: (
    id: number,
    langs: LangCode[],
    lines: string,
    sectionId?: number,
    /** 템플릿이 지정한 표시 행 폭 — 운율 행을 이 폭에 맞춰 묶는다 */
    maxChars?: number,
  ) =>
    get<{ deck: Deck; langs: LangCode[]; availableLangs: LangCode[]; missingLangs: LangCode[] }>(
      `/api/songs/${id}/deck?langs=${encodeURIComponent(langs.join(','))}&lines=${lines}` +
        (sectionId !== undefined ? `&section=${sectionId}` : '') +
        (maxChars !== undefined ? `&maxChars=${maxChars}` : ''),
    ),
  favorites: (limit = 5) => get<SongSearchHit[]>(`/api/songs/favorites?limit=${limit}`),
  toggleFavorite: (id: number, value: boolean) =>
    send<{ id: number; favorite: boolean }>('POST', `/api/songs/${id}/favorite`, { value }),

  reviewQueue: (options: {
    sort?: string;
    pendingOnly?: boolean;
    book?: string;
    limit?: number;
    offset?: number;
  }) => {
    const query = new URLSearchParams();
    if (options.sort) query.set('sort', options.sort);
    if (options.pendingOnly) query.set('pending', 'true');
    if (options.book) query.set('book', options.book);
    if (options.limit !== undefined) query.set('limit', String(options.limit));
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    return get<ReviewQueue>(`/api/songs/review?${query}`);
  },
  confirmSong: (id: number) => send<{ id: number; confirmed: boolean }>('POST', `/api/songs/${id}/confirm`, {}),
  unconfirmSong: (id: number) => send<{ id: number; confirmed: boolean }>('DELETE', `/api/songs/${id}/confirm`, {}),

  saveLyrics: (id: number, text: string) =>
    send<{ song: Song; availableLangs: LangCode[] }>('PUT', `/api/songs/${id}/lyrics`, { text }),

  plans: (kind?: PlanKind) => get<ServicePlan[]>('/api/plans' + (kind ? `?kind=${kind}` : '')),
  createPlan: (name: string, serviceDate: string, items: unknown[], kind?: PlanKind) =>
    send<{ plan: ServicePlan; rejected?: string[] }>('POST', '/api/plans', {
      name,
      serviceDate,
      items,
      ...(kind ? { kind } : {}),
    }),
  updatePlan: (id: number, patch: { name?: string; items?: unknown[]; defaults?: unknown }) =>
    send<{ plan: ServicePlan; rejected?: string[] }>('PUT', `/api/plans/${id}`, patch),
  duplicatePlan: (id: number, name?: string) =>
    send<ServicePlan>('POST', `/api/plans/${id}/duplicate`, name === undefined ? {} : { name }),
  deletePlan: (id: number) => send<{ deleted: number }>('DELETE', `/api/plans/${id}`),

  backupSummary: () =>
    get<{ songs: number; templates: number; plans: number; settings: number; fonts: string[]; approximateBytes: number }>(
      '/api/backup/summary',
    ),
  importBundle: (bundle: unknown, mode: 'merge' | 'replace') =>
    send<{ songs: number; templates: number; plans: number; settings: number; fonts: number; skipped: string[] }>(
      'POST', '/api/backup/import', { bundle, mode },
    ),

  readings: (q?: string, book?: ReadingBook) => {
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (book) query.set('book', book);
    return get<{
      book: ReadingBook;
      /** 두 찬송가에 각각 몇 편이 있는지 */
      counts: Record<ReadingBook, number>;
      total: number;
      items: ReadingSummary[];
    }>('/api/readings' + (query.size > 0 ? `?${query}` : ''));
  },
  reading: (number: number, book?: ReadingBook) =>
    get<{
      number: number;
      title: string;
      book: ReadingBook;
      lines: string[];
      slides: Array<{ leader: string; people?: string }>;
    }>(`/api/readings/${number}` + (book ? `?book=${book}` : '')),

  backgrounds: () =>
    get<{
      files: BackgroundFile[];
      /** `~/Desktop/Data/Background` 의 그림들 — 읽기 전용 */
      library: BackgroundFile[];
      libraryDir: string;
      dataDir: string;
    }>('/api/backgrounds'),

  templates: () => get<Template[]>('/api/templates'),
  createTemplate: (template: Partial<Template>) => send<Template>('POST', '/api/templates', template),
  currentTemplate: () => get<Template>('/api/template/current'),
  updateTemplate: (id: number, patch: Partial<Template>) => send<Template>('PUT', `/api/templates/${id}`, patch),
  duplicateTemplate: (id: number, name?: string) =>
    send<Template>('POST', `/api/templates/${id}/duplicate`, name ? { name } : {}),
  deleteTemplate: (id: number) => send<{ deleted: number }>('DELETE', `/api/templates/${id}`),
  /** 프리셋을 코드의 값으로 되돌린다 (덮어쓴 행을 지운다). 삭제와 다른 동작이다 */
  restoreTemplate: (id: number) => send<Template>('POST', `/api/templates/${id}/restore`, {}),
};

export { ApiError };

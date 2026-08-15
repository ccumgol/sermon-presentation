/** 컨트롤 패널의 REST 호출. 모든 오류를 명시적으로 다룬다. */

import type {
  ApiResponse, BookMeta, Deck, LangCode, Passage, ParseResult, ReviewQueue,
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

  plans: () => get<ServicePlan[]>('/api/plans'),
  createPlan: (name: string, serviceDate: string, items: unknown[]) =>
    send<{ plan: ServicePlan; rejected?: string[] }>('POST', '/api/plans', { name, serviceDate, items }),
  updatePlan: (id: number, patch: { name?: string; items?: unknown[] }) =>
    send<{ plan: ServicePlan; rejected?: string[] }>('PUT', `/api/plans/${id}`, patch),
  deletePlan: (id: number) => send<{ deleted: number }>('DELETE', `/api/plans/${id}`),

  backupSummary: () =>
    get<{ songs: number; templates: number; plans: number; settings: number; fonts: string[]; approximateBytes: number }>(
      '/api/backup/summary',
    ),
  importBundle: (bundle: unknown, mode: 'merge' | 'replace') =>
    send<{ songs: number; templates: number; plans: number; settings: number; fonts: number; skipped: string[] }>(
      'POST', '/api/backup/import', { bundle, mode },
    ),

  templates: () => get<Template[]>('/api/templates'),
  currentTemplate: () => get<Template>('/api/template/current'),
  updateTemplate: (id: number, patch: Partial<Template>) => send<Template>('PUT', `/api/templates/${id}`, patch),
  duplicateTemplate: (id: number, name?: string) =>
    send<Template>('POST', `/api/templates/${id}/duplicate`, name ? { name } : {}),
  deleteTemplate: (id: number) => send<{ deleted: number }>('DELETE', `/api/templates/${id}`),
};

export { ApiError };

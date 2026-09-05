/** 컨트롤 패널의 REST 호출. 모든 오류를 명시적으로 다룬다. */

import type { SheetSummary } from '../../lib/sheet-attach.ts';

import type {
  ApiResponse, BookMeta, Deck, LangCode, Passage, ParseResult, PlanKind, ReviewQueue,
  SearchResult, ServicePlan, Song, Songbook, SongEntry, SongSearchHit, SongSearchResult,
  Template, Testament, Translation,
} from '../../shared/types.ts';

/** 태블릿 연결 — QR 과 상태 (`/api/tablet-access`) */
export interface TabletAccess {
  /** LAN 에 열려 있는가 — 닫혀 있으면 주소를 주지 않는다 */
  lanOpen: boolean;
  /** 접속 암호가 정해져 있는가 */
  passwordSet: boolean;
  targets: Array<{
    address: string;
    /** 어느 장치인가 (`en0`) — 주소가 여러 개일 때 고르는 단서 */
    iface: string;
    url: string;
    qr: { size: number; path: string; moduleCount: number };
  }>;
}

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
  tabletAccess: () => get<TabletAccess>('/api/tablet-access'),
  translations: () => get<Translation[]>('/api/translations'),
  books: () => get<BookMeta[]>('/api/books'),
  /**
   * 성경 DB 를 언제 무엇으로 만들었는지 (`build_info` 표).
   * 값은 빌드 스크립트가 넣는 대로라 키가 늘 수 있어 문자열 사전 그대로 받는다.
   */
  bibleBuildInfo: () => get<Record<string, string>>('/api/bible/build-info'),
  parse: (q: string) => get<ParseResult>(`/api/bible/parse?q=${encodeURIComponent(q)}`),
  /**
   * 낱말로 절을 찾는다. 한 역본 안에서만 찾는다 — 서버가 역본마다 다른 방식을 쓴다
   * (한국어는 부분일치, 그 밖은 어절 검색). 여러 역본을 한 번에 섞으면 어느 방식으로
   * 걸린 것인지 알 수 없어 강조도 안내도 어긋난다.
   */
  searchBible: (q: string, translationId: string, testament?: Testament, limit = 50) =>
    get<SearchResult>(
      `/api/bible/search?q=${encodeURIComponent(q)}&t=${encodeURIComponent(translationId)}&limit=${limit}` +
        (testament ? `&testament=${testament}` : ''),
    ),
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
  song: (id: number) =>
    get<{ song: Song; availableLangs: LangCode[]; sheet?: SheetSummary }>(`/api/songs/${id}`),
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

  /**
   * 새 곡을 만든다 — **곡집을 주지 않으면 '기타' 에 번호 없이 들어간다.**
   *
   * 가사는 비워도 된다. 만든 뒤 두 칸 편집기에서 채우는 것이 자연스럽다.
   */
  createSong: (title: string, text = '') =>
    send<Song>('POST', '/api/songs', { title, text }),

  /** 곡을 지운다 — 되돌릴 수 없다. 부르는 쪽이 반드시 확인을 받아야 한다 */
  deleteSong: (id: number) => send<{ id: number }>('DELETE', `/api/songs/${id}`, {}),
  /**
   * 대응곡 연결·해제 (새찬송가 ↔ 통일찬송가처럼 **가사가 다른 같은 찬송**).
   * 둘 다 갱신된 곡을 돌려준다 — 화면이 다시 조회하지 않아도 된다.
   */
  linkSong: (id: number, linkedId: number) => send<Song>('POST', `/api/songs/${id}/link`, { linkedId }),
  unlinkSong: (id: number, linkedId: number) => send<Song>('DELETE', `/api/songs/${id}/link/${linkedId}`),

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
      /** 슬라이드쇼가 가리킬 수 있는 하위 폴더 (그림이 있는 것만) */
      folders: { library: Array<{ name: string; count: number }>; data: Array<{ name: string; count: number }> };
      libraryDir: string;
      dataDir: string;
    }>('/api/backgrounds'),

  /** 슬라이드쇼 한 폴더의 그림 — 순서표가 폴더만 담으므로 띄울 때 읽는다 */
  slideshow: (source: 'library' | 'data', folder: string) =>
    get<{ source: string; folder: string; files: BackgroundFile[] }>(
      `/api/backgrounds/slideshow?source=${encodeURIComponent(source)}&folder=${encodeURIComponent(folder)}`,
    ),

  /**
   * 악보 모양을 사람이 정한다. `null` 이면 **자동 짐작으로 되돌린다.**
   *
   * 곡이 아니라 **악보**(곡집·번호)에 붙는다 — 같은 악보를 여러 곡이 가리킬 수 있고,
   * 모양은 악보가 어떻게 인쇄됐는지의 성질이다.
   */
  setSheetLayout: (songbookId: string, number: number, layout: 'shared' | 'sequential' | null) =>
    send<{ songbookId: string; number: number; layout: 'shared' | 'sequential' | null }>(
      'PUT',
      `/api/sheets/${encodeURIComponent(songbookId)}/${number}/layout`,
      { layout },
    ),

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

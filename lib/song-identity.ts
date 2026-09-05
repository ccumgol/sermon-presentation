/**
 * **같은 곡인가** — 자료를 옮길 때 이미 있는 곡을 알아보는 규칙.
 *
 * `merge` 로 가져오기를 두 번 하면 곡이 통째로 복제되던 것을 막는다.
 *
 * ## 왜 번호만으로는 안 되는가
 *
 * `(곡집, 번호)` 는 사람이 정한 고정 좌표라 가장 믿을 만하지만 **유일하지 않다.**
 * 같은 번호를 두 곡이 갖는 경우가 실제로 35건 있다(많은물소리 301~ 등 실측).
 * 번호만 보고 건너뛰면 그중 한 곡이 조용히 사라진다.
 *
 * ## 그래서 번호 **와** 제목을 함께 본다
 *
 * 둘 다 같으면 같은 곡으로 본다. 번호가 같고 제목이 다르면 **다른 곡**이다 —
 * 위의 35건이 바로 그것이라, 둘 다 남겨야 맞다.
 *
 * 번호가 아예 없는 곡('기타' 등)은 제목만 본다. 위험이 없지는 않지만,
 * 대안은 **가져올 때마다 반드시 복제되는 것**이라 그쪽이 확실히 나쁘다.
 *
 * ## 제목은 느슨하게 맞춘다
 *
 * 띄어쓰기·문장부호가 한 칸 다른 것 때문에 같은 곡이 둘이 되면 안 된다.
 * `normalizeTitle`(`server/db/songs.ts`)과 같은 취지지만, 여기서는 저장소에
 * 기대지 않도록 필요한 만큼만 다시 적는다 — 이 파일은 순수 함수만 둔다.
 */

/** 곡을 알아보는 데 쓰는 최소 정보 */
export interface SongIdentity {
  title: string;
  /** 번호가 있는 수록만 뜻이 있다 — 번호 없는 수록은 좌표가 되지 못한다 */
  entries: ReadonlyArray<{ songbookId: string; number?: number }>;
}

/** 비교용 제목 — 공백·문장부호를 없애고 소문자로 */
export function titleKey(title: string): string {
  return title
    .normalize('NFC')
    .toLowerCase()
    .replace(/[\s·．.,'"“”‘’!?()\[\]-]/g, '');
}

/**
 * 이 곡을 가리키는 열쇠들. 하나라도 이미 있으면 같은 곡으로 본다.
 *
 * 번호가 있으면 `곡집:번호:제목`, 없으면 `제목` 하나다.
 */
export function identityKeys(song: SongIdentity): string[] {
  const title = titleKey(song.title);
  const numbered = song.entries.filter((entry) => entry.number !== undefined);
  if (numbered.length === 0) return [`t:${title}`];
  return numbered.map((entry) => `n:${entry.songbookId}:${entry.number}:${title}`);
}

/**
 * 이미 있는 곡들의 열쇠 목록. 같은 열쇠가 여럿이면 **먼저 넣은 것이 이긴다** —
 * 나중 것으로 덮으면 어느 곡에 이어질지가 넣은 순서에 따라 달라진다.
 */
export function buildIdentityIndex<T>(
  existing: ReadonlyArray<{ id: T } & SongIdentity>,
): Map<string, T> {
  const index = new Map<string, T>();
  for (const song of existing) {
    for (const key of identityKeys(song)) {
      if (!index.has(key)) index.set(key, song.id);
    }
  }
  return index;
}

/** 이미 있는 곡의 id. 없으면 `undefined` */
export function findExisting<T>(index: ReadonlyMap<string, T>, song: SongIdentity): T | undefined {
  for (const key of identityKeys(song)) {
    const found = index.get(key);
    if (found !== undefined) return found;
  }
  return undefined;
}

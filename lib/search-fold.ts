/**
 * 전문검색(FTS5) 비교용으로만 글자를 접는다. 화면에 보이는 본문은 바꾸지 않는다.
 *
 * KJV 는 1769년판 표기를 따른다 — 합자(Cæsar), 하이픈 지명(Beth-el), 둥근 아포스트로피(brother’s).
 * FTS5 unicode61 토크나이저에게 æ 는 별개의 글자이고 하이픈은 낱말 경계라서, 키보드로 친
 * 'Caesar'·'Bethel' 로는 찾지 못한다. 빌드가 verses_fts 에 이 접은 글자를 넣고, 검색어도 같은
 * 방식으로 접는다. copyBible(Swift·desktop) 의 검색 접기와 같은 규칙이다.
 */
export function foldForSearch(text: string): string {
  return text
    .replace(/[’‘ʼ]/g, "'")
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'Ae')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'Oe')
    .replace(/(?<=\p{L})-(?=\p{L})/gu, '');
}

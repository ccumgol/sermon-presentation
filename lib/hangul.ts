/** 한글 초성 검색 지원. 오퍼레이터가 'ㅇㅎ' 로 요한복음을 찾을 수 있게 한다. */

const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;
const JUNG_JONG_COUNT = 588; // 21 * 28

/** 유니코드 조합형 초성 순서 (U+3131~U+314E 중 초성으로 쓰이는 19자) */
const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
  'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
] as const;

/** 겹자음 초성을 홑자음으로 접는다. 사용자는 'ㄲ' 대신 'ㄱ' 을 치기 쉽다. */
const FOLD: Record<string, string> = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' };

/**
 * 문자열에서 초성만 뽑는다. 한글 음절이 아닌 문자는 그대로 남긴다.
 * '요한복음' → 'ㅇㅎㅂㅇ', '고린도전서' → 'ㄱㄹㄷㅈㅅ'
 */
export function toChoseong(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= SYLLABLE_START && code <= SYLLABLE_END) {
      const index = Math.floor((code - SYLLABLE_START) / JUNG_JONG_COUNT);
      const jamo = CHOSEONG[index]!;
      out += FOLD[jamo] ?? jamo;
    } else if (FOLD[ch]) {
      out += FOLD[ch]!;
    } else {
      out += ch;
    }
  }
  return out;
}

/** 입력이 초성 자모만으로 이루어졌는지 (즉 초성 검색 의도인지) */
export function isChoseongOnly(text: string): boolean {
  if (text.length === 0) return false;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    // U+3131~U+314E: 호환용 자모 자음
    if (code < 0x3131 || code > 0x314e) return false;
  }
  return true;
}

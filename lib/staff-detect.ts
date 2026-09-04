/**
 * 악보에서 **단(staff system)** 의 위·아래 경계를 찾는다.
 *
 * 왜 필요한가: 악보 한 장이 세로 2,245px 까지 된다. 통째로 화면에 띄우면 글자가
 * 손톱만 해져 못 읽는다. 지금 부르는 줄의 **단 하나만** 잘라 보여 주려면 각 단이
 * 세로로 어디서 어디까지인지 알아야 한다.
 *
 * ## 오선을 앵커로 쓴다
 *
 * '검은 픽셀이 많은 행' 으로 찾으면 안 된다: 스캔이 조금 기울어 있어 한 줄이 여러
 * 행에 걸치고, 그러면 어느 행도 폭의 60% 를 넘지 못한다 (1000번에서 10단 중 앞
 * 5단만 잡혔다, 2026-09-04 실측).
 *
 * 대신 행마다 **가장 긴 가로 연속 검은 구간**을 본다. 기울어도 그 행 안에 긴 조각은
 * 남는다. 폭의 15% 를 넘으면 오선 조각으로 본다.
 *
 * **그래도 기울기는 미리 펴야 한다.** 많이 기운 악보는 이 방법으로도 못 잡는다
 * (0301번은 7단인데 2줄만 잡혔다). 그래서 변환할 때 `-deskew` 로 펴서 저장한다
 * (`scripts/convert-sheets.ts`) — 좌표가 화면에 나가는 그림과 같아야 하므로
 * 검출할 때만 펴서는 안 된다.
 *
 * 표본 150장 실측(기울기 보정 뒤): 무리 887개 중 **822개(92.7%)가 정확히 5줄**.
 *
 * ## 자를 범위는 잉크 분포로 정한다
 *
 * 한 단은 위에 **코드 기호**(C, G7), 가운데 **오선과 음표**, 아래 **가사**로 되어 있다.
 * 처음에는 오선 높이의 몇 배로 넓혔는데, **가사가 두 줄인 악보에서 둘째 줄이 잘렸다**
 * (1000번 5단, 1·2절이 겹쳐 적힌 단). 악보마다 가사가 한 줄이거나 두 줄이라
 * 비율로는 맞출 수 없다.
 *
 * 그래서 **내용 띠**(잉크가 있는 세로 구간)를 세어, 이 단에 속하는 띠를 아래위로
 * 붙여 나간다. 다음 단의 **코드 기호 띠**는 붙이지 않는다 — 그것은 다음 단의 것이다.
 * 코드 띠는 '다음 오선에서 오선 높이 이내로 가까운 띠' 로 알아본다.
 *
 * 넘치는 쪽으로 기울인다: 다음 단의 코드가 살짝 보이는 것은 괜찮지만 **가사가 잘리면
 * 부를 수 없다.**
 */

/** 오선 조각으로 볼 최소 길이 (그림 폭에 대한 비율) */
export const LINE_RUN_RATIO = 0.15;

/** 이만큼 이내로 떨어진 오선 조각은 같은 줄로 본다 (선 두께가 2~4px) */
const LINE_MERGE_GAP = 3;

/**
 * 이 수보다 적은 줄로 이루어진 무리는 **단이 아니다** — 버린다.
 *
 * 악보에는 오선 말고도 긴 가로선이 있다: 반복 구간을 묶는 **볼타 괄호**(`1.` `2.`),
 * 밑줄 장식 따위다. 기울기를 펴고 나면 이것들이 오선만큼 곧아져 줄로 잡힌다
 * (0001번에서 762행에 하나 생겨 '1줄짜리 단' 이 됐다).
 *
 * 표본 150장 실측: 5줄 무리 822개 · 1줄 48개 · 2줄 6개 · 4줄과 6줄 합쳐 11개.
 * **1~2줄은 거의 전부 잡선**이고 진짜 단은 4줄 이상이다. 3 으로 자르면 잡선을
 * 걸러 내면서 한 줄쯤 놓친 단은 살린다.
 */
const MIN_LINES_PER_SYSTEM = 3;

/**
 * 줄 사이 간격이 오선 안 간격의 이 배를 넘으면 **다른 단**으로 본다.
 *
 * 실측: 오선 안은 10~12px, 단 사이는 100~117px — 10배 가까이 벌어져 있어
 * 이 값이 3이든 5든 결과가 같다. 3 은 안전한 쪽이다.
 */
const SYSTEM_SPLIT_RATIO = 3;

/** 빈 행으로 볼 잉크 상한 (폭에 대한 비율) — 먼지·점 몇 개는 무시한다 */
const BLANK_RATIO = 0.004;

/** 내용 띠로 인정할 최소 잉크 (폭에 대한 비율) — 이보다 옅으면 얼룩으로 본다 */
const BAND_MIN_RATIO = 0.03;

/**
 * 이 높이보다 **얇은 띠는 코드 기호**로 본다 (오선 높이에 대한 비율).
 *
 * 이것이 이 파일의 핵심 판별이다. 간격으로 나누려 했더니 실패했다 — 오선과 가사
 * 사이(8px)가 가사와 다음 단 코드 사이(7px)보다 오히려 넓은 악보가 있었다
 * (0001번 2단). 반면 **높이는 확실히 다르다**: 코드 기호 띠는 4~18px, 가사 띠는
 * 35px 이상이다 (2026-09-04 실측).
 *
 * 맨 아래 단에서는 작곡자 표기(`Honeytree 曲`, 약 20px)를 걸러내는 데도 쓴다.
 */
const CHORD_MAX_RATIO = 0.5;

/**
 * 이만큼(오선 높이의 배수) 떨어진 띠는 **이 단의 것이 아니다.**
 *
 * 한 단 안의 틈은 8~23px 인데(오선↔가사, 가사 1절↔2절) 악보 맨 아래 작곡자 표기는
 * 마지막 가사에서 80px 넘게 떨어져 있다. 높이만으로는 못 거른다 — 장식 글자(`曲`)가
 * 커서 코드 기호보다 두껍기 때문이다 (1000번 실측).
 */
const DETACH_GAP = 1.0;

/** 이웃 단의 오선을 물지 않도록 남기는 여백 */
const KEEP_OFF = 2;

/** 세로 구간 (양끝 포함) */
export interface Band {
  from: number;
  to: number;
}

export interface StaffSystem {
  /** 오선 다섯 줄 각각의 세로 구간 */
  lines: Band[];
  /** 오선만의 범위 */
  staff: Band;
  /** 화면에 잘라 낼 범위 — 코드·가사를 품는다 */
  crop: Band;
}

export interface DetectResult {
  systems: StaffSystem[];
  /**
   * 줄이 다섯이 아닌 단 — 사람이 봐야 한다.
   *
   * 조용히 넘기지 않는 이유: 넷이면 한 줄을 놓친 것이고 여섯이면 무언가를 오선으로
   * 잘못 본 것이다. 어느 쪽이든 자른 범위가 어긋나 예배 중 화면에 반쪽짜리 악보가 나간다.
   */
  odd: Array<{ index: number; lineCount: number }>;
}

/**
 * 행마다 '가장 긴 가로 연속 검은 구간' 을 받아 오선 줄을 찾는다.
 *
 * 픽셀을 직접 읽지 않는 이유: Node 에 이미지 디코더가 없어 변환 도구를 거쳐야 하는데,
 * 그 부분과 판정 로직을 섞으면 **판정을 테스트할 수 없다.** 숫자 배열만 받는다.
 */
export function findStaffLines(longestRun: readonly number[], width: number): Band[] {
  const threshold = width * LINE_RUN_RATIO;
  const lines: Band[] = [];

  for (let y = 0; y < longestRun.length; y++) {
    if (longestRun[y]! < threshold) continue;
    const last = lines[lines.length - 1];
    if (last && y - last.to <= LINE_MERGE_GAP) last.to = y;
    else lines.push({ from: y, to: y });
  }
  return lines;
}

const center = (band: Band): number => (band.from + band.to) / 2;

/**
 * 오선 줄들을 단으로 묶는다.
 *
 * 줄 간격이 갑자기 벌어지는 곳에서 끊는다 — 오선 안 간격의 중앙값을 기준으로 본다.
 * 중앙값을 쓰는 이유는 단 사이의 큰 간격이 평균을 끌어올려 기준이 무의미해지기 때문이다.
 */
export function groupIntoSystems(lines: readonly Band[]): Band[][] {
  if (lines.length === 0) return [];

  const gaps = lines.slice(1).map((line, i) => center(line) - center(lines[i]!));
  if (gaps.length === 0) return [[...lines]];

  const sorted = [...gaps].sort((a, b) => a - b);
  // 오선 안 간격이 단 사이 간격보다 훨씬 많으므로 아래쪽 절반의 중앙값이 안전하다
  const inner = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
  const median = inner[Math.floor(inner.length / 2)]!;
  const limit = median * SYSTEM_SPLIT_RATIO;

  const groups: Band[][] = [[lines[0]!]];
  for (let i = 1; i < lines.length; i++) {
    if (gaps[i - 1]! > limit) groups.push([lines[i]!]);
    else groups[groups.length - 1]!.push(lines[i]!);
  }
  // 볼타 괄호 같은 잡선은 단이 아니다 (위 MIN_LINES_PER_SYSTEM 머리말)
  return groups.filter((group) => group.length >= MIN_LINES_PER_SYSTEM);
}

/**
 * 잉크가 있는 세로 구간(내용 띠) 목록.
 *
 * 아주 옅은 띠는 버린다 — 스캔 얼룩이 '내용' 으로 잡히면 단의 끝을 잘못 잡는다.
 */
export function contentBands(ink: readonly number[], width: number): Band[] {
  const blank = Math.max(2, width * BLANK_RATIO);
  const minPeak = width * BAND_MIN_RATIO;

  const bands: Band[] = [];
  let start = -1;
  let peak = 0;

  const close = (end: number): void => {
    if (start >= 0 && peak >= minPeak) bands.push({ from: start, to: end });
    start = -1;
    peak = 0;
  };

  for (let y = 0; y < ink.length; y++) {
    if (ink[y]! > blank) {
      if (start < 0) start = y;
      if (ink[y]! > peak) peak = ink[y]!;
    } else {
      close(y - 1);
    }
  }
  close(ink.length - 1);
  return bands;
}

/**
 * 단마다 자를 범위를 정한다 — 내용 띠를 아래위로 붙여 나간다.
 *
 * **이웃 단의 오선은 절대 물지 않는다.** 넘치면 다음 단의 코드가 살짝 보일 뿐이지만,
 * 이웃 오선이 들어오면 두 단이 한 화면에 나와 어느 줄을 부르는지 알 수 없다.
 */
export function cropRanges(groups: readonly Band[][], bands: readonly Band[], height: number): StaffSystem[] {
  const bandHeight = (band: Band): number => band.to - band.from + 1;

  return groups.map((lines, index) => {
    const staff: Band = { from: lines[0]!.from, to: lines[lines.length - 1]!.to };
    const staffHeight = Math.max(1, staff.to - staff.from);
    const chordMax = staffHeight * CHORD_MAX_RATIO;

    const previous = groups[index - 1];
    const next = groups[index + 1];
    /** 이 단이 쓸 수 있는 세로 범위 — 이웃 오선은 물지 않는다 */
    const floor = previous ? previous[previous.length - 1]!.to + KEEP_OFF : 0;
    const ceiling = next ? next[0]!.from - KEEP_OFF : height - 1;

    /*
     * 이 두 오선 사이에 **온전히 들어오는** 띠만 본다.
     *
     * 걸쳐 있는 띠를 넣으면 안 된다: 첫 단에서 다음 단의 오선 띠(459-548)가 절반만
     * 들어와 '가사' 로 오인되고, 잘린 범위가 다음 단의 코드까지 삼켰다 (0001번 실측).
     */
    const inner = bands.filter((band) => band.from >= floor && band.to <= ceiling);
    const holder = inner.findIndex((band) => band.from <= staff.from && band.to >= staff.from);

    if (holder < 0) {
      // 오선을 품은 띠를 못 찾았다 — 판정 근거가 없으니 오선만 돌려준다
      return { lines: [...lines], staff, crop: { from: staff.from, to: staff.to } };
    }

    let from = inner[holder]!.from;
    let to = inner[holder]!.to;

    /*
     * 위 — 오선 바로 앞 띠가 **얇으면** 이 단의 코드 기호다. 두꺼우면 위 단의 가사다.
     * 코드가 오선에 붙어 한 띠가 된 악보도 있어(0001번 1단) 그때는 이미 들어와 있다.
     */
    const above = inner[holder - 1];
    if (above && bandHeight(above) <= chordMax && from - above.to <= staffHeight * DETACH_GAP) {
      from = above.from;
    }

    /*
     * 아래 — 남은 띠는 이 단의 가사다. 단, **마지막 띠가 얇으면** 그것은 이 단의 것이
     * 아니다: 다음 단의 코드 기호이거나(가운데 단) 작곡자 표기다(맨 끝 단).
     */
    let end = inner.length - 1;
    if (end > holder && bandHeight(inner[end]!) <= chordMax) end -= 1;
    // 멀리 떨어진 띠(악보 맨 아래 작곡자 표기)는 떼어 낸다
    while (end > holder && inner[end]!.from - inner[end - 1]!.to > staffHeight * DETACH_GAP) end -= 1;
    if (end > holder) to = inner[end]!.to;

    return {
      lines: [...lines],
      staff,
      crop: {
        from: Math.max(0, Math.min(from, staff.from), floor),
        to: Math.min(height - 1, Math.max(to, staff.to), ceiling),
      },
    };
  });
}

/** 행별 잉크·최장 연속 구간 → 단 목록. 위 넷을 이어 붙인 것이다 */
export function detectSystems(
  ink: readonly number[],
  longestRun: readonly number[],
  width: number,
  height: number,
): DetectResult {
  const groups = groupIntoSystems(findStaffLines(longestRun, width));
  const systems = cropRanges(groups, contentBands(ink, width), height);
  const odd = groups
    .map((group, index) => ({ index, lineCount: group.length }))
    .filter((one) => one.lineCount !== 5);
  return { systems, odd };
}

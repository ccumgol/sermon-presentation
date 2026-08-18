import type { Deck } from '../../../shared/types.ts';

interface Props {
  deck: Deck | null;
}

/**
 * **다음에 나갈 것들.** 오른쪽 열의 빈 자리를 채운다 (2026-08-18 사용자 지적).
 *
 * 미리보기는 '지금 나가는 것'만 보여 준다. 예배 중 정작 필요한 것은 **다음에 무엇이
 * 오는지**다 — 그것을 알아야 손을 미리 준비한다. 나중에 강사 모니터(2번째 화면)가
 * 이 자리를 쓰게 되면 그 안으로 옮기면 된다.
 *
 * 라벨은 덱이 이미 갖고 있으므로 새로 조회하지 않는다 — 예배 중 조회 실패가 없다.
 */
export function NextUp({ deck }: Props): React.JSX.Element {
  const total = deck?.slides.length ?? 0;

  /*
   * 송출 전에도 **카드는 남긴다.** 아무것도 그리지 않으면 오른쪽 열이 통째로 비어
   * 고장난 것처럼 보인다(2026-08-18 사용자 지적). 무엇을 하면 채워지는지 알려 준다.
   */
  if (!deck || total === 0) {
    return (
      <div className="card nextup-card">
        <h2>다음 화면</h2>
        <p className="hintline muted">
          <b>예배용으로 올리기</b> 를 누르면 이 자리에 다음에 나갈 화면들이 보입니다.
        </p>
      </div>
    );
  }

  const index = deck.index;
  /** 지금 것 다음부터 최대 6개 */
  const upcoming: Array<{ at: number; label: string }> = [];
  for (let at = index + 1; at < total && upcoming.length < 6; at += 1) {
    upcoming.push({ at, label: deck.labels[at] || `${at + 1}번째 화면` });
  }

  /** 지금 위치가 어느 항목(그룹)인지 — 그룹 경계로 판단한다 */
  const groupOf = (at: number): string | undefined => {
    let name: string | undefined;
    for (const group of deck.groups ?? []) {
      if (group.startIndex <= at) name = group.label;
      else break;
    }
    return name;
  };

  return (
    <div className="card nextup-card">
      <h2>다음 화면</h2>

      {upcoming.length === 0 ? (
        <p className="hintline muted">마지막 화면입니다.</p>
      ) : (
        <ol className="nextup-list">
          {upcoming.map((item, order) => (
            <li key={item.at} className={order === 0 ? 'soon' : undefined}>
              <span className="nextup-no">{item.at + 1}</span>
              <span className="nextup-label">{item.label}</span>
              {groupOf(item.at) !== groupOf(index) && order === 0 && (
                <span className="nextup-group">{groupOf(item.at)}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

# sermon-presentation — Agent 필수 지침

교회 예배용 프레젠테이션 앱. Node(빌드 없음 · **하한 24**, 개발은 26) + Fastify + `node:sqlite` + React 19,
OBS 브라우저 소스로 송출한다. **예배 중에 도는 코드다** — 화면이 멈추면 예배가 멈춘다.

**이 파일은 자동으로 읽힌다. 여기 있는 것은 전부 필수다.** 나머지는 필요할 때 찾아본다.

---

## 어느 문서를 언제 읽는가

| 언제 | 무엇을 |
|---|---|
| **작업을 시작할 때 (매번)** | [docs/collaboration-report.md](docs/collaboration-report.md) — 작업 보드·진행 중 로그·인계 메모. **여기에 착수 기록을 쓴다** |
| **무엇부터 할지 정할 때** | [docs/PLAN-next-2026-09-08.md](docs/PLAN-next-2026-09-08.md) — 우선순위와 착수 방법. **사용자 결정이 필요해 시작할 수 없는 것**도 갈라 두었다 |
| 화면·기능이 왜 그렇게 생겼는지 알아야 할 때 | [PLAN.md](PLAN.md) (설계 근거) · [docs/USER-GUIDE.md](docs/USER-GUIDE.md) (탭별 사용법) |
| 무언가 안 될 때 | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — 증상 → 원인 → 조치. **먼저 여기를 본다** |
| 전에 누가 무엇을 했는지 찾을 때 | [docs/work-log.md](docs/work-log.md) (작업 이력 전체) · [docs/CHANGELOG.md](docs/CHANGELOG.md) (요약) |
| 데이터가 이상할 때 | [docs/KNOWN-DATA-ISSUES.md](docs/KNOWN-DATA-ISSUES.md) — 원본 자료 자체의 문제 목록 |
| 찬양 자료를 밖에서 정리해 올 때 | [docs/SONG-IMPORT-FORMAT.md](docs/SONG-IMPORT-FORMAT.md) — 반입 형식 규격 |
| 보안을 건드릴 때 | [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md) — 확인된 위험과 조치. **2026-09-07 로 모든 항목이 닫혔다** — 새로 여는 것이 있으면 여기에 적는다 |
| 설치·구조를 알아야 할 때 | [README.md](README.md) |
| **무엇이 언제 달라졌는지** 알아야 할 때 | [docs/VERSION-HISTORY.md](docs/VERSION-HISTORY.md) — 판별 변경 요약. **커밋할 때 함께 고친다** |
| 배포판(맥·윈도우)을 만들 때 | [docs/PACKAGING.md](docs/PACKAGING.md) — 만드는 법과 **겪은 함정** |
| 설치 파일을 받은 사람이 물을 때 | [README '설치판으로 쓰기'](README.md) — 터미널 없이 쓰는 순서. 맥은 격리 표시 지우기 한 줄이 필요하다 |

---

## 착수하기 전에 — 매번, 예외 없이

1. **`docs/collaboration-report.md` 8장에 3줄을 먼저 쓴다.** 코드를 만지기 **전에**.
   ```
   - [시작 2026-08-22 / Agent X] 무엇을
     계획: 어떻게
     다음 단계: 지금 다음에 할 일
   ```
   **작업이 끝난 뒤 쓰는 기록은 남지 않는다** — 사용량 만료·크래시는 예고 없이 온다.
   30분 넘는 작업은 단계마다 `다음 단계:` 줄만 갱신한다. 마지막 갱신 지점이 중단 지점이다.

2. **`git status --short` 를 본다.** 내 것이 아닌 미커밋 변경이 있으면 다른 Agent 의
   미완성 작업이다. **임의로 되돌리지 않는다.** 8장 로그를 읽고
   [8.1 중단된 작업을 이어받는 절차](docs/collaboration-report.md#81-중단된-작업을-이어받는-절차)
   로 판정한다 — 추측하지 말고 실제 상태를 본다.

3. **보드(4장)에서 그 항목을 `🟡 진행중` 으로 바꾸고 이름·날짜를 적는다.**

---

## 절대 하지 않는 것

- **사용자 데이터를 되돌리기 전에 묻지 않는 것.** `data/songs.sqlite` 에는 사용자가 직접
  손본 가사가 있고 **git 에 없다.** 되돌릴 방법이 백업뿐이다. 실제로 한 번 지웠다.
- **`lines_source = 'manual'`(승인) 인 곡을 건드리는 것.** 사람이 **앱의 검토 탭에서
  승인 버튼을 누른** 표시다. 자동 스크립트도, **Agent 도** 손대지 않는다.
  곡을 콕 집어 지정할 때만 예외다.
  - `'imported'` 는 다르다 — 원본 자료의 줄나눔을 그대로 가져온 것이다. 자동 작업에서는
    똑같이 보호되지만(둘 다 `!== 'auto'`) **다시 반입·재정렬해도 되는 자료**다.
  - 일괄 반입이 `'manual'` 을 찍으면 안 된다. 실제로 그래서 새찬송가 645곡 전부가
    `manual` 이 되어 이 규칙이 헛돌았다 (2026-08-28, `scripts/relabel-lines-source.ts` 로 바로잡음).
- **미커밋 변경을 버리는 것** (`git checkout --`, `git stash drop`) — 사용자 승인 후에만.
- **원본 자료에 쓰는 것.** `~/Desktop/Data/BibleDB`, `~/Desktop/Data/Praise` 는 **읽기 전용**.
- **접속 암호를 코드·문서·로그에 평문으로 남기는 것.** `app.sqlite` 에 scrypt 해시로만
  있다. 값을 알아낼 방법은 없고, 필요하면 `npm run password` 로 다시 정한다.
- **루프백 면제를 없애는 것.** LAN 요청만 암호를 묻는다 — **OBS 브라우저 소스는 암호를
  입력할 수 없다.** 이것이 깨지면 예배 중 화면이 멈춘다 (`lib/lan-auth.ts` 머리말).
- **7777 서버를 묻지 않고 죽이는 것.** 사용자가 예배 준비 중 띄워 둔 것일 수 있다.
  검증은 **격리 서버**로 한다 (아래 참고).
- **이력 재작성** (force push, filter-repo) — 사용자 승인 필요.
- **백업이 곡 0개인 것을 모르고 넘어가는 것.** 아래 '백업' 참고.

---

## 데이터를 바꿀 때

**미리보기가 기본이고 `--apply` 를 붙여야 실제로 쓴다.** 새 스크립트도 같은 규칙을 따른다.

```bash
npm run lyrics:realign            # 미리보기 — 아무것도 쓰지 않는다
npm run lyrics:realign -- --apply # 실제로 쓴다
```

**쓰기 전에 스냅샷을 뜬다.** 코드에서는 이 함수를 부른다:

```ts
import { snapshotDatabases } from '../server/db/snapshot.ts';
const snap = snapshotDatabases('before-무엇');   // 실패하면 던진다 → 작업을 중단해야 한다
```

> ⚠️ **`cp data/songs.sqlite ...` 한 줄은 백업이 아니다.** 이 DB 는 WAL 모드라서 최근
> 변경이 `-wal` 에 있다. 한 파일만 복사하면 **곡 0개인 백업**이 된다(실제로 겪었다).
> `snapshotDatabases()` 는 `VACUUM INTO` 로 일관된 단일 파일을 뜬다 — 이걸 쓴다.

**`--apply` 로 돌리기 전에 사용자에게 알린다.** 사용자는 Agent 가 작업하는 동안에도
같은 DB 를 편집한다. 백업과 DB 가 다르다고 해서 "내 테스트 흔적" 이라고 단정하지 않는다.

**자기가 만든 변경만 목록으로 관리하고, 정리할 때 그 목록에 있는 것만 되돌린다.**

---

## 검증 — 주장하지 말고 확인한다

```bash
npx tsc --noEmit && npx vitest run && npx vite build
```

셋 다 통과해야 완료다. 커밋 메시지와 보고에 **무엇으로 확인했는지** 적는다.

**`src/`(React) 검사를 쓸 때** — 파일 맨 위 두 줄이 필요하다. 빼면 조용히 헛돈다.

```tsx
// @vitest-environment jsdom        ← 이 파일만 DOM 환경. 전역을 바꾸면 통합 검사가 영향받는다
afterEach(cleanup);                  ← globals:false 라 자동으로 안 붙는다. 없으면 다음 검사에서
                                       같은 요소가 두 개 잡힌다 (실제로 겪었다)
```

`.test.tsx` 는 `vitest.config.ts` 의 `include` 에 들어 있어야 돈다 — 없으면
**"No test files found" 만 나오고 지나간다.**

**브라우저 저장소는 `window.` 를 붙여 부른다.** 맨몸 `localStorage` 는 Node 자체의
실험적 전역이 jsdom 것을 가려서 `--localstorage-file` 없이는 **`undefined`** 다
(실제로 겪었다). `window.sessionStorage` 처럼 쓰면 jsdom 것이 온다.

**예배 순서 탭은 훅 일곱 + 컴포넌트 여덟이다.** `PlanPanel.tsx`(444줄)는
뼈대와 훅 조립·키보드만 갖는다 — 고칠 것을 아래에서 찾는다. 검사도 거기 붙어 있다.

| 로직 (`src/control/hooks/`) | 무엇 |
|---|---|
| `usePlanDraft` | 편집 중인 것(**척추**). 나머지가 이걸 붙잡는다 |
| `usePlanPreview` | 항목을 슬라이드로 푼다 (`resolveItem`) |
| `usePlanSend` | 화면으로 내보내는 것 전부 · 자동 넘김 · 라이브 판정 |
| `usePlanStorage` | 순서표 읽기·저장·삭제 (**사용자 데이터를 쓰는 길**) |
| `usePlanAdd` | 항목 추가 · 검색 디바운스 |
| `usePlanFeedback` | 배너 셋 (busy · error · notice) |
| `usePlanBackgrounds` | 배경으로 쓸 그림 목록 |

| 화면 (`src/control/components/plan/`) | 무엇 |
|---|---|
| `PlanCueList` | **예배를 진행하는 목록.** 선택(파란 테두리)과 송출(빨간 점)이 갈라져 있다 |
| `PlanAddBar` | 항목 추가 바 (열 종류) |
| `PlanDefaultsCard` | 이 예배의 기본값 |
| `PlanItemEditor` | 고른 항목의 설정 |
| `PlanHead` · `PlanActions` · `PlanNameBar` · `PlanLoadList` · `PlanDirtyLine` | 열기·저장 |

**여기에 화면을 더 자를 때의 규칙** (R-4 를 끝낸 판단이다):

- **낱개 값이 아니라 훅 객체를 넘긴다.** 추가 바를 낱개로 넘기면 프롭 28개,
  `add` 객체째로 넘기면 4개다. 훅 분리가 프롭 그룹을 이미 정해 놓았다.
- **블록당 프롭 10개를 넘으면 자르는 자리가 틀렸다는 신호다.** 프롭을 늘리지 말고
  덜 자르거나, 훅을 하나 더 만들거나, 부모에 둔다.
- **자를 수 있다고 자르지 않는다.** 한 폼을 행마다 쪼개면 `<select>` 한 줄짜리
  껍데기가 된다.

**커버리지는 묶음별로 문턱이 있다** (`lib/` · `server/` · `src/`). 값은 실측한
지금 값보다 조금 낮게 잡은 **ratchet** 이다 — 내려가지 않게 막는 것이 목적이니,
검사를 더했으면 그 값을 올려 둔다.

```bash
npx vitest run --coverage
```

**`./start.sh`(사용자의 `presentation` 명령)를 Agent 가 실행하지 않는다.** 그것은 사용자
데이터로 7777 을 잡고 브라우저를 연다. **검증은 격리 서버로 한다** — 포트를 직접 준다.

```bash
SCRATCH=/tmp/verify && mkdir -p $SCRATCH/backgrounds
PORT=7810 SERMON_DATA_DIR=$SCRATCH SERMON_BIBLE_DB=$PWD/data/bible.sqlite node server/index.ts
```

**고친 것에 따라 다시 해야 하는 일이 다르다.**

| 고친 곳 | 서버 재시작 | OBS 새로고침 |
|---|:---:|:---:|
| `server/` `lib/` `shared/` | ✅ | — |
| `src/control/` (패널) | ✅ (빌드 포함) | — |
| `public/output/` (출력 페이지) | — | ✅ |

---

## 커밋

`main` 직통이다(사용자 결정 — 예배 직전 수정에 병합 단계가 끼면 느려진다).
대신 **작게 자주** 커밋한다. 형식은 `feat:` `fix:` `docs:` `refactor:` `test:`.
메시지에 **원인·조치·검증**을 담는다.

**코드를 고쳤으면 판을 올린다** (2026-09-12 사용자 결정):

| 무엇 | 어떻게 | 보기 |
|---|---|---|
| 간단한 고침 | 가운데 자리 | `1.0.0` → `1.1.0` |
| 중요한 변경 | 앞자리, 나머지는 0 | `1.9.0` → `2.0.0` |

`package.json` 의 `version` 과 [docs/VERSION-HISTORY.md](docs/VERSION-HISTORY.md) 를
**함께** 고친다. 문서만 고친 커밋은 올리지 않는다 — 프로그램이 그대로다.
판 번호는 설치 파일 이름과 설정 탭의 '서버 정보 → 판' 에 그대로 나온다.

```bash
git diff --name-only origin/main..HEAD   # data/ 나 settings.local.json 이 섞였는지 확인
```

푸시가 실패하면 `git pull --rebase` 후 재시도한다.

---

## 코드에서 지키는 것

- **화면을 스스로 비우지 않는다.** 서버가 죽어도 출력 페이지는 마지막 내용을 유지한다.
  모르는 슬라이드 종류를 받으면 이전 화면을 그대로 둔다 — 예배 중 검은 화면을 막는다.
- **출력 페이지(`public/output/`)는 의존성 0.** React·CDN·외부 폰트를 쓰지 않는다.
  그래서 일부 로직이 `lib/` 와 의도적으로 중복돼 있다 — 고칠 때 **양쪽을 함께** 고친다.
  지금 짝인 것: `isAllowedStyleKey`(`lib/template-css.ts` ↔ `output.js`).
- **바깥에서 온 값은 형태부터 본다.** WS 페이로드·HTTP 본문·설정 값 모두.
  `deck:load` 는 `lib/deck-guard.ts`, `style:set` 은 `isAllowedStyleKey` 를 지난다 —
  **거부할 때는 로그를 남긴다**(조용히 버리면 예배 전에 진단할 수 없다).
- **설치판에서만 나타나는 함정이 있다.** 터미널로 돌릴 때는 셸의 환경을 물려받아
  드러나지 않는다 — 애드혹 서명 · 좁은 `PATH`(`/usr/bin:/bin:/usr/sbin:/sbin`) ·
  터미널 명령을 시키는 안내문. **설치판을 건드렸으면 앱을 실제로 띄워 확인한다.**
- **자동 결과는 제안이다.** 사람이 승인해야 확정된다.
- **추측 말고 실측.** 폰트 대체·글자 크기·스크롤바 폭까지 브라우저에서 재고 정했다.
- 파일은 200~400줄이 적당, **최대 800줄**. 함수는 50줄 이하.
  (`public/output/output.js` 는 의존성 0 때문에 의도적 예외)
- 기존 데이터를 직접 고치지 않고 새 복사본을 만든다.

---

## 자기 이름

Agent 이름은 **계정 이니셜**을 쓴다 (`Agent C`, `Agent J`). 협업의 취지는
**사용량 한도 이어달리기** — 여러 계정이 같은 PC·같은 `data/` 를 공유하며 이어서 작업한다.

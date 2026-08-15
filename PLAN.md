# Sermon Presentation — OBS 브라우저 소스 송출 시스템 기획서

> 성경 본문과 찬양 가사를 OBS Studio의 **브라우저 소스**로 송출하는 로컬 애플리케이션.
> 작성일: 2026-08-12 · 상태: 기획(구현 전)

---

## 1. 목표와 범위

### 1.1 핵심 목표

| # | 목표 | 성공 기준 |
|---|------|-----------|
| G1 | 성경 본문을 OBS에 즉시 송출 | 참조 입력 → 화면 반영까지 200ms 이내, 마우스 3클릭 이내 |
| G2 | 동일 본문의 다역본 동시 표시 | 주 역본 1 + 보조 역본 최대 2개, 절 단위 정렬 |
| G3 | 찬양 가사 2개 언어 동시 표시 | 한/영(또는 한/타 언어) 줄 단위 페어링 |
| G4 | 배경 투명 송출 | OBS에서 별도 크로마키 없이 글자만 합성 |
| G5 | 위치·크기·색상 자유 지정 | GUI로 조절, 즉시 미리보기, 템플릿으로 저장/재사용 |
| G6 | 예배 중 무장애 운영 | 오프라인 100% 동작, 단축키 조작, 실수 복구 1클릭 |

### 1.2 범위에 포함

- 성경 본문 검색·송출 (10개 역본, 원어 포함)
- 찬양 가사 등록·관리·다국어 송출
- 템플릿(스타일 프리셋) 시스템
- 예배 순서(큐/플레이리스트) 관리
- 오퍼레이터 컨트롤 패널 + 송출 화면 분리

### 1.3 범위에서 제외 (향후 확장)

- 영상/이미지 배경 재생 (OBS가 이미 잘 함 — 우리는 텍스트 레이어만 담당)
- OBS 씬 자동 전환 (Phase 5에서 obs-websocket 연동으로 선택 구현)
- 클라우드 동기화, 다중 사용자 협업
- 모바일 네이티브 앱 (반응형 웹으로 태블릿 지원은 함)

---

## 2. 시스템 아키텍처

### 2.1 전체 구조

```
┌──────────────────────────────────────────────────────────────┐
│  로컬 Node.js 서버 (localhost:7777)                          │
│                                                              │
│  ┌────────────┐   ┌──────────────┐   ┌───────────────────┐   │
│  │ REST API   │   │ WebSocket    │   │ Static Server     │   │
│  │ (검색/CRUD)│   │ (실시간 상태)│   │ (컨트롤/출력 UI)  │   │
│  └─────┬──────┘   └──────┬───────┘   └────────┬──────────┘   │
│        │                 │                     │             │
│  ┌─────▼─────────────────▼─────────────────────▼─────────┐   │
│  │  Live State Store (단일 진실 공급원, in-memory + 영속) │   │
│  └─────┬──────────────────────────────────┬──────────────┘   │
│        │                                  │                  │
│  ┌─────▼─────────┐  ┌──────────────┐  ┌──▼──────────────┐    │
│  │ bible.sqlite  │  │ songs.sqlite │  │ app.sqlite      │    │
│  │ (읽기 전용)   │  │ (찬양)       │  │ (템플릿/설정/큐)│    │
│  └───────────────┘  └──────────────┘  └─────────────────┘    │
└───────────┬──────────────────────┬───────────────────────────┘
            │                      │
   ┌────────▼─────────┐   ┌────────▼──────────────────────────┐
   │ 컨트롤 패널      │   │ OBS 브라우저 소스                 │
   │ (오퍼레이터 PC / │   │ http://localhost:7777/output      │
   │  태블릿 브라우저)│   │   ?layer=main   ← 본문/가사        │
   │ /control         │   │   ?layer=lower  ← 자막(로우서드)   │
   └──────────────────┘   │   ?layer=ref    ← 참조 표기 별도   │
                          └───────────────────────────────────┘
```

### 2.2 왜 이 구조인가

- **로컬 웹 서버 + 브라우저 소스**: OBS 브라우저 소스는 URL만 넣으면 되므로 가장 단순하고, 오퍼레이터 UI를 같은 서버에서 제공하면 태블릿·노트북 어디서든 조작 가능. 별도 플러그인 설치·OBS 버전 의존성 없음.
- **상태 단일화(Live State Store)**: 컨트롤 패널이 여러 개 열려 있어도, 출력 화면이 여러 개(멀티 레이어)여도 항상 같은 상태를 본다. 새로 연결된 클라이언트는 접속 즉시 현재 상태 스냅샷을 받으므로 **예배 중 OBS 브라우저 소스를 새로고침해도 화면이 복구**된다. (실전에서 가장 중요한 요구사항)
- **레이어 분리**: OBS에서 본문과 자막을 서로 다른 소스로 두면, 각각 위치·크기·표시여부를 OBS 쪽에서도 제어 가능해 유연성이 커진다.
- **DB 3분할**: 성경 DB는 읽기 전용·불변(대용량), 찬양은 자주 편집, 설정은 잦은 소규모 쓰기. 성격이 달라 파일을 나누면 백업·복구가 쉽다.

### 2.3 기술 스택

| 계층 | 선택 | 근거 |
|------|------|------|
| 런타임 | Node.js 26 | **TypeScript를 네이티브 실행**(빌드 단계 없음) + `node:sqlite` 내장 |
| 서버 | Fastify + `ws` | 경량, WebSocket 통합 간단 |
| DB | **`node:sqlite`** (내장) + FTS5 | `better-sqlite3` 를 쓰지 않는다 — 네이티브 모듈이 없으면 Electron 재빌드 문제가 사라진다. FTS5·`ATTACH`·`readOnly` 모두 동작 확인 |
| 컨트롤 UI | React + Vite + TypeScript | 상태 많은 UI, 타입 안정성 |
| 출력 화면 | **의존성 없는 순수 HTML/CSS/JS** | 렌더 안정성·시작 속도 최우선. OBS CEF에서 프레임워크 초기화 실패 위험 제거 |
| 스타일 | CSS Custom Properties (토큰) | 템플릿 값을 CSS 변수로 주입 → 리렌더 없이 즉시 반영 |
| 배포 | 개발: `npm start` 로컬 서버 → 배포: **Electron 패키징 (확정)** | 다른 봉사자 PC 설치 필요 |

> **D1 확정**: 개발 중에는 터미널 로컬 서버로 진행하고, **Phase 5에서 Electron 데스크톱 앱으로 패키징**합니다. 서버 코드를 그대로 감싸는 방식이므로 아키텍처 변경은 없습니다.
>
> Electron을 전제로 하면 지금부터 지켜야 할 제약이 몇 가지 생깁니다:
> 1. **경로를 하드코딩하지 않는다** — DB·설정·폰트 경로는 모두 `app.getPath('userData')` 기준으로 해석 가능한 단일 설정 모듈(`server/paths.ts`)을 통해서만 접근
> 2. **포트 충돌 대응** — 7777이 점유되면 자동으로 다음 포트를 잡고, 실제 포트를 UI와 "OBS용 URL 복사" 버튼에 반영
> 3. **네이티브 모듈 주의** — `better-sqlite3`는 Electron 재빌드가 필요하므로, Node 내장 `node:sqlite`를 우선 검토 (Phase 1에서 성능 비교 후 결정)
> 4. **데이터 이전** — 찬양·템플릿·예배순서를 단일 `.zip`으로 내보내기/가져오기 (다른 PC 설치 시 필수)

---

## 3. 데이터 계층

### 3.1 성경 데이터 — 기존 자산 재사용

**현재 보유** (`/Users/gihyunpark/Desktop/Data/BibleDB`, 총 ~167MB):

| 파일 | 역본 | 언어 |
|------|------|------|
| `개역개정NKRV.db` | 개역개정 | 한국어 |
| `개역한글KRV.db` | 개역한글 | 한국어 |
| `공동번역NCTB.db` | 공동번역 | 한국어 |
| `우리말성경.db` | 우리말성경 | 한국어 |
| `표준새번역SNKV.db` | 표준새번역 | 한국어 |
| `킹제임스흠정역KJVonly.db` | 흠정역 | 한국어 |
| `KJV.db` / `NIV.db` | KJV / NIV | 영어 |
| `ESV.db` / `14_ESV.db` | ESV — 2개 파일, `ESV.db` 사용 (§아래) | 영어 |
| `헬라어.db` / `히브리어.db` | 원어 | 그리스어 / 히브리어 |
| `현대인의성경.json` | 현대인의성경 (유일한 JSON 원본) | 한국어 |
| `hymn_new.db` / `hymn_old.db` | 새찬송가 645곡 / 통일찬송가 558곡 | **Phase 4에서 사용 (§3.2)** |
| `만나주석.db` | 만나주석 | 참고자료 (미사용) |
| `bible_dic.sqlite` | 성경사전 6,634항목 | 참고자료 (미사용) |

**원본 스키마 (Phase 1에서 실측)** — 예상과 달리 **두 종류**였다:

```sql
-- 안드로이드 성경앱 스키마 (10개 역본)
bible(_id, version, bibleCode, Jang, Jul, ThemeCd, Cont)
  -- bibleCode: 1=창세기 … 66=요한계시록, Jang=장, Jul=절, Cont=본문
volume_name(_id, version, bible, bibleCode, end, name, abbr)
bible_theme(_id, KindBCd, ThemeCd, StartJul, EndJul, Cont)  -- 소제목

-- ESV.db 만 다른 스키마
bible(book, chapter, verse, content)
  -- content 에 HTML 마크업: <block>, <span class="j">(예수님 말씀), &quot; 등
```

ESV 는 원본 폴더에 파일이 **두 개** 있다. `14_ESV.db` 가 android 스키마에 마크업도
없어 더 나아 보였지만, **31,086절 전수 비교에서 손상된 파생본으로 판명**됐다 —
`LORD`(YHWH)를 포함한 5,566절이 전부 `Lord` 로 바뀌었고 구두점 앞 공백 오류가
2,472절 있다. 그래서 `ESV.db` 를 쓰고 `14_ESV.db` 는 품질 저하 대체본으로만 남겼다
(사용 시 빌드가 경고). 자세한 비교는 [docs/KNOWN-DATA-ISSUES.md §4](docs/KNOWN-DATA-ISSUES.md).

그래서 역본별 스키마와 정제 규칙을 `scripts/bible-sources.ts` 에 **선언으로 모아**
어댑터 방식으로 처리한다. 원본 `bible` 테이블에는 (책,장,절) 유일성 제약이 없어
중복 행이 존재할 수 있다는 점도 확인했다.

**통합 DB 스키마 (`data/bible.sqlite`, 실제 구현)**:

```sql
CREATE TABLE translations (
  id TEXT PRIMARY KEY,           -- 'nkrv', 'niv', 'grk'
  name TEXT NOT NULL,            -- '개역개정'
  short_name TEXT NOT NULL,      -- '개정'
  lang TEXT NOT NULL,            -- 'ko','en','grc','heb'
  direction TEXT NOT NULL,       -- 'ltr' | 'rtl'
  coverage TEXT NOT NULL,        -- JSON: ["OT","NT"] — 헬라어=NT만, 히브리어=OT만
  verse_count INTEGER NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE books (
  code INTEGER PRIMARY KEY,      -- 1..66
  name_ko TEXT, abbr_ko TEXT, name_en TEXT, abbr_en TEXT,
  chapter_count INTEGER NOT NULL,      -- 개신교 표준 (표기·탐색용)
  max_chapter_count INTEGER NOT NULL,  -- 번들 역본 중 최대 (파싱 검증용)
  testament TEXT NOT NULL
);

-- 역본별 실제 장 수. 장 구분이 역본마다 달라 전역 값으로 표현할 수 없다.
CREATE TABLE translation_chapters (
  translation_id TEXT, book INTEGER, chapter_count INTEGER,
  PRIMARY KEY (translation_id, book)
);

CREATE TABLE verses (
  id INTEGER PRIMARY KEY,        -- FTS external content 용 rowid
  translation_id TEXT NOT NULL REFERENCES translations(id),
  book INTEGER NOT NULL, chapter INTEGER NOT NULL, verse INTEGER NOT NULL,
  text TEXT NOT NULL,            -- 표시용 정제 본문
  text_raw TEXT                  -- 정제로 달라진 경우에만 원문. NULL = text 가 원문
);
CREATE UNIQUE INDEX idx_verses_ref ON verses(translation_id, book, chapter, verse);

CREATE TABLE headings (
  translation_id TEXT, book INTEGER, chapter INTEGER,
  start_verse INTEGER NOT NULL,
  end_verse INTEGER,             -- NULL = 장 끝까지 (원본에 실제로 있음: 공동번역 80건)
  text TEXT NOT NULL
);

-- 본문을 중복 저장하지 않도록 external content 방식을 쓴다
CREATE VIRTUAL TABLE verses_fts USING fts5(
  text, content='verses', content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE build_info (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`text_raw` 를 **달라진 절에만** 넣어 용량을 줄였다 (311,223절 중 37,864절).
결과 DB 97MB.

**본문 정제 규칙** — 역본별로 다르므로 `bible-sources.ts` 에 선언한다:

| 역본 | 정제 |
|------|------|
| 개역개정·개역한글·공동번역·우리말성경 | 문단 기호 `○` 제거, 공백 정규화 |
| 표준새번역 | 위 + 본문 내 소제목 `<...>`, 각주 마커·각주 본문 제거 |
| KJV·흠정역 | 공백 정규화만. **보충어 대괄호 `[ ]` 는 보존** (KJV 14,229절) |
| ESV | HTML 엔티티 복원, 태그 제거, 빈 절 15개 건너뜀. **LORD/GOD(YHWH) 표기 보존** |
| 헬라어·히브리어 | 공백 정규화만. 악센트·니쿠드 보존 |

> **원칙**: 본문은 절대 임의 수정하지 않는다. 정제는 표시용이며 원문은 `text_raw` 에
> 남는다. 검증 스크립트가 **무작위 200절을 원본 DB와 직접 대조**하고, 정제 규칙을
> 원본에 다시 적용한 결과가 저장된 값과 같은지 확인한다.

**검색 전략 (Phase 1 실측으로 결정)** — 한국어는 FTS5로 부족하다:

| 방식 | 개역개정 '사랑' | 소요 |
|------|--------------:|-----:|
| FTS5 `unicode61` | 26건 (어절 완전일치만) | 17.6ms |
| `LIKE '%사랑%'` | **557건 (정답)** | 20.6ms |
| FTS5 `trigram` | 0건 (3글자 미만 질의 불가) | — |
| FTS5 `unicode61` (NIV 'love') | 526건 | 2.8ms |

FTS5 `unicode61` 은 한국어를 어절로만 쪼개 '사랑하사'·'사랑은'을 놓친다.
`trigram` 은 부분일치를 지원하지만 3글자 미만 질의를 못 하는데, '사랑'·'은혜'처럼
2음절이 한국어 검색어의 대부분이라 쓸 수 없다. 따라서:

- **한국어 역본 → `LIKE` 부분일치** (역본 1개당 약 20ms, 11역본 전체 119ms)
- **영어·헬라어·히브리어 → FTS5 어절 검색** (빠르고 랭킹 지원)

히브리어·헬라어는 결합 문자 순서가 달라 눈으로 같아도 `===` 가 실패한다.
비교·검색 시 양쪽 모두 `.normalize('NFC')` 를 거쳐야 한다.

**참조 파서 (`lib/reference-parser.ts`)** — 오퍼레이터 입력 속도의 핵심.
단위 테스트 70개로 고정했다.

지원 입력:
```
요 3:16    요3:16    요한복음 3장 16절    요 3.16    Gen. 1:1
시 23      시편 23편    창 1-2    요 3:16-4:2    롬 8:28-30
1요 2:1    요일 2:1    요한1서 2:1    I Samuel 3:1    Song of Songs 2:1
마 5:3-12; 6:9-13   (복수 구간, 책 이름 이어짐)
요 3:16,18          (콤마로 같은 장의 절 나열)
ㅇㅎㅂㅇ 3:16        (초성 — 전체 초성 일치 시 확정)
```
- 책 이름: 한글 정식/약어/별칭/초성, 영문 정식/약어/로마숫자, 원본 DB의 오타 표기까지
- `Isaiah` 가 로마숫자 `I` + `saiah` 로 오해되지 않도록 공백을 요구
- 확정하지 못하면 **후보 목록을 돌려주고 임의로 고르지 않는다**
  (`ㅇㅎ` → 여호수아·요한복음·요한일서… 6개 후보)
- 초성 색인은 **정식 한글명만** 등록. 약어까지 넣으면 `ㅇㅎ` 가 `왕하`(열왕기하)와
  정확히 일치해 요한복음 계열보다 먼저 확정되는 문제가 생긴다

> 사용 빈도 기반 후보 정렬은 컨트롤 패널(Phase 2)이 최근 사용 기록으로 처리한다.
> 파서는 추측하지 않는다.

**원본 데이터에서 발견한 문제** — 전부 [docs/KNOWN-DATA-ISSUES.md](docs/KNOWN-DATA-ISSUES.md)에 기록:

| 발견 | 성격 | 대응 |
|------|------|------|
| KJV 원본에 앞부분 잘린 절 158건 (시 23:1 = `of David. The LORD…`) | 원본 결함, 복원 불가 | 건수를 기준치로 추적. 늘어나면 검증 실패 |
| 히브리어에 에스더 3:12 없음 — 본문이 8:9 두 번째 행에 있음 | 원본 오류, 교정 가능 | 근거를 적어 3:12로 이동 (`DUPLICATE_FIXES`) |
| 요엘 4장(히브리어·공동번역), 다니엘 13·14장(공동번역) | 정상 — 판본 차이 | `CHAPTER_VARIANTS` 에 명시, 파서가 허용 |
| ESV 빈 절 15개 (마 17:21 등) | 정상 — ESV가 의도적으로 뺀 절 | 넣지 않음. 절 번호 구멍은 경고로만 |
| ESV 소제목 2,429건의 위치 정보 없음 (`ThemeCd` 전부 0, `KindBCd` 전부 1) | 원본 결함, 복원 불가 | 넣지 않음. 순서로 추론하면 한 곳만 틀려도 이후가 전부 밀려 엉뚱한 소제목이 송출된다. 영어 소제목은 NIV(2,120건) 사용 |
| `14_ESV.db` 가 LORD(YHWH) 5,566절을 전부 `Lord` 로 바꿔 놓음 + 구두점 앞 공백 2,472절 | 원본 파생본 손상 | `ESV.db` 를 쓴다. 검증기가 LORD 표기 절 수와 공백 오류를 검사해 재발을 막는다 |

### 3.2 찬양 데이터

**기존 자산 발견 (D7 답)** — 원본 폴더에 찬송가 DB 2개가 있다:

| 파일 | 찬송가 | 곡 수 | 행 수 | 번호 범위 |
|------|--------|------:|------:|-----------|
| `hymn_new.db` | 새찬송가 | 645 | 2,556 | 1–645 |
| `hymn_old.db` | 통일찬송가 | 558 | 2,317 | 1–558 |

```sql
tbl_hymn(_id, _number, _title, _title_no_space, _verse, _lyrics, _lyrics_no_space)
  -- 절 단위 1행. _no_space 컬럼은 검색용(공백 제거본)
```

**총 1,203곡을 수동 입력 없이 확보**했다. 다만 그대로 쓸 수 없고 가공이 필요하다:

| 제약 | 실측 | 대응 |
|------|------|------|
| **줄바꿈이 전혀 없다** | 2,556행 모두 `\n` 0개. 가사 길이 5–393자, 평균 79자 | 어절 경계 자동 줄나눔을 초기값으로 넣고 편집 UI에서 다듬는다 |
| **후렴이 절 안에 인라인 반복** | 289장은 5절 모두 뒤에 같은 후렴이 붙어 있고 섹션 구분이 없다 | 절 간 **최장 공통 어절 접미사**로 후렴을 검출 → 별도 `chorus` 섹션으로 분리 |
| **"아멘"이 별도 절** | 298곡 | 절로 만들지 않고 곡 속성으로 처리 |
| **한국어만 있다** | 영어 가사 없음 | 2언어 표시는 사용자가 영어 가사를 붙여넣어 페어링 (§3.2 `|` 파서) |
| 제목에 뒤쪽 공백 | `'나 같은 죄인 살리신 '` | trim, 검색은 `_title_no_space` 활용 |

**후렴 자동 검출 측정 결과** (새찬송가, 2절 이상 609곡 대상):

| 공통 접미사 어절 수 | 곡 수 | 판정 |
|--------------------|------:|------|
| 12어절 이상 | 189 | 후렴 확실 |
| 8–11어절 | 75 | 후렴 유력 |
| 2–7어절 | 50 | 오검출 가능 (우연히 같은 말로 끝나는 절) |
| 검출 안 됨 | 295 | 후렴 없음 |

합계 314곡(52%)에서 후렴 후보가 나온다. 자동 검출은 **제안**으로만 쓰고
사용자가 편집 UI에서 확인·수정한다 — 가사를 조용히 재구성하지 않는다.

**새찬송가 ↔ 통일찬송가 교차 매핑**: `_title_no_space` 로 425곡이 일치한다.
여전히 통일찬송가 번호로 곡을 부르는 경우가 많으므로, 곡 검색에서 두 번호를
모두 받아 같은 곡으로 안내한다.

> 찬송가는 곡 자체(멜로디·번호 체계)에 저작권이 있는 경우가 있다. 교회 내
> 예배 사용 전제이며, 곡별 `copyright`·`ccli_number` 필드로 표기 의무를 지원한다.

**추가로 필요한 것**: 현대 경배와찬양(CCM)은 이 DB에 없다. 수동 입력 또는
OpenLyrics 가져오기로 채운다(Phase 4).

#### 스키마 — 신규 설계

```sql
-- songs.sqlite
CREATE TABLE songs (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,              -- 주 제목
  title_alt TEXT,                   -- 다른 언어 제목
  author TEXT, composer TEXT,
  copyright TEXT, ccli_number TEXT, -- 저작권 표기용
  default_key TEXT, tempo INTEGER,
  tags TEXT,                        -- JSON 배열: ["경배","성탄"]
  default_template_id INTEGER,
  -- 찬송가 번호. 오퍼레이터가 번호로 찾는 경우가 압도적으로 많다.
  hymnal TEXT,                      -- 'new'(새찬송가) | 'old'(통일찬송가) | NULL
  hymn_number INTEGER,
  hymn_number_old INTEGER,          -- 교차 매핑 (제목 일치 425곡)
  has_amen INTEGER DEFAULT 0,       -- '아멘'으로 끝나는 곡 (새찬송가 298곡)
  source TEXT,                      -- 'hymn_new' | 'manual' | 'openlyrics'
  created_at TEXT, updated_at TEXT
);

CREATE TABLE song_sections (        -- 절/후렴/브릿지 단위
  id INTEGER PRIMARY KEY,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,               -- 'verse'|'chorus'|'bridge'|'pre'|'tag'|'ending'
  label TEXT,                       -- '1절','후렴','Bridge'
  position INTEGER NOT NULL         -- 기본 표시 순서
);

CREATE TABLE song_lines (           -- 줄 단위 + 언어별 페어링의 핵심
  id INTEGER PRIMARY KEY,
  section_id INTEGER NOT NULL REFERENCES song_sections(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,      -- 같은 값 = 같은 줄로 페어링
  lang TEXT NOT NULL,               -- 'ko','en',...
  text TEXT NOT NULL,
  UNIQUE(section_id, line_index, lang)
);

CREATE TABLE song_arrangements (    -- 곡 진행 순서(예: V1,C,V2,C,B,C,C)
  id INTEGER PRIMARY KEY,
  song_id INTEGER NOT NULL,
  name TEXT NOT NULL,               -- '기본', '주일 3부용'
  sequence TEXT NOT NULL            -- JSON: [section_id, ...]
);

CREATE VIRTUAL TABLE songs_fts USING fts5(title, lyrics, song_id UNINDEXED);
```

**설계 판단 — 왜 줄(line) 단위인가**

가사를 통째 텍스트로 저장하면 "한국어 3번째 줄과 영어 3번째 줄"을 짝지을 방법이 없습니다. `line_index`로 명시적 페어링을 하면:
- 한 화면에 `한국어 줄 / 영어 줄`을 정확히 겹쳐 배치 가능
- 언어별 줄 수가 달라도(영어가 2줄로 나뉘는 경우) `line_index`를 같게 주면 묶음 유지
- 한 언어만 있는 줄은 다른 언어가 비어 있어도 정상 동작

**가사 입력 UX** (수작업 최소화):
```
[1절]
주 예수보다 더 귀한 것은 없네
| I'd rather have Jesus than silver or gold
이 세상 부귀와 영광도
| I'd rather be His than have riches untold
```
`|`로 시작하는 줄 = 직전 줄의 번역 페어. 파서가 `line_index`를 자동 부여. 붙여넣기 후 편집 UI에서 시각적으로 페어 확인/수정.

**가져오기 지원** (Phase 4):
- 텍스트 붙여넣기 (위 형식 + 자유 형식 자동 추정)
- OpenLyrics XML (`.xml`) — OpenLP/ProPresenter 계열 표준
- CSV 일괄

### 3.3 앱 데이터

```sql
-- app.sqlite
CREATE TABLE templates (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,        -- 'bible'|'song'|'lower_third'|'blank'
  config TEXT NOT NULL,      -- JSON (§5.1 스키마)
  is_builtin INTEGER DEFAULT 0,
  updated_at TEXT
);

CREATE TABLE service_plans (      -- 예배 순서
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,             -- '2026-08-16 주일 1부'
  service_date TEXT,
  items TEXT NOT NULL,            -- JSON: CueItem[]
  updated_at TEXT
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE recent_items (kind TEXT, payload TEXT, used_at TEXT);
```

```ts
// CueItem — 예배 순서의 한 항목
type CueItem =
  | { type: 'bible';  ref: string; primary: string; secondary: string[]; templateId?: number; note?: string }
  | { type: 'song';   songId: number; arrangementId?: number; langs: string[]; templateId?: number }
  | { type: 'text';   content: string; templateId?: number }   // 광고, 기도문 등
  | { type: 'blank' };
```

---

## 4. 기능 명세

### 4.1 성경 송출

| 기능 | 상세 |
|------|------|
| 참조 입력 | 단일 입력창, 실시간 파싱 결과 미리보기, Enter로 큐에 로드 |
| 주 역본 선택 | 기본 역본을 설정에 저장 (예: 개역개정). 항목별로 임시 변경 가능 |
| 보조 역본 | 0~2개 추가 표시. 배치: `아래 겹침` / `좌우 분할` / `주 역본만 크게 + 보조 작게` |
| 절 정렬 | 절 번호를 기준으로 역본 간 정렬. 절 병합(1-2절 합침) 역본 대응: 빈 절은 상위 절에 병합 표시 |
| 페이징 | 화면 넘김 단위 선택: `1절` / `2절` / `자동(글자수 기준)` / `문단(소제목 기준)` |
| 자동 분할 | 템플릿의 글자 크기·화면 폭으로 실제 렌더 폭 측정 → 넘치면 자동으로 다음 화면 분할 (측정은 출력 화면에서 수행 후 서버에 보고) |
| 절 번호 표시 | 표시/숨김, 위첨자/인라인, 색상 별도 지정 |
| 참조 표기 | 위치 선택(상단/하단/본문 뒤 인라인), 형식 지정(`요한복음 3:16` / `요 3:16` / `John 3:16`) |
| 소제목 | 표시/숨김 (`headings` 테이블 활용) |
| 원어 병기 | 헬라어/히브리어 역본 선택 시 폰트 자동 전환, 히브리어는 RTL 자동 적용 |
| 검색 | FTS5 전문검색 — 단어/구절로 참조 찾기, 역본별·성경책 범위 필터 |
| 이동 | 다음 절/이전 절, 다음 장/이전 장 (단축키) |

### 4.2 찬양 가사 송출

| 기능 | 상세 |
|------|------|
| 곡 검색 | 제목·가사·태그 통합 검색(FTS5), 최근 사용 목록 |
| 섹션 이동 | 섹션 목록에서 클릭 또는 단축키. 진행순서(arrangement) 적용 시 순차 진행 |
| 2언어 표시 | 곡이 보유한 언어 중 2개 선택 → 줄 단위 페어링 표시. 배치: `위/아래` / `좌/우` / `주 언어만 크게` |
| 언어별 스타일 | 언어마다 폰트·크기·색·굵기 독립 지정 (한글 본문 크게, 영어 작게 등) |
| 다국어 대응 | 언어를 고정 열거형이 아닌 **자유 코드(`lang: string`)**로 저장 → 한/영 외 어떤 조합도 곡 단위로 가능. 곡마다 보유 언어가 달라도 됨 |
| 줄 묶음 | 한 화면에 표시할 줄 수 지정(1/2/4줄 또는 섹션 전체) |
| 다음 화면 예고 | 오퍼레이터 화면에만 다음 슬라이드 미리보기 (송출에는 없음) |
| 저작권 표기 | 첫 슬라이드 또는 상시 하단 소형 표기 옵션 (CCLI 번호 등) |
| 곡 편집 | 웹 UI에서 직접 추가·수정, 페어링 시각 편집 |

### 4.3 공통 송출 제어

| 기능 | 상세 | 단축키(안) |
|------|------|-----------|
| 다음/이전 | 슬라이드 이동 | `→` / `←`, `Space` |
| 블랙(숨김) | 텍스트만 페이드아웃, 상태는 유지 | `B` |
| 로고/공백 | 지정 텍스트나 빈 화면 | `L` |
| 즉시 복구 | 마지막 상태로 되돌림 | `Esc` |
| 큐 항목 이동 | 예배 순서 내 다음/이전 항목 | `PgDn`/`PgUp` |
| 프리뷰 → 라이브 | 미리보기에서 확인 후 송출 (2단 확인 모드, 옵션) | `Enter` |
| 전환 효과 | 없음 / 페이드(ms 지정) / 슬라이드 업 | — |

> **설계 판단 — 프리뷰/라이브 분리는 옵션으로**: 숙련 오퍼레이터에겐 1단(즉시 송출)이 빠르고, 초보자에겐 2단이 안전합니다. 설정으로 전환 가능하게 하고 기본값은 **1단 즉시 송출 + Esc 복구**로 둡니다.

---

## 5. 템플릿 / 스타일 시스템

### 5.1 템플릿 스키마 (JSON)

```ts
interface Template {
  id: number;
  name: string;              // '주일 예배 성경 이중역본'
  kind: 'bible' | 'song' | 'lower_third' | 'blank';

  canvas: {
    width: number;           // 1920 — OBS 브라우저 소스 해상도와 일치
    height: number;          // 1080
    background:
      | { mode: 'transparent' }                          // 권장 (OBS 기본 투명)
      | { mode: 'color'; color: string; opacity: number } // 반투명 띠 등
      | { mode: 'chroma'; color: string };                // 크로마키용 단색
    safeArea: { top: number; right: number; bottom: number; left: number }; // px 또는 %
  };

  layout: {
    anchor: 'top-left'|'top-center'|'top-right'
          |'mid-left'|'center'|'mid-right'
          |'bottom-left'|'bottom-center'|'bottom-right';
    offsetX: number; offsetY: number;    // anchor 기준 미세 조정 (px)
    width: number | 'auto';              // 텍스트 블록 최대 폭 (px 또는 %)
    maxHeight: number | 'auto';
    align: 'left'|'center'|'right';
    verticalAlign: 'top'|'middle'|'bottom';
    direction: 'column'|'row';           // 이중역본/이중언어 배치 방향
    gap: number;                         // 블록 간 간격
  };

  // 텍스트 역할별 스타일. 역본/언어별로 override 가능
  text: {
    primary:   TextStyle;                // 주 역본 / 주 언어
    secondary: TextStyle;                // 보조 역본 / 보조 언어
    verseNum:  TextStyle;                // 절 번호
    reference: TextStyle;                // 참조 표기
    heading:   TextStyle;                // 소제목
    credit:    TextStyle;                // 저작권 표기
  };

  overridesByTranslation?: Record<string, Partial<TextStyle>>; // {'grk': {fontFamily:'SBL Greek'}}
  overridesByLang?: Record<string, Partial<TextStyle>>;

  behavior: {
    autoFit: boolean;            // 넘칠 때 자동 축소
    autoFitMinScale: number;     // 최소 축소 비율 (0.6 = 60%까지)
    maxLinesPerSlide: number | 'auto';
    transition: { type: 'none'|'fade'|'slide-up'; durationMs: number };
    showVerseNumbers: boolean;
    showReference: 'none'|'top'|'bottom'|'inline';
    referenceFormat: 'full'|'abbr'|'en';
    showHeadings: boolean;
    showCredit: boolean;
  };
}

interface TextStyle {
  fontFamily: string;
  fontSize: number;            // px @1080p 기준
  fontWeight: number;          // 100..900
  lineHeight: number;          // 배수 (1.4)
  letterSpacing: number;       // px 또는 em
  color: string;               // #RRGGBB 또는 rgba()
  opacity: number;
  stroke:  { width: number; color: string } | null;      // 외곽선 — 밝은 배경 대비
  shadow:  { x: number; y: number; blur: number; color: string } | null;
  bgBox:   { color: string; paddingX: number; paddingY: number; radius: number } | null;
  textTransform: 'none'|'uppercase';
  wordBreak: 'normal'|'keep-all';   // 한국어는 keep-all 권장 (어절 단위 줄바꿈)
}
```

### 5.2 CSS 변수 주입 — 리렌더 없는 즉시 반영

출력 페이지는 템플릿을 CSS Custom Property로 받습니다:

```css
.slide {
  --primary-size: 64px;
  --primary-color: #ffffff;
  --primary-stroke: 3px #000000;
  /* ... */
}
```
템플릿 변경 시 WebSocket으로 변경된 값만 보내 `style.setProperty()` 호출 → DOM 재구성 없이 스타일만 갱신. 예배 중 폰트 크기 조절 시 화면 깜빡임이 없습니다.

### 5.3 OBS 투명 배경 처리

**권장 방식 — 진짜 투명 (Alpha)**
OBS 브라우저 소스는 페이지 배경이 투명하면 그대로 알파 합성합니다. 크로마키 필터 불필요, 반투명·글로우·안티앨리어싱 경계가 깨끗합니다.

```css
html, body { background: transparent !important; margin: 0; overflow: hidden; }
```
OBS 브라우저 소스 설정:
- 폭/높이 = 1920×1080 (템플릿 canvas와 일치)
- ☑ "소스가 보이지 않을 때 OBS 종료" 해제 (예배 중 상태 유지)
- ☑ "장면이 활성화될 때 브라우저 새로고침" **해제** (상태 유지 목적)
- 커스텀 CSS 필드는 비워둠 (기본값이 배경을 덮어씀 → 우리 페이지가 직접 처리)

**대안 — 크로마키 모드**
투명이 안 되는 환경(구버전 OBS, 하드웨어 인코더 이슈, 다른 송출 장비)을 위해 단색 배경 모드를 제공합니다. 기본 색은 `#00FF00`이 아니라 **`#1EFF00`(마젠타 대안 포함)** 등을 프리셋으로 두고, 텍스트 색과 충돌 시 경고를 띄웁니다.

**미리보기 배경 (송출에 미포함)**
컨트롤 패널의 미리보기에는 체커보드/샘플 배경 이미지를 깔아 실제 합성 결과를 확인합니다. 출력 페이지에는 `?preview=1` 쿼리로만 활성화.

### 5.4 내장 템플릿 프리셋

| 프리셋 | 용도 | 특징 |
|--------|------|------|
| `설교본문-단일` | 설교 중 본문 1역본 | 하단 중앙, 대형, 검은 외곽선 |
| `설교본문-이중역본` | 한/영 병기 | 상단 한글(대) + 하단 영어(중), 색 구분 |
| `본문-좌우분할` | 원어 대조 | 좌 개역개정 / 우 헬라어 |
| `찬양-이중언어` | 한/영 찬양 | 줄 페어 위아래, 영어는 이탤릭·80% 크기 |
| `찬양-단일` | 한국어만 | 중앙 대형 2줄 |
| `로우서드` | 설교자 이름, 광고 | 좌하단 소형, 반투명 박스 |
| `공백` | 블랭크 | 아무것도 표시 안 함 |

### 5.5 템플릿 편집 UX

- **좌: 컨트롤** (수치 입력 + 슬라이더) / **우: 실시간 미리보기** (실제 출력 페이지를 iframe으로)
- 9분할 앵커 그리드 클릭 → 위치 즉시 지정, 방향키로 1px 미세 조정
- 색상: 컬러 피커 + 최근 색 + 팔레트 저장
- 폰트: 시스템 설치 폰트 목록 조회 + 웹폰트 파일(`.woff2`) 로컬 업로드
- 템플릿 복제/내보내기(JSON)/가져오기 → 다른 PC로 이전, 백업
- 저장 시 **버전 스냅샷** 유지 → 실수로 망쳐도 되돌리기

### 5.6 다국어 폰트 전략

주 언어는 한/영이지만 다른 언어도 섞일 수 있으므로, 폰트를 언어별 단일 지정이 아니라 **폴백 체인**으로 관리합니다.

```ts
// settings에 언어별 폰트 체인 저장
{
  "ko":  ["Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", "sans-serif"],
  "en":  ["Inter", "Helvetica Neue", "sans-serif"],
  "zh":  ["Noto Sans SC", "PingFang SC", "sans-serif"],
  "ja":  ["Noto Sans JP", "Hiragino Sans", "sans-serif"],
  "grc": ["SBL Greek", "Cardo", "serif"],
  "heb": ["SBL Hebrew", "Ezra SIL", "serif"],
  "*":   ["Noto Sans", "sans-serif"]       // 미등록 언어 기본값
}
```

- 언어별 `wordBreak` 자동 적용: 한/중/일 → `keep-all`, 영어 → `normal`
- 히브리어·아람어 → `direction: rtl` 자동
- **폰트 누락 감지**: 출력 페이지가 실제 사용된 폰트를 측정해 폴백으로 떨어졌으면 컨트롤 패널에 경고 (다른 PC 설치 시 폰트 미설치를 예배 전에 발견하는 장치)
- 웹폰트 파일(`.woff2`)을 앱 데이터 폴더에 넣으면 자동 등록 → PC 이전 시 폰트까지 함께 이동 가능

---

## 6. 화면 설계

### 6.1 컨트롤 패널 레이아웃

```
┌─────────────────────────────────────────────────────────────────────┐
│ [성경] [찬양] [텍스트] [템플릿] [예배순서]        ● 송출중  [설정]   │
├──────────────┬──────────────────────────────┬───────────────────────┤
│ 예배 순서    │  본문/가사 슬라이드 목록      │  라이브 미리보기      │
│              │                              │  ┌─────────────────┐  │
│ 1. 찬양      │  ┌────────────────────────┐  │  │                 │  │
│    주 예수보다│  │ ▶ 16 하나님이 세상을…  │◀ │  │  (실제 출력)    │  │
│ 2. 본문      │  ├────────────────────────┤  │  │                 │  │
│    요 3:16-17│  │   17 하나님이 그 아들을│  │  └─────────────────┘  │
│ 3. 광고      │  └────────────────────────┘  │  다음 ▸ 17절          │
│              │                              │                       │
│ [+ 항목추가] │  역본: 개역개정 ▾  +NIV ▾    │  템플릿: 이중역본 ▾   │
├──────────────┴──────────────────────────────┴───────────────────────┤
│  [◀ 이전]  [다음 ▶]     [블랙 B]  [로고 L]  [복구 Esc]   폰트 [-][+]│
└─────────────────────────────────────────────────────────────────────┘
```

**핵심 UX 원칙**
1. 예배 중 쓰는 버튼은 항상 같은 자리, 크게, 하단 고정 (누르기 쉬움)
2. 파괴적 동작(삭제·초기화)은 예배 모드에서 비활성 또는 확인 필요
3. 현재 송출 중인 슬라이드는 명확한 시각 강조 + `● 송출중` 인디케이터
4. 태블릿 대응: 하단 컨트롤 바는 터치 타깃 44px 이상
5. 다크 UI 기본 (어두운 조명의 방송실 환경)

### 6.2 출력 페이지 (`/output`)

- 쿼리 파라미터: `?layer=main|lower|ref` `&template=<id>` `&preview=0|1`
- 의존성 0, 인라인 CSS/JS, 단일 HTML 파일 → 로드 실패 지점 최소화
- WebSocket 끊김 시: **현재 화면 유지**(절대 검은 화면으로 안 감) + 자동 재연결(지수 백오프)
- 재연결 시 서버에서 상태 스냅샷 수신 → 즉시 복구
- `console` 에러를 서버로 전송 → 컨트롤 패널에 경고 표시 (예배 중 문제 조기 감지)

---

## 7. API / 이벤트 계약

### 7.1 REST (조회·CRUD)

```
GET  /api/translations                      → 역본 목록
GET  /api/books                             → 성경 66권 메타
GET  /api/bible/parse?q=요3:16              → 파싱 결과 + 후보
GET  /api/bible/passage?ref=요3:16-17&t=nkrv,niv  → 절 배열(역본별 정렬)
GET  /api/bible/search?q=사랑&t=nkrv&books=NT     → FTS 결과
GET  /api/songs?q=주예수                    → 곡 검색
GET  /api/songs/:id                         → 섹션·줄·언어 전체
POST /api/songs                             → 곡 생성 (텍스트 파서 포함)
PUT  /api/songs/:id
GET  /api/templates  POST /api/templates  PUT /api/templates/:id
GET  /api/plans      POST /api/plans      PUT /api/plans/:id
GET  /api/fonts                             → 사용 가능 폰트 목록
GET  /api/settings   PUT /api/settings
```

### 7.2 WebSocket (실시간 상태)

```ts
// 서버 → 클라이언트
type ServerMsg =
  | { t: 'state';         payload: LiveState }          // 접속 시 전체 스냅샷
  | { t: 'state:patch';   payload: Partial<LiveState> }  // 부분 갱신
  | { t: 'template';      payload: Template }            // 템플릿 교체
  | { t: 'style:patch';   payload: Record<string,string> } // CSS 변수만
  | { t: 'error';         message: string };

// 클라이언트(컨트롤) → 서버
type ClientMsg =
  | { t: 'show';     payload: SlidePayload }
  | { t: 'next' } | { t: 'prev' }
  | { t: 'blank',    on: boolean }
  | { t: 'restore' }
  | { t: 'template:set', id: number }
  | { t: 'style:set',    patch: Record<string, unknown> }
  | { t: 'measure:report', payload: { overflow: boolean; height: number } }; // 출력→서버

interface LiveState {
  slide: SlidePayload | null;   // 현재 화면 내용
  blank: boolean;
  templateId: number;
  revision: number;             // 단조 증가 — 순서 뒤바뀜 방지
  cursor: { planItemIndex: number; slideIndex: number } | null;
}

type SlidePayload =
  | { kind: 'bible'; reference: string; blocks: Array<{
        translationId: string; lang: string;
        verses: Array<{ num: number; text: string }>;
      }>; heading?: string }
  | { kind: 'song'; title: string; sectionLabel: string;
      lines: Array<{ lang: string; text: string }[]>;   // 줄별 언어 페어 배열
      credit?: string }
  | { kind: 'text'; lines: string[] }
  | { kind: 'blank' };
```

> **`revision` 필드의 이유**: 빠르게 다음/다음/이전을 누르면 메시지 순서가 뒤바뀔 수 있습니다. 출력 페이지는 자기가 아는 revision보다 작은 메시지를 버립니다. 예배 중 "화면이 한 칸 뒤로 갔다" 류 버그의 근원을 차단합니다.

---

## 8. 폴더 구조

`✅` = Phase 0·1에서 구현 완료

```
sermon-presentation/
├── PLAN.md                        ✅ 이 문서
├── README.md                      ✅ 실행법, OBS 설정 가이드
├── docs/KNOWN-DATA-ISSUES.md      ✅ 원본 데이터의 알려진 문제
├── package.json                   ✅
├── tsconfig.json                  ✅ noEmit + allowImportingTsExtensions (네이티브 실행)
├── data/                          # 생성물·사용자 데이터 (git 제외)
│   ├── bible.sqlite               ✅ 빌드 산출물 (97MB)
│   ├── songs.sqlite               # Phase 4
│   └── app.sqlite                 # Phase 3
│   └── reports/                   ✅ 빌드 리포트
├── scripts/
│   ├── bible-sources.ts           ✅ 역본별 스키마·정제 규칙 선언
│   ├── build-bible-db.ts          ✅ 원본 11개 DB → bible.sqlite
│   ├── verify-bible-db.ts         ✅ 42항목 무결성 검증
│   └── seed-templates.ts          # Phase 3
├── server/
│   ├── paths.ts                   ✅ 모든 경로의 단일 출처 (Electron 대비)
│   ├── config.ts                  ✅ 전역 상수 (PORT 환경변수 지원)
│   ├── index.ts                   ✅ Fastify 부트스트랩 + 포트 자동 탐색
│   ├── ws.ts                      # Phase 2 — WebSocket 허브
│   ├── state.ts                   # Phase 2 — LiveState 스토어
│   ├── routes/                    # Phase 2~ bible.ts, songs.ts, templates.ts, plans.ts
│   └── db/                        # Phase 2 — 연결·쿼리 (읽기 전용/쓰기 분리)
├── shared/
│   └── types.ts                   ✅ 서버·클라이언트 공용 타입 (단일 계약)
├── lib/                           # 순수 로직 — DB·네트워크 의존 없음
│   ├── books.ts                   ✅ 66권 메타 + 이름 별칭 + 장 구분 차이
│   ├── hangul.ts                  ✅ 초성 검색
│   ├── reference-parser.ts        ✅ 성경 참조 파서
│   ├── lyrics-parser.ts           # Phase 4 — 가사 텍스트 → 섹션/줄/언어
│   ├── paginator.ts               # Phase 3 — 슬라이드 분할
│   └── template-css.ts            # Phase 3 — Template → CSS 변수
├── public/
│   ├── index.html                 ✅ 안내 페이지 (Phase 2에서 컨트롤 패널로 교체)
│   └── output/                    ✅ OBS 출력 페이지 (의존성 0)
│       ├── index.html
│       ├── output.css             ✅ 전부 CSS 변수로 제어
│       └── output.js              ✅ 렌더·스타일 패치·실측·오류 수집
├── src/control/                   # Phase 2 — React 컨트롤 패널
└── tests/
    ├── unit/                      ✅ reference-parser 70건
    ├── integration/               # Phase 2 — API 라우트, DB 쿼리
    └── e2e/                       # Phase 5 — 컨트롤→출력 동기화 시나리오
```

---

## 9. 개발 로드맵

각 Phase는 **그 자체로 동작하는 상태**로 끝납니다.

### ✅ Phase 0 — 기반 (완료)
- 프로젝트 초기화, 폴더 구조, `shared/types.ts` 공용 타입
- `server/paths.ts` — 모든 경로의 단일 출처 (Electron 대비)
- 포트 자동 탐색 (7777 점유 시 다음 포트), `/api/info` 로 실제 포트 노출
- 출력 페이지 골격 (의존성 0), 데모·미리보기·진단 모드
- **검증 결과**: 투명 배경 확인(`html`/`body` 모두 `rgba(0,0,0,0)`), 이중역본 렌더,
  한국어 어절 단위 줄바꿈, 실측 `measure()` 동작

빌드 도구 관련해 계획을 하나 바꿨다: Node 26이 **TypeScript를 네이티브로 실행**하고
`node:sqlite` 를 내장하므로 `better-sqlite3` 를 쓰지 않는다. Electron 네이티브 재빌드
문제(D1 제약 3번)가 아예 사라졌다.

### ✅ Phase 1 — 성경 DB 구축 (완료)
- `scripts/bible-sources.ts` — 역본별 소스·정제 규칙 선언 (스키마 차이 흡수)
- `scripts/source-reader.ts` — SQLite 2종 + JSON 읽기. **빌드와 검증이 같은 코드로 읽는다** (다르게 읽으면 원문 대조가 무의미)
- `scripts/build-bible-db.ts` — **12역본 342,317절** 통합, 소제목 11,577건,
  FTS5 external content 인덱스. 임시 파일 → 성공 시에만 교체. 소요 2.9초, 결과 97MB
- `scripts/verify-bible-db.ts` — **47개 항목 검증**, 무작위 원본 대조, 신명사문자 표기 검사
- `lib/books.ts` · `lib/hangul.ts` · `lib/reference-parser.ts` — **단위 테스트 70개**
- `docs/KNOWN-DATA-ISSUES.md` — 원본 데이터에서 발견한 7개 사안 기록
- **검증 결과**: 42건 중 통과 40 · 경고 2(문서화된 원본 결함) · 실패 0.
  타입 검사 통과, 테스트 70개 통과

당초 예상보다 원본 데이터가 고르지 않았다. ESV 스키마가 다르고, KJV에 앞부분이
잘린 절이 158건 있고, 히브리어에 에스더 3:12가 빠져 있었다. 한국어 FTS5 한계도
여기서 드러나 검색 전략을 `LIKE` 로 정했다 (§3.1).

### ✅ Phase 2 — 송출 파이프라인 (완료) ★ 첫 실사용 가능 지점
- `server/state.ts` — LiveState 저장소. revision 단조 증가, 모든 변경을 즉시 디스크에 영속
- `server/ws.ts` — WebSocket 허브. 접속 즉시 스냅샷, 역할(control/output)별 전송,
  잘못된 메시지가 연결을 끊지 않음, 접속 수를 폴링 대신 푸시
- `server/db/bible.ts` — 읽기 전용 조회. 언어별 검색 전략(한국어 LIKE / 그 외 FTS),
  역본 커버리지 판정으로 '없는 본문' 조용히 구분
- `lib/slide-builder.ts` — 본문 → 슬라이드. **다역본 절 정렬**, 소제목은 첫 장에만
- `server/routes/bible.ts` — parse · passage · search · chapters
- `server/app.ts` / `index.ts` 분리 — 앱 구성과 실행을 나눠 테스트에서 주입 가능
- `src/control/` — React 컨트롤 패널 (Vite → `public/app/` 정적 빌드, 포트 하나 유지)
- 출력 페이지 WS 클라이언트 — 스냅샷 복구, 지수 백오프 재연결, revision 가드
- **테스트 137개** (파서 70 · 슬라이드 빌더 25 · 상태 저장소 22 · 통합 20)

**검증 결과** (실제 브라우저로 확인):

| 시나리오 | 결과 |
|----------|------|
| 출력 페이지 새로고침 | ✅ 본문·소제목·참조 즉시 복구 (revision 유지) |
| 서버 재시작 | ✅ 디스크에서 마지막 상태 복구 |
| 서버 강제 종료 | ✅ 화면 유지(opacity 1), 자동 재연결 후 정상 복귀 |
| 다음/이전 16회 연타 | ✅ 경계에서 멈추고 위치 정확, 유실 0 |
| 블랙 | ✅ opacity 0, 내용은 DOM 에 유지 → 즉시 복구 |
| 다역본 동시 표시 | ✅ 개역개정 + NIV 절 정렬 일치 |

작업 중 실제로 물린 문제 두 개를 고쳤다:
- `@fastify/static` 의 `cacheControl: false` 는 헤더를 **생략**만 해서, Last-Modified
  기반 휴리스틱 캐싱으로 갱신된 `output.js` 가 반영되지 않았다 → 출력 페이지는
  `no-store`, Vite 해시 산출물은 영구 캐시로 명시
- `index: false` 로 두자 `/output/` 디렉터리 요청이 403 이 되었다 → 디렉터리 경로를
  명시적으로 연결

### ✅ Phase 3 — 템플릿 시스템 (완료)
- `lib/template-css.ts` — Template → CSS 변수. 순수 함수라 서버·패널·출력이 같은 결과를 낸다
- `lib/template-presets.ts` — 내장 프리셋 7종. **id 를 음수로** 두어 사용자 템플릿과 절대 충돌하지 않는다
- `server/db/templates.ts` + `routes/templates.ts` — CRUD·복제. 프리셋은 DB 에 넣지 않고 코드가 유일한 출처
- `lib/paginator.ts` — **실측 기반 자동 분할**. 측정 함수를 주입받는 순수 로직
- `src/control/hooks/useMeasure.ts` — 1920×1080 숨긴 iframe 으로 실측
- `src/control/panels/TemplatePanel.tsx` — 9분할 앵커, 색·크기·외곽선·그림자·여백·배경 편집
- 출력 페이지 — 언어·역본별 override 인라인 적용, **자동 축소**(배율), 창 크기 변화 대응
- **테스트 208개** (템플릿 CSS 30 · 자동 분할 16 · 템플릿 REST 16 추가)

**설계 판단 두 가지**

*자동 분할은 추정하지 않는다.* 글자 수로 추정하면 폰트·자간·행간·여백 조합에 따라
반드시 틀린다. 컨트롤 패널이 실제 출력 페이지를 숨긴 iframe 으로 띄워 재고 그 값으로
나눈다. 측정기와 송출기가 같은 코드라 "재 봤을 때는 맞았는데 화면에선 넘친다"가 없다.

*자동 축소는 서버에 되묻지 않는다.* 넘침을 서버에 보고해 다시 나누는 피드백 루프는
진동 위험이 있다. 출력 페이지가 로컬 계산으로 배율을 한 번에 정하고, 최소 배율로도
부족할 때만 그 사실을 보고해 컨트롤 패널이 안내한다.

**검증 결과** (실제 브라우저):

| 항목 | 결과 |
|------|------|
| 실측 정확도 | 가용 904px 기준 3절(858px) 통과 · 4절(1101px) 넘침 정확 판정 |
| 자동 분할 | 요 3:16-21(6절) → 3절씩 2화면 (측정값과 일치) |
| 자동 축소 | 1106px→0.64배(=724/1106×0.98) · 537px→배율 1 해제 |
| 편집 즉시 반영 | 글자 크기·색·앵커·배경이 DOM 재구성 없이 반영 |
| 프리셋 보호 | 수정·삭제 모두 409 거부, 저장 시 사본 생성 |
| 좌우 분할 + 원어 | 개역개정/헬라어 좌우 배치, SBL Greek 폰트 override 적용 |

작업 중 실제 버그 두 개를 고쳤다:
- `.slide` 가 `--flow-direction` 을 따라 `row` 가 되면서 **좌우 분할 템플릿에서 참조
  표기가 본문 옆 칸으로 밀려 세로로 눌렸다** → 방향은 `.blocks` 에만 적용하고
  `.slide` 는 항상 세로(소제목 → 본문 → 참조)로 고정
- WS `style:patch` 경로에서 자동 축소를 다시 계산하지 않아, **편집으로 글자를 키우면
  화면을 넘긴 채 방치**됐다 → 패치 적용 후 재계산

### ✅ Phase 4 — 찬양 (완료)
- `lib/lyrics-parser.ts` — `|` 페어링 파서 · 후렴 검출 · 자동 줄나눔 (순수 로직)
- `lib/song-slides.ts` — 섹션 → 슬라이드. `lineIndex` 페어링으로 2언어 짝짓기
- `server/db/songs.ts` — 줄 단위 스키마, 번호·제목·가사 3중 검색
- `server/routes/songs.ts` — 검색·조회·덱·가사 편집
- `scripts/import-hymns.ts` — 찬송가 가져오기 + 리포트
- `src/control/panels/SongPanel.tsx` — 검색, 섹션 목록, 언어 선택, 가사 편집
- **테스트 290개** (가사 파서 39 · 찬양 슬라이드 26 · 찬양 REST 20 추가)

**가져오기 결과**

| 판본 | 곡 | 섹션 | 아멘 | 후렴 확실/유력/확인필요 |
|------|---:|-----:|-----:|------------------------|
| 새찬송가 | 645 | 2,572 | 298 | 189 / 75 / 50 |
| 통일찬송가 | 557 | 2,305 | 285 | 169 / 67 / 38 |

총 1,202곡 · 판본 간 번호 교차 매핑 428곡 · 건너뜀 1곡(통일 551장 — 제목과 내용이
모두 '아멘'뿐이라 곡으로 만들 수 없다. 리포트에 기록).

자동 줄나눔 품질: 줄 길이 3~26자, 평균 18자, **40자 초과 0건**. 305장은 원래 악보의
행 구분과 정확히 맞았다("나 같은 죄인 살리신 주 은혜 놀라워" / "잃었던 생명 찾았고 광명을 얻었네").

**설계 판단**

*가사는 줄 단위로 저장한다.* 통짜 텍스트로는 "한국어 3번째 줄 ↔ 영어 3번째 줄"을
짝지을 방법이 없다. `lineIndex` 를 공유하는 줄들이 한 묶음이 되어 화면에서 겹친다.

*자동 처리는 제안이다.* 원본에 줄바꿈이 없고 후렴이 인라인으로 반복되어 있어 가공이
불가피하지만, 자동 결과를 확정하지 않는다. 신뢰도를 리포트에 남기고 편집 UI 에서
사람이 확인한다 — 가사를 조용히 재구성하는 것은 본문을 임의로 고치는 것과 같다.

*없는 언어를 요청하면 알린다.* 한국어만 있는 찬송가에 영어를 켜도 화면에 빈 자리가
생기지 않고, 대신 컨트롤 패널이 "이 곡에는 영어 가사가 없습니다"를 띄운다.

**검증 결과** (실제 브라우저):

| 항목 | 결과 |
|------|------|
| 번호 검색 | `305`(새·통일 모두) · `새 305` · `통일 405` 정확 |
| 제목 검색 | 공백 무시 (`나같은죄인` → 305장) |
| 가사 검색 | 부분일치 + 걸린 대목 표시 |
| 2언어 페어링 | 305장에 영어 추가 → 줄 단위로 정확히 겹침 |
| 저작권 표기 | '새찬송가 305장' 자동 표기 |
| 찬양 프리셋 송출 | 한국어(굵게)/영어(이탤릭) 2줄 묶음, 오류 0 |

작업 중 실제 버그 하나를 고쳤다: `inferSectionKind` 가 **'Pre-Chorus' 를 후렴으로
분류**했다 — 'chorus' 를 포함하기 때문이다. 더 구체적인 패턴을 먼저 검사하도록 순서를 바꿨다.

**남긴 것**: OpenLyrics XML 가져오기와 폰트 누락 감지는 넣지 않았다. 전자는 현재
데이터 출처가 없고, 후자는 Phase 6(다른 PC 설치) 시점에 실제로 필요해진다.

### ✅ Phase 5 — 운영 완성도 (완료)
- `server/db/plans.ts` + `routes/plans.ts` — 예배 순서 CRUD·복제, 항목 경계 검증
- `lib/plan-deck.ts` — 순서 → **평평한 덱 + 항목 경계**. 순수 로직
- `server/state.ts` — `gotoGroup()` 항목 단위 이동, `currentGroup()` 위치 보고
- `server/routes/backup.ts` — 데이터 이전 (내보내기·가져오기·미리보기)
- `src/control/panels/PlanPanel.tsx` — 항목 추가·재배치·삭제, 예배용 올리기
- 설정 탭에 데이터 이전 카드 (덮어쓰기는 확인 후 실행)
- 단축키: 화살표=슬라이드, PgDn/PgUp=항목
- **테스트 337개** (순서 덱 24 · 항목 이동 15 · 순서·백업 REST 17 추가)

**설계 판단**

*순서표는 항목만 저장한다.* 슬라이드를 미리 만들어 넣으면 템플릿을 바꿨을 때 순서표가
낡는다. 올릴 때 풀되, 성경은 실측 자동 분할까지 거치므로 예배 중에는 다시 계산하지 않는다.

*항목별 덱을 따로 두지 않고 하나로 이어붙인다.* 그러면 기존 next/prev 가 그대로 동작하고
(항목 경계를 넘는 이동이 공짜로 된다), 경계를 `groups` 로 담아 두면 PgDn/PgUp 항목 점프가
된다. 서버는 항목을 다시 해석하지 않아 예배 중 조회 실패·지연이 없다.

*풀지 못한 항목은 건너뛰되 반드시 알린다.* 예배 중 순서가 조용히 하나 사라지는 것이
가장 위험하므로, 실패 목록을 돌려주고 컨트롤 패널이 배너로 띄운다.

*이전 파일은 `.zip` 이 아니라 JSON 한 파일이다.* Node 에 zip 이 없어 의존성이 늘고
Electron 패키징에서 변수가 된다. 사람이 열어 확인·수정할 수 있는 편이 예배 전 급할 때
실제로 유용하다. 폰트는 base64 로 담는다.

**검증 결과** (실제 브라우저):

| 항목 | 결과 |
|------|------|
| 순서표 올리기 | 4항목(찬양·본문·광고·찬양) → 17슬라이드, 실패 0 |
| PgDn 항목 이동 | 1/4 → 2/4 → 3/4 → 4/4, 경계에서 순환 없음 |
| PgUp | 항목 중간이면 그 항목 처음으로, 처음이면 이전 항목으로 |
| 화살표 | 항목 경계를 자연히 넘어감 |
| 잘못된 항목 검증 | 6개 중 5개 거부하고 사유 반환 |
| 데이터 이전 왕복 | 1.62MB 번들, 찬양 1,202곡 + 순서 1개, 유실 0 |
| 경로 탈출 방어 | `../../evil.woff2` → basename 으로 잘림, `.exe` 거부 |

**작업 중 잡은 실제 버그**: 번들 가져오기가 **"Payload Too Large"** 로 실패했다. Fastify
기본 본문 한도가 1MB 인데 실제 번들이 1.62MB 다. 통합 테스트는 곡이 몇 개뿐이라 통과했고,
브라우저에서 진짜 데이터로 해 보고서야 드러났다 — 데이터 이전은 다른 PC 설치의 유일한
경로라 이대로 두면 Phase 6 에서 막혔을 것이다. 해당 라우트 한도를 올리고, 1MB 를 넘는
번들을 넣는 회귀 테스트를 추가했다.

### ✅ 곡집 구조 (Phase 5 이후 추가)

복음성가 시리즈를 계속 추가하려면 기존 스키마로는 안 됐다 — `hymnal`·`hymn_number`·
`hymn_number_old` 컬럼에 찬송가 두 종이 박혀 있어 시리즈가 늘 때마다 컬럼을 붙여야 했고,
**한 곡이 여러 시리즈에 실린 경우**를 표현할 수 없었다 (복음성가는 흔하다).

**변경**

```sql
songbooks(id, name, short_label, numbered, sort_order, is_builtin, quick_slot, …)
song_entries(song_id, songbook_id, number)   -- 다대다, 번호 포함
song_links(song_id, linked_id)               -- 가사가 다른 대응곡
```

- 시리즈를 **행**으로 다룬다 → 스키마 변경 없이 무한히 추가
- 찬송가의 '장'과 복음성가의 '번호'를 하나의 `number` 로 통일
- `기타` 곡집은 `numbered=0` — 번호 없이 담는다
- 가져오기 재실행은 `songbook_id` 범위로 지우고 다시 넣는다 → **개별·일괄 갱신이 같은 방식**
- 곡집을 지워도 수록곡은 `기타` 로 옮겨 본문이 사라지지 않는다

**새/통일을 합치지 않은 근거**: 교차 매핑 428쌍의 가사를 전수 비교했더니 **91%가 달랐다**
(새찬송가가 개정). 합치면 본문이 사라지므로 별도 곡으로 두고 `song_links` 로 잇는다.

**마이그레이션**: 기존 컬럼을 제자리에서 옮긴다(재가져오기를 강제하지 않는다 — 사용자가
손본 가사가 있을 수 있다). 실제 DB 에서 곡집 3개·대응곡 428쌍·컬럼 제거까지 확인했다.

**통합 검색**: 번호 → 곡집 지정 번호 → 제목(공백 무시) → 가사 부분일치 순으로 본다.
곡집을 고르면 그 범위로 좁히고, 검색어가 없으면 번호 순 목록을 돌려준다.

**UI**: 바로가기 버튼 4개(대표 한 글자) + 드롭다운 + 리스트. 가져오기는 미리보기를
먼저 보여주고, 가져온 뒤 빠진 번호를 알린다.

**작업 중 잡은 버그**: 마이그레이션이 `DROP COLUMN` 에서 실패했다 — 옛 인덱스
`idx_songs_number(hymnal, hymn_number)` 가 컬럼을 참조해 SQLite 가 거부했다
(`error in index ... after drop column`). 옛 컬럼을 참조하는 인덱스를 먼저 지우도록 고쳤다.

### ✅ 예배 중 손이 멈추지 않게 (곡집 구조 이후 추가)

곡집 구조를 올린 뒤 실사용 관점에서 세 가지를 더 넣었다. 공통 기준은 **편의 기능이
예배를 방해하면 안 된다** — 실패해도 송출은 진행되고, 자동으로는 아무것도 지우지 않는다.

**① 번호 즉시 송출** — 검색창 Enter 로 첫 결과를 열고 곧바로 송출한다(`openAndSend`).
곡을 여는 것과 올리는 것이 두 동작이면 곡이 갑자기 바뀔 때 손이 멈춘다. 결과가 없으면
아무 일도 하지 않는다(잘못 눌러 화면이 비지 않는다). 열려 있던 언어 선택은 그 곡이
가진 언어로 교집합을 잡고, 비면 첫 언어를 쓴다.

**② 최근·자주 쓴 곡** — 예배에 반복되는 곡은 20~30곡 남짓이라, 검색 단계 자체를
없앨 수 있다. 검색어가 비면 최근 송출 곡을 칩으로 보여준다.

기록은 `/deck` 이 **실제로 슬라이드를 만들었을 때만** 남긴다 — 가사가 없어 빈 덱이면
'사용'이 아니다. `markUsed` 는 try/catch 로 감싸 기록 실패가 송출을 막지 못하게 했다.

순서는 `last_used_at` 이 아니라 **단조 증가 `used_seq`** 로 잡는다. ISO 시각은 밀리초
정밀도라 같은 밀리초에 두 곡을 보내면 순서가 불확정이고(테스트가 실제로 이걸 잡았다),
시스템 시계가 뒤로 가면 아예 뒤집힌다. 시각은 표시용으로만 남겼다.

**③ 가사 점검** — 자료를 일부만 가져오면 '번호·제목만 있는 곡'이 남는다. 예배 중에
발견하면 늦으므로 미리 목록으로 뽑는다(`no_sections` · `no_lines` · `too_few_lines`).
곡집으로 범위를 좁힐 수 있고, **지우는 기능은 넣지 않았다** — 채우는 것은 사람의 판단이다.

**넣지 않은 것**: 중복 곡 검출(사용자 판단 — 가사 용량이 작아 중복을 남기는 편이
관리에 낫다), FreeShow 가져오기(자료가 일부뿐).

### ✅ 가사 줄나눔 (예배 중 속도 이후 추가)

캡처로 보고된 사고: 새256 이 `묵묵히 참고` | `당하셨네` 로 갈라져 송출됐다.
원인은 두 가지가 겹친 것이었다.

**① 고아 줄** — `chunk()` 가 3줄을 기계적으로 `2+1` 로 잘라 마지막 한 줄만 다음
화면으로 넘겼다. 찬송가 섹션의 30%(1,484/4,877)가 홀수 줄이라 자주 일어났다.
필요한 장수를 먼저 정하고 균등 분배하도록 바꿨고, 그래도 마지막 장이 한 줄이면
장수를 하나 줄인다. `1줄씩` 설정은 모든 화면이 한 줄인 것이 의도이므로 제외한다.

**② 줄나눔 자체가 틀림** — 원본 DB 에 줄바꿈이 없어 글자 폭만 보고 나눴다.
증거는 데이터에 있었다. 새256 의 세 절이 `12/11/13`, `12/13/11`, `13/12/11` 로
**경계가 서로 달랐다** — 같은 멜로디에서는 불가능한 일이다.

그 제약을 거꾸로 쓴다. 행 수 후보마다 절들을 나눠 보고 절끼리 행 길이가 일치하는
구조를 찾는다. 분할은 편차 제곱합을 최소화하는 DP 로 한다 (최대폭 최소화는
'한 행만 크게 벗어난 분할'과 '고르게 벗어난 분할'을 구별하지 못한다).

**측정으로 잡은 두 가지 함정:**

1. *절 간 일치만으로는 행 수를 못 정한다.* 새256 은 2·3·4·6행이 모두 편차 0.00 이다
   — 모든 절을 같은 방식으로 잘못 자르면 '일관되게' 틀리기 때문이다. 구별 신호는
   운율 자체에 있었다: 실제 운율은 균일하거나(`9.9.9.9`) 교대한다(`8.6.8.6` —
   Amazing Grace 의 Common Meter). 폭 기준이 만든 `12/11/13` 에는 어떤 주기도 없다.
2. *균일 목표만 쓰면 교대 운율이 깨진다.* 새305 에서 `8/6/8/6` 과 `8/7/7/6` 이 섞였다.
   첫 분할 결과를 **행별 목표 벡터**로 삼아 다시 나누는 2패스로 고쳤다.

결과: 찬송가 1,202곡 중 자동 적용 가능 751곡, 사람 확인 308곡, 정렬 불가 57곡(절 1개).

**한계를 숨기지 않는다.** 새8(`거룩 거룩 거룩`)은 운율이 `11.12.12.10` 으로 주기가
없어 행 수를 정할 수 없다. 편차가 0 이어도 신뢰도를 high 로 주지 않고 사람에게 넘긴다
— 신뢰도는 '절끼리 같은가'와 '주기가 있는가'를 **함께** 본다.

**사람 작업 보존**: `song_sections.lines_source` (`auto`|`manual`|`imported`).
편집 UI 저장 경로(`replaceSections`)는 기본값이 `manual` 이다. 이게 없으면 알고리즘을
개선할 때마다 사람이 손본 가사가 날아간다. 재정렬 결과는 `auto` 로 남겨 다음 개선 때
다시 계산할 수 있게 한다.

**적용은 미리보기가 기본**이다 (`npm run lyrics:realign`, `--apply` 로 실제 쓰기).
어절 경계에서만 끊으므로 본문은 한 글자도 바뀌지 않는다 — 테스트가 이를 검사한다.

### ✅ 후렴 병합 · 짝수 행 · 표시 폭 (출력 테스트 반영)

실사용 출력 테스트에서 세 가지가 걸렸다. 셋 다 데이터 구조 문제였다.

**① 후렴을 각 절 뒤로 되돌렸다 (586곡)**

가져올 때 `detectRefrain` 으로 떼어낸 것을 원형 복원했다. 원본이 이미 인라인
형태였으므로 손실이 구조적으로 없다 — `절(접미사 제거) + 후렴 = 원문` 이 성립한다.

되돌린 근거 두 가지:
- 후렴 곡 586곡 중 **97곡은 절 끝 어절이 후렴을 수식**한다. 새9 는
  `…성부와 성자와 성령 삼위의` + `하나님 우리 예배를…` 로 한 문장이 쪼개져 있었다
- 1·2·3·4절 뒤에 후렴이 한 번 오는 구조라 화살표로 순서대로 진행할 수 없었다

새36 에서 후렴이 두 번 보이는 것은 오류가 아니다 — 실제 찬송가에서
`금 면류관을 드려서 만유의 주 찬양` 이 반복되고, `detectRefrain` 이 마지막
반복만 접미사로 떼어냈던 것이다.

재가져오기 기본값도 바꿨다(`--split-refrain` 으로 옛 동작 복원 가능). 안 바꾸면
다음 `hymns:import` 가 병합을 되돌린다.

**② 행 수를 짝수로 강제했다**

홀수 행은 어떤 배수로도 깔끔히 나뉘지 않아 `2행, 1행` 이 반복된다.

순위 규칙은 세 곡으로 정할 수 없어(새8 은 세밀한 쪽, 새256 은 규칙적인 쪽이
맞는데 기준이 엇갈렸다) 후보 생성(`meterCandidates`)과 순위(`pickBest`)를 분리하고
1,146곡에 네 규칙을 돌려 비교했다 (`scripts/measure-meter-ranking.ts`).

| 규칙 | 꼬리조각 | 홀수행 |
|------|--------:|-------:|
| 짝수 → 일관성 → **주기 → 세밀함** | **8.20%** | 0곡 |
| 짝수 → 일관성 → 세밀함 → 주기 | 10.18% | 0곡 |
| 짝수 → 일관성 → 편차 → 주기 | 8.48% | 0곡 |
| 짝수 없이 (기존) | 7.82% | 286곡 |

'꼬리조각'은 행이 1글자 어절로 끝나는 비율 — 구가 갈라진 대리 지표다. 짝수 강제의
대가는 0.38%p 이고 얻는 것은 홀수 행 286곡 → 0곡이다. **세밀함을 먼저 보는 규칙은
10.18% 로 오히려 나빠져** 채택하지 않았다.

신뢰도 기준도 측정으로 확인했다: high 는 꼬리조각 5.80%, medium 은 10.88% —
거의 두 배 차이다. 기준을 느슨하게 하지 않고 high 540곡만 자동 적용했다.

**③ 표시 폭을 템플릿이 정한다 (기본 24자)**

저장은 운율 행 단위(새256 = `9.9.9.9`), 표시할 때 `fitLinesToWidth` 가 인접 행을
**짝으로** 묶는다.

```
9.9.9.9  --24자-->  19.19    (하단 두 줄)
9.9.9.9  --14자-->  9.9.9.9  (전체화면 큰 글씨)
```

세밀하게 저장하는 이유는 되돌릴 수 없기 때문이다 — 긴 행은 다시 쪼갤 안전한 방법이
없지만 짧은 행은 언제든 묶을 수 있다. 짝으로만 묶는 이유도 같다: 3행을 `2+1` 로
묶으면 홀수가 되어 고아 줄이 돌아온다.

프리셋에 `찬양 — 전체화면 큰 글씨`(96px, 14자)를 더해 8종이 됐다.

### ✅ 전체 초안 + 검토 화면 · 찬양 자료 폴더 규약

**초안을 전체에 넣었다.** `lyrics:realign --all` 로 medium·low 신뢰도까지 최선 후보를
넣어 531곡을 채웠다(high 540곡은 이미 적용돼 변화 없음). 아무것도 없는 상태보다
최선 후보가 들어가 있는 편이 사람의 검토가 빠르다.

**검토 화면**(`src/control/panels/ReviewPanel.tsx`)의 설계 기준은 *손이 멈추지 않는 것*이다.
1,200곡을 마우스로 오가면 끝나지 않으므로 `Enter` 승인 + 자동 다음 곡으로 만들었다.
행마다 글자 수를 나란히 보여 주는데, 절끼리 같은 숫자가 나오는지가 판단 근거다.

승인은 `lines_source = 'manual'`. 이 값이 **모든 자동 작업의 차단막**이다 —
재정렬·후렴 병합 모두 `'auto'` 인 섹션만 대상으로 한다. 가사 편집 경로
(`replaceSections`)의 기본값도 `'manual'` 이라, 고쳐 저장하면 그 자체가 확인이 된다.

정렬을 셋으로 나눈 이유는 쓰임이 다르기 때문이다: 전체를 훑을 때는 번호 순, 시간이
없을 때는 사용 빈도 순, 문제를 먼저 잡고 싶을 때는 '절마다 행 수가 다른 곡' 순.

**라우트 순서 주의**: `/api/songs/review` 가 `/api/songs/:id` 보다 뒤에 등록돼 있어도
Fastify 는 정적 경로를 우선한다. 깨지면 'review' 를 곡 id 로 해석해 404 가 되므로
회귀 테스트로 고정했다.

**찬양 자료 폴더 규약** — 원본은 파일, sqlite 는 산출물. 성경 DB 와 같은 구조다.

`~/Desktop/Data/Praise` 를 실측한 결과가 판단 근거가 됐다:

| 항목 | 결과 |
|------|------|
| 파일 | 2,062개 txt, 번호 1~2062 |
| 수집 품질 | 빈 파일 0 · HTML 잔여물 0 · 인코딩 오류 0 |
| **줄바꿈** | **이미 있음** (중앙값 16자, 24자 초과 4.4%) |
| 섹션 구분 | 구분 없음 952 · 빈 줄 1103 · 숫자만 369 · 괄호 259 · 맨 라벨 18 |
| 악보 | 2,062개, 번호로 100% 매칭 (`0001.bmp` + `(1889).bmp` 두 형식) |

**줄바꿈이 이미 있다는 것이 찬송가 DB 와의 결정적 차이다.** 제공자의 줄나눔이 추정보다
정확하므로 `lines_source = 'imported'` 로 넣어 자동 정렬 대상에서 뺀다.

파일을 원본으로 두는 이유는 수동 보정이다 — 자료를 모으는 중에는 편집기로 바로 고칠
수 있어야 하고 git 이력이 남아야 한다. sqlite 를 원본으로 두면 곡집이 늘 때마다
마이그레이션을 신경 써야 하고, 예배 전날 급히 고칠 때 도구가 필요하다.

폴더 규약은 **새로 만들지 않고 현재 수집 구조를 그대로 채택**했다 (폴더=곡집,
「번호 제목」=곡, '… 악보' 폴더는 번호로 연결). `.txt`·`.md` 를 함께 받아, 저작권·CCLI
메타가 필요한 곡만 md 로 승격한다.

`scripts/check-praise-folder.ts` 는 **읽기 전용**이다. 무엇을 고칠지는 사람이 정한다.

### ✅ 검토 화면 다듬기

**화면 안에서 바로 고친다.** 찬양 탭으로 옮겨 다니면 1,200곡을 볼 수 없다.
`수정하기` 로 편집창이 그 자리에서 열리고, 저장하면 확인 완료까지 함께 처리한다.
편집 중에는 `Enter` 를 승인에 쓰지 않는다 — 줄바꿈이어야 한다.

**목록만 스크롤한다.** `max-height: 60vh` 는 화면 높이와 무관한 고정값이라
1920×1080 에서도 페이지가 함께 넘쳤다. `.main:has(.review-panel)` 로 페이지
스크롤을 끄고, 목록·상세가 각자 `min-height: 0` 을 가진 스크롤 컨테이너가 되게 했다
(그리드 항목은 `min-height: 0` 없이는 내용만큼 늘어나 `overflow` 가 동작하지 않는다).

**진행률 분모 오류**: `total` 은 지금 보는 목록의 크기라 필터에 따라 달라진다.
그대로 분모로 쓰면 '미확인만' 을 껐을 때 100% 로 뛰었다. 분모는 항상 전체 곡이다.

**'운율 안 맞는 곡 순' 을 버렸다**: 재정렬이 절마다 행 수를 맞춰 놔서 대상이 0곡이었다.
아무 일도 하지 않는 정렬은 오해를 부른다. 실측으로 쓸모 있는 신호를 다시 골랐다 —
절이 하나뿐이라 정렬하지 못한 곡 56곡, 홀수 행이 남은 29개 섹션. (24자 초과 행은
0개였다 — 상한이 잘 잡혔다는 뜻이라 지표에서 뺐다.)

**저장이 다른 곡을 덮어쓸 수 있었다**: 곡 읽기는 비동기라 커서를 빠르게 옮기면
`current` 가 먼저 바뀌고 `draft` 는 아직 이전 곡의 가사인 순간이 생긴다. 그 상태로
저장하면 다른 곡을 덮어쓴다. `draftFor` 로 draft 의 주인을 함께 들고 다니며 일치할
때만 저장하도록 막았다.

### ✅ 찬양 탭 2단 · 즐겨찾기

**2단 배치.** 왼쪽에서 곡을 고르고 오른쪽에서 표시를 정한다. 위아래로 쌓으면 곡을
고른 뒤 설정을 보려고 매번 스크롤해야 했다.

높이 처리는 검토 화면과 같은 원리다 — 페이지가 아니라 **검색 결과 목록**이 남는 높이를
가져간다(`.song-hits { flex: 1; max-height: none }`). 카드 전체를 스크롤 컨테이너로
두면 검색창까지 함께 밀려 올라가므로, 카드는 flex 컬럼으로 두고 목록만 늘렸다.
1920×1080에서 목록 593px, 1280×720에서 138px로 자동 조절된다.

900px 미만에서는 1단으로 쌓고 **목록 높이 제한을 되살린다**(`max-height: 50vh`).
제한이 없으면 목록이 4,061px까지 펼쳐져 페이지가 감당할 수 없게 길어졌다.

**즐겨찾기(`songs.is_favorite`)로 바꿨다.** 최근 송출 순은 목록이 매번 흔들려 손이
기억하지 못한다. 송영·봉헌송처럼 예배마다 쓰는 곡은 사람이 지정해야 늘 같은 자리에 있다.

빈 목록 문제는 **대체 표시**로 풀었다 — 지정한 곡이 없으면 자주 쓴 곡을 보여 주고
라벨을 '자주 쓴 곡'으로 바꿔 그 사실을 감추지 않는다. 5칸인 이유는 한 줄에 들어가고
손이 기억할 수 있는 개수이기 때문이다.

사용 기록은 지우지 않았다 — 즐겨찾기 대체 표시와 검토 화면의 '자주 쓴 곡 순' 정렬이
쓴다.

### ✅ 곡 목록 정렬 (스크롤바 폭)

곡 목록의 항목이 검색창보다 오른쪽에서 **15px 짧았다.** 목록이 스크롤 컨테이너라
스크롤바가 그만큼 안쪽을 먹는데, 그 위의 검색창·곡집 버튼은 카드 폭 그대로였다.

스크롤바 폭은 플랫폼마다 다르고(맥의 오버레이 스크롤바는 0px) CSS 로는 알 수 없어
한 번 측정해 `--scrollbar-w` 로 둔다. 목록 위의 요소들에 그만큼 오른쪽 여백을 주면
오버레이 환경(0px)에서도 그대로 맞는다.

`scrollbar-gutter: stable` 을 함께 걸었다 — 검색 결과 수에 따라 스크롤바가 생겼다
사라지면 목록 폭이 매번 15px 씩 널뛴다.

검색창은 인라인 `width: 100%` 가 여백을 무시하고 늘어나 혼자 어긋나 있었다.
블록 요소로 두어 여백을 따르게 했다 (`width: auto`).

### ✅ 목록 항목 상하 정렬 · 승인 표시 · git

**항목이 눌려 글자가 밖으로 넘쳤다.** 22px 상자에 41px 내용이 들어 있었다.
목록을 화면 높이에 맞춰 늘리면서(`flex: 1`) 컨테이너 높이가 확정됐고, 그러자 세로
flex 항목들이 `flex-shrink: 1` 로 눌렸다. `.song-hit { min-height: 0 }` 이 내용
크기 보호(`min-height: auto`)까지 꺼 놓아 제한 없이 줄어들었다.
`flex-shrink: 0` 으로 고정했다 — 위아래 여백이 11px 로 같아졌다.

**승인 표시를 목록에 드러냈다.** 보호 장치(`lines_source = 'manual'`)는 있었지만
화면에 보이지 않아, 내 작업이 남아 있는지 확인할 방법이 없었다. 표시가 없으면
매번 다시 확인하게 된다. `SongSearchHit.confirmed` · `Song.confirmed` 로 실어
목록과 곡 제목에 초록색 '승인' 표를 붙였다.

**git 을 시작했다** (`github.com/ccumgol/sermon-presentation`). 데이터는 넣지 않는다 —
`data/`(144MB)는 원본에서 다시 빌드할 수 있고, 사용자가 손본 가사는 개인 자료다.
커밋 대상은 95개 파일 1.1MB.

### Phase 6 — Electron 패키징 & 배포 (1.5일)
- Electron 래핑: 서버를 메인 프로세스에서 기동, 컨트롤 패널을 앱 창으로
- 포트 자동 할당 + "OBS용 URL 복사" 버튼 (실제 포트 반영)
- 사용자 데이터 경로 정리(`userData`), 첫 실행 시 DB 초기화·템플릿 시딩
- macOS `.dmg` / Windows `.exe` 빌드, 코드사인 여부 판단
- **검증**: 다른 PC에 설치 → 데이터 `.zip` 가져오기 → OBS 연결까지 10분 내 완료

**총 예상: 10.5일** (집중 작업 기준. Phase 2 시점부터 실사용 가능)

---

## 10. 테스트 전략

| 계층 | 대상 | 도구 | 목표 |
|------|------|------|------|
| 단위 | 참조 파서, 가사 파서, 페이지네이터, 템플릿→CSS 변환 | Vitest | 커버리지 90%+ (로직 핵심) · 파서 70건 완료 |
| 데이터 | 성경 DB 무결성 — 역본별 절 수, 원본 대조 샘플, 빈 본문 탐지 | 검증 스크립트 | 실패 0건 · 42항목 완료 |
| 통합 | REST 라우트, WS 메시지 흐름, DB 쿼리 | Vitest + supertest | 주요 경로 100% |
| E2E | 컨트롤 조작 → 출력 화면 반영, 재연결 복구, 빠른 연속 조작 | Playwright | 핵심 6시나리오 |
| 수동 | OBS 실제 합성(투명/크로마키), 폰트 렌더, 리허설 | 체크리스트 | 예배 전 필수 |

**반드시 테스트할 예배 실전 시나리오**
1. 브라우저 소스 새로고침 → 현재 화면 복구
2. 서버 재시작 → 마지막 상태 복구
3. 다음 버튼 10회 빠른 연타 → 순서 정확
4. 네트워크(localhost) 순간 끊김 → 화면 유지, 자동 재연결
5. 매우 긴 절(시편 119편류) → 자동 분할 정상
6. 히브리어(RTL) + 한국어 동시 표시 → 방향 정상

---

## 11. 리스크와 대응

| 리스크 | 영향 | 대응 |
|--------|------|------|
| 예배 중 화면이 검게 나감 | **치명적** | 출력 페이지는 연결 끊김 시 현재 화면 유지. 상태를 디스크에 즉시 영속화. 서버 재시작 후 자동 복구 |
| OBS CEF 렌더 차이(폰트·굵기) | 중 | 출력 페이지 의존성 0, 웹폰트를 로컬 파일로 임베드. Phase 2에서 실제 OBS로 검증 |
| 한국어 줄바꿈이 어색 | 중 | `word-break: keep-all` + `overflow-wrap: break-word` 조합, 어절 단위 유지 |
| 역본 간 절 분할 불일치 | 중 | 절 번호 기반 정렬, 병합 절은 상위 절에 합쳐 표시. 불일치 시 오퍼레이터에게 경고 표시 |
| 원본 DB 손상 | 높 | ✅ 해결 — 원본은 `readOnly: true` 로만 연다. `ATTACH` 도 쓰지 않는다. 빌드는 임시 파일에 만든 뒤 성공 시에만 교체 |
| 원본 데이터 자체의 결함 | 중 | ✅ 대응 — 검증기가 원본과 무작위 200절을 직접 대조. 발견된 7개 사안은 `docs/KNOWN-DATA-ISSUES.md` 에 근거와 함께 기록. 교정은 `DUPLICATE_FIXES` 로 명시하고, 조용히 버리는 일이 없도록 제외 행을 리포트에 남긴다 |
| KJV 앞부분 잘린 절 158건 | 중 | 원본 결함으로 복원 불가. 검증기가 건수를 기준치로 추적. KJV를 주 역본으로 쓸 경우 다른 소스로 교체 필요 (한국어 흠정역은 정상) |
| 한국어 검색이 어절 단위로만 걸림 | 중 | ✅ 해결 — 한국어는 `LIKE` 부분일치, 그 외는 FTS5. 검증기가 `FTS < LIKE` 관계를 고정 검사 |
| 자동 분할이 실제 렌더와 어긋남 | 중 | 서버 추정이 아니라 **출력 페이지에서 실측**(`scrollHeight`) 후 보고하는 방식 |
| 오퍼레이터 오조작 | 중 | Esc 복구, 파괴적 동작 차단, 예배 모드 잠금 |
| 저작권 | 중 | 로컬·비배포 사용 전제. 찬양은 CCLI 번호·저작권 필드를 제공해 표기 의무 지원. 성경 역본 DB 재배포 금지 명시 |

---

## 12. 결정 사항

### 확정

| ID | 항목 | 결정 |
|----|------|------|
| D1 | 배포 형태 | **개발 = 로컬 서버, 배포 = Electron 앱 (Phase 6)**. 다른 봉사자 PC 설치를 전제로 경로·포트·데이터 이전 설계 반영 |
| D3 | 찬양 언어 | **한국어 + 영어 주력**, 다른 언어 혼용 가능. `lang` 자유 코드 + 언어별 폰트 폴백 체인(§5.6) |

### 남은 확인 사항 (기본값으로 진행 가능)

| ID | 질문 | 기본 권고안 |
|----|------|-------------|
| D2 | 기본 주 역본 | 개역개정 |
| D4 | 출력 해상도 | 1920×1080 기본, 템플릿에서 변경 가능 |
| D5 | 오퍼레이터 조작 기기 | PC 브라우저 + 태블릿 둘 다 지원 |
| D6 | 프리뷰/라이브 2단 확인을 기본으로 할지 | 기본 1단(즉시 송출) + 설정으로 2단 전환 |
| D7 | ~~기존 찬양 가사 데이터 보유 여부~~ | **해결됨** — 원본 폴더에 찬송가 DB 2개(새찬송가 645곡 + 통일찬송가 558곡)가 있다. Phase 4에 가져오기 스크립트를 추가했다 (§3.2). 현대 CCM은 없어 수동 입력·OpenLyrics로 채운다 |
| D8 | 한/영 외에 실제로 쓸 언어 | 미정 — 아키텍처는 제약 없음. 알려주시면 폰트 프리셋만 추가 |

---

## 부록 A — OBS 설정 요약

1. 소스 추가 → **브라우저**
2. URL: `http://localhost:7777/output?layer=main`
3. 폭 `1920` / 높이 `1080`
4. 사용자 지정 CSS: **비움** (기본값 삭제)
5. ☐ 표시되지 않을 때 소스 종료 — **해제**
6. ☐ 장면이 활성화될 때 브라우저 새로고침 — **해제**
7. ☑ 페이지 권한: 기본
8. 필터 불필요 (투명 배경 모드). 크로마키 모드 사용 시에만 크로마키 필터 추가

## 부록 B — 원본 성경 DB 참조

경로: `/Users/gihyunpark/Desktop/Data/BibleDB` (읽기 전용)

```sql
-- 절 조회 예시
SELECT bibleCode, Jang, Jul, Cont
FROM bible
WHERE bibleCode = 43 AND Jang = 3 AND Jul = 16;

-- 성경책 메타
SELECT bibleCode, name, abbr, end FROM volume_name ORDER BY bibleCode;
```
전 역본 스키마 동일 · 개역개정 31,102절 · `Cont`에 `○` 문단 기호 포함(정제 대상)

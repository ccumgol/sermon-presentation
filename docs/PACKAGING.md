# 맥·윈도우 배포판 만들기

> 앱을 쓰는 방법은 [USER-GUIDE](USER-GUIDE.md), 설치는 [README](../README.md) 를 보세요.
> 이 문서는 **배포판을 만드는 사람**을 위한 것입니다.
>
> 최종 갱신 2026-09-05

---

## 한 줄 요약

```bash
npm run dist:mac    # 맥에서 — .dmg 두 개 (Apple Silicon · Intel)
npm run dist:win    # 윈도우에서 — .exe 설치 파일
```

**윈도우 설치 파일은 윈도우(또는 Wine)에서만 만들어집니다.** 맥에서 만들려면
GitHub Actions 를 쓰세요 — 저장소의 Actions 탭에서 **설치 파일 빌드**를 실행하면
맥·윈도우 것이 함께 나옵니다 (`.github/workflows/build.yml`).

---

## 무엇이 들어가고 무엇이 안 들어가는가

| 들어감 | 안 들어감 |
|---|---|
| 프로그램 코드 · 화면 · 템플릿 프리셋 | **가사 (`songs.sqlite`)** |
| Electron 런타임 | **성경 DB (`bible.sqlite`, 97MB)** |
| | **악보 그림 (`data/sheets/`)** |
| | 배경 그림 · 폰트 |

**저작권 자료는 배포판에 넣지 않습니다.** 개역개정·새찬송가 가사·찬미예수 악보는
git 에도 없고(`data/` 는 gitignore) 설치 파일에도 없습니다.

받는 사람에게 자료를 주는 방법은 두 가지입니다.

1. **설정 탭 → 자료 내보내기 / 가져오기** — 가사·순서표·템플릿·폰트가 파일 하나로
   갑니다. 같은 번들을 여러 번 가져와도 곡이 늘지 않습니다.
2. **성경 DB 와 악보는 파일로** — 번들에 담기지 않습니다.
   앱의 **데이터 폴더 열기**(설정 탭)로 폴더를 연 뒤 그 안에 넣으세요.
   - `bible.sqlite` → 데이터 폴더 바로 아래
   - 악보 → 데이터 폴더의 `sheets/` 아래

---

## 데이터가 어디에 저장되는가

| | 자리 |
|---|---|
| 맥 | `~/Library/Application Support/sermon-presentation/data/` |
| 윈도우 | `%APPDATA%\sermon-presentation\data\` |

앱 안에는 쓸 수 없습니다 — 맥의 `.app` 은 서명돼 읽기 전용이고, 윈도우의
`Program Files` 는 관리자 권한이 필요합니다.

`data` 라는 **한 칸 아래**에 두는 이유: 그 위(`userData`)에는 Electron 이 Cookies·
Cache 같은 자기 파일을 만듭니다. 섞이면 '이 폴더만 복사하면 이사가 됩니다' 가
거짓이 됩니다.

---

## 겪은 함정 — 다시 만나면 여기를 보세요

### ① 앱이 창도 로그도 없이 죽는다 (종료 코드 133)

**앱 이름에 한글·공백을 쓰면 그렇습니다.**

`productName` 은 파일·번들 이름이 되고, 거기에는 **Helper 앱**
(`<이름> Helper.app`)도 포함됩니다. Electron 은 뜰 때 그 이름으로 Helper 를
찾는데, 한글 이름이면 찾지 못하고 `FATAL ... Unable to find helper app` 으로
죽습니다. 겉으로는 SIGTRAP 만 남아 원인을 찾기 어렵습니다.

- `productName` 은 **영문**으로 (`SermonPresentation`)
- 사람이 보는 이름은 `mac.extendInfo.CFBundleDisplayName` 으로 한글
- ⚠️ **`CFBundleName` 은 덮어쓰지 마세요** — 그것도 Helper 를 찾는 데 쓰입니다

### ② `asar: false` 인데 무결성 검사에서 죽는다

electron-builder 가 `default_app.asar` 을 지우면서도 `Info.plist` 의
`ElectronAsarIntegrity` 에는 그 해시를 남깁니다. Electron 이 없는 파일을 검사하다
죽습니다. `electron/after-pack.cjs` 가 빌드 뒤에 그 항목을 지웁니다.

### ③ 조작 화면이 404 가 된다

포장하면 서버가 `dist-server/` 아래 JS 로 도는데 `public/` 은 거기 없습니다.
`electron/main.cjs` 가 `SERMON_APP_ROOT` 로 진짜 자리를 알려 줍니다.

---

## 맥 배포판을 받는 사람에게 — **꼭 읽으세요**

**공증(notarize)하지 않았습니다** (Apple 개발자 계정 $99/년이 있어야 합니다).
그래서 다른 맥으로 옮기면 열리지 않습니다.

> **"SermonPresentation은(는) 손상되었기 때문에 열 수 없습니다.
> 해당 항목을 휴지통으로 이동해야 합니다."**

**손상된 것이 아닙니다.** 파일을 옮길 때(에어드롭·클라우드·USB·메일) macOS 가
**격리 표시**(`com.apple.quarantine`)를 붙이고, 공증되지 않은 앱을 막는 것입니다.
만든 맥에서는 그 표시가 없어 그냥 열립니다 — 그래서 만든 사람은 모릅니다.

### 여는 방법 (받는 쪽에서 한 번만)

앱을 **응용 프로그램에 복사한 뒤**, 터미널에서 한 줄:

```bash
xattr -dr com.apple.quarantine /Applications/SermonPresentation.app
```

그다음부터는 평소처럼 열면 됩니다.

> 시스템 설정 → 개인 정보 보호 및 보안 → **그래도 열기** 로도 될 때가 있지만,
> '손상됨' 문구가 뜬 경우에는 그 항목이 나타나지 않는 일이 많습니다.
> 위 명령이 확실합니다.

### 근본 해법

Apple 개발자 계정으로 **서명 + 공증**하면 이 과정이 사라집니다.

```yaml
# electron-builder.yml
mac:
  identity: "Developer ID Application: 이름 (팀ID)"
notarize:
  teamId: "팀ID"
```

환경 변수 `APPLE_ID` · `APPLE_APP_SPECIFIC_PASSWORD` · `APPLE_TEAM_ID` 가 필요합니다.

### 지금 하고 있는 것 — 애드혹 서명

`electron/after-pack.cjs` 가 빌드 뒤에 **애드혹 서명**을 합니다(인증서 없이).
이것만으로 격리를 통과하지는 못하지만, 서명이 아예 없을 때와 다릅니다:

| | 서명 없음 | 애드혹 서명 |
|---|---|---|
| 만든 맥 | 열림 | 열림 |
| 옮긴 맥 | **'손상됨'** — 되돌릴 길이 안 보인다 | '확인할 수 없음' — 설정에서 열 수 있다 |

⚠️ `codesign --deep` 은 쓰지 않습니다 (Electron 에서 깨집니다). **깊은 곳부터
바깥으로** 하나씩 서명합니다 — 순서를 지키지 않으면
`In subcomponent: .../chrome_crashpad_handler` 로 실패합니다.

---

## 아이콘 고치기

원본은 SVG 두 개입니다.

| 파일 | 쓰이는 곳 |
|---|---|
| `build-resources/icon.svg` | 32px 이상 — 줄 세 개 |
| `build-resources/icon-small.svg` | 16px — 줄 두 개 |

고친 뒤:

```bash
npm run icons
```

`icon.icns`(맥) · `icon.ico`(윈도우) · 프로젝터 PWA 아이콘 두 개가 함께 만들어집니다.
`librsvg` 와 `imagemagick` 이 필요합니다 (`brew install librsvg imagemagick`).

- **큰 그림을 고치면 작은 변형도 함께 고치세요** — 어긋나면 크기에 따라 다른 앱처럼 보입니다.
- **16px 에서 읽히는지 꼭 확인하세요.** 1픽셀이 64단위입니다 — 선 사이 틈이 128단위는
  되어야 두 줄로 보입니다. 처음에 40단위로 두었다가 통째로 뭉쳤습니다.
- `.icns` 는 맥에서만 만들어집니다(`iconutil` 이 맥 전용). 그래서 저장소에 커밋해
  두고 윈도우 CI 는 그것을 그대로 씁니다.

---

## 왜 서버를 JS 로 뽑는가

개발 중에는 Node 가 `server/*.ts` 를 그대로 실행합니다(타입 스트리핑). 하지만
Electron 의 Node 가 그것을 해 준다는 보장이 없어, 포장할 때는 `tsc` 로 평범한
JS 를 뽑습니다 (`tsconfig.build.json`).

`rewriteRelativeImportExtensions` 가 핵심입니다 — `./app.ts` 를 `./app.js` 로
바꿔 줍니다. 이것이 없으면 뽑은 JS 가 없는 `.ts` 파일을 찾습니다.

**개발 방식은 그대로입니다.** 빌드는 포장할 때만 돕니다.

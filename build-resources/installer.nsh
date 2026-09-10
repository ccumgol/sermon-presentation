; 윈도우 설치 과정에서 **필요한 다른 프로그램까지** 설치한다 (2026-09-10, 사용자 요청).
;
; ## 무엇을 설치하나
;
;   OBS Studio  — 필수. 이 앱은 OBS 의 브라우저 소스로 가사를 올린다
;   Google Chrome — 선택. 프로젝터 창을 주소줄 없이 띄울 수 있다
;
; 목록과 명령은 `lib/env-check.ts` 의 ENV_ITEMS 와 **같은 것**이다. 한쪽만 고치면
; 설치 관리자와 앱 안의 '이 PC 준비 상태' 가 서로 다른 말을 하게 된다.
;
; ## 설치는 winget 이 한다
;
; 우리가 설치 파일을 나르지 않는다 — 그러면 이 exe 가 수백 MB 가 되고, OBS 새 판이
; 나올 때마다 우리 배포판이 낡는다. winget 은 윈도우 10 1809 이상·11 에 기본으로
; 들어 있다(App Installer).
;
; ## ⚠️ 실패해도 설치를 멈추지 않는다
;
; 여기서 무엇이 잘못돼도 **예배 프레젠테이션 자체는 설치돼야 한다.** winget 이 없는
; PC, 인터넷이 막힌 교회 망, 회사 정책으로 막힌 경우 — 어느 것도 드문 일이 아니다.
; 그래서 모든 실패를 삼키고 넘어간다. 빠진 것은 앱을 열면
; **설정 탭 → 이 PC 준비 상태**가 다시 알려 주고 거기서도 설치할 수 있다.
;
; ## ⚠️ 이 파일은 **실행해 본 적이 없다** (2026-09-10)
;
; 만든 사람에게 윈도우가 없다. CI 가 NSIS 로 **컴파일되는 것까지는** 확인해 주지만
; (문법이 틀리면 빌드가 깨진다), 실제로 눌렀을 때의 동작은 사용자가 확인해야 한다.
; 그래서 **아무것도 강제하지 않고**, 실패를 전부 무시하도록 짰다.

; nsDialogs = 물어보는 화면 · LogicLib = ${If} · WinMessages = ${BST_CHECKED}
; (모두 중복 include 방지 장치가 있어 electron-builder 가 또 넣어도 괜찮다)
!include LogicLib.nsh
!include nsDialogs.nsh
!include WinMessages.nsh

; ⚠️ **여기부터 파일 끝까지 `!ifndef BUILD_UNINSTALLER` 로 감싼다** (2026-09-10 CI 가 잡았다).
;
; electron-builder 는 설치 관리자와 **제거 관리자를 따로 컴파일**한다. 아래 것들은
; 설치 쪽에만 끼워지므로(`customPageAfterChangeDir` · `customInstall`), 감싸지 않으면
; 제거 쪽 컴파일에서 아무 데서도 안 쓰여 경고가 난다 —
;   `warning 6010: install function "PrereqPageShow" not referenced`
;   `warning 6001: Variable "PrereqPage" not referenced or never set`
; 그리고 electron-builder 는 **경고를 오류로 다룬다** → 빌드가 깨진다.
; (두 번에 걸쳐 겪었다: 처음엔 함수만 감쌌더니 이번엔 변수가 걸렸다)
!ifndef BUILD_UNINSTALLER

Var PrereqPage
Var CheckObs
Var CheckChrome
Var InstallObs
Var InstallChrome

; ── 물어보는 화면 ────────────────────────────────────────────────
; 묻지 않고 깔면 '내가 시키지도 않은 프로그램이 설치됐다' 가 된다.
; 기본값은 켜 둔다 — 대부분은 이게 필요해서 받은 것이다.
Function PrereqPageShow
  ; ⚠️ `MUI_HEADER_TEXT` 를 쓰지 않는다 — 이 파일은 electron-builder 가 MUI2 를
  ; 넣기 **전에** 끼워 넣으므로 그 매크로가 아직 없다. 그대로 두면
  ; `macro named "MUI_HEADER_TEXT" not found!` 로 **빌드가 깨진다** (2026-09-10 CI 가 잡았다).
  ; 제목은 아래 라벨로 직접 그린다.
  nsDialogs::Create 1018
  Pop $PrereqPage
  ${If} $PrereqPage == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 12u "함께 설치할 프로그램"
  Pop $0
  ${NSD_CreateLabel} 0 14u 100% 24u "예배를 진행하려면 아래 프로그램이 필요합니다. 이미 깔려 있으면 건너뜁니다.$\r$\n나중에 앱의 '설정 탭 → 이 PC 준비 상태' 에서도 설치할 수 있습니다."
  Pop $0

  ${NSD_CreateCheckbox} 0 44u 100% 12u "OBS Studio — 예배 영상을 송출합니다 (필수)"
  Pop $CheckObs
  ${NSD_Check} $CheckObs

  ${NSD_CreateCheckbox} 0 60u 100% 12u "Google Chrome — 프로젝터 창을 주소줄 없이 띄웁니다 (선택)"
  Pop $CheckChrome
  ${NSD_Check} $CheckChrome

  ${NSD_CreateLabel} 0 84u 100% 32u "설치는 윈도우의 winget 이 합니다. 인터넷이 필요하고 몇 분 걸릴 수 있습니다.$\r$\nwinget 이 없거나 실패해도 예배 프레젠테이션 설치는 그대로 끝납니다."
  Pop $0

  nsDialogs::Show
FunctionEnd

Function PrereqPageLeave
  ${NSD_GetState} $CheckObs $InstallObs
  ${NSD_GetState} $CheckChrome $InstallChrome
FunctionEnd

!macro customPageAfterChangeDir
  Page custom PrereqPageShow PrereqPageLeave
!macroend

; ── 실제로 설치하는 자리 ─────────────────────────────────────────
; `customInstall` 은 파일 복사가 끝난 뒤에 불린다 — 여기서 무엇이 잘못돼도
; 앱은 이미 깔려 있다.
!macro customInstall
  ; winget 이 있는가. 없으면 조용히 넘어간다 (윈도우 10 1809 미만 등)
  nsExec::ExecToStack 'cmd /c winget --version'
  Pop $0
  ${If} $0 != 0
    DetailPrint "winget 이 없어 추가 프로그램 설치를 건너뜁니다. 앱의 '이 PC 준비 상태' 에서 설치할 수 있습니다."
  ${Else}
    ${If} $InstallObs == ${BST_CHECKED}
      DetailPrint "OBS Studio 를 설치하는 중입니다… (몇 분 걸릴 수 있습니다)"
      ; --accept-*-agreements: 창이 뜨지 않게 한다. 없으면 설치가 조용히 멈춘 것처럼 보인다
      nsExec::ExecToLog 'cmd /c winget install --id OBSProject.OBSStudio -e --silent --accept-package-agreements --accept-source-agreements'
      Pop $0
      ${If} $0 == 0
        DetailPrint "OBS Studio 설치 완료."
      ${Else}
        DetailPrint "OBS Studio 설치를 마치지 못했습니다(코드 $0). 앱의 '이 PC 준비 상태' 에서 다시 시도할 수 있습니다."
      ${EndIf}
    ${EndIf}

    ${If} $InstallChrome == ${BST_CHECKED}
      DetailPrint "Google Chrome 을 설치하는 중입니다…"
      nsExec::ExecToLog 'cmd /c winget install --id Google.Chrome -e --silent --accept-package-agreements --accept-source-agreements'
      Pop $0
      ${If} $0 == 0
        DetailPrint "Google Chrome 설치 완료."
      ${Else}
        DetailPrint "Google Chrome 설치를 마치지 못했습니다(코드 $0). 앱의 '이 PC 준비 상태' 에서 다시 시도할 수 있습니다."
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!endif ; BUILD_UNINSTALLER

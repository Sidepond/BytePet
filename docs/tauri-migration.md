# Tauri 실행과 기존 데이터 가져오기

현재 `main`은 Tauri 2 / Rust / WKWebView 기반의 macOS 개발 버전입니다. Electron 실행 코드와 의존성은 제거했으며, 기존 화면·캐릭터 자산과 구버전 데이터 가져오기 기능을 유지합니다.

## 실행과 빌드

macOS 12 이상, Xcode Command Line Tools, Rust 1.91 이상, Node.js 22.12 이상이 필요합니다. 로그인 시 자동 실행은 macOS 13 이상에서 지원합니다. 이번 검증 환경은 Apple Silicon이며 Intel 빌드는 별도로 검증해야 합니다.

```sh
npm ci
npm run tauri:dev
npm run tauri:build
npm run package:tauri:preview
```

- 개발 실행: `npm run tauri:dev`
- 앱: `src-tauri/target/release/bundle/macos/BytePet Tauri Preview.app`
- 미리보기 DMG: `dist/tauri-preview/` 아래 날짜·커밋·아키텍처별 폴더
- 기본 실행·빌드: `npm start`, `npm run build`, `npm run package:preview` (모두 Tauri)

미리보기 앱은 ad-hoc 서명이며 Apple 공증을 받지 않았습니다. DMG는 Applications 바로가기와 앱을 포함하며 LZMA로 압축합니다. `build-info.json`과 `SHA256SUMS.txt`가 같이 생성됩니다. Tauri 런타임에는 Electron, Node.js 및 `node_modules`를 포함하지 않습니다. `desktop/`의 HTML/CSS/ES 모듈과 캐릭터 PNG만 준비하고 앱에 내장합니다.

## 옮긴 기능

| 기능 | Tauri 구현 |
| --- | --- |
| 캐릭터 | 기존 6종, idle·잠자기·먹기, 지원 캐릭터의 드래그·착지 모션을 공유 |
| 창 | 투명 창, 알파 기반 클릭 투과, 드래그, 위치 저장·복구, 모니터 영역 보정 |
| Spaces | 캐릭터·메뉴·게이지에 모든 Space 및 전체 화면 보조 창 속성 적용 |
| 메뉴 | 집 모양, 먹이/변환/개발 포트/사용량/설정, 일정한 메뉴 높이, 입력 초안 유지 |
| 화면 설정 | 땅 표시, 메뉴 방향, 캐릭터 선택, 기본 위치 복원 |
| 보관함 | 텍스트·파일·사진, 검색, 이미지 미리보기, 이름 변경, 휴지통·복원, Finder 열기 |
| 변환 | 기존 JSON/JWT 변환·검증 UI와 클립보드 복사 |
| 개발 포트 | `lsof` 조회, 주소 열기, 프로세스 신원 재확인, 네이티브 확인창 후 SIGTERM |
| Codex | 로컬 CLI의 app-server 표준 입출력으로 구독 한도 조회, 갱신 간격·취소·오류 표시 |
| Claude | 기존 상태줄 보존·복원, Rust 실행 파일의 상태줄 모드로 사용량만 로컬 저장 |
| 게이지 | 항상 표시/숨김, 땅/위/좌/우, 짧은/주간 한도 선택, 애니메이션과 독립된 위치 |
| 앱 편의 | 트레이, 캐릭터 우클릭 메뉴, 숨기기·복원, 단일 인스턴스, 앱 정보 복사, 로그인 시 실행 |

강아지 3종의 별도 드래그 이미지 작업은 기존과 마찬가지로 후속 작업입니다. 이번 이전에서 새 모션을 생성하지 않습니다.

## 저장 데이터와 기존 데이터 가져오기

기본 저장 폴더를 분리합니다.

- Electron: `~/Library/Application Support/BytePet`
- Tauri: `~/Library/Application Support/BytePet-Tauri`

설정 JSON 및 `food/<id>/content/`·`meta.json` 형식은 호환됩니다. 일반 실행은 기존 Electron 데이터를 자동으로 변경하거나 가져오지 않습니다. 두 앱을 종료한 상태에서 아래 명령으로 빈 Tauri 폴더에 **복사**할 수 있습니다.

```sh
"src-tauri/target/release/bundle/macos/BytePet Tauri Preview.app/Contents/MacOS/bytepet-tauri" \
  --import-electron="$HOME/Library/Application Support/BytePet"
```

대상 폴더가 이미 비어 있지 않으면 덮어쓰지 않고 중단합니다. 다른 빈 폴더에 가져오려면 `--user-data-dir=/절대/경로`를 함께 전달하고 이후 실행에도 같은 인수를 사용하세요. 가져오기는 설정, 위치, 보관함과 휴지통을 복사하며 Claude 연결·사용량 스냅샷이나 로그인 항목은 옮기지 않습니다. 손상된 항목이나 보관함 밖을 가리키는 링크를 발견하면 원본을 유지한 채 중단합니다.

## 연동 주의사항

- Codex CLI는 PATH와 일반적인 설치 경로에서 찾습니다. ChatGPT 구독으로 로그인한 CLI가 필요합니다. 계정 정보나 토큰은 보관함에 저장하지 않습니다.
- Claude 연결은 사용자가 설정 패널에서 켤 때만 `~/.claude/settings.json`의 상태줄을 변경합니다. `CLAUDE_CONFIG_DIR`을 지원합니다.
- Tauri 연결 기록은 `~/.claude/bytepet-tauri-usage/config.json`입니다. 기존 상태줄 명령과 옵션을 보존하고 실행 결과를 이어서 출력합니다.
- Electron BytePet에 Claude가 연결되어 있다면 먼저 기존 앱에서 연결을 해제해야 합니다. 두 앱이 같은 상태줄의 복원 기록을 덮어쓰지 않도록 합니다.
- Claude 연결 후 앱의 설치 위치를 옮겼다면 같은 설정에서 다시 연결하세요. 앱 삭제 전 연결을 해제하면 기존 상태줄을 복원할 수 있습니다.
- 자동 실행은 `/Applications`에 설치한 앱에서만 설정할 수 있습니다. 개발 실행·별도 프로필·DMG 내부 실행에서는 시스템 로그인 항목을 변경하지 않습니다.

## 검증

```sh
npm test
npm run test:desktop
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

Rust 테스트는 보관함 원문/바이트 보존, 경로 검증, 설정·휴지통 가져오기, 창 배치, 포트 파싱과 프로세스 신원, Codex 프로토콜, Claude 연결 복원, 하위 프로세스 출력/시간 제한을 다룹니다.

WKWebView 테스트는 임시 프로필에서 실제 앱을 실행하며 43개 UI/IPC 검증을 수행합니다. 별도 테스트에서 실제 바이너리의 Claude 상태줄 모드를 실행해 기존 상태줄 출력과 저장 데이터 제한을 확인합니다. 실제 Claude 설정과 로그인 항목은 변경하지 않습니다. GUI 테스트는 다른 데스크톱 테스트와 동시에 실행하지 마세요. `--smoke-script` 및 `test:*` 명령은 디버그 빌드에만 포함됩니다.

실제 Spaces 전환, 전체 화면 앱 위 표시, 서로 다른 배율의 다중 모니터, 설치 후 로그인 재실행은 사용 환경에서 추가 검증이 필요합니다. 해당 동작을 위한 네이티브 설정은 구현했지만 자동 테스트만으로 모든 macOS 조합을 검증하지는 않습니다.

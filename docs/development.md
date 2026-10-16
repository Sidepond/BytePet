# BytePet 개발 안내

일반 사용자는 [README의 DMG 설치 안내](../README.md#설치하기)를 참고하세요. 현재 앱은 Tauri 2 / Rust / macOS WKWebView 기반입니다. Electron 실행 코드·의존성·패키징 도구는 제거했습니다.

## 로컬 실행

macOS 12 이상, Xcode Command Line Tools, Rust 1.91 이상, Node.js 22.12.0 이상과 npm이 필요합니다. 로그인 시 자동 실행은 macOS 13 이상에서 지원합니다. Apple Silicon에서 검증했으며 Intel은 별도 검증이 필요합니다.

```sh
npm ci
npm start
# 같은 개발 실행: npm run dev
```

기본 저장 위치는 `~/Library/Application Support/BytePet-Tauri`입니다. 같은 데이터 폴더로 중복 실행하면 기존 앱을 표시하고 새 프로세스는 종료합니다. 개발·테스트에는 별도 프로필을 권장합니다. 첫 번째 `--`는 npm 인수, 뒤의 두 `--`는 Tauri 실행기와 앱 인수를 구분합니다.

```sh
npm start -- -- -- --user-data-dir=/tmp/bytepet-dev-profile
```

기존 Electron 데이터는 자동으로 변경하지 않습니다. [기존 데이터 가져오기와 Claude 연결 전환](tauri-migration.md#저장-데이터와-기존-데이터-가져오기)을 참고하세요.

## 코드 구성

| 경로 | 역할 |
| --- | --- |
| `src-tauri/src/main.rs` | 앱 진입점, 네이티브 명령 처리 |
| `src-tauri/src/` | 창·저장소·포트·설정·사용량 서비스와 Rust 테스트 |
| `src-tauri/tauri.conf.json` | 앱 버전·권한·번들 설정 |
| `tauri/` | 화면과 Rust를 연결하는 브리지, 보관함 메뉴 |
| `desktop/` | 펫·집 메뉴·사용량 게이지의 HTML/CSS/JavaScript |
| `desktop/assets/characters/` | 앱에 포함되는 캐릭터 PNG |
| `desktop/sprite-manifest.js` | 스프라이트 경로와 재생 규격 |
| `art/` | 현재 캐릭터 원본·승인 시트·규격·생성 기록 |
| `scripts/` | Tauri 패키징과 캐릭터 제작 도구 |
| `tests/` | 렌더러 단위 테스트와 실제 WKWebView 통합 테스트 |

`desktop/`은 프론트엔드 소스 폴더입니다. `prepare-tauri.mjs`가 화면·캐릭터와 브리지를 `build/tauri-web/`에 모아 앱에 내장합니다.

## 검증

```sh
npm test                 # JavaScript + Rust 단위 테스트
npm run test:desktop    # 실제 Tauri / WKWebView 통합 테스트
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

JavaScript 테스트는 캐릭터 동작·변환·결과 반응·사용량 표시를 검사합니다. Rust 테스트는 저장소·경로 검증·기존 데이터 가져오기·창 배치와 클릭 영역·포트·사용량 연동을 검사합니다. 제거된 Electron 서비스의 테스트는 더 이상 실행하지 않습니다.

데스크톱 테스트는 임시 프로필에서 실제 앱을 실행해 메뉴 높이, 사용량 게이지, 파일 저장·미리보기·휴지통, 설정과 IPC를 확인합니다. 별도 테스트에서 실제 바이너리의 Claude 상태줄 모드가 기존 출력과 데이터 제한을 지키는지 확인합니다. 실제 Claude 설정과 로그인 항목은 변경하지 않습니다. 디스플레이가 있는 macOS에서 실행하고 다른 GUI 테스트와 동시에 실행하지 마세요.

실제 Claude 구독 계정, Spaces·전체 화면 전환, 서로 다른 배율의 모니터와 설치 후 로그인 자동 실행은 추가 수동 검증 대상입니다.

## 앱과 DMG 빌드

```sh
npm run build           # 앱 번들 (package:mac도 동일)
npm run package:preview # 앱 빌드 + 미리보기 DMG
```

- 앱: `src-tauri/target/release/bundle/macos/BytePet Tauri Preview.app`
- DMG: `dist/tauri-preview/` 아래 버전·아키텍처·시각·커밋별 폴더
- 함께 생성되는 파일: SHA-256 체크섬, 빌드 정보, 릴리스 본문과 GitHub 설정 JSON

기본 명령은 현재 Mac의 아키텍처로 빌드합니다. `package:tauri:preview`, `tauri:dev`, `tauri:build` 별칭도 유지합니다. 버전 변경 시 `package.json`·잠금 파일·Cargo 파일·`tauri.conf.json`과 `docs/releases/v<버전>.md`를 함께 갱신하세요.

DMG는 ULMO(LZMA) 압축을 사용합니다. Tauri 앱에는 Electron·Node.js·개발용 브라우저가 포함되지 않습니다. 미리보기 앱은 로컬 ad-hoc 서명이며 Developer ID 서명·Apple 공증·자동 업데이트는 아직 포함하지 않습니다. 빌드·패키징은 GitHub 게시를 수행하지 않습니다.

앱 아이콘은 승인된 마멀레이드 대기 프레임에서 생성합니다. 아이콘을 변경할 때만 아래 명령으로 `src-tauri/icons/`를 갱신하세요. 일반 앱 빌드는 저장된 아이콘을 사용합니다.

```sh
npx playwright install chromium
npm run build:icon
```

## 앱 설정과 AI 사용량

로그인 시 자동 실행은 macOS ServiceManagement를 사용합니다. `/Applications`에 설치한 앱에서만 변경할 수 있으며 개발 실행과 별도 프로필에서는 시스템 로그인 항목을 변경하지 않습니다.

Codex는 로컬 CLI의 app-server로 조회합니다. Claude는 Rust 실행 파일의 상태줄 모드로 기존 출력을 보존하면서 사용률과 초기화 시각만 저장합니다. 연결 기록은 Claude 설정 폴더의 `bytepet-tauri-usage/`에 보관합니다. 자세한 구조와 주의사항은 [Tauri 안내](tauri-migration.md)를 참고하세요.

## 캐릭터 에셋

현재 6종 캐릭터는 로컬 PNG 스프라이트를 사용합니다. 앱 실행이나 기존 에셋의 재구성에는 PixelLab API 키가 필요하지 않습니다.

```sh
npx playwright install chromium # 캐릭터 제작 도구를 처음 사용할 때만
npm run build:characters
npm run sync:characters
```

`build:characters`는 저장된 이미지에서 갤러리를 재구성하고, `sync:characters`는 승인된 PNG와 재생 시간을 앱의 에셋·매니페스트에 반영합니다. 생성된 `art/pixellab-character-pack/preview.html`은 로컬 브라우저에서 열어 확인할 수 있습니다.

새 이미지를 PixelLab으로 생성할 때만 `.env.local`의 `PIXELLAB_API_KEY`가 필요합니다. 생성 명령은 외부 API를 호출하고 크레딧을 사용하므로 실행 전에 대상과 범위를 확인하세요. API 키와 요청·응답 기록은 Git에서 제외합니다.

공통 규격과 생성 절차는 [캐릭터 팩 문서](../art/pixellab-character-pack/README.md)에 있습니다. 강아지 3종의 전용 들기 모션은 [후속 작업](../art/pixellab-character-pack/README.md#dog-dragging-todo)으로 남겨두었습니다.

## README 이미지 갱신

기존 공개 예시 스크린샷과 GIF는 `docs/images/`에 유지합니다. Electron 전용 자동 캡처 스크립트는 제거했습니다. 화면 변경 후에는 별도 프로필의 Tauri 앱에서 공개용 예시 데이터로 캡처해 해당 이미지를 갱신하세요. 실제 보관함·계정·프로세스 정보가 포함되지 않도록 하고, 사용량이 예시 데이터라는 캡션을 유지하세요.

## 관련 문서

- [사용자 README](../README.md)
- [구현 현황과 후속 작업](roadmap.md)
- [Tauri 실행과 기존 데이터 가져오기](tauri-migration.md)

## 보관함 동작

- 저장 직후 빈 메모 입력칸은 접히며, 작성 중인 입력은 접기·탭 전환·미리보기로 지워지지 않습니다.
- 검색은 이름과 텍스트 먹이의 본문 전체를 대상으로 합니다. 일반 파일 내부의 내용은 검색하지 않습니다.
- 사진 썸네일과 미리보기는 검증한 보관함 항목 ID로만 요청하며, 로컬 네이티브 썸네일을 PNG로 전달합니다. 화면 근처의 이미지부터 최대 두 개씩 요청하며 작은 썸네일 캐시는 48개로 제한합니다. 지원하지 않는 형식은 파일 아이콘으로 표시합니다.
- 이름 변경은 `meta.json`의 표시 이름만 원자적으로 갱신합니다. 보관된 원본 파일명·바이트는 그대로 둡니다.
- 휴지통 이동은 `food/<id>`를 `food/.trash/<id>`로 이동하며, 복원은 동일한 ID로 되돌립니다. 앱 재시작 후에도 복원할 수 있고 자동 영구 삭제는 하지 않습니다. 휴지통 데이터도 로컬 디스크 공간을 사용합니다.
- 새 미리보기·이름 변경·휴지통·컨텍스트 메뉴 IPC는 패널의 최상위 프레임에서만 허용됩니다. 모듈 OFF 시 진행 중인 UI 응답을 무효화하고 열린 대화상자를 닫습니다.

## 저장소 관리 범위

현재 6종 캐릭터의 생성 원본·참조 이미지·승인된 시트·atlas·manifest와 제작 도구는 유지합니다. 과거 치즈 고양이 실험 3종 및 전용 스크립트, 오래된 기획 문서는 추적에서 제외했습니다. 기획 문서는 [로드맵](roadmap.md)으로 통합했습니다. 정리 시점의 원본은 로컬 `build/repository-archive/`에도 보관합니다.

`art/`의 생성된 HTML·스크린샷·원본 프레임 모음 이미지·검증 JSON은 Git에 넣지 않습니다. 새 체크아웃에서 `npm run build:characters`를 실행하면 누락된 캐릭터 미리보기도 저장된 원본으로 재구성합니다. API 호출은 없습니다. README에 필요한 `docs/images/`는 GitHub 표시를 위해 유지합니다.

추적 제외는 이후 체크아웃의 파일 수를 줄이며, 과거 Git 커밋의 용량을 제거하지 않습니다. 이 작업에서는 Git 기록을 다시 쓰지 않습니다.

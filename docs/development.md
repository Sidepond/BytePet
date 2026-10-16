# BytePet 개발 안내

일반 사용자는 [README의 DMG 설치 안내](../README.md#설치하기)를 참고하세요. 이 문서는 소스 코드를 실행하거나 수정하는 개발자를 위한 안내입니다.

## 로컬 실행

macOS, Node.js **22.12.0 이상**, npm이 필요합니다. 현재 앱은 Electron 기반입니다.

```sh
npm ci
npm start
```

개발 실행과 패키지 앱은 기본적으로 같은 `~/Library/Application Support/BytePet` 폴더를 사용합니다. 같은 데이터 폴더로 중복 실행하면 기존 앱을 표시하고 새 프로세스는 종료합니다. 별도 프로필을 사용하려면 `--user-data-dir`를 지정하세요.

```sh
npm start -- --user-data-dir=/tmp/bytepet-dev-profile
```

## 코드 구성

| 경로 | 역할 |
| --- | --- |
| `desktop/main.cjs` | Electron 앱 진입점 |
| `desktop/` | 펫 창, 집 메뉴, 로컬 보관함, 변환 도구, 포트 관리, AI 사용량 |
| `desktop/assets/characters/` | 앱에 포함되는 캐릭터 PNG |
| `desktop/sprite-manifest.js` | 스프라이트 경로와 재생 규격 |
| `art/` | 현재 캐릭터 원본·승인 시트·규격·생성 기록 |
| `scripts/` | 앱 패키징과 캐릭터 제작 도구 |
| `tests/` | 단위·Electron GUI·패키지 테스트 |

## 검증

```sh
npm test
npm run test:desktop
npm run test:usage-desktop
```

단위 테스트는 저장·변환·포트·설정·사용량 데이터 처리를 검사합니다. 데스크톱 테스트는 메뉴 크기 유지(포트 조회 중·실패·빈 목록·모듈 꺼짐 포함), 먹이/변환 입력 분리, 보관함 격자의 선택·키보드 탐색·검색·썸네일·미리보기·이름 변경·휴지통 복원도 확인합니다. 실제 Electron GUI를 실행하므로 디스플레이가 있는 macOS 환경에서 실행하세요. 임시 사용자 데이터 폴더를 사용하며, 일부 화면은 Git에서 제외된 `test-results/`에 저장합니다.

GUI 테스트는 창 포커스와 시스템 클립보드 등에 접근할 수 있습니다. 테스트 중에는 다른 입력 작업을 피하고, 여러 GUI 테스트 명령은 동시에 실행하지 않는 편이 좋습니다. 프로세스 종료 테스트는 테스트가 생성한 서버만 대상으로 합니다.

Codex 사용량은 실제 CLI 조회로 확인했습니다. Claude 연동은 공식 상태줄 형식의 모의 입력과 실제 연결 도우미로 검증했으며, 실제 구독 계정에서의 확인은 별도로 필요합니다. Windows·Linux 및 실제 다중 모니터 구성은 아직 검증하지 않았습니다.

## macOS 앱 패키징

```sh
npm run package:mac
npm run test:package
```

현재 Mac의 아키텍처에 맞는 독립 실행 앱을 만듭니다.

| 대상 | 결과물 |
| --- | --- |
| Apple Silicon | `dist/BytePet-darwin-arm64/BytePet.app` |
| Intel | `dist/BytePet-darwin-x64/BytePet.app` |

`npm run package:mac -- arm64` 또는 `npm run package:mac -- x64`로 대상을 지정할 수 있습니다. 실행 검증은 해당 아키텍처의 Mac에서 진행해야 합니다. 다시 빌드하면 같은 대상의 결과물을 교체하므로 기존 패키지 앱을 먼저 종료하세요.

앱 아이콘은 `scripts/create-icon.mjs`가 현재 마멀레이드 대기 시트의 첫 프레임에서 생성합니다. 투명 여백을 제외한 캐릭터를 정수 배율로 확대해 청록색 타일에 배치하고, macOS 아이콘 크기별 PNG와 ICNS를 `build/`에 만듭니다. 렌더링에는 임시 프로필의 숨겨진 Electron 창을 사용합니다.

패키지에는 `desktop/`과 실행에 필요한 앱 메타데이터만 포함합니다. 개발 도구, 테스트, 사용자 데이터와 API 키는 포함하지 않습니다. 생성물인 `build/`와 `dist/`는 Git에서 제외합니다.

테스트용 DMG는 다음 명령으로 만듭니다.

```sh
npm run package:preview
# Intel 대상: npm run package:preview -- x64
```

`dist/preview/BytePet-<preview 버전>-<아키텍처>/`에 앱, DMG, SHA-256 체크섬, 빌드 정보와 설치 안내를 생성합니다. 버전에는 UTC 빌드 시각·커밋과 미커밋 변경 여부(`dirty`)가 포함됩니다. 기존 결과물을 덮어쓰지 않습니다.

DMG는 **ULMO(LZMA)** 압축을 사용합니다. 동일 앱을 담은 기존 UDZO(zlib) DMG를 비교했을 때 약 124.3MiB에서 91.5MiB로 줄었습니다. 이번 최신 소스의 Preview DMG는 약 93MiB이며 파일 내용·파일시스템 배치에 따라 압축 크기는 달라집니다. 설치된 앱 크기는 약 287MiB로 동일합니다. 대부분이 Electron 런타임이며, 코드·이미지·아이콘을 합친 앱 리소스는 약 0.62MiB입니다. 런타임 라이브러리나 언어 리소스를 제거하지 않습니다.

패키지와 Preview DMG 모두 **로컬 ad-hoc 서명**을 사용합니다. Developer ID 서명·Apple 공증·GitHub 게시·자동 업데이트는 포함하지 않습니다. 정식 배포 전 다른 Mac에서 설치를 검증해야 합니다.

## 앱 편의 설정

- 로그인 시 자동 실행은 macOS 앱 패키지에서만 활성화합니다. 개발 실행과 `--user-data-dir`로 지정한 별도 프로필은 시스템 로그인 항목을 읽거나 변경하지 않습니다.
- 사용자가 스위치를 바꿀 때만 [Electron 로그인 항목 API](https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows)를 호출합니다. 별도 JSON 설정을 진실의 기준으로 사용하지 않으며, 설정 화면을 열거나 다시 포커스할 때 OS 상태를 확인합니다. 승인 대기와 조회·적용 실패를 구분합니다.
- 설정 바로 열기는 메뉴바·캐릭터 우클릭·앱 메뉴에서 제공하고, 앱 활성화 중 `⌘,`를 사용할 수 있습니다. 전역 단축키는 등록하지 않습니다.
- 기본 위치로 되돌리기는 드래그를 해제하고 기본 모니터로 창을 옮긴 뒤 저장합니다. 열린 메뉴와 게이지의 화면 경계를 함께 보정하며 입력 초안과 캐릭터 선택은 유지합니다.
- 환경 정보 복사는 버전·운영체제 버전·아키텍처·앱/개발 실행 여부만 포함합니다. 계정이나 파일 경로를 포함하지 않습니다.

`npm test`와 `npm run test:desktop`에 편의 기능 검증을 포함합니다. 자동 실행 등록과 클립보드 쓰기는 전용 UI 테스트에서 OS 경계를 모의하므로 실제 사용자 설정을 바꾸지 않습니다. 실제 앱 설치 위치에서 등록 후 로그아웃·로그인으로 자동 실행되는지는 별도 수동 확인이 필요합니다.

## 캐릭터 에셋

현재 6종 캐릭터는 로컬 PNG 스프라이트를 사용합니다. 앱 실행이나 기존 에셋의 재구성에는 PixelLab API 키가 필요하지 않습니다.

```sh
npm run build:characters
npm run sync:characters
```

`build:characters`는 저장된 이미지에서 갤러리를 재구성하고, `sync:characters`는 승인된 PNG와 재생 시간을 앱의 에셋·매니페스트에 반영합니다. 생성된 `art/pixellab-character-pack/preview.html`은 로컬 브라우저에서 열어 확인할 수 있습니다.

새 이미지를 PixelLab으로 생성할 때만 `.env.local`의 `PIXELLAB_API_KEY`가 필요합니다. 생성 명령은 외부 API를 호출하고 크레딧을 사용하므로 실행 전에 대상과 범위를 확인하세요. API 키와 요청·응답 기록은 Git에서 제외합니다.

공통 규격과 생성 절차는 [캐릭터 팩 문서](../art/pixellab-character-pack/README.md)에 있습니다. 강아지 3종의 전용 들기 모션은 [후속 작업](../art/pixellab-character-pack/README.md#dog-dragging-todo)으로 남겨두었습니다.

## AI 사용량 연동 구조

- **Codex:** 설치된 CLI의 `app-server`를 stdio로 실행해 `account/read`와 `account/rateLimits/read`로 조회합니다. 시작 시와 5분마다 조회하며, 수동 요청은 30초 간격으로 제한합니다.
- **Claude Code:** 사용자 설정의 `statusLine`에 연결 도우미를 추가해 공식 상태줄 입력에서 사용률과 초기화 시각만 추출합니다. 기존 명령의 출력과 옵션은 유지합니다. `CLAUDE_CONFIG_DIR`를 지원하며, 연결 파일과 복원 기록은 해당 설정 폴더의 `bytepet-usage/`에 저장합니다.
- **캐시:** Claude의 정규화된 사용률·초기화 시각·수신 시각은 앱 데이터 폴더의 `claude-usage.json`에 저장하고 5초마다 확인합니다. 설정은 `ai-usage.json`에 저장합니다.
- **표시:** 15분 이상 지난 값이나 실패 후 남은 값은 이전 값으로 구분하고, 초기화 시각을 지난 값은 새 데이터가 오기 전까지 `—`로 표시합니다. 기존 `hover` 설정은 `always`로 이전합니다.
- **배치:** 기본 `ground` 배치는 캐릭터 발밑의 땅 중앙에 겹칩니다. 땅을 숨겨도 같은 기준점을 사용하며, 애니메이션 프레임의 불투명 영역 변화가 게이지 위치를 바꾸지 않도록 유지해야 합니다. 위·왼쪽·오른쪽 배치도 선택할 수 있습니다.
- **설정 이전:** `ai-usage.json` 버전 2부터 기본 배치는 `ground`입니다. 버전 1의 `top`은 한 번만 `ground`로 이전하며, 기존 좌우 배치·숨김 설정과 버전 2에서 직접 선택한 `top`은 유지합니다.

연결 도우미는 설치된 앱의 실행 경로를 사용합니다. 앱을 이동하거나 삭제하기 전에 연결을 해제하고, 새 경로에서 다시 연결하세요. 다른 도구가 상태줄을 변경한 경우 연결 해제 과정에서 덮어쓰지 않습니다.

연동 규격은 [Codex App Server](https://learn.chatgpt.com/docs/app-server)와 [Claude Code 상태줄](https://code.claude.com/docs/en/statusline)을 참고하세요.

## README 이미지 갱신

README의 기능 화면과 GIF는 앱의 실제 UI·캐릭터 렌더러로 만듭니다. macOS에서 `npm ci`를 완료하고 `ffmpeg`를 설치한 뒤 실행하세요.

```sh
node scripts/build-readme-assets.mjs
```

임시 프로필에 예시 메모와 사진을 저장하고 데모 포트 목록을 표시해 캡처합니다. 사용자 보관함이나 AI 계정에 접근하지 않으며, 완료 후 임시 프로필을 제거합니다. 출력은 `docs/images/`입니다. GIF는 앱의 8프레임과 프레임별 재생 시간을 유지합니다.

AI 사용량 PNG 2개는 `tests/usage-desktop.test.mjs`의 모의 사용량 화면을 캡처한 이미지입니다. 위 스크립트는 저장된 두 이미지를 소개 화면 구성에 사용합니다. 사용량 UI를 변경하면 해당 테스트에서 생성되는 `/tmp/bytepet-usage-panel.png`와 `/tmp/bytepet-usage-badge.png`를 검토한 뒤 각각 `docs/images/ai-usage-panel.png`, `docs/images/ai-usage-gauge.png`로 반영하세요.

스크린샷을 바꿀 때는 공개용 예시 데이터만 사용하고, README의 예시 데이터 캡션도 유지해 주세요.

## 관련 문서

- [사용자 README](../README.md)
- [구현 현황과 후속 작업](roadmap.md)

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

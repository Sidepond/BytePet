# PixelLab 치즈 고양이 시안

[비교 화면](./preview.html)을 브라우저에서 연다. 기존 코드 그림과 PixelLab 결과를 나란히 재생하고, 대기/잠자기 전환, 1배/3배 확대, 일시 정지, 프레임 선택을 할 수 있다. HTML에 그림이 내장되어 인터넷 없이 열린다. 실제 앱의 캐릭터 렌더러에는 아직 적용하지 않았다.

## 생성과 규격

- 기존 `drawCat` / `drawSleeping`을 **24×24 투명 PNG**로 출력해 PixelLab의 `POST /v2/animate-with-text-v3`에 전달했다. 스크린샷이나 확대 그림을 입력하지 않았다.
- `first_frame`과 `last_frame`에 같은 그림, `frame_count: 8`, `seed: 42`, `no_background: true`, `enhance_prompt: false`, `drift_threshold: 0`을 지정했다. `drift_threshold`는 색상 보정 설정이며 위치 고정 기능이 아니다.
- 실제 응답은 입력 자세를 포함한 9장이었다. 원본을 `source/` 및 `revisions/2/source/`에 모두 보관했다.
- 출력은 96×96 프레임, 4열×2행의 384×192 투명 PNG이다. 모든 원본 픽셀을 정확히 4×4로 확대하며 프레임별 자동 크기 조절·보간을 하지 않는다. 바닥선은 y=92이다.
- 대기는 원본 0~7번을 순서대로 사용한다. 8번은 0번과 같으므로 반복 시 생략한다. 서로 다른 자세 8개이며 한 주기는 4.15초이다.

## 잠자기 보정

첫 생성은 등이 거의 움직이지 않고 얼굴과 귀, Z 표시가 변했다. 두 번째는 Z 표시를 제거하고 오른쪽 등의 움직임을 강조했다. 생성 원본에는 여전히 얼굴·귀의 변형과 과한 등 움직임이 있어 그대로 사용하지 않았다.

최종 잠자기는 두 번째 결과 중 작은 움직임만 골라 **0·1·7·7·1·0·0·0번**으로 구성했다. 8칸에 서로 다른 자세 3개를 배치한 4초 호흡 루프이다. 논리 좌표 `x=14..22, y=14..19`의 등 부분에만 생성 프레임을 사용하고, 얼굴·귀·발·꼬리는 입력 그림으로 고정했다. 프레임 전체의 위치 이동이나 크기 변경은 없다. 등 높이 변화는 최대 1픽셀, 얼굴 좌우 이동은 0픽셀로 검증했다.

이는 API 생성 결과를 선별·합성한 시안이며, 원본 API가 모든 위치 고정 지시를 지켰다는 뜻은 아니다. 원본은 [대기 전체 프레임](./raw-idle.png), [두 번째 잠자기 전체 프레임](./raw-sleeping.png)에서 비교할 수 있다.

## 재생성과 기록

```sh
# 저장한 결과로 시트·비교 화면을 다시 만들고 검증 (API 호출 없음)
npm run build:pixellab

# 기존 작업 결과를 이어서 가져오기 (새 생성 없음)
npm run sprites:pixellab -- poll idle
npm run sprites:pixellab -- poll sleeping 2
```

새 생성은 `.env.local`의 `PIXELLAB_API_KEY`를 읽는다. 예시는 `.env.example`에 있으며 실제 키 파일은 Git에서 제외한다. `prepare`는 로컬 요청만 만들고, `generate idle|sleeping [revision]`만 유료 생성을 요청한다. 이미 작업 기록이 있는 경우 중복 생성을 차단하고 POST를 자동 재시도하지 않는다. 새 시도는 별도 revision 번호를 사용한다. 새 revision을 검토할 때는 `npm run build:pixellab -- <revision>`으로 잠자기 원본을 선택할 수 있으며, 기존 보정 조건에 맞지 않는 결과는 검증에 실패할 수 있다.

이번 실험은 대기 1회, 잠자기 2회, 총 **3회 생성**했다. 각 응답의 사용량은 `generations: 1`이며 금액은 응답에 제공되지 않았다. `*-request.json`에 실제 입력과 프롬프트, `*-job.json`에 작업과 사용량, `*-response.json`에 전체 응답을 남겼다. API 키는 이 파일들에 포함하지 않는다. `prepare`는 이미 생성한 작업의 기록을 덮어쓰지 않는다.

`atlas.json`은 선택한 프레임과 보정 영역, 크기·바닥·재생 시간을 기록한다. `validation.json`은 원본 크기, 투명 배경, 바닥선, 반복 끝 자세, 얼굴 이동, 호흡 높이, 4배 픽셀 확대와 비교 UI의 재생·정지·동작 줄이기·작은 화면 검증 결과다. 빌드는 임시 Electron 프로필을 사용한다.

공식 참고: [PixelLab API 문서](https://api.pixellab.ai/v2/docs), [OpenAPI 스키마](https://api.pixellab.ai/v2/openapi.json).

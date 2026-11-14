# 유물과 유물 사이

국립중앙박물관 유물의 연결을 살펴보고, 관심사에 따른 추천을 체험하는 웹사이트입니다.

**[공개 웹사이트 바로가기 →](https://gummy-ai.github.io/temp-website/)**

GitHub Pages에 공개되어 있어 설치나 로그인 없이 브라우저에서 이용할 수 있습니다.

## 개발용 로컬 미리보기

```bash
python3 scripts/preview.py --port 4173
```

`http://localhost:4173/`에서 확인합니다. 원격 VS Code에서는 4173번 포트를 전달합니다. 이 서버는 `.env`·비공개 API 응답·엑셀을 제공하지 않고 사이트 공개 파일만 제공합니다.

먹색 바탕·금박 포인트의 "밤의 박물관" 디자인입니다(2026-11-14 개편, 이전 초안은 `.backup/gpt-draft-20261114/`).

- 첫 화면: 배경을 지운 백자 달항아리, 코드로 그린 수묵 산맥, 금빛 먼지.
- 이야기: 화면이 고정된 채 스크롤에 따라 청자 매병에서 시대·재질·문양 표찰로 실이 이어지고, 그 끝에 실제 추천 유물이 나타납니다.
- 발견: 기준 유물 5점 가운데 하나를 고르면 진열장으로 확대됩니다. 표찰을 누르면 CAFE 가중치가 별자리 도표로 펼쳐집니다. 안쪽 고리는 관계와 속성, 바깥 고리는 추천 6점이며, 선 굵기가 가중치입니다. 관계·속성 막대와 순위 변화도 함께 보여 줍니다.
- 소장품: `collection.json` 전체를 시대·재질·검색으로 거르고, 24점씩 "더 보기"로 늘립니다. 사진은 확대·이동할 수 있습니다.

추천 체험은 미리 계산한 실제 모델 결과(25개 조합)이며 실시간 모델 추론이 아닙니다. 기준 유물 5점의 배경 제거본은 `assets/cutouts/`에 있으며, 원본과 처리 방법은 `cutouts.json`에 기록했습니다.

### 첫 화면 효과와 인트로

- 떠다니는 불빛과 마우스 붓자국은 `app.js` 맨 위쪽 `HERO_FX_INTENSITY` 상수 하나로 세기를 조절합니다(0 = 끔, 1 = 설계 세기, 현재 0.85). 터치 화면에서는 불빛만, 움직임 줄이기 설정에서는 둘 다 꺼집니다.
- 첫 방문 인트로(문 열리는 5초 영상, `assets/media/intro.mp4`·`intro-mobile.mp4`, 포스터 `intro-poster.webp`)는 `index.html`의 `<html data-intro…>` 속성으로 지정합니다. 첫 방문 때 한 번 재생하고 끝나면 0.3초 겹침으로 첫 화면 반복 영상(처음 프레임부터)에 넘깁니다. 건너뛰기 버튼과 Esc가 있고, `?intro=1`을 붙이면 다시 볼 수 있습니다. 움직임 줄이기 설정에서는 생략합니다.
- 인트로 마지막 프레임과 반복 영상 첫 프레임의 차이는 평균 4.4(0–255 기준)입니다. 완전히 맞추려면 `media-src/hero-loop-first-frame.png`(공개 사이트에는 올리지 않음)를 끝 프레임으로 다시 생성하면 됩니다.

### 추천 체험의 계산

- 추천은 미리 계산한 실제 모델 결과입니다. `scripts/export_recommendations.py`가 원본 모델(`online-learning/2026-09-05`, 읽기 전용)로 `assets/recommendations.json`(기준 유물별 기본 상위 6점)과 `assets/recommendation-pool.json`(기준 유물별 칩, 후보마다 기준 유물 유사도와 칩별 조건 유사도, CAFE 원점수 s_k)을 만듭니다.
- "이 유물에서 끌리는 점" 칩은 기준 유물이 실제로 가진 트리플입니다. 칩을 고르면 모델의 관심 조건(para_sim 0.4)이 됩니다: 점수 = 0.6 × 기준 유물과의 코사인 유사도 + 0.4 × 고른 칩들의 조건 유사도 평균(`recommend_top_n`에 relation_id/tail_id 목록을 넣은 것과 같음). 칩 1개, 2개 조합, 속성 묶음 전체 208가지에서 원본 상위 6점과 모두 일치함을 확인했습니다.
- temperature 0(= 원본 `use_sampling=False`)이라 같은 선택에는 늘 같은 결과가 나옵니다. CAFE 해설 가중치는 화면의 6점에 대해 `src/importance.py`와 같은 식으로 다시 계산하며(차이 1e-7 이하), 고른 칩의 연결은 5배 무게를 받습니다.
- 조절용 상수(`app.js`): `RECOMMEND_TEMPERATURE`, `SWAY_INTENSITY`, `VITRINE_LIGHT`(진열장 사진의 빛 위치 x 63.7%·y 70.7%), `CURATOR_AUTOPLAY_MS`.
- 다시 내보내기: `/path/online-learning/2026-09-05/.venv-report/bin/python scripts/export_recommendations.py --project /path/online-learning/2026-09-05 --output /tmp/rec-export --verify` 후 두 JSON을 `assets/`로 복사합니다.

### 생성 미디어 넣기

Higgsfield 등으로 만든 영상·이미지는 `assets/media/`에 두고 `assets/media/manifest.json`의 해당 칸에 경로를 적습니다. 비어 있는 칸은 코드로 그린 배경을 그대로 씁니다.

| 칸 | 쓰이는 곳 |
| --- | --- |
| `hero.video` / `hero.image` | 첫 화면 배경(달항아리 뒤) |
| `story.video` (+ `videoMobile`, `poster`) | 이야기 구간 배경. 스크롤에 맞춰 앞뒤로 재생 |
| `vitrine.image` / `vitrine.video` | 진열장 배경 |
| `textures.silk` | 페이지 전체 질감 타일 |
| `textures.clouds` | 연구 구간 배경 |

스크롤 재생용 영상은 키프레임 간격을 짧게 다시 인코딩해야 부드럽게 움직입니다(H.264, GOP 8 안팎, 소리 제거, faststart).

2026-11-15 현재 넣은 파일(모두 생성형 AI로 만든 장식용 배경이며 실제 유물·장소 사진이 아님, 사이트 출처 창에도 표시):

| 파일 | 원본 → 변환 |
| --- | --- |
| `story-film.mp4` | 15초 1280×720 → H.264 CRF 24, GOP 10, 소리 없음, 5.2MB |
| `story-film-mobile.mp4` | 같은 영상 960×540, CRF 27, GOP 6, 1.8MB |
| `story-film-poster.webp` | 위 영상 첫 프레임 |
| `hero-loop.mp4` | 5초 반복 영상 → 끝 0.8초를 처음과 겹쳐 이음매 없는 4.3초 반복, H.264 CRF 23, 소리 없음, 0.5MB |
| `hero-still.webp` | 반복 영상의 기준 프레임 2688×1520 → 1920폭. 반복 영상이 뜨기 전·움직임 줄이기 설정에서 보이는 포스터 |
| `vitrine.webp` | 빈 진열장 1792×2240 → 1000폭 |
| `silk-tile.webp` | 비단 타일 2048 → 640 |
| `clouds.webp` | 금선 운문 2688×1520 → 1920폭, 바닥글 배경 |

소장품 사진은 `assets/collection.json`에 등록된 데이터에 따라 표시되며, 수집 결과를 반영하면서 늘어납니다. 기존 22점 사진도 함께 보존합니다. 기존 22점과 원본 추천 데이터·엑셀은 보존합니다. 나중에 승인된 이미지 수집 결과가 늘어나면 아래 명령으로 공개 컬렉션 데이터를 다시 생성합니다. 검색·필터·소장품 수는 데이터에 따라 갱신됩니다.

```bash
python3 scripts/build_site_data.py --matches image_matching/results/pilot-100/matches.json
```

`index.html`, `styles.css`, `app.js`가 초안 화면이고 `assets/`와 `image_matching/public/`가 공개 자산입니다. 이미지 매칭용 Python 코드와 인증키는 브라우저에서 사용하지 않습니다. 공개 사이트는 GitHub Pages에서 제공하며, 변경 사항을 저장소에 푸시하면 배포에 반영됩니다.

유물 이미지 자동 매칭 모듈과 실행 방법은 [image_matching/README.md](image_matching/README.md)를 참고하세요.

현재 웹페이지·추천 시스템과 분리된 로컬 데이터 생성 작업입니다. 인증키는 루트 `.env`에만 입력하며 Git에 포함하지 않습니다. 실제 API 검증 및 국립중앙박물관 100점 표본 결과는 `image_matching/results/pilot-100/`에 저장됩니다. 공개 가능한 이미지 사본과 JSON은 `image_matching/public/`에 준비되며 자동 배포하지 않습니다.

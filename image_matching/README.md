# e뮤지엄 유물 이미지 매칭

추천 시스템·학습 모델·원본 엑셀을 수정하지 않고, 공식 소장품 식별자와 이미지 사본을 생성하는 별도 모듈입니다. Python 3.12 표준 라이브러리만 사용합니다. Node.js는 선택적인 브라우저 어댑터 검사에만 필요합니다.

## 실행 범위

`pilot`은 국립중앙박물관 최대 100점으로 제한됩니다. 별도로 승인된 전체 9,664점 처리는 `image_matching.full` 작업자가 수행합니다. 공공데이터포털의 무료 API만 호출합니다. Higgsfield나 유료 이미지·영상 생성은 사용하지 않습니다.

```bash
cd /home/jinyoungjung/jinyoung/temp-website
python3 -m image_matching analyze
python3 -m image_matching probe
python3 -m image_matching pilot --limit 100 --seed 7
```

기본 엑셀 경로는 형제 폴더의 `online-learning/2026-09-05/input/203703_131741.xlsx`입니다. 다른 환경에서는 `--workbook /원본/경로.xlsx`로 지정합니다. 엑셀은 ZIP/XML로 읽으며 저장하지 않습니다.

## 인증키

프로젝트 루트 `.env`의 `EMUSEUM_SERVICE_KEY=` 뒤에 공공데이터포털 일반 인증키(Decoding)를 입력하고 저장합니다. Encoding 키는 URL 디코딩을 한 번 적용합니다. `.env.example`만 공유하며 `.env`는 Git에서 제외됩니다. 키를 명령 인자로 전달하거나 브라우저 코드에 넣지 않습니다.

키를 출력하지 않기 위해 HTTP 예외의 URL·본문을 출력하지 않고, API 응답의 `params`와 인증키가 들어 있는 이미지 URL은 캐시에도 보관하지 않습니다. `.private`에는 인증정보를 제거한 응답과 체크포인트만 저장합니다. 인증키가 있는 이미지 URL은 실행 중 메모리에만 존재합니다.

## 확인한 공식 API

- [e뮤지엄 공식 안내](https://www.emuseum.go.kr/openApi)
- [공공데이터포털: e뮤지엄 박물관 소장품 정보, 15159017](https://www.data.go.kr/data/15159017/openapi.do)
- [공식 기술문서](https://www.emuseum.go.kr/uploadfile/%5BEMUSEUM%5DOPEN-API_GUIDE.docx)
- [e뮤지엄 저작권 정책](https://www.emuseum.go.kr/copyright)

현재 안내와 실제 호출로 확인한 HTTPS Endpoint는 `https://apis.data.go.kr/1371027/openapi`이고, 기능은 `/code`, `/list`, `/detail`입니다. 첨부 DOCX에는 이전 `www.emuseum.go.kr/openapi/relic/list` 경로도 남아 있으므로 현재 공공데이터포털 경로를 우선합니다. 미확인 경로로 자동 우회하지 않습니다.

실제 XML은 `result/list/data/item`의 `key`·`value` 속성으로 필드를 제공합니다. 상세 응답의 `imageList/list/data`가 이미지 목록입니다. 실제 응답과 다른 구조는 오류로 중단합니다. `results/pilot-100/endpoint-verification.json`에 실제 연결 검증 결과가 기록됩니다.

## 엑셀 식별자와 매칭

- 원본 행 식별값: `번호`, 위치: `source_row`.
- 추천 시스템이 사용하는 식별자: `artifact::{소장기관}::{소장품번호}`.
- 매칭 키: 소장기관과 소장품번호 전체. 번호만으로 기관을 넘나들며 매칭하지 않습니다.
- API에서는 `museumName2`·`museumCode2`로 기관을 확인하고, `museumName3`·`relicNo`·`relicSubNo`로 전체 소장품번호를 확인합니다.
- 유니코드 NFKC·공백·여러 하이픈·숫자 앞 0을 정규화하되, 소장구분 접두부와 세부번호는 구별합니다. 원본 표기는 별도 보존합니다. 근거 없는 한글 수사 변환이나 기관 별칭은 만들지 않습니다.
- 정확한 원본 번호 일치는 `matched_exact`, 공식 기관 코드와 정규화 번호 일치는 `matched_normalized`로 구분합니다. 신뢰도 숫자는 규칙 강도이며 통계적 확률이 아닙니다.
- 검색은 공식 `indexWord`에 소장품번호를 넣고, 실패 시 유물명을 보조 검색합니다. 어떤 검색 결과든 기관·전체 번호가 일치해야 채택합니다. 이름만 같은 후보는 채택하지 않습니다.
- 번호 일치 후보가 여럿이거나 후보 조회가 잘린 경우 `manual_review`입니다. 지정 기관에서 찾지 못하면 해당 번호만 전 기관 검색하여 기관 충돌을 진단하고, 기관이 다르면 자동 재배정하지 않고 검토 대상으로 남깁니다. 제목 비교 결과는 보조 검증 값으로 보존하며 유물명 변경을 번호 일치와 혼동하지 않습니다.

새 박물관은 `matching.py`의 기관 등록부에 **공식 응답으로 확인한 코드**를 추가해야 합니다. 모르는 기관 코드를 추정하지 않습니다.

## 100점 표본과 재시작

표본은 국중박 유물의 `SHA256(seed + NUL + project_id)`를 정렬한 첫 100점입니다. 엑셀 행 순서와 무관하며 `sample.json`에 원본 파일 해시·seed·표본 해시를 보존합니다.

기본 호출 간격은 0.5초(초당 최대 2회), 한 실행 최대 요청 수는 1,000회입니다. 이미지 요청도 예산과 간격에 포함됩니다. HTTP 429·5xx·네트워크 오류는 최대 3회 시도하며 API 쿼터·인증 오류는 중단합니다. 실제 일일 한도는 사용자 키의 정책을 따릅니다.

매 유물 처리 후 체크포인트와 보고서를 원자적으로 저장합니다. 같은 명령을 다시 실행하면 완료된 유물을 중복 조회하지 않습니다. API 오류 항목만 재처리하려면 `--retry-errors`, 미매칭·검토 항목만 명시적으로 재확인하려면 `--retry-unmatched`를 추가합니다. 인증정보가 없는 캐시로 이미지를 새로 받아야 할 때만 상세 API를 갱신합니다.

## 이미지와 이용조건

API 원본 이미지 URL에는 `serviceKey`가 포함될 수 있습니다. 이 URL을 정적 JSON이나 HTML에 내보내지 않습니다. 해당 유물의 공공누리 조건을 확인하고 공개 이미지 사본을 로컬에서 받으며, 브라우저에는 **로컬 사본의 상대 URL**만 전달합니다.

현재 API는 소장품 레코드의 `glsv`를 제공하며 이미지별 별도 `glsv`는 보통 제공하지 않습니다. 각 이미지가 같은 소장품 ID에 속하는지 확인하고, 별도 이미지 조건이 있으면 이를 우선합니다. 소장품 레코드 조건을 사용했다면 `scope: collection_record`와 실제 근거 필드를 기록하며 이미지별 독립 라이선스를 확인했다고 표현하지 않습니다.

제1유형(출처표시)이며 해당 레코드에 속한 이미지에 한해 사본을 받습니다. 조건 누락·제2~4유형·ID 불일치는 검토 대상으로 남깁니다. 사진은 API가 반환한 700px 썸네일 URL을 우선 사용하고, JPEG/PNG/WebP 실제 파일 서명과 MIME을 검사합니다. HTTP 200으로 온 HTML 오류 페이지를 사진으로 저장하지 않습니다. 원본 사진을 합성하거나 다른 유물 사진으로 대체하지 않습니다.

API가 제공하지 않는 상세 페이지 URL·촬영자 등은 비워 둡니다. 추가 이미지 ID·순서·확인 가능한 공개 URL·이용조건은 수집하지만 대표 사본 한 장만 다운로드합니다. 인증정보를 제거하면 작동하지 않는 URL은 공개 URL로 가장하지 않습니다.

## 결과

`image_matching/results/pilot-100/`는 로컬 검토용이며 Git에서 제외됩니다.

| 파일 | 내용 |
| --- | --- |
| `workbook-analysis.json` | 컬럼·기관별 규모·ID 중복·정규화 충돌 |
| `endpoint-verification.json` | 현재 Endpoint 실제 연결 검증 |
| `sample.json` | 재현 가능한 표본과 해시 |
| `matches.json`, `matches.csv` | 매칭·이미지·출처·이용조건 결과 |
| `needs-review.json` | 실패·복수 후보·조건 확인·이미지 오류 항목 |
| `report.json` | 정확/정규화 매칭·확보율·오류·5개 이미지 URL 예시 |

`image_matching/public/`에는 공개 가능한 정적 JSON·실제 이미지 사본·어댑터만 있습니다. 원격 배포는 자동으로 실행하지 않습니다.

## 기존 웹사이트에 연결

기존 22점 이미지를 지우거나 추천 코드를 수정하지 않습니다. 새 카탈로그는 추천 결과의 `headKey`로 조회합니다. 소장품번호만 있는 결과는 소장기관을 함께 전달해야 합니다.

```javascript
import { loadImageCatalog, createArtifactPhoto } from './image_matching/public/image-catalog.js';

const imageFor = await loadImageCatalog({
  manifestUrl: new URL('./image_matching/public/artifact-images.json', location.href),
  // 기존 사이트의 파일을 함께 제공하는 경우에만 실제 위치를 설정합니다.
  existingManifestUrl: new URL('./assets/images/images.json', location.href),
  existingAssetBaseUrl: new URL('./', location.href),
});

// 추천 결과와 순서는 기존 시스템이 결정합니다.
for (const recommendation of existingRecommendations) {
  const record = imageFor(recommendation);
  cardContainer.append(createArtifactPhoto(record));
}
```

어댑터는 기존 이미지 매니페스트가 있으면 우선 보존합니다. 새 JSON이 없는 경우에도 기존 이미지를 유지하며, 사진 미확보 시 SVG 기본 이미지를 표시합니다. 사진을 누르면 실제 사진·유물명·출처·이용조건을 대화상자로 보여줍니다. 공식 상세 URL이 제공된 경우에만 링크를 만듭니다. 이 예시는 연결 위치를 설명하는 것이며 현재 기본 웹페이지를 교체하지 않습니다.

## 검증

```bash
python3 -m unittest discover -s image_matching/tests -v
node --check image_matching/public/image-catalog.js
node image_matching/tests/test_catalog.mjs
git check-ignore .env image_matching/.private/cache.json
```

실제 실행은 원본 엑셀·추천 소스·기존 소개 페이지·22점 이미지 파일의 해시를 비교해 변경 여부를 보고합니다. 결과 내보내기 전에도 인증키 및 `serviceKey`가 든 URL이 남지 않았는지 확인해야 합니다. `.env`를 `git add -f`로 강제 추가하지 않습니다.

## 전체 국중박 실행 — 2026-11-14 승인 범위

전체 작업은 `heritage-nmk-images.service`라는 **사용자 systemd 서비스**로 실행합니다. 사용자 관리자의 `Linger=yes`를 확인했으므로 VS Code·SSH 연결 종료와 독립적으로 동작합니다. `setsid`·`nohup`은 사용하지 않습니다.

작업 순서는 다음과 같습니다.

1. `assets/recommendations.json`의 catalog 87점 중 현재 사진이 없는 63점.
2. 나머지 추천 카탈로그 유물.
3. 국립중앙박물관 소장기관으로 표시된 나머지 유물, 총 9,664점.

기존 100점 결과를 SQLite 체크포인트에 가져오므로 완료 유물은 재조회하지 않습니다. 원본 소장기관과 번호가 일치하지 않으면 검토 대상으로 남기며, 다른 기관으로 자동 재배정하지 않습니다.

사용자가 공공데이터포털 활용신청 상세에서 확인한 한도는 **`/list`, `/detail`, `/code` 각각 하루 1,000회**입니다. `results/full-nmk/run-config.json`에 숫자와 확인 근거를 기록합니다. 별도 이미지 호스트의 하루 한도는 제공 화면에 없으므로 이미지 요청에도 보수적으로 하루 1,000회 로컬 상한을 적용하며, 이를 공식 포털 한도와 구분합니다.

`daily-quota.sqlite3`에 날짜·기능별 요청 수를 원자적으로 예약해 재시작해도 카운터가 유지됩니다. 시작일의 이전 사용량은 같은 날 캐시·이미지 생성 기록에 기능별 여유 20회를 더해 보수적으로 예약합니다. 포털의 실제 잔여량을 조회할 공식 기능은 제공 문서에서 확인되지 않았으므로 잔여량을 정확히 안다고 표현하지 않습니다. 제공자가 일일 한도 오류를 반환해도 즉시 그날의 해당 기능을 중단합니다.

하루 한도에 도달하면 체크포인트와 사이트 데이터를 저장하고 **다음 날 한국시간 00:05**까지 기다린 뒤 자동 재개합니다. 요청 간격은 이미지까지 포함해 최소 0.5초입니다. 한도에 따라 전체 작업은 여러 날에 걸릴 수 있습니다.

사진별로 `public/thumbs/*-480.webp`에 최대 가로 480px WebP 썸네일을 추가합니다. 작은 원본은 확대하지 않습니다. 원본 이미지와 기존 JSON 필드는 유지하고, `assets/collection.json` 항목에는 `thumb` 경로를 추가합니다. 기존 루트 메타데이터·사용자 정의 필드·기존 항목 순서는 보존합니다. 작업 25점 또는 약 60초마다 공개 카탈로그를 원자적으로 갱신합니다.

```bash
systemctl --user status heritage-nmk-images.service
systemctl --user restart heritage-nmk-images.service
systemctl --user stop heritage-nmk-images.service
```

현재 상태·중간 통계·완료 결과 파일:

- `image_matching/results/full-nmk/status.json`: 실행 상태, 진행률, 기능별 당일 예산, 다음 재개 시각.
- `image_matching/results/full-nmk/matches.json`, `matches.csv`: 처리한 유물의 상세 결과.
- `image_matching/results/full-nmk/needs-review.json`, `unmatched.json`: 검토 및 미매칭 목록.
- `image_matching/results/full-nmk/worker.log`: 비밀정보 없는 진행 로그.
- `image_matching/results/full-nmk/final-report.json`: 전체 작업이 완료될 때만 생성. 매칭·미매칭·검토 수와 원본/썸네일/합계 용량 포함.

일반 실행 중의 `status.json`을 전체 완료 보고서로 혼동하지 않습니다. 이 작업자는 디자인 파일과 `assets/collection.json` 이외의 `assets/` 파일을 쓰지 않습니다. 원본 엑셀과 추천 알고리즘도 수정하지 않습니다.

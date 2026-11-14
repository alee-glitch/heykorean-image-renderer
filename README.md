# HeyKorean Image Renderer

Instagram 채용공고 이미지 자동 합성 API 서버

## API

### POST /render

**Request Body:**
```json
{
  "image_url": "https://...",
  "title": "소프트웨어 엔지니어를\n채용합니다.",
  "subtitle": "TX | 정규직"
}
```

**Response:** PNG 이미지 (1080x1350)

### GET /health

서버 상태 확인

## 로컬 실행

```bash
npm install
npm start
```

## n8n 연동

HTTP Request 노드:
- Method: POST
- URL: https://your-app.render.com/render
- Body Content Type: JSON
- Response Format: File


---

## 캐러셀 템플릿 V2 — POST /render/v2

밝은 배경 · 축별 색 규칙을 쓰는 새 템플릿. 기존 `/render` 는 그대로 동작한다.
요청 1번에 카드 1장(PNG 1080x1350)을 돌려준다. 본문은 JSON, `type` 으로 카드 종류를 고른다.

**축(axis)과 색**

| axis | 뜻 | 배경 | 강조색 |
|---|---|---|---|
| `region` | 지역 | `#E8F4FE` | `#0096FA` |
| `cond` | 조건 (비자·신입·인턴) | `#E6F7EF` | `#00B06B` |
| `job` | 직군 | `#EFEBFE` | `#7C5CFC` |

급여와 비자는 축과 상관없이 항상 초록(`#00B06B`). 모든 글자에서 이모지는 자동으로 뺀다.

### 검수 (기본으로 켜져 있음)

`/render/v2` 는 그리기 전에 카드를 검수한다. 정보가 부족하거나 글이 칸을 넘치면 그리지 않고
`422` 와 `{ "error", "issues": [{ "field", "problem", "detail" }] }` 를 돌려준다.
넘치는 글을 잘라서 내보내지 않기 위한 장치다. 선정 기준과 글자 수 한도는 `CONTENT_RULES.md` 에 있다.

- `POST /render/v2/bundle` — 공고 후보 목록을 받아 한 묶음을 짠다. 본문: `{ axis, date, day, theme, open_total, jobs: [...] }`.
  규칙을 통과한 공고만 골라 `{ ok, count, issues, rejected, cards }` 를 돌려준다. `cards` 를 순서대로 `/render/v2` 에 넣으면 된다.
  통과한 공고가 3곳이 안 되면 `ok: false` 다.
- `POST /render/v2/check` — 그리지 않고 검수만 한다. 항상 `200` 으로 `{ "ok", "issues" }` 를 돌려준다.
- 시험할 때만 본문에 `"strict": false` 를 넣어 검수를 끈다. 이때는 넘치는 글을 줄여서 그린다.

### type: "cover" — 커버

```json
{
  "type": "cover", "axis": "cond",
  "date": "11.14", "day": "토",
  "theme": "비자 스폰서",
  "count": 5, "open_total": 162,
  "logos": [ { "url": "https://data.heykorean.com/job/company/....jpeg", "name": "Solomon America GA" } ]
}
```

- 필수: `date`, `theme`
- `logos` 는 5개까지. 이미지를 못 받으면 `name` 을 글자로 적는다.
- `theme` 이 길면 한 줄에 맞게 글자 크기를 줄인다.
- 선택: `sub` (기본값은 open_total 로 만든 문장), `label` (기본값은 축 이름), `count_text`, `brand`

### type: "job" — 공고 내지

```json
{
  "type": "job", "axis": "cond", "index": 1, "total": 5,
  "date": "11.14", "theme": "비자 스폰서",
  "logo_url": "https://...", "company": "SUNG NAM PAK CPA",
  "role": "회계·세무 어시스턴트",
  "where": "뉴욕 맨해튼", "state": "NY", "employment_type": "정규직/계약직", "experience": "경력무관",
  "pay": "$40,000 ~ $120,000", "pay_unit": "연봉",
  "visa": "J-1 · E-2 · H-1B · 영주권 스폰",
  "tasks": ["택스 신고 준비 보조", "회계 · 부기"],
  "needs": ["회계 전공 졸업자 또는 인턴"],
  "extra": "40년차 맨해튼 미드타운 회계법인",
  "deadline": "마감 11월 20일"
}
```

- 필수: `role`, `company`, `where`, `state`(주 코드 2글자), `pay`, `tasks` 2개 이상, `needs` 1개 이상
- 급여는 단위별 인정 범위 안에 있어야 한다. `$1`, `연봉 $4,000` 같은 값은 거절한다.
- 급여 공개 의무 주(`PAY_REQUIRED_STATES`)는 급여 금액이 없으면 거절한다.
- 그 밖의 주에서 `pay` 가 "면접 후 협의"면 초록 대신 회색으로 적는다.
- `tasks` 는 3개, `needs` 는 2개까지. 내용이 넘치면 부가 설명(`extra`) 제거 → 항목 1줄 처리 → 항목 수 축소 순으로 줄인다.

### type: "cta" — 마지막 장

```json
{ "type": "cta", "axis": "cond", "date": "11.14", "day": "토", "open_total": 162 }
```

- 필수: `date`
- 선택: `headline_pre`, `headline_num`, `headline_post`, `body` (3줄까지), `note` (안내 줄, 빈 문자열이면 생략), `foot`

### 폰트

`fonts/` 에 Pretendard Regular · Medium · SemiBold · Bold 가 있어야 디자인대로 나온다.
Medium · SemiBold 가 없으면 Regular · Bold 로 대체해서 그린다.

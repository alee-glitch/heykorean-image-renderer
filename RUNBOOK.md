# 구인구직 묶음 시안 만들기 (주 2회 예약 실행)

예약 작업이 이 순서대로 실행한다. 규칙은 `CONTENT_RULES.md`, 도구는 `tools/hk-jobs.js`.
시안이 슬랙 `채용공고-시안`에 올라가면 담당자가 스레드에 `승인`(또는 `첫줄: 문장`, `취소`)을 단다. 게시는 n8n 이 게시 예정일 뉴욕 오전 10시에 한다.

## 준비

1. 담당자 컴퓨터의 크롬에서 `https://job.heykorean.com/job/list` 탭을 연다. 공고 API 는 이 사이트 탭 안에서만 열린다.
2. 그 탭에서 도구를 불러온다.
   ```js
   eval(await (await fetch('https://raw.githubusercontent.com/alee-glitch/heykorean-image-renderer/main/tools/hk-jobs.js')).text())
   ```
   `HK ready` 가 나오면 된다.
3. 계획을 받는다. 키와 주소는 예약 작업 지시문에 있다.
   ```js
   const plan = await (await fetch(PLAN_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ key: PLAN_KEY, span: 4 }) })).json();
   HK.used = plan.used;
   ```
   `plan.slots` 가 이번에 채울 게시 예정일(뉴욕 날짜)과 축·주제다. 비어 있으면 할 일이 없다.

브라우저 도구는 실행 결과에 `=` `&` `?` 가 있으면 결과를 가린다. `HK.summary()`, `HK.peek()` 는 이 글자를 `§` 로 바꿔서 돌려준다. 다른 값을 볼 때도 같은 식으로 바꿔서 본다.

## 자리마다

1. 후보를 모은다: `await HK.candidates({ axis, theme, date })` → `HK.summary()` 로 목록을 본다.
2. 상세형(기본)은 3~5곳, 목록형(식당·식음료, 뷰티·헬스케어)은 5~15곳을 고른다.
   - 한 회사 1건, 같은 직군 2곳까지, 조건·직군 묶음에는 타주 공고가 있으면 1곳 이상.
   - 여러 직무를 한 공고에 모집하는 것, 같은 항목이 원문 안에서 서로 다른 것(급여, 근무시간, 고용형태, 언어 조건)은 고르지 않는다.
3. `HK.peek(i)` 로 원문을 읽고 카드 글을 쓴다. 쓰는 칸은 `role`, `where`(근무 도시, 주), `company`(필요하면 읽기 쉽게), `tasks`(2~3개), `needs`(1~2개), `extra`(선택) 뿐이다. 나머지는 도구가 공고 데이터로 채운다.
   - 원문에 있는 것만. 줄이는 건 되고, 더하거나 바꾸는 건 안 된다. 급여 칸 외에 커미션·팁 같은 조건이 원문에 있으면 `extra` 에 적는다.
   - 목록형은 `role` 만 쓴다.
4. 캡션 둘째 줄 문장(`hook`)을 쓴다(선택). 첫 줄은 n8n 이 만든다. 목록만 봐서는 안 보이는 사실 하나(비자 종류, 신입 가능, 근무 시간, 눈에 띄는 공고). 급여 개수 나열은 쓰지 않는다. 최근 30일 시안과 같은 틀은 피한다.
5. 먼저 `dry: true` 로 만들어 본다. 문제가 없으면 보낸다.
   ```js
   await HK.send(cards, { webhook: BUNDLE_URL, axis, theme: res.theme, format: res.format, date, hook, tags: ['#…', '#…'], open_total: res.open_total })
   ```
   - `res` 는 `HK.candidates` 결과. 타주 지역 주제는 `open_total` 이 비어 있다(커버에 큰 숫자를 쓰지 않는다).
   - 태그는 주제에 맞는 것 3개까지(고정 #헤이코리안 #미국취업은 n8n 이 붙인다).
6. 1~2분 뒤 슬랙에 시안이 오거나 실패 알림이 온다. 사실 확인에서 공고가 빠져 3곳(목록형 5곳)이 안 되면 실패 알림이 온다. 빠진 이유를 고쳐서(또는 다른 공고로 바꿔서) 한 번만 다시 보낸다.

## 모자랄 때

- 기준을 통과한 곳이 모자라면 범위를 한 번만 넓힌다: `res.widen`(조지아 → 조지아·남부, 캘리포니아 → 서부). 커버 주제명도 넓힌 이름으로 보낸다.
- 그래도 모자라면 같은 축의 다음 주제(`slot.next_in_axis` 순서)로 바꾼다.
- 기준을 낮추거나 최근에 쓴 공고를 다시 넣지 않는다.

## 끝나면

- 자리마다 무엇을 보냈는지(날짜, 주제, 곳 수, 빠진 공고와 이유)를 한 번에 정리해서 남긴다.
- 브라우저 탭은 연 것만 닫는다.

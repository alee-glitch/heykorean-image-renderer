/* 헤이코리안 구인구직 인스타 묶음 도구
   job.heykorean.com 탭에서 실행한다 (사이트 보안 때문에 이 사이트의 탭 안에서만 공고 API 가 열린다).
   1) HK.candidates(cfg)  주제에 맞는 후보를 모은다. 기계로 판정할 수 있는 규칙만 적용한다.
   2) HK.peek(i)          후보 하나의 본문을 읽기 좋게 돌려준다 (= & ? 는 § 로 바꿔서).
   3) HK.send(cards, meta) 카드 글(직무명, 하는 일, 필요한 것 등)만 받아, 나머지 칸은 공고 데이터로 채워 n8n 시안 워크플로우로 보낸다.
   규칙 원문은 CONTENT_RULES.md. 이 파일과 렌더 서버 v2.js 의 숫자(급여 범위, 공개 의무 주)는 같아야 한다. */
(() => {
  const PAY_REQUIRED = new Set(['CA', 'CO', 'CT', 'DC', 'HI', 'IL', 'ME', 'MD', 'MA', 'MN', 'NJ', 'NY', 'VT', 'VA', 'WA']);
  const UNIT = { 1: '주급', 2: '연봉', 3: '시급', 4: '월급' };
  const RANGE = { '시급': [7.25, 200], '주급': [250, 6000], '월급': [1000, 25000], '연봉': [15000, 600000] };
  const AB = { '뉴저지': 'NJ', '뉴욕': 'NY', '조지아': 'GA', '캘리포니아': 'CA', '텍사스': 'TX', '워싱턴 D.C': 'DC', '팬실베니아': 'PA',
    '매사추세츠': 'MA', '워싱턴': 'WA', '메릴랜드': 'MD', '일리노이': 'IL', '코네티컷': 'CT', '미시간': 'MI', '위스콘신': 'WI', '플로리다': 'FL',
    '콜로라도': 'CO', '아리조나': 'AZ', '노스캐롤라이나': 'NC', '사우스캐롤라이나': 'SC', '인디애나': 'IN', '네바다': 'NV', '오하이오': 'OH',
    '버지니아': 'VA', '앨라배마': 'AL', '하와이': 'HI', '미네소타': 'MN', '메인': 'ME', '버몬트': 'VT', '테네시': 'TN' };
  const EMP = { '1': '정규직', '2': '파트타임', '3': '계약직', '4': '단기', '5': '인턴' };
  const VISA = { GC: '영주권', H1: 'H-1B', E2: 'E-2', J1: 'J-1', OPT: 'OPT', L1: 'L-1' };
  const DAY = ['일', '월', '화', '수', '목', '금', '토'];

  // 주제 정의. 순서표는 CONTENT_RULES.md "주제 순서".
  const THEMES = {
    region: {
      '뉴욕·뉴저지': { states: ['NY', 'NJ'] },
      '조지아': { states: ['GA'], widen: '조지아·남부' },
      '조지아·남부': { states: ['GA', 'AL', 'TX', 'VA', 'NC', 'SC', 'TN', 'FL'] },
      '캘리포니아': { states: ['CA'], widen: '서부' },
      '남부': { states: ['AL', 'TX', 'VA', 'NC', 'SC', 'TN', 'FL'] },   // 조지아는 단독 주제가 따로 있어서 뺀다
      '서부': { states: ['CA', 'NV', 'WA'] },
      '중서부': { states: ['IN', 'IL', 'MI', 'OH'] },
    },
    cond: {
      '비자 스폰서': { list: (x) => x.sponsor_visa === 1, detail: (d) => String(d.sponsor_visa_type || '').trim() !== '' },   // 비자 종류가 적힌 공고만
      '이번 주 새 공고': { detail: (d, ctx) => ctx.daysSince(d.create_dt) <= 7 },
      '파트타임': { detail: (d) => String(d.employment_type || '').split(',').includes('2') },
      '인턴·신입': { list: (x) => x.internship === 1 || x.experience === 1 },
      '경력무관': { list: (x) => x.experience === 3 },
    },
    job: {
      '사무·경영': { cats: ['11'] },
      '식당·식음료': { cats: ['25'], format: 'list' },
      '생산·제조': { cats: ['19'] },
      '마케팅·디자인': { cats: ['12', '14'] },
      '무역·물류': { cats: ['15'] },
      '의료·간호': { cats: ['22'] },
      '뷰티·헬스케어': { cats: ['17'], format: 'list' },
    },
  };
  const OUT_OF_STATE_POOL = ['캘리포니아', '남부', '서부'];   // "타주 모음" 자리에서 재고가 가장 많은 쪽을 고른다

  const etDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });   // YYYY-MM-DD
  const diffDays = (a, b) => Math.round((Date.parse(String(b).slice(0, 10) + 'T00:00:00Z') - Date.parse(String(a).slice(0, 10) + 'T00:00:00Z')) / 86400000);
  const md = (iso) => iso.slice(5, 7) + '.' + iso.slice(8, 10);
  const mdKo = (iso) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
  const strip = (h) => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  const safe = (s) => String(s).replace(/[=&?]/g, '§');
  const api = async (path) => (await fetch(path, { credentials: 'omit' })).json();

  const HK = window.HK = window.HK || {};
  HK.used = HK.used || [];          // [{id, company_id?, date: 'YYYY-MM-DD'}] 이미 쓴 공고. plan 결과와 이번 실행에서 보낸 것.

  HK.load = async (force) => {
    if (HK._list && !force) return;
    const areaRaw = await api('/api/job/area');
    const AREA = {}; (Array.isArray(areaRaw) ? areaRaw : (areaRaw.list || areaRaw.data || [])).forEach((x) => { AREA[String(x.id)] = x; });
    HK._stateKo = (code) => { let n = AREA[String(code)], g = 0;
      while (n && String(n.parent_id) !== '4447' && n.depth > 1 && g++ < 6) n = AREA[String(n.parent_id)];
      return n ? (n['ko-kr'] || n.name) : ''; };
    const all = [];
    for (let pg = 1; pg <= 3; pg++) {
      const j = await api(`/api/job/list?limit=1000&page=${pg}&sorting=3`);
      (j.list || []).forEach((x) => all.push(x));
      if ((j.list || []).length < 1000) break;
    }
    HK._list = all;
    HK._open = new Map(all.filter((x) => x.status === 2).map((x) => [String(x.id), x]));
    HK._info = new Map();
  };
  const info = async (id) => {
    if (!HK._info.has(String(id))) HK._info.set(String(id), await api('/api/job/info/' + id));
    return HK._info.get(String(id));
  };
  const stateOf = (x) => AB[HK._stateKo(x.area_code)] || '';

  // 급여 판정: amount(금액이 단위 범위 안) / none(협의·없음) / bad(금액·단위가 맞지 않음)
  const payOf = (d) => {
    const unit = UNIT[d.salary_unit];
    const nums = [d.min_salary, d.max_salary].map(Number).filter((v) => v > 0);
    if (d.salary_nego_after_interview === 1 || !nums.length) return { kind: 'none', pay: '면접 후 협의', pay_unit: '' };
    const rg = RANGE[unit], lo = Math.min(...nums), hi = Math.max(...nums);
    if (!rg || lo < rg[0] || hi > rg[1]) return { kind: 'bad' };
    const f = (n) => '$' + n.toLocaleString('en-US');
    return { kind: 'amount', pay: lo === hi ? f(lo) : f(lo) + ' ~ ' + f(hi), pay_unit: unit };
  };
  const bodyOf = (d) => [strip(d.task), strip(d.requirement), strip(d.give_preference), strip(d.welfare), strip(d.content)].filter(Boolean).join('\n');
  const expOf = (x, d) => x.experience === 1 ? '신입' : x.experience === 3 ? '경력무관' : (Number(d.experience_year) > 0 ? `경력 ${d.experience_year}년 이상` : '경력');
  const visaOf = (d) => String(d.sponsor_visa_type || '').split(',').filter(Boolean).map((v) => VISA[v] || v).join(' · ');

  // 이미 쓴 공고·회사 제외: 같은 공고는 게시 예정일 앞뒤 14일, 같은 회사는 7일
  const usedBlock = (x, date) => {
    for (const u of HK.used) {
      const gap = Math.abs(diffDays(u.date, date));
      if (String(u.id) === String(x.id) && gap < 14) return '최근에 쓴 공고';
      const cid = u.company_id || (HK._open.get(String(u.id)) || {}).company_id;
      if (cid && String(cid) === String(x.company_id) && gap < 7) return '최근에 쓴 회사';
    }
    return '';
  };

  // 공고 하나를 규칙에 비춰 본다. 통과하면 후보 정보를, 아니면 { drop } 을 돌려준다.
  const judge = async (x, { date, format, minBody, stateSet, detailFilter, ctx, skipUsed }) => {
    const st = stateOf(x);
    if (!st) return { drop: '주를 알 수 없음' };
    if (stateSet && !stateSet.has(st)) return { drop: '주제 지역 아님' };
    const left = diffDays(date, x.perioid_end);
    if (left < (format === 'list' ? 5 : 3)) return { drop: '게시일 기준 마감 임박' };
    const u = skipUsed ? '' : usedBlock(x, date); if (u) return { drop: u };
    const r = await info(x.id); const d = r.job || {}, c = r.company || {};
    if (detailFilter && !detailFilter(d, ctx)) return { drop: '주제 조건 아님' };
    const p = payOf(d);
    if (p.kind === 'bad') return { drop: '급여 오류(금액·단위)' };
    if (p.kind === 'none' && (format === 'list' || PAY_REQUIRED.has(st))) return { drop: format === 'list' ? '목록형인데 급여 금액 없음' : '급여 공개 의무 주인데 금액 없음' };
    const body = bodyOf(d);
    if (format !== 'list' && body.length < minBody) return { drop: '본문이 짧음' };
    return { ok: {
      id: x.id, source_url: 'https://job.heykorean.com/job/view/' + x.id, company_id: x.company_id,
      company: c.name || x.company_name || '', title: d.title || x.title, state: st, city: c.city || x.company_city || '',
      address: d.address || '', working_location: d.working_location || '',
      employment_type: EMP[String(d.employment_type || '').split(',')[0]] || '', experience: expOf(x, d),
      pay: p.pay, pay_unit: p.pay_unit, pay_kind: p.kind, visa: visaOf(d),
      deadline_iso: String(x.perioid_end).slice(0, 10), days_left: left, category: String(x.category || '').slice(0, 2),
      logo_url: c.logo || '', views: x.count_view, out_of_state: !['NY', 'NJ'].includes(st), body,
    } };
  };

  // cfg: { axis: 'region'|'cond'|'job', theme, date: 'YYYY-MM-DD'(게시 예정일, 뉴욕), pool?, minBody? }
  HK.candidates = async (cfg) => {
    await HK.load();
    let theme = cfg.theme;
    if (cfg.axis === 'region' && theme === '타주 모음') {
      // 세 후보 중 통과 회사 수가 가장 많은 쪽
      let best = null;
      for (const t of OUT_OF_STATE_POOL) {
        const r = await HK.candidates({ ...cfg, theme: t, pool: 30, quiet: true });
        if (!best || r.companies > best.companies) best = r;
      }
      best.theme_slot = '타주 모음';
      return HK._last = best;
    }
    const def = (THEMES[cfg.axis] || {})[theme];
    if (!def) throw new Error('알 수 없는 주제: ' + cfg.axis + ' / ' + theme);
    const format = def.format || 'detail';
    const pool = cfg.pool || (format === 'list' ? 25 : 15);
    const minBody = cfg.minBody || 150;
    const ctx = { daysSince: (dt) => diffDays(String(dt || '').slice(0, 10), etDate()) };
    let themed = [...HK._open.values()];
    if (def.states) { const s = new Set(def.states); themed = themed.filter((x) => s.has(stateOf(x))); }
    if (def.cats) themed = themed.filter((x) => def.cats.some((c) => String(x.category || '').startsWith(c)));
    if (def.list) themed = themed.filter(def.list);
    themed.sort((a, b) => b.count_view - a.count_view);
    const cands = [], dropped = {}, seenCo = new Set();
    let outOfState = 0;
    for (const x of themed) {
      // 인기 순으로 채우되, 조건·직군 묶음은 타주 공고를 3곳까지 더 찾아본다 (지역이 한쪽으로 보이지 않게)
      const needOOS = cfg.axis !== 'region' && outOfState < 3;
      if (cands.length >= pool && !needOOS) break;
      if (cands.length >= pool && needOOS && ['NY', 'NJ'].includes(stateOf(x))) continue;
      if (seenCo.has(String(x.company_id))) { dropped['같은 회사'] = (dropped['같은 회사'] || 0) + 1; continue; }
      const j = await judge(x, { date: cfg.date, format, minBody, detailFilter: def.detail, ctx });
      if (j.drop) { dropped[j.drop] = (dropped[j.drop] || 0) + 1; continue; }
      seenCo.add(String(x.company_id)); cands.push(j.ok);
      if (j.ok.out_of_state) outOfState++;
      if (cands.length >= pool + 3) break;
    }
    // "지금 N건" 은 뉴욕·뉴저지가 섞인 큰 수일 때만. 타주 지역 주제는 쓰지 않는다.
    const isOOSRegion = cfg.axis === 'region' && theme !== '뉴욕·뉴저지';
    const res = { axis: cfg.axis, theme, format, date: cfg.date, open_total: isOOSRegion ? null : themed.length,
      companies: cands.length, widen: def.widen || null, candidates: cands, dropped };
    if (!cfg.quiet) HK._last = res;
    return res;
  };

  // 후보 요약 (출력 제한 때문에 짧게)
  HK.summary = (res = HK._last) => safe(res.candidates.map((c, i) =>
    `${i} | ${c.company} | ${c.title} | ${c.city}, ${c.state} | ${c.pay} ${c.pay_unit} | ${c.visa || '-'} | ${c.deadline_iso} | 본문 ${c.body.length}`).join('\n'));
  // 후보 하나의 원문. from 부터 len 글자.
  HK.peek = (i, from = 0, len = 1400, res = HK._last) => {
    const c = res.candidates[i];
    const head = `[${i}] ${c.company} / ${c.title}\n근무지 주소: ${c.address} / 근무 위치: ${c.working_location} / ${c.city}, ${c.state}\n고용형태: ${c.employment_type} / 경력: ${c.experience} / 급여: ${c.pay} ${c.pay_unit} / 비자: ${c.visa || '-'} / 마감: ${c.deadline_iso}\n`;
    return safe((from === 0 ? head : '') + c.body.slice(from, from + len) + (c.body.length > from + len ? `\n…(${c.body.length - from - len}자 더)` : ''));
  };

  // cards: [{ id, role, where?, company?, tasks?, needs?, extra? }]  — 사람이(Claude 가) 원문을 읽고 쓴 칸만
  // meta:  { webhook, axis, theme, format, date: 'YYYY-MM-DD'(게시 예정일), hook, tags: [], ask?, open_total? }
  HK.send = async (cards, meta) => {
    await HK.load(true);   // 보내기 직전에 공고 상태를 새로 읽는다
    const format = meta.format || 'detail';
    const jobs = [], rejected = [];
    for (const k of cards) {
      const x = HK._open.get(String(k.id));
      if (!x) { rejected.push({ id: k.id, why: '게시 중이 아님' }); continue; }
      const j = await judge(x, { date: meta.date, format, minBody: 0, skipUsed: true });
      if (j.drop) { rejected.push({ id: k.id, why: j.drop }); continue; }
      const r = await info(x.id); const d = r.job || {}, c = r.company || {};
      const p = payOf(d), st = stateOf(x);
      const where = k.where || [c.city || x.company_city, st].filter(Boolean).join(', ');
      const deadline = mdKo(String(x.perioid_end).slice(0, 10)) + ' 마감';
      const fields = {
        '회사 칸': c.name || x.company_name, '제목 칸': d.title || x.title, '근무지 주소 칸': d.address || '', '근무 위치 칸': d.working_location || '',
        '회사 도시 칸': c.city || '', '주 칸': HK._stateKo(x.area_code), '고용형태 칸': EMP[String(d.employment_type || '').split(',')[0]] || '',
        '경력 칸': expOf(x, d), '급여 칸': p.kind === 'amount' ? `${p.pay} ${p.pay_unit}` : (p.kind === 'none' ? '면접 후 협의' : '오류'),
        '비자 칸': visaOf(d) || '없음', '마감일 칸': String(x.perioid_end).slice(0, 10),
      };
      const source_text = Object.entries(fields).map(([a, b]) => `${a}: ${b}`).join('\n') + '\n\n본문:\n' + bodyOf(d);
      jobs.push({
        source_url: 'https://job.heykorean.com/job/view/' + x.id, company: k.company || c.name || x.company_name, role: k.role, where,
        state: st, employment_type: EMP[String(d.employment_type || '').split(',')[0]] || '', experience: expOf(x, d),
        pay: p.pay, pay_unit: p.pay_unit, visa: visaOf(d), deadline, category: String(x.category || '').slice(0, 2), logo_url: c.logo || '',
        tasks: k.tasks || [], needs: k.needs || [], extra: k.extra || '', source_text,
      });
    }
    const date = meta.date;
    const bundle = {
      axis: meta.axis, theme: meta.theme, format, date: md(date), day: DAY[new Date(date + 'T12:00:00Z').getUTCDay()], data_date: md(etDate()),
      hook: meta.hook || '', ask: meta.ask || '', tags: meta.tags || [], jobs,
    };
    if (meta.open_total != null) bundle.open_total = meta.open_total;
    const min = format === 'list' ? 5 : 3;
    if (jobs.length < min) return { sent: false, why: `보낼 수 있는 공고가 ${jobs.length}곳이라 ${min}곳이 안 돼요.`, rejected };
    HK._lastBundle = bundle;
    if (meta.dry) return { sent: false, dry: true, count: jobs.length, date: bundle.date, rejected };   // 보내지 않고 묶음만 만들어 본다
    const res = await fetch(meta.webhook, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(bundle) });
    if (res.ok) cards.forEach((k) => { const x = HK._open.get(String(k.id)); HK.used.push({ id: k.id, company_id: x && x.company_id, date }); });
    return { sent: res.ok, status: res.status, count: jobs.length, date: bundle.date, rejected };
  };

  HK.version = '2026-11-16';
  return 'HK ready';
})();

/* =========================================================
   第6课 旅游行程智规划 · 智慧课堂工具（幻灯片驱动 · 重设版）
   mode：student 学生端 | ppt/teacher 大屏演示（翻页即推进进度）
   主线：分解（短）→ 分工规划（向AI助手提问→平台/官网核实→行程卡）→ 汇报 → 迁移
   配图：每页预留 img 位（/ppt-images/<file>），未放置时显示占位框，最后由豆包生成
   ========================================================= */
(function () {
  'use strict';

  const QS = new URLSearchParams(location.search);
  const MODE = QS.get('mode') || 'student';
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const app = $('#app');

  /* ---------- 课程内容：全部来自 course.js ----------
     引擎里不出现任何课程专有名词（地名 / 岗位名 / 组名 / 页数）。
     换一门课只改 course.js，这个文件一行不动。 */
  const COURSE = window.COURSE;
  if (!COURSE || !Array.isArray(COURSE.slides) || !COURSE.slides.length) {
    document.body.innerHTML = '<pre style="padding:24px;font:16px/1.8 monospace;white-space:pre-wrap">' +
      '缺少 public/course.js，或里面的 slides 是空的。\n\n先按技能 pbl-classroom 的说明把这一门课填进 course.js。' +
      '</pre>';
    return;
  }
  const META = COURSE.meta || {};
  if (META.title) document.title = META.title + (MODE === 'ppt' || MODE === 'teacher' ? ' · 大屏' : '');
  const ROLES = (COURSE.roles || []).map(function (r) { return r.name; });
  const ROLE_META = {};
  (COURSE.roles || []).forEach(function (r) { ROLE_META[r.name] = r; });
  /* 四卡（角色 / 目标 / 知识 / 规矩，外加一条"诱饵规矩"） */
  const CARD_SETS = {};
  (COURSE.roles || []).forEach(function (r) {
    CARD_SETS[r.name] = Object.assign({ role: '', goal: '', know: '', rules: '', bad: '' }, r.cards || {});
  });

  /* 动手分解：主分支 + 每条分支下的小任务 */
  const MM_BRANCHES = COURSE.mindMap || [];
  const MM_KEYS = MM_BRANCHES.map(function (b) { return b.key; });
  const MM_CARDS = {};
  MM_BRANCHES.forEach(function (b) { MM_CARDS[b.key] = b.label || b.key; });
  const MM_SUBS = {};
  MM_BRANCHES.forEach(function (b) { MM_SUBS[b.key] = b.subs || []; });
  const SUB_CAT = {};                       // 小任务 id → 属于哪个主分支
  const SUB_TEXT = {};                      // 小任务 id → 文字
  MM_KEYS.forEach(function (k) { MM_SUBS[k].forEach(function (x) { SUB_CAT[x.id] = k; SUB_TEXT[x.id] = x.text; }); });
  const MM_SUB_TOTAL = MM_BRANCHES.reduce(function (n, b) { return n + (b.subs || []).length; }, 0);
  const MM_TOTAL = MM_KEYS.length + MM_SUB_TOTAL;

  /* 组 ⇄ 目的地（course.js 的 teams 是唯一来源） */
  const TEAM_DESTS = {};
  const TEAM_CITY = {};
  (COURSE.teams || []).forEach(function (t) {
    TEAM_DESTS[t.name] = t.dest || '';
    TEAM_CITY[t.name] = { city: t.city || '' };
  });

  /* 子问题池：所有岗位的子问题混在一起，学生挑出自己岗位的 */
  const SUBPOOL = [];
  (COURSE.roles || []).forEach(function (r) {
    (r.subProblems || []).forEach(function (s) { SUBPOOL.push({ id: s.id, role: r.name, text: s.text }); });
  });

  /* 题库：前端只拿题面（不带答案），判分在服务端 */
  const QUESTIONS = COURSE.questions || [];

  /* 页面 */
  const SLIDES = COURSE.slides;

  /* 行程卡：行顺序 + 每行归哪个岗位 + 图标 */
  const CARD_ROWS = (COURSE.cardRows || []).map(function (r) { return r.key; });
  const CARD_ICON = {};
  (COURSE.cardRows || []).forEach(function (r) { CARD_ICON[r.key] = r.icon || '•'; });
  const CARD_ROLE = {};
  (COURSE.roles || []).forEach(function (r) { if (r.cardRow) CARD_ROLE[r.cardRow] = r.name; });
  const ROLE_WORD = {};
  (COURSE.roles || []).forEach(function (r) { ROLE_WORD[r.name] = r.roleWord || '信息'; });

  // 提问页（按 act 定位，避免写死页码）
  const SLIDE_USE = SLIDES.findIndex(s => s.act === 'useAgent');
  /* 学生侧把「认领岗位」和「找出你岗位的子任务」合成一页：认领成功后子任务题直接出现在下面。
     所以老师翻到子任务那页时，学生停在认领页不动；老师再往后翻，学生才跟着走。 */
  const SLIDE_CLAIM = SLIDES.findIndex(s => s.act === 'claim');
  const SLIDE_PICK = SLIDES.findIndex(s => s.act === 'pick');
  /* 同理，「去平台核实」页把小组行程卡也带上：查一条填一条，不用来回翻。
     所以老师在「整理成行程卡」那页（放演示视频）时，学生也停在核实页不动。 */
  const SLIDE_PLATFORM = SLIDES.findIndex(s => s.act === 'platform');
  const SLIDE_ITIN = SLIDES.findIndex(s => s.act === 'itinerary');
  /* 行程卡页和互评页图最多，学生侧让工作区占满全宽，
     「我的小组 / 实时排行」挪到底部横排。 */
  const WIDE_ACTS = { platform: 1, report: 1 };
  const studentSlide = (sl) => {
    if (sl === SLIDE_PICK && SLIDE_CLAIM >= 0) return SLIDE_CLAIM;
    if (sl === SLIDE_ITIN && SLIDE_PLATFORM >= 0) return SLIDE_PLATFORM;
    return sl;
  };
  const wideLayout = (sl) => {
    const s = SLIDES[studentSlide(Math.min(sl, SLIDES.length - 1))];
    return !!(s && WIDE_ACTS[s.act]);
  };

  /* ---------- 全局状态 ---------- */
  let STATE = null;
  let me = loadMe();
  let netMode = 'server';
  let lastRenderedSlide = -1;
  let lastSig = '';
  let lastPanelSig = '';
  let transitioning = false;
  let sel = {};
  let dlgInstalled = false;
  let bc = null;
  let mm = { slide: -1, slots: MM_KEYS.map(() => null) };
  let pick = { role: null, ids: [] };

  function loadMe() { try { return JSON.parse(localStorage.getItem('cls_me') || '{}'); } catch { return {}; } }
  function saveMe() { localStorage.setItem('cls_me', JSON.stringify(me)); }
  function blankTeam(id, name, color, dest) {
    return { id, name, color, dest: dest || '', members: [], score: 0, badges: [], answeredBy: {}, roleClaims: {}, memberRoles: {}, mindMap: { nodes: [], submitted: false }, picks: {}, selfAwards: {}, agent: [], card: {} };
  }
  function defaultState() {
    const rows = COURSE.teams || [];
    return {
      title: META.title || '课堂', origin: META.origin || '', duration: META.duration || '', slide: 0,
      teams: rows.map((t, i) => Object.assign(blankTeam('T' + (i + 1), t.name, t.color, t.dest), { demo: !!t.demo })),
      audit: [], connected: 0,
    };
  }

  /* ---------- 网络层 ---------- */
  const Net = {
    es: null,
    connect() {
      try {
        this.es = new EventSource('/api/events');
        this.es.addEventListener('state', (e) => { STATE = JSON.parse(e.data); netMode = 'server'; if (checkSession()) return; afterState(); });
        this.es.onerror = () => { if (this.es && this.es.readyState === 2) { this.es.close(); this.useLocal(); } };
      } catch { this.useLocal(); }
    },
    useLocal() {
      netMode = 'local';
      STATE = loadLocal() || defaultState();
      try { bc = new BroadcastChannel('cls_room'); bc.onmessage = (e) => { if (e.data && e.data.type === 'state') { STATE = e.data.state; afterState(); } }; } catch {}
      afterState();
    },
    async send(action, payload) {
      if (netMode === 'server') { try { const r = await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload }) }); return await r.json().catch(() => null); } catch { return null; } }
      else { localApply(action, payload); persistLocal(); afterState(); return null; }
    },
  };
  function loadLocal() { try { return JSON.parse(localStorage.getItem('cls_state')); } catch { return null; } }
  function persistLocal() { localStorage.setItem('cls_state', JSON.stringify(STATE)); try { bc && bc.postMessage({ type: 'state', state: STATE }); } catch {} }
  function localApply(action, p) {
    p = p || {}; const t = p.teamId ? STATE.teams.find(x => x.id === p.teamId) : null;
    switch (action) {
      case 'setSlide': STATE.slide = Math.max(0, Math.min(SLIDES.length - 1, p.slide || 0)); break;

      case 'joinTeam': if (t && p.member && !t.members.includes(p.member)) t.members.push(p.member); break;
      case 'claimRole': if (t && p.role) { if (p.member) t.roleClaims[p.role] = p.member; else delete t.roleClaims[p.role]; } break;
      case 'submitQuiz': { if (!t || !p.member) break; const mine = t.answeredBy[p.member] || (t.answeredBy[p.member] = {}); if (mine[p.qid]) break; mine[p.qid] = { chosen: p.chosen, correct: false }; break; }   // 本地模式没有答案，只记录作答
      case 'setMindMap': if (t) t.mindMap = { nodes: (p.nodes || t.mindMap.nodes).slice(0, 60), submitted: !!p.submitted }; break;
      case 'setCard': if (t && p.key) { t.card = t.card || {}; t.card[p.key] = Object.assign({ t: '', img: '' }, t.card[p.key], { t: String(p.t == null ? '' : p.t).slice(0, 300) }); } break;
      case 'setCardImg': if (t && p.key) { t.card = t.card || {}; t.card[p.key] = Object.assign({ t: '', img: '' }, t.card[p.key], { img: String(p.img == null ? '' : p.img).slice(0, 300) }); } break;

      case 'logAgent': if (t) t.agent.push({ member: p.member || '', role: p.role, q: p.q, a: p.a, p: p.p || '', at: Date.now() }); break;

      case 'rateTeam': {
        if (!t || !p.rater) break;
        const stars = Math.max(1, Math.min(5, Number(p.stars) || 0));
        const rk = String(p.rater);
        if (rk.slice(-(t.id.length + 1)) === '@' + t.id) break;   // 不能给自己组打星
        STATE.ratings = STATE.ratings || {};
        STATE.ratings[t.id] = STATE.ratings[t.id] || {};
        if (STATE.ratings[t.id][rk]) break;                       // 只能一次
        STATE.ratings[t.id][rk] = stars;
        t.score += stars * 2;
        break;
      }

      default: break;
    }
  }

  /* ---------- 派生 ---------- */
  function myTeam() { return me.teamId ? STATE?.teams.find(t => t.id === me.teamId) : null; }
  /* 教师（demo）功能全开，但不进排行、不计进度、不参与互评 */
  function realTeams() { return (STATE.teams || []).filter(t => !t.demo); }
  function sortedTeams() { return realTeams().sort((a, b) => b.score - a.score); }
  function qForSlide(sl) { return QUESTIONS.filter(q => q.slide === sl); }
  function myAnswer(t, qid) { return (t && t.answeredBy && t.answeredBy[me.name] && t.answeredBy[me.name][qid]) || null; }
  function myClaimedRole(team) {
    const byMember = (team && team.memberRoles) || {};
    if (byMember[me.name]) return byMember[me.name];
    const rc = (team && team.roleClaims) || {};
    return Object.keys(rc).find(r => rc[r] === me.name) || null;
  }
  function isDemoTeam(t) { return !!(t && t.demo); }
  function myPick(t) { return (t && t.picks && t.picks[me.name]) || null; }
  function claimedMembers(t) { return Object.keys((t && t.memberRoles) || {}); }
  /* 全组是否都做完：已认领岗位的每个人都完成 */
  function teamPickDone(t) { const ms = claimedMembers(t); return ms.length > 0 && ms.every(m => t.picks && t.picks[m] && t.picks[m].correct); }
  function teamMembersDone(t, pred) { return claimedMembers(t).filter(m => pred(m)).length; }
  const noRoleBanner = () => '<div class="banner">你还没有认领岗位。请老师翻回<b>「认领岗位」</b>那页，先选一个岗位。</div>';
  /* 会话号：老师 Ctrl+Alt+R 清空全班后服务端会换一个会话号，学生机据此自动登出，避免下一个班顶着上一班同学的名字 */
  function checkSession() {
    if (MODE !== 'student' || !me.teamId || !STATE) return false;
    const teamGone = !STATE.teams.some(t => t.id === me.teamId);
    const sessionChanged = !!(me.session && STATE.session && me.session !== STATE.session);
    if (teamGone || sessionChanged) {
      try { localStorage.removeItem('cls_me'); } catch {}
      location.reload();
      return true;
    }
    if (!me.session && STATE.session) { me.session = STATE.session; saveMe(); }   // 老版本登录的、或登录时还没拿到会话号
    return false;
  }
  /* 打分人标识：同一个人在同一组只算一次 */
  function raterKey() { return (me.name || '') + '@' + (me.teamId || ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function fmt(sec) { const m = Math.floor(sec / 60), x = sec % 60; return m + ':' + String(x).padStart(2, '0'); }
  function toast(msg) { let t = $('.toast'); if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2200); }
  function rankHTML() { return sortedTeams().map((t, i) => `<li class="${i < 3 ? 'top' : ''}"><span class="pos">${i + 1}</span><span class="swatch" style="background:${t.color}"></span><span class="nm">${esc(t.name)}</span><span class="sc">${t.score}</span></li>`).join(''); }
  function badgesHTML(t) { return (t?.badges || []).map(b => `<span class="badge">${esc(b)}</span>`).join('') || '<span class="hint">完成一步会得徽章</span>'; }

  /* ---------- 事件委托（答题 / 多选 / 星级） ---------- */
  function installDelegated() {
    if (dlgInstalled) return; dlgInstalled = true;
    document.addEventListener('click', (e) => {
      if (MODE !== 'student') return;
      const op = e.target.closest('[data-open]');
      if (op) { openPlatform(op.dataset.open, op.dataset.q); return; }
      const ms = e.target.closest('[data-msubmit]');
      if (ms) { const qid = ms.dataset.msubmit; submitQuizInstant(qid, (sel[qid] || []).map(Number), ms); delete sel[qid]; return; }
      const opt = e.target.closest('[data-opt]');
      if (opt) {
        const [qid, idx] = opt.dataset.opt.split(':');
        const q = QUESTIONS.find(x => x.id === qid); if (!q) return;
        const t = myTeam(); if (!t || myAnswer(t, qid)) return;
        if (q.type === 'multi') { sel[qid] = sel[qid] || []; const pos = sel[qid].indexOf(idx); if (pos >= 0) { sel[qid].splice(pos, 1); opt.classList.remove('chosen'); } else { sel[qid].push(idx); opt.classList.add('chosen'); } ensureSubmit(qid); }
        else { submitQuizInstant(qid, Number(idx), opt); }
        return;
      }
      const star = e.target.closest('.star');
      if (star) {
        const box = star.closest('[data-ratefor]');
        if (!box) return;
        const tid = box.dataset.ratefor;                        // 被评的那一组
        const rk = raterKey();
        if (me.teamId && tid === me.teamId) { toast('不能给自己组打星'); return; }
        if (STATE.ratings && STATE.ratings[tid] && STATE.ratings[tid][rk]) { toast('这组你已经打过分了'); return; }
        if (star.disabled) return;
        box.querySelectorAll('.star').forEach(x => { x.classList.remove('primary'); x.disabled = true; });
        star.classList.add('primary');
        const m = box.querySelector('.starmsg');
        if (m) m.textContent = '你给这组 ' + star.dataset.n + ' 星（+' + (star.dataset.n * 2) + ' 分），只能打一次';
        Net.send('rateTeam', { teamId: tid, stars: Number(star.dataset.n), rater: rk });
        return;
      }
    });
    // 打字结束、鼠标移开后，把挂起的面板刷新补上
    document.addEventListener('focusout', () => {
      if (MODE !== 'student' || !me.teamId) return;
      setTimeout(() => {
        const t = myTeam(); if (!t || inputBusy()) return;
        const psig = panelSig(t);
        if (psig !== lastPanelSig) { lastPanelSig = psig; rerenderPanel(); }
      }, 0);
    });
  }
  function ensureSubmit(qid) {
    const o = document.querySelector(`[data-opt="${qid}:0"]`); const card = o ? o.closest('.card') : null; if (!card) return;
    let row = card.querySelector('.msubmitrow'); if (!row) { row = document.createElement('div'); row.className = 'msubmitrow mt8'; card.appendChild(row); }
    row.innerHTML = `<button class="primary" data-msubmit="${qid}">✅ 提交我的选择</button>`;
  }
  /* 提交选择题 → 服务端判分 → 即时对错反馈 + 答对时“+n分”飞向我的小组总分 */
  let quizBusy = false;
  async function submitQuizInstant(qid, chosen, fromEl) {
    if (quizBusy) return; quizBusy = true;
    // 先给点击的选项一个“提交中”的观感（禁用同题所有选项，避免连点）
    $$(`[data-opt^="${qid}:"]`).forEach(el => el.classList.add('locking'));
    if (netMode !== 'server') { Net.send('submitQuiz', { teamId: me.teamId, member: me.name, qid, chosen }); quizBusy = false; return; }
    try {
      const r = await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submitQuiz', payload: { teamId: me.teamId, member: me.name, qid, chosen } }) });
      const d = await r.json().catch(() => ({}));
      const res = (d && d.result) || {};
      if (res.already) { toast('这道题你已经答过了'); return; }
      if (res.correct) {
        toast('🎉 答对了！+' + (res.awarded || 2) + ' 分');
        flyPoints(fromEl, res.awarded || 2);
      } else {
        toast('❌ 答错了，等老师讲讲哪里不对');
        if (fromEl) { fromEl.classList.add('shake'); setTimeout(() => fromEl.classList.remove('shake'), 500); }
      }
    } catch { toast('提交失败，请重试'); }
    finally { quizBusy = false; }
    // 对错的最终样式由服务端广播回来后重绘 quizHTML 决定（✔ 正确 / ✘ 待讲解）
  }
  /* “+n 分”从选项飞到右侧“我的小组”总分，落点处总分跳一下 */
  function flyPoints(fromEl, points) {
    const target = $('#myscore');
    if (!fromEl || !target) return;
    const a = fromEl.getBoundingClientRect(), b = target.getBoundingClientRect();
    const fly = document.createElement('div');
    fly.className = 'flyscore';
    fly.textContent = '+' + points + '分';
    fly.style.left = (a.left + a.width / 2) + 'px';
    fly.style.top = (a.top + a.height / 2) + 'px';
    document.body.appendChild(fly);
    const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
    const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
    requestAnimationFrame(() => { fly.style.transform = `translate(${dx}px, ${dy}px) scale(.55)`; fly.style.opacity = '0'; });
    setTimeout(() => {
      fly.remove();
      target.classList.remove('bump'); void target.offsetWidth; target.classList.add('bump');
      setTimeout(() => target.classList.remove('bump'), 500);
    }, 780);
  }

  /* =========================================================
     学生端
     ========================================================= */
  function renderStudent() {
    if (!me.teamId) { renderLogin(); return; }
    const t = myTeam(); const sl = Math.min(STATE.slide, SLIDES.length - 1);
    document.title = '学生端 · 第' + (studentSlide(sl) + 1) + '页';
    app.innerHTML = `
      <div class="topbar">
        <div class="brandlogo"><div class="logo">${esc(META.brandEmoji || '📘')}</div><div>${esc(META.brand || '课堂')}</div></div>
        <div class="spacer"></div>
        <div class="pill gold">⭐ ${esc(t ? t.name : '')} · ${esc(me.name || '')}${myClaimedRole(t) ? ' · ' + esc(myClaimedRole(t)) : ''}</div>
        <div class="conn" id="conn"><span class="dot"></span><span id="conntxt">连接中</span></div>
      </div>
      <div class="layout${wideLayout(sl) ? ' wide' : ''}">
        <section class="main" id="panel">${buildPanel(sl, t)}</section>
        <aside class="right">
          <div class="card"><h3 style="margin:0">🏅 我的小组</h3>
            <div class="mt8"><span style="font-size:28px;font-weight:900;color:var(--accent)" id="myscore">${t ? t.score : 0}</span> <small>分</small></div>
            <div class="badges mt8">${badgesHTML(t)}</div>
            <div class="hint mt8">成员：${esc((t?.members || []).join('、') || '—')}</div>
          </div>
          <div class="card mt8"><h3 style="margin:0 0 10px">🏆 实时排行</h3><ol class="rank">${rankHTML()}</ol></div>
        </aside>
      </div>
      <div class="selfbar">
        <button class="selfbtn" id="selfaward">⭐ 给自己加分 <b>+5</b></button>
        <div class="selfhint">回答问题后才可以给自己加分哦。</div>
      </div>`;
    afterState();
  }

  function buildPanel(sl, t) {
    // 映射放在这里，四个调用点（首次渲染 / 重绘 / 翻页过渡两条路）就都覆盖到了
    const s = SLIDES[studentSlide(sl)];
    const quiz = (s.quiz && s.quiz.length) ? `<div id="quiz-q" class="mt">${quizHTML(s.quiz.map(id => QUESTIONS.find(q => q.id === id)).filter(Boolean), t)}</div>` : '';
    // 纯文字页（没有任务、也没有题）：学生这时是在听老师讲，把字放大、居中占满，别留一片空白
    if (!s.act && !(s.quiz && s.quiz.length)) {
      return `<div class="card bigcard">
        <span class="pill gray bigtag">${esc(s.tag)} · 建议 ${s.min}′</span>
        <h2 class="bigtitle">${s.title}</h2>
        ${s.sub ? `<div class="bigsub">${s.sub}</div>` : ''}
        <div class="bighint">${s.students}</div>
      </div>`;
    }
    return `<div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <h2 class="panel-title" style="margin:0">${s.title}</h2>
        <span class="pill gray">${esc(s.tag)} · 建议 ${s.min}′</span>
      </div>
      <p class="panel-sub mt8">${s.students}</p>
      ${s.sub ? `<div class="pageSub">${s.sub}</div>` : ''}
      <div class="divider"></div>
      ${actHTML(s.act, t)}
    </div>${quiz}`;
  }

  function actHTML(act, t) {
    switch (act) {
      case 'claim': {
        const claims = t?.roleClaims || {};
        const mine = myClaimedRole(t);
        const demo = isDemoTeam(t);
        const btns = ROLES.map(r => {
          const owner = claims[r];
          const isMine = demo ? (mine === r) : (!!owner && owner === me.name);
          // 教师：谁都能选、还能随时改选；普通组一岗一人，占了就置灰
          const dis = demo ? '' : (((mine || owner) && !isMine) ? 'disabled' : '');
          const tail = demo ? '' : (owner ? ' · ' + esc(owner) : '');
          return `<button class="mini ${isMine ? 'primary' : 'ghost'}" data-role="${r}" ${dis}>${r}${tail}</button>`;
        }).join('');
        return `<div class="pill brand" style="font-size:14px">🚩 出发地：${esc(STATE.origin || '—')}　🎯 目的地：${esc(t?.dest || '—')}</div>
          <div class="divider"></div>
          <label>认领你的岗位（点一下即可）</label>
          <div class="btnrow" id="rolepick">${btns}</div>
          ${mine
            ? `<div class="pk-fb ok mt8">✔ 你${demo ? '当前选的是' : '已经认领了'}「<b>${esc(mine)}</b>」${demo ? '，随时可以换一个再体验' : '，后面的任务都按这个岗位来'}。</div>`
            : (demo
              ? `<div class="hint mt8">这里是<b>教师</b>：${ROLES.length} 个岗位随便选，多位老师可以选同一个，选完还能换。</div>`
              : `<div class="hint mt8">${ROLES.length} 个岗位并行做事，各管一方面的子问题。<b>认领后不能更改</b>，想好再点。</div>`)}
          ${mine ? `<div class="divider"></div>
          <h3 class="panel-title" style="margin:0 0 8px">🗂️ 接着做：找出你岗位的子任务</h3>
          ${pickHTML(t)}` : ''}`;
      }
      case 'mindmap': return mmHTML(t);
      case 'pick': return pickHTML(t);
      case 'platform': return platformHTML(t);
      case 'useAgent': return useAgentHTML(t);
      case 'itinerary': return cardHTML(t);
      case 'report': {
        const rk = raterKey();
        const others = realTeams().length - 1;
        return `<div class="hint">${realTeams().length} 组的行程卡都在下面，逐个看一遍：<b>给除你们组以外的 ${others} 个组各打一次星</b>（点几颗就是几星，一颗 2 分；<b>打过就不能再改，自己组也不能给自己打</b>）。</div>
        <div class="mt8">${realTeams().map(x => {
          const self = !!(t && x.id === t.id);
          if (self) {
            return `
          <div class="ratebox self mt8" data-ratefor="${x.id}">
            <div class="rb-name">${esc(x.name)} <span class="rb-self">我们组</span></div>
            ${cardDisplayHTML(x)}
            <div class="hint starmsg mt8">⭐ 这是<b>你们组自己</b>的行程卡：<b>不能给自己组打星</b>，去给上面/下面其他组打分吧。</div>
          </div>`;
          }
          const my = (STATE.ratings && STATE.ratings[x.id] && STATE.ratings[x.id][rk]) || 0;
          const hint = my ? ('你给这组打的是 ' + my + ' 星（只能打一次）') : ('点星级给「' + esc(x.name) + '」打分');
          return `
          <div class="ratebox mt8" data-ratefor="${x.id}">
            <div class="rb-name">${esc(x.name)}</div>
            ${cardDisplayHTML(x)}
            <div class="btnrow mt8">${[1, 2, 3, 4, 5].map(n => `<button class="${n === my ? 'primary' : 'ghost'} star" data-n="${n}" ${my ? 'disabled' : ''}>${'⭐'.repeat(n)}</button>`).join('')}</div>
            <div class="hint starmsg mt8">${hint}</div>
          </div>`;
        }).join('')}</div>`;
      }
      case 'reflect': return `<div class="tree"><div class="treeroot">分解思维三步法</div><div class="treecats"><div class="treecat"><h4>① 定目标</h4><div>先想清楚要什么</div></div><div class="treecat"><h4>② 拆小问题</h4><div>把大难题切开</div></div><div class="treecat"><h4>③ 逐个解决</h4><div>小问题就好办了</div></div></div></div>
        <div class="mt8"><b>💬 想一想：</b>办六一活动、写一篇作文、整理书桌，也能用三步法吗？</div>
        <div class="hint mt8">想好了就举手说给大家听 —— 这一步我们口头交流，不用打字。</div>`;
      default: return '';
    }
  }

  /* ---------- 分解导图 + 即时评价（覆盖检查，可当场补） ---------- */
  /* ---------- 动手分解：主节点 + 四条线 + 四个空白框（拖动卡片） ---------- */
  function ensureMM(sl, t) {
    if (mm.slide === sl) return;
    const nodes = (t?.mindMap?.nodes) || [];
    const lv1 = nodes.filter(n => n && n.lv !== 2 && MM_KEYS.includes(n.cat)).map(n => n.cat);
    const compact = MM_KEYS.filter(k => lv1.includes(k));
    const subs = {};
    MM_KEYS.forEach(k => { subs[k] = MM_SUBS[k].map(() => null); });
    nodes.filter(n => n && n.lv === 2 && SUB_CAT[n.id]).forEach(n => {
      const cat = SUB_CAT[n.id];
      const i = MM_SUBS[cat].findIndex(x => x.id === n.id);
      if (i >= 0) subs[cat][i] = n.id;
    });
    mm = { slide: sl, slots: MM_KEYS.map((_, i) => compact[i] || null), subs };
  }
  function mmPlaced() { return mm.slots.filter(Boolean).length; }
  function mmSubPlaced() { return MM_KEYS.reduce((a, k) => a + (mm.subs[k] || []).filter(Boolean).length, 0); }
  /* 提交给服务端的节点：第一层 + 第二层 */
  function mmNodes() {
    const out = [];
    mm.slots.filter(Boolean).forEach(k => out.push({ cat: k, lv: 1, text: MM_CARDS[k] }));
    MM_KEYS.forEach(k => (mm.subs[k] || []).forEach(id => { if (id) out.push({ cat: k, lv: 2, id, text: SUB_TEXT[id] }); }));
    return out;
  }
  function mmHTML(t) {
    ensureMM(STATE.slide, t);
    const pool = MM_KEYS.filter(k => !mm.slots.includes(k));
    const placed = mmPlaced(), subPlaced = mmSubPlaced();
    const lv1Done = placed === MM_KEYS.length;
    // 第二层卡片：全部主分支放好后才出现（先拆大块，再拆小块）
    const subPool = [];
    MM_KEYS.forEach(k => MM_SUBS[k].forEach(x => { if (!(mm.subs[k] || []).includes(x.id)) subPool.push(x); }));

    const branches = mm.slots.map((k, i) => {
      const kids = k ? (mm.subs[k] || MM_SUBS[k].map(() => null)) : (MM_SUBS[MM_KEYS[0]] || []).map(() => null);
      return `
        <div class="mmbranch">
          <div class="mmdrop"></div>
          <div class="mmslot ${k ? 'filled' : ''}" data-mmslot="${i}">
            ${k ? `<span class="mmcard">${esc(MM_CARDS[k])}</span><span class="mmx" data-mmback="${i}">✕</span>` : '拖主分支到这里'}
          </div>
          <div class="mmsubs ${k ? '' : 'locked'}">
            ${kids.map((_, j) => {
              const id = kids[j];
              return `<div class="mmsubslot ${id ? 'filled' : ''}" ${k ? `data-mmsub="${esc(k)}|${j}"` : ''}>
                ${id ? `<span class="mmsubtext">${esc(SUB_TEXT[id])}</span><span class="mmx" data-mmsubback="${esc(k)}|${j}">✕</span>`
                     : (k ? '小任务' : '—')}
              </div>`;
            }).join('')}
          </div>
        </div>`;
    }).join('');

    const poolHTML = lv1Done
      ? `<div class="asmhint">👇 再把 <b>${MM_SUB_TOTAL} 个小任务</b> 拖到<b>它该去的那一方面</b>下面</div>
         <div class="asmpool horiz" id="mmpool2">${subPool.map(x => `<div class="asmcard sub" data-card="s:${x.id}">${esc(x.text)}</div>`).join('') || '<div class="empty">小任务也都放好啦 🎉</div>'}</div>`
      : `<div class="asmhint">👇 先把 <b>${MM_KEYS.length} 张主分支卡</b> 拖到上面的空框里</div>
         <div class="asmpool horiz" id="mmpool">${pool.map(k => `<div class="asmcard" data-card="${k}">${esc(MM_CARDS[k])}</div>`).join('')}</div>`;

    const tip = !lv1Done
      ? `还差主分支：${MM_KEYS.filter(k => !mm.slots.includes(k)).map(k => esc(MM_CARDS[k])).join('、')}`
      : (subPlaced < MM_SUB_TOTAL ? `小任务还差 <b>${MM_SUB_TOTAL - subPlaced}</b> 条` : '　✔ 两层都拆完了，非常棒！');

    return `<div class="mm">
        <div class="mmroot">${esc(META.mindMapRoot || '主题分解')}</div>
        <div class="mmstem"></div>
        <div class="mmrail"></div>
        <div class="mmrow">${branches}</div>
      </div>
      <div class="mt8">${poolHTML}</div>
      <div class="evalbox"><b>⚡ 即时评价：</b>主分支 <b>${placed}</b>/${MM_KEYS.length}　·　小任务 <b>${subPlaced}</b>/${MM_SUB_TOTAL}　${tip}</div>`;
  }

  /* ---------- 去平台核实 ----------
     上课用的是本机 platform.html（课前查好、不连外网）。
     下面这些只给"临时切回真站点"备查，全部来自 course.js 的 platform 段。 */
  const PLAT = COURSE.platform || {};
  const TRIP = Object.assign({ d: '', ci: '', co: '' }, META.tripDates || {});
  const CITY_INFO = PLAT.cityInfo || {};
  const SIGHT = PLAT.sight || {};
  function originCity() {
    // 'XX省XX市' → 'XX'；'XX市' → 'XX'；'XX省XX' → 'XX'
    let s = String(STATE.origin || '').trim();
    s = s.replace(/^[\u4e00-\u9fa5]{2,3}省/, '');        // 去掉省
    s = s.replace(/市\s*$/, '');                          // 去掉末尾"市"
    s = s.replace(/[（(].*$/, '').trim();                 // 去掉括号补充
    return s || META.defaultCity || '';
  }
  function teamCityName(t) { const c = TEAM_CITY[t && t.name]; return (c && c.city) || META.defaultCity || ''; }
  function teamPlace(t) {
    const d = (t && t.dest) || TEAM_DESTS[t && t.name] || '';
    const parts = String(d).split('·');
    let p = (parts[parts.length - 1] || d).trim();
    p = p.replace(/[（(].*?[）)]/g, '').trim();   // 去掉括号补充，搜索词更干净
    return p || teamCityName(t);
  }
  /* 课堂自己的查询页：数据课前查好存在本机，上课不连外网，
     不会弹登录、不会撞验证页，也不受机房网速影响。 */
  function platformUrl(role, t) {
    const kind = (ROLE_META[role] && ROLE_META[role].platformKind) || '';
    const p = new URLSearchParams({ role, team: (t && t.name) || '', city: teamCityName(t), kind });
    return '/platform.html?' + p.toString();
  }
  /* 旧的携程外链，留着备查（万一想临时切回真站点） */
  function ctripUrl(role, t) {
    const enc = encodeURIComponent;
    const from = originCity(), to = teamCityName(t), place = teamPlace(t);
    const info = CITY_INFO[to] || {};
    // 岗位 → 查询类型（course.js 的 roles[].platformKind）；认不出就退回通用搜索
    const kind = (ROLE_META[role] && ROLE_META[role].platformKind) || '';
    if (kind === 'train') {
      return 'https://trains.ctrip.com/webapp/train/list?ticketType=0&dStation=' + enc(from) +
        '&aStation=' + enc(to) + '&dDate=' + TRIP.d + '&rDate=&trainsType=&hubCityName=&highSpeedOnly=0';
    }
    if (kind === 'sight') {
      const sp = SIGHT[t && t.name];
      return sp
        ? 'https://you.ctrip.com/sight/' + sp            // 具体景点页（接口返回的真实地址）
        : 'https://you.ctrip.com/globalsearch/?keyword=' + enc(place);
    }
    if (kind === 'hotel') {
      return info.hotel
        ? 'https://hotels.ctrip.com/hotels/list?countryId=1&city=' + info.hotel + '&provinceId=0&checkin=' + TRIP.ci +
          '&checkout=' + TRIP.co + '&optionId=' + info.hotel + '&optionType=City&directSearch=0&display=' + enc(to + ', ' + (META.region || '') + ', 中国') +
          '&crn=1&adult=1&children=0&searchBoxArg=t&travelPurpose=0&ctm_ref=ix_sb_dl&domestic=1'
        : 'https://you.ctrip.com/globalsearch/?keyword=' + enc(to + '酒店');
    }
    if (kind === 'rest') {
      return info.rest
        ? 'https://you.ctrip.com/restaurant/' + info.pinyin + info.rest + '.html'
        : 'https://you.ctrip.com/globalsearch/?keyword=' + enc(to + '特色美食');
    }
    return 'https://you.ctrip.com/globalsearch/?keyword=' + enc(to);
  }
  function platformHTML(t) {
    const mine = myClaimedRole(t);
    if (!mine) return noRoleBanner();
    return `<div class="hint">🚩 出发地 <b>${esc(originCity())}</b> → 🎯 目的地 <b>${esc(teamCityName(t))}</b>${META.tripLabel ? `　·　📅 <b>${esc(META.tripLabel)}</b>` : ''}</div>
      <button class="ctripbtn" id="openctrip" type="button">
        <span class="ctriplogo">🔎</span>
        打开出行查询 · 查${esc(ROLE_WORD[mine] || '信息')}
      </button>
      <div class="hint mt8">查到什么就<b>直接填到下面的行程卡</b>里；查询窗口随时能再点开，不会丢。</div>
      <div class="divider"></div>
      <h3 class="panel-title" style="margin:0 0 8px">🗺️ 接着填：小组行程卡</h3>
      ${cardHTML(t)}`;
  }
  /* 携程查询窗：挂在 body 上而不是面板里 —— 面板会因为同组同学改卡而重绘，
     挂在里面的话 iframe 每次重绘都会重新加载，学生查到一半就被打回首页。 */
  let ctripFrameRole = '';
  function ctripBox() {
    let box = document.getElementById('ctripwrap');
    if (!box) {
      box = document.createElement('div');
      box.id = 'ctripwrap'; box.className = 'ctripwrap';
      box.innerHTML = `<div class="cw-bar">
          <span class="cw-title">🔎 出行查询</span>
          <button class="cw-btn" id="cwback" type="button">↺ 重新搜索</button>
          <span class="cw-spacer"></span>
          <button class="cw-btn cw-close" id="cwclose" type="button">✕ 收起，回到行程卡</button>
        </div>
        <div class="cw-mask" id="cwmask"><div class="cw-msg" id="cwmsg">正在打开查询页…</div>
          <div class="cw-acts" id="cwacts"></div></div>
        <iframe id="cwframe" referrerpolicy="no-referrer"></iframe>`;
      document.body.appendChild(box);
      box.querySelector('#cwclose').addEventListener('click', () => {
        box.classList.remove('on');
        document.documentElement.classList.remove('cw-open');
      });
      box.querySelector('#cwback').addEventListener('click', () => {
        const f = box.querySelector('#cwframe'); const u = f.getAttribute('data-url');
        if (u) loadCtrip(box, f, u);
      });
    }
    return box;
  }
  /* 加载查询页：网慢或出错时别停在一片空白，明确告诉学生并给个重试。 */
  function loadCtrip(box, f, url) {
    const mask = box.querySelector('#cwmask');
    const msg = box.querySelector('#cwmsg');
    const acts = box.querySelector('#cwacts');
    const show = (text, retry) => {
      if (!mask) return;
      mask.style.display = 'grid';
      if (msg) msg.textContent = text;
      if (acts) acts.innerHTML = retry ? '<button class="cw-btn cw-close" id="cwretry">↻ 再试一次</button>' : '';
      const rb = box.querySelector('#cwretry');
      if (rb) rb.addEventListener('click', () => loadCtrip(box, f, url));
    };
    let done = false;
    const ok = () => { if (done) return; done = true; if (mask) mask.style.display = 'none'; };
    show('正在打开查询页…', false);
    f.onload = ok;
    f.onerror = () => { done = true; show('查询页没打开。可能是网络不通，点下面再试一次。', true); };
    setTimeout(() => { if (!done) show('查询页加载得有点慢，点下面再试一次。', true); }, 8000);
    f.setAttribute('data-url', url);
    f.setAttribute('src', url);
  }
  function openCtrip(t) {
    const role = myClaimedRole(t); if (!role) return;
    const box = ctripBox();
    const f = box.querySelector('#cwframe');
    // 岗位没变就保留上次查到哪儿，只有第一次（或换了岗位）才加载
    if (ctripFrameRole !== role) {
      loadCtrip(box, f, platformUrl(role, t));
      ctripFrameRole = role;
    }
    box.classList.add('on');
    // 锁住背后的滚动：既让查询窗真正铺满（不留滚动条那一条），也免得在 iframe 里滑动时背景跟着跑
    document.documentElement.classList.add('cw-open');
  }
  function openPlatform(kind, q) {
    if (kind === 'url' && q) window.open(q, '_blank', 'noopener,noreferrer');
  }
  /* ---------- 找出你岗位的子问题（所有岗位混在一起，挑出自己的） ---------- */
  function pickExpected(role) { return SUBPOOL.filter(x => x.role === role).map(x => x.id); }
  function ensurePick(t) {
    const role = myClaimedRole(t);
    if (pick.role !== role) {
      const mp = myPick(t);
      const saved = (mp && mp.role === role) ? (mp.picked || []) : [];
      pick = { role, ids: saved.slice() };
    }
  }
  function pickHTML(t) {
    if (!myClaimedRole(t)) return noRoleBanner();
    ensurePick(t);
    const role = pick.role;
    const exp = pickExpected(role);
    const mp = myPick(t);
    const fb = (mp && mp.role === role) ? mp : null;
    const rows = SUBPOOL.map(x => {
      const sel = pick.ids.includes(x.id);
      let cls = sel ? 'on' : '';
      if (fb) {
        const isExp = exp.includes(x.id);
        cls = (isExp && sel) ? 'ok' : (isExp && !sel) ? 'miss' : (!isExp && sel) ? 'extra' : 'dim';
      }
      return `<div class="pickitem ${cls}" data-pick="${x.id}"><span class="pk-box">${fb ? (cls === 'ok' ? '✔' : cls === 'miss' ? '!' : cls === 'extra' ? '✕' : '') : (sel ? '✔' : '')}</span><span class="pk-text">${esc(x.text)}</span></div>`;
    }).join('');
    const miss = fb ? exp.filter(id => !pick.ids.includes(id)) : [];
    const extra = fb ? pick.ids.filter(id => !exp.includes(id)) : [];
    const okBox = fb
      ? (fb.correct
        ? '<div class="pk-fb ok">✔ 全对！这些就是你岗位要负责的子问题。</div>'
        : `<div class="pk-fb no">还有些出入，改一改再提交：${miss.length ? `<br>· 漏选了 ${miss.length} 条（带 <b>!</b> 的）` : ''}${extra.length ? `<br>· 多选了 ${extra.length} 条（带 <b>✕</b> 的）` : ''}</div>`)
      : '';
    return `<div class="hint">你的岗位：<b style="color:var(--brand-dark)">${esc(role)}</b>　——下面这些子问题属于<b>不同岗位</b>，请挑出属于你的那 <b>${exp.length}</b> 条。</div>
      <div class="pickgrid mt8">${rows}</div>
      <div class="mt8 btnrow">
        <button class="primary" id="picksubmit">${fb ? '🔄 改好了，重新提交' : '✅ 提交我的选择'}</button>
        <span class="pill gray">已选 <b id="pickcount">${pick.ids.length}</b> 条</span>
      </div>
      ${okBox}`;
  }
  function wirePick() {
    const items = $$('#panel .pickitem'); if (!items.length) return;
    items.forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.pick; const i = pick.ids.indexOf(id);
      if (i >= 0) { pick.ids.splice(i, 1); el.classList.remove('on'); el.querySelector('.pk-box').textContent = ''; }
      else { pick.ids.push(id); el.classList.add('on'); el.querySelector('.pk-box').textContent = '✔'; }
      const c = $('#pickcount'); if (c) c.textContent = pick.ids.length;
    }));
    const sub = $('#picksubmit'); if (sub) sub.addEventListener('click', async () => {
      if (sub.disabled) return; sub.disabled = true;
      const d = await Net.send('submitPick', { teamId: me.teamId, member: me.name, role: pick.role, picked: pick.ids });
      const res = (d && d.result) || {};
      if (res.correct) { toast(res.awarded ? '🎉 全对！+' + res.awarded + ' 分' : '✔ 已经全对啦'); if (res.awarded) flyPoints(sub, res.awarded); }
      else { toast('还有出入，看看带 ! 和 ✕ 的，改一改再交'); sub.classList.add('shake'); setTimeout(() => sub.classList.remove('shake'), 500); }
      rerenderPanel();
    });
  }
  /* 指针拖拽（鼠标 / 触屏通用）：slotSel 决定放到哪里算数，onDrop 决定怎么处理 */
  function attachDrag(el, slotSel, onDrop) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const ghost = el.cloneNode(true);
      ghost.classList.add('ghost'); ghost.style.width = r.width + 'px'; ghost.style.left = r.left + 'px'; ghost.style.top = r.top + 'px';
      document.body.appendChild(ghost);
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      el.classList.add('dragging');
      const pid = e.pointerId;
      const move = (ev) => { if (ev.pointerId !== pid) return; ghost.style.left = (ev.clientX - dx) + 'px'; ghost.style.top = (ev.clientY - dy) + 'px'; };
      const cleanup = () => {
        document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); document.removeEventListener('pointercancel', cancel);
        ghost.remove(); el.classList.remove('dragging');
      };
      const up = (ev) => {
        if (ev.pointerId !== pid) return;
        cleanup();
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        onDrop(under && under.closest(slotSel), el.dataset.card);
      };
      // 平板上系统手势（滚动、切应用）打断拖拽时，把幽灵卡片和监听器都收掉
      const cancel = (ev) => { if (ev.pointerId !== pid) return; cleanup(); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); document.addEventListener('pointercancel', cancel);
    });
  }
  function wireMM() {
    // 全部 12 块都放好 → 提交并计分
    const finishIfDone = async (fromEl) => {
      if (!(mmPlaced() === MM_KEYS.length && mmSubPlaced() === 8)) return false;
      const d = await Net.send('setMindMap', { teamId: me.teamId, nodes: mmNodes(), submitted: true });
      const awarded = (d && d.result && d.result.awarded) || 0;
      toast(awarded ? '🎉 两层都拆完了！+' + awarded + ' 分，获得【拆解大师】🏅' : '✔ 两层都拆完了，获得【拆解大师】🏅');
      if (awarded) flyPoints(fromEl, awarded);
      return true;
    };

    // 第一层：主分支卡 → 上面四个空框（四个框等价，放哪个都行）
    $$('#mmpool .asmcard').forEach(el => attachDrag(el, '[data-mmslot]', async (slot, key) => {
      if (!slot) return;
      const idx = Number(slot.dataset.mmslot);
      if (mm.slots[idx]) { toast('这个框里已经有卡片了'); return; }
      mm.slots[idx] = key;
      toast('✔ 放好了！');
      await finishIfDone(slot);
      rerenderPanel();
    }));

    // 第二层：小任务卡 → 必须放到它所属的那个主分支下面
    $$('#mmpool2 .asmcard').forEach(el => attachDrag(el, '[data-mmsub]', async (slot, key) => {
      if (!slot) return;
      const id = String(key || '').replace(/^s:/, '');
      const [cat, jStr] = String(slot.dataset.mmsub).split('|');
      const j = Number(jStr);
      if (SUB_CAT[id] !== cat) { toast('这条不属于「' + cat + '」，再想想它该跟着谁～'); return; }
      const arr = mm.subs[cat] || (mm.subs[cat] = MM_SUBS[cat].map(() => null));
      if (arr[j]) { toast('这个小框里已经有了'); return; }
      arr[j] = id;
      toast('✔ 放对了！');
      await finishIfDone(slot);
      rerenderPanel();
    }));

    // 取回：主分支拿走时，它下面的小任务一起回到卡片区
    $$('#panel [data-mmback]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.mmback);
      const cat = mm.slots[i];
      if (cat && mm.subs[cat]) mm.subs[cat] = MM_SUBS[cat].map(() => null);
      mm.slots[i] = null;
      rerenderPanel();
    }));
    $$('#panel [data-mmsubback]').forEach(b => b.addEventListener('click', () => {
      const [cat, jStr] = String(b.dataset.mmsubback).split('|');
      if (mm.subs[cat]) mm.subs[cat][Number(jStr)] = null;
      rerenderPanel();
    }));
  }
  function rerenderPanel() { const p = $('#panel'); if (p) { p.innerHTML = buildPanel(STATE.slide, myTeam()); wireStudent(); lastPanelSig = panelSig(myTeam()); } }
  /* 面板签名：队伍数据一变就重绘（换页之外，也覆盖认领/选题/提交等） */
  function panelSig(t) {
    if (!t) return '';
    // 注意：不把对话记录算进签名——第 10 页的聊天气泡是直接写进 DOM 的，同组别人提问不该把我的面板重绘掉
    return JSON.stringify([
      t.roleClaims || {}, myPick(t),
      (t.mindMap && t.mindMap.nodes || []).length, !!(t.mindMap && t.mindMap.submitted),
      t.card || {}, t.score,
    ]);
  }
  /* 正在输入时不要重绘，免得把学生打的字冲掉 */
  function inputBusy() {
    if (cardPending) return true;   // 行程卡有还没发出去的文字：这时重绘会把刚打的字冲掉
    const a = document.activeElement;
    if (!a || !a.closest || !a.closest('#panel')) return false;
    return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable === true;
  }
  let cardPending = false;

  /* ---------- 让助手给草稿 ---------- */
  function useAgentHTML(t) {
    // 助手是老师直接配好的：认领了哪个岗位，就用哪一套设定
    const role = myClaimedRole(t);
    const dest = (t?.dest || '').trim();
    return `<div class="hint">你的助手：${role ? esc(role) + '助手' : '（还没认领岗位，请老师翻回「认领岗位」那页）'}
      ｜ 出发地：<b style="color:var(--brand-dark)">${esc(STATE.origin || '—')}</b>
      ｜ 本组目的地：<b style="color:var(--brand-dark)">${dest ? esc(dest) : '—'}</b></div>
      ${dest ? `<div class="hint mt8">助手已经知道你们要<b>从${esc(STATE.origin || '出发地')}去 ${esc(dest)}</b>，它的回答都会围绕这条线。</div>` : ''}
      <label class="mt8">问你的助手（说说你这个岗位要解决什么）</label>
      <input class="input" id="a_qinput" placeholder="点此输入你的问题，然后向 AI 提问" />
      <div class="btnrow mt8"><button class="accent" id="agentask">💬 提问</button></div>
      <div class="chatbox mt8" id="chatbox">${chatHTML(t)}</div>`;
  }
  function chatHTML(t) {
    let h = '<div class="msg assistant"><span class="tag">助手</span>你好！把你的岗位任务告诉我，我先给你一版草稿——记得等下要去核实哦。</div>';
    (t?.agent || []).filter(x => x.member === me.name).forEach(x => {
      h += `<div class="msg user">${esc(x.q || '')}</div>`;
      h += `<div class="msg assistant"><span class="tag">助手 · ${x.p === 'api' ? '真实AI' : '示例(离线)'}</span>${esc(x.a || '').replace(/\n/g, '<br>')}</div>`;
    });
    return h;
  }
  function wireAgent() {
    const ask = $('#agentask'); if (!ask) return;
    ask.addEventListener('click', async () => {
      if (ask.disabled) return;   // 防连点：上一问还没回来
      const t = myTeam(); const role = myClaimedRole(t); const set = role && CARD_SETS[role];
      if (!set) { toast('先去认领岗位'); return; }
      const q = ($('#a_qinput')?.value || '').trim() || '请给我这一方面的行程建议';
      ask.disabled = true; ask.textContent = '⏳ 助手思考中…';
      const u = document.createElement('div'); u.className = 'msg user'; u.textContent = q;
      const a = document.createElement('div'); a.className = 'msg assistant'; a.textContent = '助手思考中…';
      const place = () => { const box = $('#chatbox'); if (box) { if (!box.contains(u)) box.appendChild(u); if (!box.contains(a)) box.appendChild(a); box.scrollTop = box.scrollHeight; } };
      place();
      try {
        const r = await fetch('/api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: set.role, objective: set.goal, knowledge: set.know, rules: set.rules, question: q, dest: t.dest || '', teamId: me.teamId }) });
        const d = await r.json();
        a.innerHTML = `<span class="tag">助手 · ${d.provider === 'api' ? '真实AI' : '示例(离线)'}</span>` + esc(d.answer).replace(/\n/g, '<br>');
        Net.send('logAgent', { teamId: me.teamId, member: me.name, role, q, a: d.answer, p: d.provider });
      } catch { a.textContent = '暂时连不上助手，请稍后再试。'; }
      place();   // 等待期间面板若被重绘过，把这两条气泡补回新的聊天框
      ask.disabled = false; ask.textContent = '💬 提问';
    });
  }

  /* 共享行程卡：格子文字实时同步给同组；图片走上传接口 */
  function wireCard() {
    // 文字格（只有自己那一行是可编辑的）：边打边同步（停 0.4 秒发一次）
    $$('#panel .celltext[contenteditable="true"]').forEach(el => {
      let timer = null;
      el.addEventListener('input', () => {
        cardPending = true;
        clearTimeout(timer);
        timer = setTimeout(async () => {
          const text = el.textContent.trim();
          cardPending = false;
          await Net.send('setCard', { teamId: me.teamId, member: me.name, key: el.dataset.cell, t: text });
        }, 400);
      });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
    });
    // 图片格：监听挂在 <td> 上（格子内部会被 syncCard 整块替换，挂在内部元素上会丢）
    $$('#panel [data-paste]:not(.ro)').forEach(wireImgCell);
  }
  function wireImgCell(td) {
    const key = td.dataset.paste;
    td.addEventListener('click', async (e) => {
      const x = e.target.closest('[data-imgx]');
      if (x) { e.stopPropagation(); Net.send('setCardImg', { teamId: me.teamId, member: me.name, key, img: '' }); toast('截图已删除'); return; }
      const b = e.target.closest('[data-pastebtn]');
      if (b) {
        // 粘贴按钮：优先直接读剪贴板；被浏览器拒绝（http 局域网地址下会这样）就帮学生选中格子、让 TA 按 Ctrl+V
        try {
          const items = await navigator.clipboard.read();
          for (const it of items) {
            const type = (it.types || []).find(t => t.indexOf('image') === 0);
            if (type) { const blob = await it.getType(type); uploadCardImage(key, blob); return; }
          }
          toast('剪贴板里没有图片 —— 先截图再点这里');
        } catch (err) {
          td.focus();
          toast('浏览器不让直接读剪贴板：已选中格子，请按 Ctrl+V 粘贴');
        }
        return;
      }
      td.focus();
    });
    // 截图到剪贴板后，点格子按 Ctrl+V 直接粘贴
    td.addEventListener('paste', (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      for (const it of items) {
        if (it.type && it.type.indexOf('image') === 0) {
          e.preventDefault();
          const f = it.getAsFile();
          if (f) { uploadCardImage(key, f); return; }
        }
      }
      toast('剪贴板里没有图片 —— 先截图（Win+Shift+S）再粘贴');
    });
  }
  /* 图片（截图/文件）→ 压缩 → 上传 → 写进格子 */
  async function uploadCardImage(key, blob) {
    toast('正在处理截图…');
    const dataUrl = await shrinkImage(blob);
    if (!dataUrl) { toast('这张图读不出来，换一张试试'); return; }
    try {
      const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl }) });
      const d = await r.json();
      if (d.url) { Net.send('setCardImg', { teamId: me.teamId, member: me.name, key, img: d.url }); toast('截图已粘上，同组同学都能看到'); }
      else toast('上传失败：' + (d.error || '未知原因'));
    } catch (e) { toast('上传失败，请重试'); }
  }
  /* 别人改的格子，实时写进来（正在输入的那格不动；图片格整块替换，事件挂在 td 上不会丢） */
  function syncCard(t) {
    if (!t || !t.card) return;
    $$('#panel [data-cell]').forEach(el => {
      const want = (t.card[el.dataset.cell] && t.card[el.dataset.cell].t) || '';
      if (document.activeElement === el) return;
      if (el.textContent !== want) el.textContent = want;
    });
    $$('#panel [data-paste]').forEach(td => {
      const key = td.dataset.paste;
      const want = (t.card[key] && t.card[key].img) || '';
      if ((td.dataset.img || '') === want) return;
      td.dataset.img = want;
      td.innerHTML = imgCellInner(key, { img: want }, !td.classList.contains('ro'));
    });
  }
  /* CARD_ROWS / CARD_ROLE 已在顶部由 course.js 生成 */
  const cardKey = (row) => row;
  function cellOf(t, row) { return (t && t.card && t.card[cardKey(row)]) || {}; }
  /* 我能不能改这一行：本行岗位的人可以；没人认领这行岗位时协调安排员可以补；全组谁都没认领时不限制（与服务端规则一致） */
  function canEditRow(t, key) {
    if (isDemoTeam(t)) return true;          // 教师：随便试
    const role = CARD_ROLE[key]; if (!role) return false;
    const claims = t?.roleClaims || {};
    if (!Object.keys(claims).length) return true;
    const owner = claims[role];
    return owner ? owner === me.name : true;   // 该岗位没人认领时，本组谁都能补这一行
  }
  function rowOwnerHTML(t, key) {
    const role = CARD_ROLE[key]; const owner = (t?.roleClaims || {})[role];
    if (owner === me.name) return `<small class="rowowner mine">${esc(role)} · 你负责</small>`;
    if (owner) return `<small class="rowowner">${esc(role)} · ${esc(owner)}</small>`;
    return `<small class="rowowner">${esc(role)} · 还没人认领</small>`;
  }
  function imgCellInner(key, c, editable) {
    if (c.img) return `<div class="cellimg"><img src="${esc(c.img)}" alt="" />${editable ? `<span class="imgx" data-imgx="${esc(key)}">✕</span>` : ''}</div>`;
    return editable
      ? `<div class="pastehint">点这里 按 Ctrl+V 粘贴截图</div><span class="imgadd" data-pastebtn="${esc(key)}">📋 粘贴截图</span>`
      : `<div class="pastehint">（由本行岗位的同学粘贴）</div>`;
  }
  function cardHTML(t) {
    const mineRole = myClaimedRole(t);
    return `<div class="hint">同组同学一起填这张卡，<b>每人只能改自己岗位那一行</b>，别人的改动会实时出现。</div>
      ${!mineRole ? '<div class="banner mt8">你还没认领岗位，只能看，不能填。</div>' : ''}
      <table class="cardtable mt8">
        <thead><tr><th class="rowhead">项目</th><th class="txtcol">内容</th><th class="imgcol">图片（粘贴截图）</th></tr></thead>
        <tbody>
          ${CARD_ROWS.map(row => {
            const key = cardKey(row);
            const c = cellOf(t, row);
            const ok = canEditRow(t, key);
            return `<tr class="${ok ? 'myrow' : 'rorow'}">
              <th class="rowhead">【${esc(row)}】<br>${rowOwnerHTML(t, key)}</th>
              <td>${ok
                ? `<div class="celltext" contenteditable="true" data-cell="${esc(key)}" data-ph="点这里填写">${esc(c.t || '')}</div>`
                : `<div class="celltext ro" data-cell="${esc(key)}" data-ph="等这一行的同学来填">${esc(c.t || '')}</div>`}</td>
              <td class="imgcell${ok ? '' : ' ro'}" ${ok ? 'tabindex="0"' : ''} data-paste="${esc(key)}" data-img="${esc(c.img || '')}">${imgCellInner(key, c, ok)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      <div class="hint mt8">填好后到下一页和全班分享。</div>`;
  }
  function cardText(t, row) { const c = cellOf(t, row); return (c.t || '').trim(); }
  function cardSummaryHTML(t) {
    return CARD_ROWS.map(r => {
      const a = cardText(t, r); const u = cellOf(t, r).img;
      return `<div style="margin:4px 0"><b>【${esc(r)}】</b> ${esc(a || '—')}
        ${u ? `<br><span class="cellimg sm"><img src="${esc(u)}" alt="" /></span>` : ''}</div>`;
    }).join('');
  }

  /* ---------- 展示用的漂亮行程卡（汇报页 / 大屏） ---------- */
  /* CARD_ICON 已在顶部由 course.js 生成 */
  function cardDisplayHTML(t) {
    const rows = CARD_ROWS.map(r => {
      const c = cellOf(t, r);
      const v = (c.t || '').trim();
      return `<div class="tc-row">
        <span class="tc-label">${CARD_ICON[r] || '•'} ${esc(r)}</span>
        <span class="tc-val${v ? '' : ' empty'}">${esc(v || '还没填')}</span>
        ${c.img ? `<a class="tc-thumb" href="${esc(c.img)}" target="_blank" rel="noopener noreferrer" title="点开看大图"><img src="${esc(c.img)}" alt="" loading="lazy" /></a>` : ''}
      </div>`;
    }).join('');
    return `<div class="tripcard" style="--tc:${esc(t.color || '#2ec4b6')}">
      <div class="tc-head">
        <span class="tc-dot"></span>
        <b class="tc-name">${esc(t.name)}</b>
        <span class="tc-dest">${esc(teamCityName(t))}</span>
        <span class="tc-score">${t.score} 分</span>
      </div>
      <div class="tc-rows">${rows}</div>
    </div>`;
  }
function shrinkImage(file) {
    return new Promise(res => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const maxW = 1100;
          const sc = Math.min(1, maxW / (img.width || maxW));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round((img.width || maxW) * sc));
          c.height = Math.max(1, Math.round((img.height || maxW) * sc));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          res(c.toDataURL('image/jpeg', 0.82));
        } catch { res(null); } finally { URL.revokeObjectURL(url); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); res(null); };
      img.src = url;
    });
  }
  /* （旧的纯文字摘要已被卡片式展示取代） */
  function quizHTML(qs, t) {
    return qs.map(q => {
      const ans = myAnswer(t, q.id); const done = !!ans;
      return `<div class="card" style="box-shadow:none;border:1.5px solid ${done ? (ans.correct ? 'var(--good)' : 'var(--bad)') : 'var(--line)'}">
        <div style="display:flex;justify-content:space-between;align-items:center"><b>${esc(q.title)}</b><span class="pill ${done ? (ans.correct ? 'brand' : 'gold') : 'gray'}">${done ? (ans.correct ? '✔ 正确 +' + q.points : '✘ 待讲解') : '答题 +' + q.points + '分'}</span></div>
        <div class="mt8">${q.options.map((o, i) => { const on = done && (q.type === 'multi' ? (ans.chosen || []).includes(i) : ans.chosen === i); const bg = done ? (on ? (ans.correct ? 'var(--good)' : 'var(--bad)') : '#e6eaf2') : '#e6eaf2'; return `<div class="mapnode ${on ? 'chosen' : ''}" style="cursor:pointer" data-opt="${q.id}:${i}"><div class="n" style="background:${bg};color:${on ? '#fff' : 'var(--muted)'}">${String.fromCharCode(65 + i)}</div><div class="t" style="font-size:14.5px">${esc(o)}</div></div>`; }).join('')}</div>
      </div>`;
    }).join('');
  }

  /* ---------- 学生端事件绑定 ---------- */
  function wireStudent() {
    // 岗位认领（认领后锁定其他岗位；用"重新认领"解锁）
    $$('#rolepick button').forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      const t = myTeam();
      if (!isDemoTeam(t) && myClaimedRole(t)) { toast('你已经认领过岗位了，不能更改'); return; }
      const r = b.dataset.role;
      Net.send('claimRole', { teamId: me.teamId, role: r, member: me.name }).then(() => { setTimeout(rerenderPanel, 250); pairDevice(); });
      toast('你认领了 ' + r);
    }));
    // 动手分解（思维导图拖拽）
    wireMM();
    // 找出你岗位的子问题
    wirePick();
    // 助手提问
    wireAgent();
    // 携程查询窗（嵌在页面里，收起后随时能再点开）
    const oc = $('#openctrip');
    if (oc) oc.addEventListener('click', () => openCtrip(myTeam()));
    // 共享行程卡：实时同步 + 加图
    wireCard();
    // 行程卡（旧表单）已移除
    // 行程卡（共享表格）已在上面处理完
    // 给自己加分（回答问题后用）
    const sa = $('#selfaward');
    if (sa) sa.addEventListener('click', async () => {
      if (sa.disabled) return;
      sa.disabled = true;                                  // 防触屏误触连点
      const d = await Net.send('selfAward', { teamId: me.teamId, member: me.name });
      const res = (d && d.result) || {};
      const pts = res.awarded || 5;
      toast('🎉 回答得好！+' + pts + ' 分');
      flyPoints(sa, pts);
      setTimeout(() => { sa.disabled = false; }, 1200);
    });
    // 反思
  }

  /* ---------- 登录 ---------- */
  function renderLogin() {
    document.title = '加入课堂';
    app.innerHTML = `<div class="login"><div class="card">
      <h2 class="panel-title" style="text-align:center">${esc(META.brandEmoji || '📘')} ${esc(META.brand || '课堂')} · 入职登记</h2>
      <p class="panel-sub" style="text-align:center">选一个小组，写下名字，开始今天的工作</p>
      <label>选择小组</label>
      <div class="teampick" id="teampick">${realTeams().map(t => `<div class="teamcard" data-team="${t.id}"><div class="swatch" style="background:${t.color}"></div><b>${esc(t.name)}</b></div>`).join('')}</div>
      ${(STATE.teams || []).filter(t => t.demo).map(t => `
        <div class="demopick">
          <div class="teamcard demo" data-team="${t.id}"><div class="swatch" style="background:${t.color}"></div><b>${esc(t.name)}</b></div>
          <div class="demotip">听课教师可以选择本组</div>
        </div>`).join('')}
      <div id="destbox" class="mt8"></div>
      <label class="mt8">你的名字</label><input class="input" id="username" maxlength="12" placeholder="例如：小明" />
      <div class="mt8"><button class="primary" style="width:100%" id="joinbtn">🚀 入职，开始规划</button></div>
    </div></div>`;
    let chosen = '';
    // 目的地与组名绑死：选中小组即显示，不需要任何人设置
    const drawDest = () => {
      const box = $('#destbox'); if (!box) return;
      if (!chosen) { box.innerHTML = '<div class="hint">先选小组，就会显示本组要去的地方</div>'; return; }
      const t2 = STATE.teams.find(x => x.id === chosen);
      box.innerHTML = `<div class="pill brand" style="font-size:13.5px">🚩 出发地：${esc(STATE.origin || '—')}　🎯 目的地：${esc((t2 && t2.dest) || TEAM_DESTS[t2 && t2.name] || '—')}</div>
        <div class="hint mt8">${META.tripLabel ? `📅 出行日期：${esc(META.tripLabel)}　·　` : ''}🕐 时长：${esc(META.duration || '—')}</div>`;
    };
    drawDest();
    // 注意：教师组的卡片在 #teampick 之外，所以要按 .teamcard 全选，不能只找 #teampick 里的
    $$('.login .teamcard').forEach(c => c.addEventListener('click', () => {
      $$('.login .teamcard').forEach(x => x.classList.remove('sel')); c.classList.add('sel'); chosen = c.dataset.team; drawDest();
    }));
    $('#joinbtn').addEventListener('click', () => {
      const n = $('#username').value.trim(); if (!n) { toast('先写名字'); return; }
      if (!chosen) { toast('先选小组'); return; }
      me = { teamId: chosen, name: n, session: STATE.session || '' }; saveMe();
      Net.send('joinTeam', { teamId: chosen, member: n });
      renderStudent();
      pairDevice();
    });
  }

  /* =========================================================
     大屏演示（PPT · 翻页即推进进度）
     ========================================================= */
  function renderPresent() {
    const i = Math.min(STATE.slide, SLIDES.length - 1);
    document.title = '演示 · 第' + (i + 1) + '页';
    app.className = 'ppt';
    // 大屏不显示顶栏：整屏都留给内容，翻页用方向键 / 翻页笔（PageUp·PageDown）
    app.innerHTML = `<div class="stage" id="slidestage">${slideHTML(i)}</div>`;
    wirePresent(); wireSlideVideo(i); afterState();
  }
  let keyBound = false;
  function wirePresent() {
    $('#prevbtn') && $('#prevbtn').addEventListener('click', () => setSlide(STATE.slide - 1));
    $('#nextbtn') && $('#nextbtn').addEventListener('click', () => setSlide(STATE.slide + 1));
    if (!keyBound) { keyBound = true; document.addEventListener('keydown', (e) => {
      if (MODE === 'student') return;
      if (e.ctrlKey && e.altKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); askResetAll(); return; }
      // 翻页笔有两种发键方式：左右箭头 / 上下箭头，两种都接（PageUp·PageDown 是第三种）
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        // manualVideo 的页：第一次按「下一页」不翻页，而是整页播演示；播完回到图文，再按才真翻页
        if (playManualVideo(STATE.slide)) return;
        setSlide(STATE.slide + 1);
      }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); setSlide(STATE.slide - 1); }
    }); }
  }
  function setSlide(n) { Net.send('setSlide', { slide: Math.max(0, Math.min(SLIDES.length - 1, n)) }); }

  /* 换班/重上一遍时清空全班数据（只在大屏页按 Ctrl+Alt+R，学生端无效） */
  function askResetAll() {
    const ok = window.confirm(
      '要重置课堂吗？（换班 / 重上一遍时用）\n\n' +
      '会清掉：各组分数、徽章、答题记录、认领的岗位、分解导图、\n' +
      '行程卡里的内容与截图、互评星级、加入课堂的成员名单。\n\n' +
      '不会动：组名、各组目的地、出发地、行程时长、上传的图片文件。\n' +
      '清空后大屏回到第 1 页。');
    if (!ok) return;
    Net.send('resetAll', {});
    toast('已清空全班数据');
  }

  /* 整页全屏视频的舞台标记（manualVideo 的页先显示图文，按一下「下一页」才换成这个） */
  function videoStageHTML(i) {
    const s = SLIDES[i];
    return `<div class="slidevideo" id="slidevideo">
        <video id="pptvideo" playsinline preload="auto" poster="/ppt-images/${esc(s.img)}"></video>
        <div class="sv-tap" id="svtap">🔊 点一下开声音</div>
        ${s.endText ? `<div class="sv-end">${s.endText}</div>` : ''}
        ${s.afterVideo === 'slide'
          ? `<div class="sv-skip" id="svskip">跳过讲解 ▶</div>`
          : `<div class="sv-replay" id="svreplay" title="点一下重播">↺ 重播</div>`}
      </div>`;
  }
  function slideHTML(i) {
    const s = SLIDES[i];
    // 整页全屏视频页：不显示标题与排行榜，视频铺满整个舞台
    // manualVideo 的页例外：翻到时先照常显示图文，老师再按一下「下一页」才播
    if (s.videos && s.videos.length && !s.manualVideo) return videoStageHTML(i);
    return slideBodyHTML(i);
  }
  /* 大屏一页的版式（图文页；视频页另走 slidevideo）。
     为「教室后排也要看得清」而设计：字号整体放大、组名带本组颜色、排行做成底部横条。 */
  function slideBodyHTML(i) {
    const s = SLIDES[i];
    const pd = pagedataHTML(i);
    return `<div class="sl ${pd ? '' : 'sl-hero'}">
        <div class="sl-top">
          <span class="sl-tag" id="resettag" title="点一下可以重置课堂（会先让你确认）">${esc(s.tag)}</span>
        </div>
        <div class="sl-body">
          <div class="sl-art"><img src="/ppt-images/${s.img}" alt="" data-slot="${esc(s.img)}" onerror="imgSlot(this)" /></div>
          <div class="sl-main">
            <div class="slide-title">${s.title}</div>
            ${s.sub ? `<div class="slide-sub">${s.sub}</div>` : ''}
            <div class="pagedata" id="pagedata">${pd}</div>
          </div>
        </div>
        <div class="sl-rank" id="livezone">${liveHTML(i)}</div>
      </div>`;
  }
  /* ---------- 整页全屏视频：按顺序连播，播完停在最后一帧 ---------- */
  let vseq = { token: 0 };
  /* 左上角环节标签 = 重置课堂入口（任意页都能点，点了会先确认） */
  function wireResetTag() {
    const el = $('#resettag');
    if (el && !el._wired) { el._wired = true; el.addEventListener('click', askResetAll); }
  }

  /* manualVideo 的页：按一下「下一页」就地换成整页视频。
     返回 true 表示"这一下用来播视频了，不要翻页"。 */
  let manualPlayed = -1;                              // 本次停留在这一页时已经播过了
  function playManualVideo(i) {
    const s = SLIDES[i];
    if (!s || !s.manualVideo || !(s.videos && s.videos.length)) return false;
    if (manualPlayed === i) return false;              // 播过了，这一下就正常翻页
    const st = $('#slidestage'); if (!st) return false;
    manualPlayed = i;
    st.innerHTML = videoStageHTML(i);
    wireSlideVideo(i, true);
    return true;
  }
  function wireSlideVideo(i, forcePlay) {
    wireResetTag();
    const my = ++vseq.token;                          // 一翻页就作废上一页的连播
    const s = SLIDES[i];
    const stage = $('#slidestage');
    // manualVideo 的页平时是图文版式，只有被 playManualVideo 触发时才进视频态
    const isVideo = !!(s && s.videos && s.videos.length && (!s.manualVideo || forcePlay));
    if (stage) stage.classList.toggle('videostage', isVideo);
    if (!isVideo) return;
    const v = $('#pptvideo'); const box = $('#slidevideo'); if (!v) return;
    const list = s.videos.slice();
    let idx = 0, failed = 0;

    /* 播第 idx 段。withSound=false 时静音播（浏览器拦了有声自动播放的兜底）。 */
    const play = (withSound) => {
      if (my !== vseq.token) return;
      v.muted = !withSound;
      if (v.getAttribute('src') !== list[idx]) { v.setAttribute('src', list[idx]); v.load(); }
      const pr = v.play();
      if (pr && pr.catch) pr.catch(() => {
        if (my !== vseq.token) return;
        if (withSound) { box && box.classList.add('needtap'); play(false); }   // 有声被拦 → 静音先播，提示点一下
      });
    };
    // 讲解类的页：播完自动切回图文版式，好让大屏继续显示本页实时进度
    const toStatic = () => {
      if (my !== vseq.token) return;
      const st = $('#slidestage'); if (st) { st.classList.remove('videostage'); st.innerHTML = slideHTMLStatic(i); wireResetTag(); }
    };
    v.addEventListener('ended', () => {
      if (my !== vseq.token) return;
      if (idx < list.length - 1) { idx++; play(!v.muted); return; }   // 多段时接着播下一段
      if (s.afterVideo === 'slide') { toStatic(); return; }
      box && box.classList.add('done');                               // 否则停在最后一帧
    });
    // 某段文件缺失/损坏：跳过；全都不能播就回落成静态图页
    v.addEventListener('error', () => {
      if (my !== vseq.token) return;
      failed++;
      if (idx < list.length - 1) { idx++; play(!v.muted); return; }
      if (failed >= list.length) { const st = $('#slidestage'); if (st) { st.classList.remove('videostage'); st.innerHTML = slideHTMLStatic(i); } }
    });
    box && box.addEventListener('click', () => {
      if (my !== vseq.token) return;
      if (s.afterVideo === 'slide') { try { v.pause(); } catch (e) {} toStatic(); return; }   // 讲解页：点一下＝跳过
      // 其它页：从头带声重播（点击本身就是用户操作，这时浏览器一定放行声音）
      idx = 0; failed = 0;
      box.classList.remove('done'); box.classList.remove('needtap');
      v.currentTime = 0;
      play(true);
    });
    play(true);
  }
  /* 回落用：同一页的静态图版式（视频缺失时用） */
  function slideHTMLStatic(i) { return slideBodyHTML(i); }
  /* 配图位：图片还没生成时显示占位框，明确标出缺哪张 */
  function imgSlot(img) {
    const f = img.getAttribute('data-slot') || '';
    const box = img.parentElement; box.classList.add('art');
    box.innerHTML = `<div class="slotbox"><div class="sloticon">🖼️</div><div class="slotname">${esc(f)}</div><div class="slottip">配图位（待用豆包生成）</div></div>`;
  }
  window.imgSlot = imgSlot;

  /* ---------- 每页实时数据（按岗位） ---------- */
  function anyAnsweredCorrect(t, qid) { const bym = t.answeredBy || {}; return Object.keys(bym).some(m => bym[m][qid] && bym[m][qid].correct); }
  /* 侧栏“实时排行”：占全高的一条窄栏 */
  function liveHTML() {
    const medal = ['🥇', '🥈', '🥉'];
    return sortedTeams().map((t, k) => `<div class="rk ${k === 0 ? 'first' : ''}">
        <span class="rk-pos">${medal[k] || (k + 1)}</span>
        <span class="rk-dot" style="background:${esc(t.color || '#c9d3e4')}"></span>
        <span class="rk-name">${esc(t.name)}</span>
        <span class="rk-score">${t.score}</span>
      </div>`).join('');
  }

  /* ---------- 嵌在每页里的实时数据 ----------
     学生的作答、认领、进度直接显示在「这一页」上，老师不用另开控制台。 */
  /* who 传小组对象时带上本组颜色，学生一眼认出自己那一格 */
  function pdChip(who, text, state) {
    const name = (who && who.name) || who || '';
    const color = (who && who.color) || '';
    return `<span class="pd-chip ${state || ''}"${color ? ` style="--tc:${esc(color)}"` : ''}><span class="pd-nm">${esc(name)}</span><b>${esc(text)}</b></span>`;
  }
  function pdHTML(label, value, chips) {
    return `<div class="pd-head"><span class="pd-label">⚡ ${esc(label)}</span><span class="pd-val">${value}</span></div>
      ${chips ? `<div class="pd-chips">${chips}</div>` : ''}`;
  }
  function cardRowsFilled(t) {
    return CARD_ROWS.filter(r => (cardText(t, r) || '').trim() || (cellOf(t, r) || {}).img).length;
  }
  function pagedataHTML(i) {
    const s = SLIDES[i]; if (!s) return '';
    const T = realTeams();          // 教师不计入本页进度
    const qid = (s.quiz && s.quiz[0]) || null;
    if (qid) {
      const q = QUESTIONS.find(x => x.id === qid);
      let subCnt = 0, rightCnt = 0;
      const chips = T.map(t => {
        const bym = (t.answeredBy || {});
        const members = Object.keys(bym).filter(m => bym[m][qid]);
        const done = members.length, ok = members.filter(m => bym[m][qid].correct).length;
        subCnt += done; rightCnt += ok;
        const total = (t.members || []).length;
        return pdChip(t, done ? `对${ok}/答${done}` + (total ? '·共' + total + '人' : '') : '未答', done ? (ok === done ? 'ok' : 'no') : 'wait');
      }).join('');
      return pdHTML(`本页答题（各人各答，答对 +${q ? q.points : 10}分）`,
        `答对 <b>${rightCnt}</b> 人　·　已提交 <b>${subCnt}</b> 人`, chips);
    }
    if (s.act === 'claim') {
      const total = T.length * ROLES.length;
      const got = T.reduce((a, t) => a + Object.keys(t.roleClaims || {}).length, 0);
      const miss = T.filter(t => Object.keys(t.roleClaims || {}).length < ROLES.length).map(t => t.name);
      return pdHTML('认领岗位', `已认领 <b>${got}</b>/${total} 人次` + (miss.length ? `　·　还差：${esc(miss.join('、'))}` : '　·　✔ 全班岗位齐了'),
        T.map(t => { const k = Object.keys(t.roleClaims || {}).length; return pdChip(t, k + '/' + ROLES.length, k >= ROLES.length ? 'ok' : 'wait'); }).join(''));
    }
    if (s.act === 'mindmap') {
      const cnt = (t) => Math.min(12, ((t.mindMap && t.mindMap.nodes) || []).length);
      const done = T.filter(t => (t.mindMap && t.mindMap.submitted) || cnt(t) >= 12);
      return pdHTML('动手分解（两层）', `两层都拆完 <b>${done.length}</b>/${T.length} 组`,
        T.map(t => { const k = cnt(t); return pdChip(t, k + '/12', k >= 12 ? 'ok' : 'wait'); }).join(''));
    }
    if (s.act === 'pick') {
      const okc = T.filter(teamPickDone).length;
      return pdHTML('找出本岗位子问题', `全组都全对 <b>${okc}</b>/${T.length} 组`,
        T.map(t => {
          const m = claimedMembers(t).length, k = teamMembersDone(t, x => t.picks && t.picks[x] && t.picks[x].correct);
          const tried = teamMembersDone(t, x => t.picks && t.picks[x]);
          return pdChip(t, `${k}/${m} 人全对` + (tried > k ? `·${tried - k} 待改` : ''), teamPickDone(t) ? 'ok' : (tried > k ? 'no' : 'wait'));
        }).join(''));
    }
    if (s.act === 'useAgent') {
      const asked = T.filter(t => (t.agent || []).length > 0).length;
      return pdHTML('向助手提问', `已提问 <b>${asked}</b>/${T.length} 组`,
        T.map(t => { const ppl = new Set((t.agent || []).map(x => x.member)).size; const k = (t.agent || []).length; return pdChip(t, k ? `${ppl} 人 · ${k} 问` : '未问', k ? 'ok' : 'wait'); }).join(''));
    }
    if (s.act === 'itinerary') {
      const full = T.filter(t => cardRowsFilled(t) >= CARD_ROWS.length).length;
      return pdHTML('小组行程卡', `四行都填了 <b>${full}</b>/${T.length} 组`,
        T.map(t => { const k = cardRowsFilled(t); return pdChip(t, k + '/' + CARD_ROWS.length, k >= CARD_ROWS.length ? 'ok' : 'wait'); }).join(''));
    }
    if (s.act === 'report') {
      const total = Object.keys(STATE.ratings || {}).reduce((a, tid) => a + Object.keys(STATE.ratings[tid] || {}).length, 0);
      return pdHTML('同伴互评', `已收到 <b>${total}</b> 条评星`, '');
    }
    return '';
  }

  /* ---------- 状态更新 ---------- */
  function afterState() {
    if (!STATE) return;
    updateWidgets(); updateNetBanner();
    if (MODE === 'student') {
      if (lastRenderedSlide !== STATE.slide) {
        const from = lastRenderedSlide, to = STATE.slide;
        lastRenderedSlide = to;
        // 标签页标题原来只在首次渲染时设过一次，翻页后一直停在「第1页」
        document.title = '学生端 · 第' + (studentSlide(Math.min(to, SLIDES.length - 1)) + 1) + '页';
        // 行程卡页/互评页切成全宽版式（排行榜挪到底部）
        const lay = document.querySelector('.layout');
        if (lay) lay.classList.toggle('wide', wideLayout(to));
        const handled = runRobotTransition(from, to,
          () => { const p = $('#panel'); if (p) { p.innerHTML = buildPanel(to, myTeam()); wireStudent(); lastPanelSig = panelSig(myTeam()); } },
          () => $('#panel'));
        if (!handled) {
          const t = myTeam(); const p = $('#panel');
          if (p) { p.innerHTML = buildPanel(to, t); wireStudent(); lastPanelSig = panelSig(t); }
        }
      }
      updateStudent();
    } else afterPresent();
  }
  function updateWidgets() {
    const conn = $('#conn'); if (conn) { conn.classList.add(netMode === 'server' ? 'ok' : 'off'); const c = $('#conntxt'); if (c) c.textContent = netMode === 'server' ? '已连接服务器' : '本地演示'; }
    const pn = $('#pptn'); if (pn) pn.textContent = STATE.connected + ' 终端在线';
    const tg = $('#pptTag'); if (tg) tg.textContent = SLIDES[STATE.slide] ? SLIDES[STATE.slide].tag : '';
  }
  function updateStudent() {
    if (MODE !== 'student' || !me.teamId) return;
    const t = myTeam();
    const rk = document.querySelector('.right .rank'); if (rk) rk.innerHTML = rankHTML();
    const ms = $('#myscore'); if (ms) ms.textContent = t ? t.score : 0;
    // 徽章也要即时刷新：原来要等翻页才显示，学生拿到了却看不见
    const bd = document.querySelector('.right .badges');
    if (bd) { const h = badgesHTML(t); if (bd.innerHTML !== h) bd.innerHTML = h; }
    syncCard(t);   // 同组同学改的格子实时写进来
    const sig = qForSlide(STATE.slide).map(q => { const a = myAnswer(t, q.id); return a ? ((q.type === 'multi' ? (a.chosen || []).join(',') : a.chosen) + ':' + (a.correct ? 1 : 0)) : '-'; }).join('|');
    if (sig !== lastSig) { lastSig = sig; const qz = $('#quiz-q'); if (qz) qz.innerHTML = quizHTML(qForSlide(STATE.slide), t); }
    // 队伍数据变化 → 重绘面板（正在打字时先挂起，失焦后再补上）
    const psig = panelSig(t);
    if (!transitioning && psig !== lastPanelSig && !inputBusy()) { lastPanelSig = psig; rerenderPanel(); }
  }
  function afterPresent() {
    const i = Math.min(STATE.slide, SLIDES.length - 1);
    const splash = (i === 0 || i === SLIDES.length - 1);
    app.className = 'ppt ' + (splash ? 'ppt-gradient' : 'ppt-white');
    const st = $('#slidestage');
    if (!st) return;
    if (lastRenderedSlide !== i) {
      const from = lastRenderedSlide; lastRenderedSlide = i;
      manualPlayed = -1;        // 翻走再翻回来，演示视频可以重新按一下播
      const handled = runRobotTransition(from, i,
        () => { st.innerHTML = slideHTML(i); wireSlideVideo(i); },
        () => st.querySelector('.sl') || st);
      if (!handled) { st.innerHTML = slideHTML(i); wireSlideVideo(i); }
    }
    const lz = $('#livezone'); if (lz && !transitioning) lz.innerHTML = liveHTML(i);
    const pd = $('#pagedata'); if (pd && !transitioning) pd.innerHTML = pagedataHTML(i);
  }

  /* ===== 机器人图标动画 =====
     生命周期：第8页翻走时「缩进去」→ 第9页「保持」→ 第10页「弹出来」并留在角落 → 第11页「收起」
     翻回第8页或更早也收起。 */
  let robotEl = null;
  let transToken = 0;                       // 让挂起的过渡渲染作废（防止旧页覆盖新页）

  function robotShow(x, y) {
    if (!robotEl || !document.body.contains(robotEl)) {
      robotEl = document.createElement('div');
      robotEl.id = 'robotPal'; robotEl.className = 'flybot'; robotEl.textContent = '🤖';
      document.body.appendChild(robotEl);
    }
    robotEl.style.left = x + 'px'; robotEl.style.top = y + 'px';
    requestAnimationFrame(() => { if (robotEl) robotEl.classList.add('on'); });
  }
  function robotHide() {
    const el = document.getElementById('robotPal');
    robotEl = null;
    if (!el) return;
    el.classList.remove('on');
    setTimeout(() => el.remove(), 430);
  }
  /* 弹出：以图标中心为原点，从图标里长出来 */
  function popFromRobot(box) {
    if (!box) return;
    box.style.transformOrigin = (box.offsetWidth - 46) + 'px ' + (box.offsetHeight - 46) + 'px';
    void box.offsetWidth;                                   // 强制重排，保证从 scale(.05) 起步
    box.classList.add('popFromBot');
    setTimeout(() => { box.classList.remove('popFromBot'); box.style.transformOrigin = ''; }, 760);
  }
  /* 关键：动画类必须摘掉。学生端的 #panel 是常驻元素，
     留着带有 forwards 的 shrinkToBot 会让面板永久缩成 0.05 看不见。 */
  function clearAnim(box) { if (box) { box.classList.remove('shrinkToBot'); box.classList.remove('popFromBot'); } }

  /* 返回 true 表示「这一页的渲染由动画接管」，调用方不要再自己渲染 */
  function runRobotTransition(from, to, renderFn, boxFn) {
    // 助手不再由学生拼装，所以没有"从组装页缩进图标"这一步了；
    // 到提问页时让面板从右下角长出来，翻走就收起。
    const entering = (to === SLIDE_USE && from !== to);

    ++transToken;                                             // 作废任何挂起的过渡渲染
    const my = transToken;
    transitioning = false;
    clearAnim(boxFn());                                       // 清掉可能残留的缩小态

    if (entering) {
      renderFn();
      popFromRobot(boxFn());                                  // 页面从右下角"蹦"出来
      setTimeout(() => {                                      // 留一枚角标，翻页即收
        if (my === transToken && STATE.slide === SLIDE_USE) robotShow(window.innerWidth - 70, window.innerHeight - 70);
      }, 560);
      return true;
    }

    if (to !== SLIDE_USE) robotHide();
    return false;
  }
  // 窗口尺寸变了，角标跟着挪回右下角
  window.addEventListener('resize', () => {
    if (!robotEl || !document.body.contains(robotEl)) return;
    robotEl.style.left = (window.innerWidth - 70) + 'px';
    robotEl.style.top = (window.innerHeight - 70) + 'px';
  });
  function updateNetBanner() {
    let b = document.getElementById('netbanner');
    if (netMode === 'local') { if (!b) { b = document.createElement('div'); b.id = 'netbanner'; b.className = 'netbanner'; app.prepend(b); } b.innerHTML = '⚠️ 当前为 <b>本地演示</b>（未连接课堂服务器）。运行 <code>node server.js</code> 后访问 <code>' + esc(location.origin) + '</code>'; }
    else if (b) b.remove();
  }

  /* =========================================================
     Emoji → 豆包生成的图标：把页面里所有 emoji 文本实时换成 <img>
     （文件名 = 各码点十六进制用 - 连接，如 🏞️ → 1f3de-fe0f.png）
     ========================================================= */
  const EMOJI_LIST = ['✔','🎯','💬','🎉','🏅','🔄','✅','🧭','⭐','🚩','🚄','🏞️','🏨','🍜','🏆','👇','⚡','📅','📥','🤔','🧩','✍️','🗂️','🛠️','❓','🔎','🏛️','🗺️','🎤','📊','🌅','🎓','❌','🌊','⏳','📋','🌟','🚀','🕐','◀','▶','🖼️','🤖','⚠️','🛰️'];
  const IMG = {};
  EMOJI_LIST.forEach(e => { IMG[e] = '/emoji/' + [...e].map(c => c.codePointAt(0).toString(16)).join('-') + '.png'; });
  function emoSrc(key) {
    if (IMG[key]) return IMG[key];
    const noVS = key.replace(/️/g, ''); if (IMG[noVS]) return IMG[noVS];
    const addVS = noVS + '️'; if (IMG[addVS]) return IMG[addVS];
    return null;
  }
  const EMOJI_RE = /(\p{Extended_Pictographic}️?(?:‍\p{Extended_Pictographic}️?)*)/gu;
  const EMOJI_TEST = /\p{Extended_Pictographic}/u;   // 独立、无 /g，避免 lastIndex 状态污染
  const SKIP_SEL = 'textarea, input, [contenteditable="true"], .celltext, script, style, .ei';
  function deEmoji(root) {
    if (!root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.nodeValue || !EMOJI_TEST.test(n.nodeValue)) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (p && p.closest(SKIP_SEL)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = []; let n; while ((n = walker.nextNode())) nodes.push(n);
    for (const t of nodes) {
      const s = t.nodeValue; EMOJI_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m, changed = false;
      while ((m = EMOJI_RE.exec(s))) {
        const src = emoSrc(m[1]);
        if (!src) continue;
        if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
        const ch = m[1];   // 闭包捕获：onerror 是异步的，不能用循环变量
        const img = document.createElement('img');
        img.className = 'ei'; img.src = src; img.alt = ch; img.setAttribute('draggable', 'false');
        // 没放 emoji 素材包（/emoji/）时退回系统 emoji 文本，不留破图
        img.onerror = function () {
          const span = document.createElement('span');
          span.className = 'ei'; span.textContent = ch;
          if (img.parentNode) img.parentNode.replaceChild(span, img);
        };
        frag.appendChild(img);
        last = m.index + m[1].length; changed = true;
      }
      if (!changed) continue;
      if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
      t.parentNode.replaceChild(frag, t);
    }
  }
  let emoObserver = null, emoScheduled = false;
  function runDeEmoji() {
    if (emoObserver) emoObserver.disconnect();
    try { deEmoji(document.body); } catch (e) {}
    if (emoObserver) emoObserver.observe(document.body, { childList: true, subtree: true });
  }
  function scheduleEmoji() { if (emoScheduled) return; emoScheduled = true; requestAnimationFrame(() => { emoScheduled = false; runDeEmoji(); }); }
  function startEmoji() {
    runDeEmoji();
    emoObserver = new MutationObserver(() => scheduleEmoji());
    emoObserver.observe(document.body, { childList: true, subtree: true });
  }

  /* ---------- 和本机「课堂截图工具」配对 ----------
     工具在 127.0.0.1 上报出本机设备号；只有同一台机器读得到，
     读到后登记给服务器，截图就能直接贴进这位同学岗位那一行。
     读不到（没装工具/端口被占）也不影响上课，服务端会退回按 IP 识别。 */
  let devicePaired = false;
  async function pairDevice() {
    if (MODE !== 'student' || devicePaired || !me.teamId || !me.name) return;
    for (const port of [45678, 45679, 45680]) {
      try {
        const ctl = new AbortController();
        const t = setTimeout(() => ctl.abort(), 1200);
        const r = await fetch('http://127.0.0.1:' + port + '/id', { signal: ctl.signal, cache: 'no-store' });
        clearTimeout(t);
        if (!r.ok) continue;
        const d = await r.json();
        if (!d || !d.deviceId) continue;
        await Net.send('bindDevice', { teamId: me.teamId, member: me.name, deviceId: d.deviceId });
        devicePaired = true;
        return;
      } catch (e) { /* 这个端口没有工具，试下一个 */ }
    }
  }

  /* 「课堂学生端」是全屏 kiosk 窗口，没有关闭按钮。
     启动器会在地址里带上 kiosk=<端口>，这里按 Esc 就去敲它本机的那个端口，由它关掉浏览器。
     普通浏览器打开时没有这个参数，Esc 什么也不做。 */
  function wireKioskExit() {
    const port = new URLSearchParams(location.search).get('kiosk');
    if (!port || !/^\d+$/.test(port)) return;
    let asking = false;
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || asking) return;
      const a = document.activeElement;
      if (a && a.closest && a.closest('input, textarea, [contenteditable="true"]')) return;  // 正在打字：Esc 让给输入框
      const box = document.getElementById('ctripwrap');
      if (box && box.classList.contains('on')) {            // 查询窗开着：Esc 先收起它
        box.classList.remove('on');
        document.documentElement.classList.remove('cw-open');
        return;
      }
      if (!window.confirm('要退出课堂学生端吗？')) return;
      asking = true;
      fetch('http://127.0.0.1:' + port + '/quit', { mode: 'no-cors', cache: 'no-store' })
        .catch(() => {}).then(() => { setTimeout(() => { asking = false; }, 3000); });
    });
  }

  function start() {
    if (!STATE) STATE = loadLocal() || defaultState();
    installDelegated();
    Net.connect();
    if (MODE === 'student') renderStudent(); else renderPresent();
    startEmoji();
    pairDevice();
    wireKioskExit();
  }
  window.__dshBoot = true;
  start();
})();

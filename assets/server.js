/*
 * 旅游行程智规划 · 课堂工具服务器
 * ---------------------------------------------------------------
 * 零依赖：仅用 Node 内置模块（http / fs / path / crypto）。
 * 功能：
 *   1) 静态托管 public/（学生端、教师端+PPT 一体页面）
 *   2) SSE 实时广播课堂状态  ->  GET /api/events
 *   3) 客户端上报状态变更    ->  POST /api/state
 *   4) 学生自建智能体 LLM 代理 -> POST /api/agent（服务端持有密钥，离线自动降级）
 *
 * 启动：node server.js          （默认端口 5174，可 PORT=xxxx node server.js）
 * 智能体配置：见 config.json（可编译自 config.example.json），或环境变量
 *   OPENAI_BASE_URL / OPENAI_API_KEY / OPENAI_MODEL
 * ---------------------------------------------------------------
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || process.argv[2] || 5174);
const PUB_DIR = path.join(__dirname, 'public');

/* ---------- 课程内容：全部来自 public/course.js（唯一可变文件） ----------
   answers.js 放在 public 外，只给服务端判分，学生端拿不到。
   引擎里不许再出现任何课程专有名词（地名、岗位名、组名、页数）。 */
const COURSE = require(path.join(PUB_DIR, 'course.js'));
const ANSWERS = (function () {
  try { return require(path.join(__dirname, 'answers.js')); } catch (e) { return {}; }
})();
const META = COURSE.meta || {};
const ROLES = COURSE.roles || [];
const TEAMS = COURSE.teams || [];

/* ---------- 工具 ---------- */
function readBody(req, max) {
  const limit = max || 1e6;
  return new Promise((resolve) => {
    let data = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on('data', (c) => { data += c; if (data.length > limit) { finish({}); req.destroy(); } });
    req.on('end', () => {
      try { finish(data ? JSON.parse(data) : {}); }
      catch { finish({}); }
    });
    req.on('error', () => finish({}));
    req.on('close', () => finish({}));   // 客户端中途断开：也要放行，别让 handler 永远等下去
  });
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

/* ---------- 题库：题面来自 course.js，答案来自 answers.js ---------- */
const QUESTIONS = (COURSE.questions || []).map(function (q) {
  const out = Object.assign({}, q);
  if (ANSWERS[q.id] !== undefined) out.answer = ANSWERS[q.id];
  if (q.answerSet === undefined && Array.isArray(ANSWERS[q.id])) out.answerSet = ANSWERS[q.id];
  return out;
});
// 把题库发给客户端（不含答案，避免学生端泄露；评分在服务端）
const PUBLIC_QUESTIONS = QUESTIONS.map(function (q) {
  const rest = Object.assign({}, q);
  delete rest.answer; delete rest.answerSet;
  return rest;
});

/* ---------- 子问题池：所有岗位的子问题混在一起，学生挑出自己岗位的 ---------- */
const SUBPOOL = [];
ROLES.forEach(function (r) {
  (r.subProblems || []).forEach(function (s) { SUBPOOL.push({ id: s.id, role: r.name, text: s.text }); });
});

/* ---------- 课堂状态（服务端权威，SSE 广播） ---------- */
/* 页数不在这里定：以客户端 public/app.js 的 SLIDES 长度为准（见 setSlide）。
   加页 / 删页只改前端，服务端不设上界，避免"最后一页翻不到"。 */

function newTeam(i, name, color, dest, demo) {
  return {
    id: 'T' + (i + 1), name, color,
    demo: !!demo,          // 教师：功能全开，但不进排行、不计进度、不参与互评

    dest: dest || '',      // 本组目的地：会写进 AI 助手的预置提示词
    members: [], score: 0,
    badges: [],
    answeredBy: {},        // 选择题按人：{ '小明': { qid: {chosen, correct} } }
    roleClaims: {},        // 岗位占用：{ '某岗位': '小明' } —— 普通组一岗一人，用来置灰按钮
    memberRoles: {},       // 人 → 岗位：{ '小明': '某岗位' } —— 身份以这个为准；
                           //   教师允许多人同岗位，那时 roleClaims 不写、只写这里
    mindMap: { nodes: [], submitted: false },
    picks: {},             // 每人一份子问题作答：{ '小明': { role, picked: [id], correct } }
    agent: [],             // 智能体对话记录（按 member 区分，每人只看自己的）
    selfAwards: {},        // 「给自己加分」次数：{ '小明': 2 }
    card: {},              // 共享行程卡：{ '景点安排': { t:'', img:'' }, ... }
  };
}

/* 组名 → 目的地（course.js 的 teams 是唯一来源） */
const TEAM_DESTS = {};
TEAMS.forEach(function (t) { TEAM_DESTS[t.name] = t.dest || ''; });

let state = {
  title: META.title || '课堂工具',
  origin: META.origin || '',        // 全班出发地：写进 AI 预置提示词
  duration: META.duration || '',    // 行程时长：也写进 AI 预置提示词
  session: crypto.randomUUID().slice(0, 8),
  slide: 0,             // 演示页下标（上界由客户端 SLIDES 决定），老师翻页即推进进度
  teams: TEAMS.map(function (t, i) { return newTeam(i, t.name, t.color, t.dest, t.demo); }),
  ratings: {},              // 打分记录：{ 被评组id: { 打分人标识: 星数 } } —— 每组每人只能打一次
  audit: [],                // 事件流水（教师端可看）
  connected: 0,
};

let sseClients = new Set();

/* ---------- IP → 学生身份（给截图工具直传用；一人一机的前提下成立） ----------
   学生端每次上报动作都带 teamId + member，这里按来源 IP 记下最近一次是谁在用这台机器。
   只存在内存里，不进 state、不广播。 */
const ipIdentity = new Map();
/* 设备号 → 身份：截图工具在本机开了个只听 127.0.0.1 的小接口报出设备号，
   学生端网页（同一台机器）读到后来这里登记。跨机器不可能读到别人的设备号，
   所以云教室 / 同一出口 IP 的环境也不会串号。IP 只作兜底。 */
const deviceIdentity = new Map();
function normIP(req) {
  let ip = (req.socket && req.socket.remoteAddress) || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);   // IPv4-mapped IPv6
  if (ip === '::1') ip = '127.0.0.1';               // 老师机自测时的本地回环
  return ip;
}
function rememberIdentity(req, p) {
  if (!p || !p.teamId || !p.member) return;
  const ip = normIP(req); if (!ip) return;
  ipIdentity.set(ip, { teamId: String(p.teamId), member: String(p.member).slice(0, 20), at: Date.now() });
}
/* 岗位 → 行程卡的哪一行（由 course.js 的 roles[].cardRow 生成） */
const ROLE_ROW = {};
ROLES.forEach(function (r) { if (r.cardRow) ROLE_ROW[r.name] = r.cardRow; });
/* 这台机器现在是谁、该往哪一行贴图 */
function whoAmI(req, deviceId) {
  const dev = deviceId ? deviceIdentity.get(String(deviceId)) : null;
  const id = dev || ipIdentity.get(normIP(req));          // 先认设备号，认不出再按 IP 兜底
  if (!id) return { ok: false, reason: '这台电脑还没有同学登录，请先在学习平台上登录。' };
  const team = state.teams.find(t => t.id === id.teamId);
  if (!team) return { ok: false, reason: '课堂数据已重置，请重新登录学习平台。' };
  const role = (team.memberRoles || {})[id.member] || Object.keys(team.roleClaims || {}).find(r => team.roleClaims[r] === id.member);
  if (!role) return { ok: false, reason: '你还没有认领岗位，请先在学习平台上认领。', team, member: id.member };
  const row = ROLE_ROW[role];
  if (!row) return { ok: false, reason: '你的岗位没有对应的图片格；要补图请用 Ctrl+V 粘到格子里。', team, member: id.member, role };
  return { ok: true, team, member: id.member, role, row };
}

/* 发给客户端的状态：去掉 audit（前端不显示，只是让每次广播变胖） */
function wireState() { const { audit, ...rest } = state; return JSON.stringify(rest); }
let bcastTimer = null;
function broadcast() {
  // 合并：行程卡打字、连续拖拽会在几十毫秒内触发多次变更，攒成一次再发
  if (bcastTimer) return;
  bcastTimer = setTimeout(() => {
    bcastTimer = null;
    const data = wireState();
    for (const res of sseClients) {
      try { res.write('event: state\ndata: ' + data + '\n\n'); } catch { sseClients.delete(res); }
    }
  }, 60);
}
function audit(msg) {
  state.audit.unshift({ at: Date.now(), msg });
  if (state.audit.length > 120) state.audit.pop();
}

/* ---------- 状态变更处理（白名单） ---------- */
function applyAction(action, p) {
  p = p || {};
  const team = p.teamId ? state.teams.find(t => t.id === p.teamId) : null;
  let ret;   // 个别 action（如 submitQuiz）把判分结果回给调用方，用于学生端即时反馈
  switch (action) {
    case 'setSlide': {
      state.slide = clamp(Math.floor(Number(p.slide) || 0), 0, 999);   // 上界交给客户端 SLIDES
      audit('翻页 → 第 ' + (state.slide + 1) + ' 页');
      break;
    }

    case 'bindDevice': {
      // 学生端登录后把「本机设备号 ↔ 我是谁」登记上来
      if (!team || !p.member || !p.deviceId) break;
      deviceIdentity.set(String(p.deviceId).slice(0, 64), { teamId: team.id, member: String(p.member).slice(0, 20), at: Date.now() });
      break;
    }
    case 'joinTeam': if (team && p.member) { const m = String(p.member).slice(0, 20); if (!team.members.includes(m)) team.members.push(m); } break;

    case 'submitQuiz': {
      // 选择题按人各答各的：每人一份，每人第一次作答后不可改、答对本人所在组 +points
      if (!team || !p.member) break;
      const q = QUESTIONS.find(x => x.id === p.qid); if (!q) break;
      const member = String(p.member).slice(0, 20);
      const chosen = p.chosen;
      let correct = false;
      if (q.type === 'multi') {
        const s = Array.isArray(chosen) ? chosen.slice().sort((a, b) => a - b) : [];
        correct = s.length === q.answerSet.length && s.every((v, i) => v === q.answerSet[i]);
      } else {
        correct = chosen === q.answer;
      }
      const mine = team.answeredBy[member] || (team.answeredBy[member] = {});
      if (mine[p.qid]) { ret = { already: true, correct: mine[p.qid].correct, points: q.points, awarded: 0 }; audit(team.name + '·' + member + ' 重复作答 ' + p.qid + '，已忽略'); break; }
      mine[p.qid] = { chosen, correct };
      let awarded = 0;
      if (correct) { team.score += q.points; awarded = q.points; addBadge(team, '答题王'); }
      ret = { correct, points: q.points, awarded };
      audit(`${team.name}·${member} 作答 ${p.qid} ${correct ? '✔ 正确 +' + q.points : '✘ 待讲解'}`);
      break;
    }

    case 'claimRole': {
      if (!team || !p.role) break;
      const role = String(p.role).slice(0, 12);
      const member = p.member ? String(p.member).slice(0, 20) : '';
      if (!member) {
        const who = team.roleClaims[role];
        delete team.roleClaims[role];
        if (who) delete team.memberRoles[who];
        audit(team.name + ' 取消认领：' + role);
        break;
      }
      if (team.demo) {
        // 教师：几位听课老师可以同时选同一个岗位，互不挤占
        team.memberRoles[member] = role;
        audit(team.name + '·' + member + ' 选择岗位：' + role);
        break;
      }
      // 岗位已被别人占用则拒绝（先检查，再动自己原来的认领，失败时不会把原岗位弄丢）
      if (team.roleClaims[role] && team.roleClaims[role] !== member) { audit(team.name + ' 认领失败（' + role + ' 已被占）'); break; }
      // 一个人只能占一个岗位：清掉该成员原有的认领
      Object.keys(team.roleClaims).forEach(r => { if (team.roleClaims[r] === member) delete team.roleClaims[r]; });
      team.roleClaims[role] = member;
      team.memberRoles[member] = role;
      audit(team.name + ' 认领岗位：' + role);
      break;
    }
    case 'setMindMap': {
      if (!team) break;
      const wasScored = !!(team.mindMap && team.mindMap.scored);   // 分解导图是小组级：全组第一次完成 +2，保留 scored 防重复加分
      team.mindMap = { nodes: Array.isArray(p.nodes) ? p.nodes.slice(0, 60) : [], submitted: !!p.submitted, scored: wasScored };
      let awarded = 0;
      if (p.submitted) {
        addBadge(team, '拆解大师');
        if (!wasScored) { team.score += 2; team.mindMap.scored = true; awarded = 2; }
        audit(team.name + ' 完成分解思维导图');
      }
      ret = { awarded };
      break;
    }
    case 'submitPick': {
      // 按人记：每个岗位的同学各挑自己的子问题；每人第一次全对 +2（一组 5 人满分 10），全组都全对得徽章
      if (!team || !p.role || !p.member) break;
      const member = String(p.member).slice(0, 20);
      const role = String(p.role).slice(0, 12);
      const expect = SUBPOOL.filter(x => x.role === role).map(x => x.id).sort();
      const got = (Array.isArray(p.picked) ? p.picked.map(String) : []).slice(0, 20).sort();
      const ok = expect.length > 0 && expect.length === got.length && expect.every((v, i) => v === got[i]);
      const prev = team.picks[member];
      const firstCorrect = ok && !(prev && prev.correct);
      team.picks[member] = { role, picked: got, correct: ok };
      if (firstCorrect) team.score += 2;
      if (teamPickDone(team)) addBadge(team, '岗位小专家');
      ret = { correct: ok, awarded: firstCorrect ? 2 : 0 };
      audit(team.name + '·' + member + ' 选择岗位子问题 ' + (ok ? '✔ 全对' : '✘ 待修改'));
      break;
    }

    case 'setCard': {
      if (!team || !p.key) break;
      if (!canEditRow(team, p.member, p.key)) { audit(team.name + '·' + (p.member || '?') + ' 想改不属于自己岗位的行【' + p.key + '】，已拒绝'); break; }
      const c = team.card[p.key] || (team.card[p.key] = { t: '', img: '' });
      c.t = String(p.t == null ? '' : p.t).slice(0, 300);
      team.card[p.key] = c;
      break;
    }
    case 'setCardImg': {
      if (!team || !p.key) break;
      if (!canEditRow(team, p.member, p.key)) { audit(team.name + '·' + (p.member || '?') + ' 想改不属于自己岗位的行【' + p.key + '】，已拒绝'); break; }
      const c = team.card[p.key] || (team.card[p.key] = { t: '', img: '' });
      const img = String(p.img == null ? '' : p.img).slice(0, 300);
      c.img = /^\/uploads\/[A-Za-z0-9-]+\.(png|jpe?g|gif|webp)$/.test(img) ? img : '';   // 只认本服务器上传的图
      team.card[p.key] = c;
      audit(team.name + (c.img ? ' 行程卡加了图片' : ' 删除行程卡图片'));
      break;
    }

    case 'logAgent': {
      if (!team) break;
      team.agent.push({ member: String(p.member || '').slice(0, 20), role: String(p.role || '').slice(0, 40), q: String(p.q || '').slice(0, 500), a: String(p.a || '').slice(0, 2000), p: p.p || '', at: Date.now() });
      if (team.agent.length > 60) team.agent.splice(0, team.agent.length - 60);   // 别让广播越来越胖
      break;
    }

    case 'rateTeam': {
      if (!team || !p.rater) break;
      if (team.demo) { audit('教师不参与互评，已忽略'); break; }
      {
        const m = /@(T\d+)$/.exec(String(p.rater));
        const rt = m ? state.teams.find(x => x.id === m[1]) : null;
        if (rt && rt.demo) { audit('教师打的星不计入，已忽略'); break; }
      }
      const stars = clamp(Number(p.stars) || 0, 1, 5);
      const rk = String(p.rater).slice(0, 40);
      // 不能给自己组打星：打分人标识是「姓名@组id」，同组即拒绝
      if (rk.slice(-(team.id.length + 1)) === '@' + team.id) {
        audit(team.name + ' 想给自己组打星，已拒绝（' + rk + '）');
        break;
      }
      state.ratings[team.id] = state.ratings[team.id] || {};
      if (state.ratings[team.id][rk]) {                   // 只能打一次：重复提交直接忽略
        audit(team.name + ' 的评分被重复提交，已忽略（' + rk + '）');
        break;
      }
      state.ratings[team.id][rk] = stars;
      team.score += stars * 2;
      audit(rk + ' 给 ' + team.name + ' 打了 ' + stars + ' 星（+' + stars * 2 + '分）');
      break;
    }
    case 'selfAward': {
      // 学生口头回答问题后，自己点一下加分（一次 +5）
      if (!team || !p.member) break;
      const member = String(p.member).slice(0, 20);
      const pts = 5;
      team.score += pts;
      team.selfAwards[member] = (team.selfAwards[member] || 0) + 1;
      ret = { awarded: pts, times: team.selfAwards[member] };
      audit(team.name + '·' + member + ' 回答问题加分 +' + pts + '（第 ' + team.selfAwards[member] + ' 次）');
      break;
    }

    case 'resetAll': {
      state.teams = state.teams.map(t => newTeam(Number(t.id.slice(1)) - 1, t.name, t.color, TEAM_DESTS[t.name] || t.dest || '', t.demo));
      state.audit = []; state.slide = 0; state.ratings = {};
      state.session = crypto.randomUUID().slice(0, 8);   // 会话号一换，学生端会自动清掉本机登录信息、回到登录页
      ipIdentity.clear(); deviceIdentity.clear();         // 身份表也清掉，换班后不会串号
      audit('已清空全班数据，新会话 ' + state.session);
      break;
    }
    default: break;
  }
  return ret;
}

function addBadge(team, b) { if (!team.badges.includes(b)) team.badges.push(b); }
/* 全组"子问题"是否都全对：已认领岗位的每个人都有一份全对的作答 */
function teamPickDone(team) {
  const members = Object.keys(team.memberRoles || {});
  return members.length > 0 && members.every(m => team.picks[m] && team.picks[m].correct);
}
/* 行程卡：四行各归一个岗位。该岗位有人认领 → 只有他能改；
   没人认领（比如这组人不够 4 个）→ 本组任何人都能补，别让那一行没人管。 */
const CARD_ROLE = {};
ROLES.forEach(function (r) { if (r.cardRow) CARD_ROLE[r.cardRow] = r.name; });
function canEditRow(team, member, key) {
  const role = CARD_ROLE[key];
  if (!role) return false;
  if (team.demo) return true;          // 教师：随便试，不做归属限制
  const claims = team.roleClaims || {};
  if (!Object.keys(claims).length) return true;
  const m = String(member || '');
  if (!m) return false;
  const owner = claims[role];
  return owner ? owner === m : true;
}

/* ---------- 智能体 LLM 代理 ---------- */
const CFG = loadConfig();
function loadConfig() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8');
    return JSON.parse(raw);
  } catch { return {}; }
}
function buildSystemPrompt(cards, dest, origin, duration) {
  const role = cards.role || '你的助手';
  const goal = cards.objective || '帮助用户完成本岗位工作';
  const knowledge = cards.knowledge || '一般常识';
  const rules = cards.rules || '给出条理清晰的建议';
  const d = (dest || '').trim();
  const o = (origin || '').trim();
  const du = (duration || '').trim();
  // 目的地所在城市（"XX省XX市·某某景区" → "XX"）
  // 三级兜底：去掉省名后取"XX市" → 命中 teams[].city → 命中 platform.cityInfo 的键
  const city = (function () {
    const s = d.replace(new RegExp('^' + (META.region || '')), '');
    const m = s.match(/^([\u4e00-\u9fa5]{2,3})市/);
    if (m) return m[1];
    const t = TEAMS.filter(function (x) { return x.dest && (x.dest === d || d.indexOf(x.dest) >= 0); })[0];
    if (t && t.city) return t.city;
    const info = (COURSE.platform && COURSE.platform.cityInfo) || {};
    const k = Object.keys(info).filter(function (c) { return d.indexOf(c) >= 0; })[0];
    return k || '';
  })();
  // 目的地的短名（"XX省XX市·某某景区" → "某某景区"；顺带去掉尾部的括号补充）
  const dn = (() => {
    const k = d.lastIndexOf('·');
    const s = (k >= 0 ? d.slice(k + 1) : d.replace(/^山东省/, ''))
      .replace(/[（(][^）)]*[）)]\s*$/, '')
      .trim();
    return s || d;
  })();
  // 出发地短名（"XX省XX市" → "XX市"）
  const on = o.replace(/^山东省/, '').trim() || o;
  // 岗位分工：每个助手只答自己这一块，绝不给完整一日行程、不替别的岗位规划
  // 岗位分工：直接读 course.js 的 roles[].scope，引擎不再认识任何具体岗位名
  const scope = (function () {
    const rt = role || '';
    const r = ROLES.filter(function (x) { return x.scope && x.scope.name && rt.indexOf(x.scope.name) >= 0; })[0];
    if (!r) return null;
    const fill = function (s) {
      return String(s == null ? '' : s)
        .replace(/\{origin\}/g, on || '出发地')
        .replace(/\{dest\}/g, dn || '目的地')
        .replace(/\{duration\}/g, du || '这段行程')
        .replace(/\{scopeName\}/g, r.scope.name);
    };
    return { name: r.scope.name, focus: fill(r.scope.focus), avoid: r.scope.avoid || '' };
  })();
  const rules_ = [];
  if (d) rules_.push(`${rules_.length + 1}. 每一条建议都要说清是在「${dn}」怎么安排，不要用“目的地”“那里”代替它的名字。`);
  if (d) rules_.push(`${rules_.length + 1}. 你提到的地点必须都在${city ? `「${city}」` : `「${dn}」`}，绝不能出现出发地${o ? `「${on}」` : ''}或其它城市。`);
  if (d) rules_.push(`${rules_.length + 1}. 绝对不要改写目的地，不要说“可以就近选一个地方”“先确定具体目的地”之类的话。目的地已经定好了，就是「${dn}」。`);
  if (du) rules_.push(`${rules_.length + 1}. 只在 ${du} 的范围里说，不许出现“第二天”“两天”“次日返程”这类内容。`);
  if (o && d && (!scope || scope.name === '交通')) rules_.push(`${rules_.length + 1}. 讲交通时，必须写清「从${on}怎么到${dn}」：坐什么车、大概多久、到哪一站下。`);
  rules_.push(`${rules_.length + 1}. 不确定的信息（票价、班次、开放时间、价格）必须说“这需要查证”，绝不编造。`);
  return [
    scope
      ? `你是本课堂【${scope.name}】岗位的AI助手。你【只负责${scope.name}这一件事】，只回答和${scope.name}有关的内容（${scope.focus}）。`
      : `你是一名${META.grade || '小学'}${META.subject || ''}课堂里的“岗位AI助手”。`,
    scope
      ? `⚠ 最重要的一条：即使用户让你“安排这一天/给完整行程/把行程排一下”，你也【绝对不要】给出一整天的完整规划，【绝对不要】涉及${scope.avoid}；那些是其他岗位同学负责的。用户一旦问到${scope.avoid}，只回一句：“那是其他岗位同学负责的，请去问对应岗位的助手”，然后把话题拉回${scope.name}。`
      : ``,
    ``,
    `本组的行程设定已由老师确定，不可更改（只作为背景，你仍然只答你那一块）：`,
    o ? `　出发地：${on}` : ``,
    d ? `　目的地：${dn}${city ? `（在${city}市）` : ''}` : ``,
    du ? `　行程时长：${du}（住一晚就返回）` : ``,
    ``,
    `【硬性要求，必须遵守】`,
    ...rules_,
    ``,
    `你的身份：${role}`,
    `你要帮用户做的事：${goal}`,
    `你可以依据的知识：${knowledge}`,
    `你的行为规矩：${rules}`,
    ``,
    scope
      ? `输出要求：中文、分条、每条一句话，最多 4 条，每一条都必须是关于【${scope.name}】的，出现${scope.avoid}就算错。`
      : `输出要求：中文、分条、每条一句话，最多 5 条。`,
    `严禁输出与行程规划无关的内容，严禁广告、危险或成人信息。`,
  ].filter(Boolean).join('\n');
}
// 离线降级：未配置真实API或调用失败时给出示例。
// 关键：先看「问题」想问什么；问题看不出意图时，才用「岗位」兜底。
// （早期版本把岗位名一起做匹配，"某岗位"问预算也会命中该岗位分支，答非所问。）
function offlineAnswer(cards, question, dest, origin, duration) {
  const role = cards.role || '';
  const q = question || '';
  const D = (dest || '').trim() || (TEAMS[0] && TEAMS[0].dest) || '目的地';
  const O = (origin || '').trim() || META.origin || '出发地';
  const DU = (duration || '').trim();
  const tag = '（演示模式：未配置真实AI，以下为内置示例回答）';
  const head = `收到！我是「${role || '助手'}」，从「${O}」出发，我们组要去「${D}」${DU ? `，行程${DU}` : ''}。你问：${question || '给我一些建议'}\n`;

  let kind = null;
  if (/预算|多少钱|花多少|费用|贵不贵|省钱/.test(q)) kind = 'budget';
  else if (/住|民宿|酒店|吃|餐|美食|吃饭/.test(q)) kind = 'stay';
  else if (/安全|天气|注意|风险|下雨|危险/.test(q)) kind = 'safe';
  else if (/时间|节奏|进度|协调|合到|几天|先做哪/.test(q)) kind = 'coord';
  else if (/讲解|文案|开场|导游词|介绍词/.test(q)) kind = 'guide';
  else if (/景点|必去|好玩|去哪|门票|开放时间/.test(q)) kind = 'spot';
  else if (/交通|怎么去|坐车|火车|大巴|出行|换乘/.test(q)) kind = 'traffic';
  if (!kind) {
    // 岗位兜底：按 course.js 里该岗位 scope.name 映射到预置范例
    const sn = scopeNameOf(role);
    const map = { '交通': 'traffic', '景点': 'spot', '住宿': 'stay', '美食': 'stay', '时间协调': 'coord' };
    kind = map[sn] || (/安全/.test(role) ? 'safe' : /文案|导游/.test(role) ? 'guide' : 'general');
  }

  const R = {
    traffic: `\n1. 从${O}出发去${D}：先坐高铁或大巴到${D}所在城市，再换乘公交/打车；\n2. 自驾：提前查好路线和停车；\n3. 建议先比价、看时间，优先安全。`,
    spot: `\n1. ${D}·主景点（自然风光，适合拍照）；\n2. ${D}周边人文点位（了解当地文化）；\n3. 开放时间和门票都要查证。`,
    stay: `\n1. 住宿：${D}附近民宿或快捷酒店，比较方便；\n2. 美食：${D}当地的特色菜，哪家店好吃要查证；\n3. 建议提前预订，错峰用餐。`,
    budget: `\n1. 交通 约 200 元/人；\n2. 门票 约 80 元/人；\n3. 住宿 约 150 元/人；\n4. 餐饮 约 120 元/人；\n合计约 550 元/人，先以平台实价为准。`,
    safe: `\n1. 去${D}前先查天气预报，备好雨具；\n2. 注意景区警示，湿地不随意下河；\n3. 文明旅游，不投喂野生动物。`,
    coord: `\n1. 先看 ${D} 的开放时间，倒推这一天一夜的节奏；\n2. 把交通、景点、住宿、美食四块的时间排开；\n3. 检查哪一块还没完成，提醒对应同学补上。`,
    guide: `\n“同学们，我们现在来到了${D}……”\n1. 用一句生动的开场；\n2. 讲一个当地的小知识；\n3. 提醒爱护环境。`,
    general: `\n建议：1) 先定目标（本组目的地：${D}）；2) 把任务拆小；3) 用查到的真实信息补充。记住：AI是助手，不是答案。`,
  };
  return head + tag + R[kind];
}

/* 岗位关键词：用来把模型答案里“串岗”的句子过滤掉（小模型不一定听提示词，这里兜底）
   由 course.js 的 roles[].scope.kw 生成；没写 kw 的岗位不参与过滤 */
const DOMAIN_KW = {};
ROLES.forEach(function (r) {
  if (r.scope && r.scope.name && r.scope.kw && r.scope.kw.length) DOMAIN_KW[r.scope.name] = r.scope.kw;
});

/* 只保留属于本岗位的句子：一行若含别的岗位专属词、又不含本岗位词，就删掉；删空则退回原文 */
function scopeFilter(answer, scopeName) {
  if (!answer || !DOMAIN_KW[scopeName]) return answer;
  const own = DOMAIN_KW[scopeName];
  const others = Object.keys(DOMAIN_KW).filter(k => k !== scopeName).flatMap(k => DOMAIN_KW[k]);
  const hit = (line, kws) => kws.some(w => line.includes(w));
  const lines = String(answer).split('\n').map(s => s.trim()).filter(Boolean)
    .map(s => s.replace(/^\d+[\.、]\s*/, ''));   // 去掉原有编号，稍后重排
  const kept = lines.filter(line => {
    const otherOnly = hit(line, others) && !hit(line, own);
    return !otherOnly;
  });
  const use = kept.length ? kept : lines;   // 万一全删了，退回原文，别给学生空白
  return use.map((s, i) => (i + 1) + '. ' + s).join('\n');
}
/* 从岗位卡的“角色”里认出是哪一块（与 buildSystemPrompt 的 scope 判定同源） */
function scopeNameOf(roleText) {
  const rt = roleText || '';
  const r = ROLES.filter(function (x) { return x.scope && x.scope.name && rt.indexOf(x.scope.name) >= 0; })[0];
  return r ? r.scope.name : '';
}

async function handleAgent(req, res) {
  const body = await readBody(req);
  const cards = {
    role: String(body.role || '').slice(0, 40),
    objective: String(body.objective || '').slice(0, 120),
    knowledge: String(body.knowledge || '').slice(0, 200),
    rules: String(body.rules || '').slice(0, 200),
  };
  const question = String(body.question || '').slice(0, 500);
  // 出发地：全班统一，取课堂状态
  let origin = String(body.origin || '').slice(0, 40) || state.origin || '';
  // 目的地：优先用请求带来的，其次按 teamId 从课堂状态里取
  let dest = String(body.dest || '').slice(0, 40);
  if (!dest && body.teamId) {
    const t = state.teams.find(x => x.id === body.teamId);
    if (t) dest = t.dest || '';
  }
  const key = CFG.openaiApiKey || process.env.OPENAI_API_KEY;
  const base = (CFG.openaiBaseUrl || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = CFG.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const maxTok = Number(CFG.maxTokens || process.env.OPENAI_MAX_TOKENS || 4000);
  const timeoutMs = Number(CFG.timeoutMs || process.env.OPENAI_TIMEOUT_MS || 45000);
  // 推理等级：none/low/medium/high（不配则不发送该参数）
  const effort = CFG.reasoningEffort || process.env.OPENAI_REASONING_EFFORT || '';
  // 行程时长：全班统一，取课堂状态
  const duration = String(body.duration || '').slice(0, 20) || state.duration || '';

  const scopeName = scopeNameOf(cards.role);
  if (!key) {
    return json(res, 200, { answer: offlineAnswer(cards, question, dest, origin, duration), provider: 'offline', dest, origin, duration });
  }
  const system = buildSystemPrompt(cards, dest, origin, duration);

  const payloadFor = (withEffort) => {
    const p = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: question || '请给出你的建议' },
      ],
      temperature: 0.3,
      max_tokens: maxTok,
    };
    if (withEffort && effort) p.reasoning_effort = effort;
    return p;
  };

  const doCall = async (withEffort) => {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
        body: JSON.stringify(payloadFor(withEffort)),
        signal: ac.signal,
      });
      const txt = await r.text();
      if (!r.ok) {
        const err = new Error('API ' + r.status + ' ' + txt.slice(0, 160));
        err.status = r.status;
        throw err;
      }
      return JSON.parse(txt);
    } finally { clearTimeout(tid); }
  };

  try {
    let data;
    try {
      data = await doCall(true);
    } catch (e) {
      // 有些服务商不认 reasoning_effort，去掉该参数重试一次，保证换供应商也能用
      if (effort && e.status && e.status >= 400 && e.status < 500) {
        console.warn('[agent] reasoning_effort 被拒，去掉重试：', e.message);
        data = await doCall(false);
      } else { throw e; }
    }
    const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
    const raw = msg.content || '';
    const answer = scopeName ? scopeFilter(raw, scopeName) : raw;   // 兜底：删掉串岗的句子
    const reasoning = (data.usage && data.usage.completion_tokens_details && data.usage.completion_tokens_details.reasoning_tokens) || 0;
    console.log('[agent] model=' + model + ' effort=' + (effort || '-') + ' 岗位=' + (scopeName || '-') + ' 原文=' + raw.length + '字 过滤后=' + answer.length + '字');
    json(res, 200, { answer: answer || offlineAnswer(cards, question, dest, origin, duration), provider: 'api', dest, origin, duration, reasoningTokens: reasoning });
  } catch (e) {
    console.warn('[agent fallback]', e.message);
    json(res, 200, { answer: offlineAnswer(cards, question, dest, origin, duration), provider: 'offline', dest, origin, duration, note: '调用失败，已使用示例回答：' + e.message });
  }
}

/* ---------- HTTP 服务 ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/x-m4v', '.ogv': 'video/ogg',
  '.mhtml': 'multipart/related', '.mht': 'multipart/related',   // 抓取存档的平台页
};

// 视频和图片的缓存策略：每次都问一句"变了没"，没变就回 304。
// 不用 max-age 是因为素材还在改——万一换了视频，学生机不该抱着旧的不放。
// 一次问答几十字节，但省掉的是几 MB 的重传，公网上差别很大。
const REVAL = 'public, max-age=0, must-revalidate';
const etagOf = (st) => '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';

const server = http.createServer(async (req, res) => {
  // 注意：req.url 可能是 '//'、'http://…' 这类畸形值，new URL 会抛错。
  // 以前这里没兜住，学生在地址栏多打一个斜杠（http://localhost:5174//）就能让整台服务器退出。
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('请求地址不正确，请用 http://localhost:5174/');
  }

  // ---------- API ----------
  if (pathname === '/api/state' && req.method === 'POST') {
    const body = await readBody(req);
    rememberIdentity(req, body.payload);        // 记住这台机器现在是谁在用（截图直传要用）
    const result = applyAction(body.action, body.payload);
    audit(`⬆ ${body.action}`);
    broadcast();
    return json(res, 200, { ok: true, result: result || null });
  }

  if (pathname === '/api/agent' && req.method === 'POST') {
    return handleAgent(req, res);
  }

  // 行程卡配图上传（学生选本机图片 → 服务端保存 → 返回 URL）
  if (pathname === '/api/upload' && req.method === 'POST') {
    const body = await readBody(req, 9e6);
    const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(String(body.dataUrl || ''));
    if (!m) return json(res, 400, { error: '图片格式不支持' });
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    let buf;
    try { buf = Buffer.from(m[2], 'base64'); } catch { return json(res, 400, { error: '解码失败' }); }
    if (!buf.length || buf.length > 4 * 1024 * 1024) return json(res, 400, { error: '图片太大（限 4MB）' });
    const dir = path.join(PUB_DIR, 'uploads');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const name = crypto.randomUUID().slice(0, 12) + '.' + ext;
    fs.writeFileSync(path.join(dir, name), buf);
    return json(res, 200, { url: '/uploads/' + name });
  }

  // 截图工具问「我是谁」：窄条上显示身份，出问题时一眼看出原因
  if (pathname === '/api/whoami') {
    const w = whoAmI(req, new URL(req.url, 'http://x').searchParams.get('device'));
    return json(res, 200, w.ok
      ? { ok: true, team: w.team.name, member: w.member, role: w.role, row: w.row, slide: state.slide + 1 }
      : { ok: false, reason: w.reason, team: w.team ? w.team.name : '', member: w.member || '', slide: state.slide + 1 });
  }

  // 截图工具直传：按来源 IP 认出学生 → 直接贴进他岗位那一行的图片格
  if (pathname === '/api/shot' && req.method === 'POST') {
    const body = await readBody(req, 9e6);
    const who = whoAmI(req, body.deviceId);
    if (!who.ok) return json(res, 200, { ok: false, reason: who.reason });
    const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(String(body.dataUrl || ''));
    if (!m) return json(res, 200, { ok: false, reason: '图片格式不支持' });
    const ext = m[1].toLowerCase() === 'jpeg' ? 'jpg' : m[1].toLowerCase();
    let buf;
    try { buf = Buffer.from(m[2], 'base64'); } catch { return json(res, 200, { ok: false, reason: '图片解码失败' }); }
    if (!buf.length || buf.length > 4 * 1024 * 1024) return json(res, 200, { ok: false, reason: '图片太大（限 4MB）' });
    if (!canEditRow(who.team, who.member, who.row)) return json(res, 200, { ok: false, reason: '这一行不归你负责' });
    const dir = path.join(PUB_DIR, 'uploads');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const name = crypto.randomUUID().slice(0, 12) + '.' + ext;
    try { fs.writeFileSync(path.join(dir, name), buf); }
    catch (e) { return json(res, 200, { ok: false, reason: '服务器保存失败' }); }
    const c = who.team.card[who.row] || (who.team.card[who.row] = { t: '', img: '' });
    c.img = '/uploads/' + name;
    audit(who.team.name + '·' + who.member + ' 截图直传到【' + who.row + '】');
    broadcast();
    return json(res, 200, { ok: true, team: who.team.name, member: who.member, role: who.role, row: who.row });
  }

  if (pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('event: hello\ndata: {}\n\n');
    sseClients.add(res);
    state.connected = sseClients.size;
    res.write('event: state\ndata: ' + wireState() + '\n\n');
    broadcast();   // 让大屏的"N 终端在线"立刻变
    req.on('close', () => { sseClients.delete(res); state.connected = sseClients.size; broadcast(); });
    return;
  }

  if (pathname === '/api/questions') {
    return json(res, 200, { questions: PUBLIC_QUESTIONS });
  }
  if (pathname === '/api/health') return json(res, 200, { ok: true, port: PORT });

  // ---------- 静态 ----------
  let fp = pathname === '/' ? '/index.html' : pathname;
  let file = path.normalize(path.join(PUB_DIR, fp));
  if (!file.startsWith(PUB_DIR)) return json(res, 403, { error: 'forbidden' });
  const ext = path.extname(file);
  const type = MIME[ext] || 'application/octet-stream';

  // 视频用流式 + Range：不要整个读进内存，也让浏览器能拖进度
  if (/^video\//.test(type)) {
    return fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 Not Found');
      }
      const tag = etagOf(st);
      // 没带 Range 且文件没变 → 304，浏览器用本地缓存，公网上省掉整段重传
      if (!req.headers.range && req.headers['if-none-match'] === tag) {
        res.writeHead(304, { 'ETag': tag, 'Cache-Control': REVAL });
        return res.end();
      }
      const range = req.headers.range;
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        let start = m[1] === '' ? null : Number(m[1]);
        let end = m[2] === '' ? null : Number(m[2]);
        if (start === null) { start = Math.max(0, st.size - (end || 0)); end = st.size - 1; }   // bytes=-N 取末尾 N 字节
        if (end === null || end >= st.size) end = st.size - 1;
        if (!(start >= 0 && start <= end)) {
          res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
          return res.end();
        }
        res.writeHead(206, {
          'Content-Type': type, 'Content-Length': end - start + 1,
          'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes',
          'ETag': tag, 'Cache-Control': REVAL,
        });
        return fs.createReadStream(file, { start, end }).on('error', () => res.end()).pipe(res);
      }
      res.writeHead(200, {
        'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes',
        'ETag': tag, 'Cache-Control': REVAL,
      });
      fs.createReadStream(file).on('error', () => res.end()).pipe(res);
    });
  }

  // 图片/字体走 ETag：内容没变就回 304（几十字节），不用把几十张 emoji 和背景图重下一遍
  if (/^(image|font)\//.test(type)) {
    return fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('404 Not Found');
      }
      const tag = etagOf(st);
      if (req.headers['if-none-match'] === tag) {
        res.writeHead(304, { 'ETag': tag, 'Cache-Control': REVAL });
        return res.end();
      }
      res.writeHead(200, {
        'Content-Type': type, 'Content-Length': st.size,
        'ETag': tag, 'Cache-Control': REVAL,
      });
      fs.createReadStream(file).on('error', () => res.end()).pipe(res);
    });
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    const head = { 'Content-Type': type };
    // 改完代码后学生机刷新一下就该拿到新版，别被浏览器缓存住
    if (ext === '.html' || ext === '.js' || ext === '.css') head['Cache-Control'] = 'no-cache';
    res.writeHead(200, head);
    res.end(buf);
  });
});

// SSE 心跳：15 秒一条注释行，防止空闲连接被浏览器/代理掐断（截图工具 20 秒读不到数据也会重连）
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(': ping\n\n'); } catch { sseClients.delete(res); }
  }
}, 15000);

server.listen(PORT, () => {
  console.log('✅ 课堂工具已启动:  http://localhost:' + PORT);
  console.log('   学生端:  ' + `http://localhost:${PORT}?mode=student`);
  console.log('   教师端:  ' + `http://localhost:${PORT}?mode=teacher`);
  console.log('   大屏PPT: ' + `http://localhost:${PORT}?mode=ppt`);
  console.log('   (智能体默认离线演示；配置 config.json 或环境变量后启用真实大模型)');
});

/* 上课期间宁可带伤跑，也不要静默退出：单个请求出错不该让全班断线。 */
process.on('uncaughtException', (e) => { console.error('[uncaughtException]', (e && e.stack) || e); });
process.on('unhandledRejection', (e) => { console.error('[unhandledRejection]', (e && e.stack) || e); });

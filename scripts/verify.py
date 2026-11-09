# -*- coding: utf-8 -*-
"""verify.py —— 检查一门课的内容是否完整、能不能上课

用法：
    python verify.py <课程目录>
    python verify.py <课程目录> --smoke http://127.0.0.1:5174

退出码 0 = 通过（可能有警告）；1 = 有错误；2 = 跑不起来
"""
import io, json, os, re, subprocess, sys, urllib.request

ACTS = {None, 'quiz', 'mindmap', 'claim', 'pick', 'useAgent', 'platform', 'itinerary', 'report', 'reflect'}
ERR, WARN, INFO = [], [], []


def say(kind, msg):
    {'E': ERR, 'W': WARN, 'I': INFO}[kind].append(msg)


def find_node():
    for c in [os.environ.get('NODE_BIN'), 'node']:
        if c and os.path.exists(c):
            return c
    from shutil import which
    n = which('node')
    if n:
        return n
    guess = os.path.expanduser('~/.workbuddy/binaries/node/versions')
    if os.path.isdir(guess):
        for v in sorted(os.listdir(guess), reverse=True):
            p = os.path.join(guess, v, 'node.exe')
            if os.path.exists(p):
                return p
    return None


def load(course_dir, node):
    script = (
        "let c=null,a={};"
        "try{c=require('./public/course.js')}catch(e){console.error('LOAD_FAIL:'+e.message);process.exit(2)}"
        "try{a=require('./answers.js')}catch(e){}"
        "process.stdout.write(JSON.stringify({course:c,answers:a}))"
    )
    r = subprocess.run([node, '-e', script], cwd=course_dir,
                       capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode != 0:
        print('✗ course.js 加载失败：')
        print((r.stderr or '').strip()[:800])
        sys.exit(2)
    return json.loads(r.stdout)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    course_dir = os.path.abspath(sys.argv[1])
    smoke = None
    if '--smoke' in sys.argv:
        smoke = sys.argv[sys.argv.index('--smoke') + 1]

    node = find_node()
    if not node:
        print('✗ 找不到 node，无法校验 course.js')
        return 2

    data = load(course_dir, node)
    C, A = data['course'], data.get('answers') or {}
    pub = os.path.join(course_dir, 'public')

    # ---------- meta ----------
    meta = C.get('meta') or {}
    for k in ('title', 'brand', 'origin', 'duration'):
        v = meta.get(k)
        if not v or str(v).startswith('TODO'):
            say('E', 'meta.%s 没填' % k)
    for k in ('grade', 'subject'):
        if not meta.get(k) or str(meta.get(k)).startswith('TODO'):
            say('W', 'meta.%s 没填 —— AI 的人设语气会不准' % k)

    # ---------- teams ----------
    teams = C.get('teams') or []
    if len(teams) < 2:
        say('E', 'teams 少于 2 组，做不了分组教学')
    if not any(t.get('demo') for t in teams):
        say('W', '没有 demo:true 的教师组，老师试讲时没法全功能体验')
    for t in teams:
        for k in ('name', 'color', 'dest'):
            if not t.get(k):
                say('E', '组「%s」缺 %s' % (t.get('name', '?'), k))
        if str(t.get('dest', '')).startswith('TODO'):
            say('E', '组「%s」的 dest 还是 TODO' % t.get('name', '?'))

    # ---------- roles ----------
    roles = C.get('roles') or []
    if not roles:
        say('E', 'roles 为空')
    card_rows = [r.get('key') for r in (C.get('cardRows') or [])]
    scope_names = []
    for r in roles:
        nm = r.get('name') or '?'
        if str(nm).startswith(('TODO', '岗位')):
            say('W', '岗位「%s」看起来还是骨架里的占位名' % nm)
        if not r.get('cardRow'):
            say('E', '岗位「%s」缺 cardRow' % nm)
        elif r['cardRow'] not in card_rows:
            say('E', '岗位「%s」的 cardRow「%s」不在 cardRows 里' % (nm, r['cardRow']))
        sc = r.get('scope') or {}
        if not sc.get('name'):
            say('E', '岗位「%s」缺 scope.name' % nm)
        else:
            scope_names.append(sc['name'])
            if sc['name'] not in nm:
                say('E', 'scope.name「%s」不是岗位名「%s」的连续子串 —— AI 认不出这个岗位' % (sc['name'], nm))
        if not sc.get('kw'):
            say('W', '岗位「%s」的 scope.kw 是空的 —— 串岗句子不会被过滤' % nm)
        cards = r.get('cards') or {}
        for k in ('role', 'goal', 'know', 'rules', 'bad'):
            if not cards.get(k):
                say('E', '岗位「%s」四张卡缺 %s' % (nm, k))
        if len(r.get('subProblems') or []) < 2:
            say('W', '岗位「%s」子问题少于 2 条，pick 页会太空' % nm)

    for row in card_rows:
        if row not in [r.get('cardRow') for r in roles]:
            say('E', '行程卡行「%s」没有岗位认领，这一行永远填不了' % row)

    # ---------- mindMap ----------
    mm = C.get('mindMap') or []
    if not mm:
        say('W', 'mindMap 为空，动手分解页会没有分支')
    if len(mm) not in (3, 4, 5):
        say('W', 'mindMap 有 %d 条主分支（样式按 4 列排版，3~5 条最稳）' % len(mm))
    for b in mm:
        if b.get('key') not in scope_names:
            say('W', '导图分支「%s」没有同名 scope.name，拖拽归类可能对不上' % b.get('key'))
        if not (b.get('subs') or []):
            say('E', '导图分支「%s」没有小任务' % b.get('key'))

    # ---------- questions / answers ----------
    qs = C.get('questions') or []
    qids = [q.get('id') for q in qs]
    for q in qs:
        if q.get('id') not in A:
            say('E', '题目 %s 在 answers.js 里没有答案' % q.get('id'))
        if not (q.get('options') or []):
            say('E', '题目 %s 没有选项' % q.get('id'))
    for qid in A:
        if qid not in qids:
            say('W', 'answers.js 里的 %s 在 questions 里不存在' % qid)

    # ---------- slides ----------
    slides = C.get('slides') or []
    if not slides:
        say('E', 'slides 为空，课上不了')
    total_min = 0
    for i, s in enumerate(slides, 1):
        act = s.get('act')
        if act not in ACTS:
            say('E', '第 %d 页 act=「%s」不是合法类型（见 references/02）' % (i, act))
        total_min += (s.get('min') or 0)
        for q in (s.get('quiz') or []):
            if q not in qids:
                say('E', '第 %d 页引用了不存在的题号 %s' % (i, q))
        if not s.get('students'):
            say('W', '第 %d 页没有学生端提示语' % i)
        img = s.get('img')
        if img:
            if not os.path.exists(os.path.join(pub, 'ppt-images', img)):
                say('W', '第 %d 页配图缺失：ppt-images/%s（会显示占位框）' % (i, img))
        for v in (s.get('videos') or []):
            p = os.path.join(pub, v.lstrip('/').replace('/', os.sep))
            if not os.path.exists(p):
                say('W', '第 %d 页视频缺失：%s（会回落成静态图）' % (i, v))

    if total_min:
        say('I', '共 %d 页，建议时长合计 %d 分钟' % (len(slides), total_min))
    else:
        say('W', '所有页的 min 都是 0，没法核对课时')

    # ---------- 安全 / 结构 ----------
    if os.path.exists(os.path.join(pub, 'answers.js')):
        say('E', 'answers.js 出现在 public/ 里 —— 学生能直接下载答案，必须移到项目根')
    if os.path.exists(os.path.join(course_dir, 'config.json')):
        say('I', 'config.json 存在（含 API key，发布前确认不要打进压缩包）')

    # ---------- 前后端 action 对齐 ----------
    srv = io.open(os.path.join(course_dir, 'server.js'), encoding='utf-8', errors='replace').read()
    app = io.open(os.path.join(pub, 'app.js'), encoding='utf-8', errors='replace').read()
    srv_set = set(re.findall(r"case '([a-zA-Z]+)':", srv))
    app_set = set(re.findall(r"Net\.send\('([a-zA-Z]+)'", app))
    only_srv = srv_set - app_set
    only_app = app_set - srv_set
    if only_srv:
        say('W', '服务端有但客户端不发的 action（可能是死代码）：%s' % ', '.join(sorted(only_srv)))
    if only_app:
        say('E', '客户端发了服务端没有的 action（会 500）：%s' % ', '.join(sorted(only_app)))
    say('I', 'action 对齐：服务端 %d 个，客户端 %d 个' % (len(srv_set), len(app_set)))

    # ---------- 冒烟 ----------
    if smoke:
        try:
            smoke_test(smoke, teams)
        except Exception as e:
            say('E', '冒烟失败：%s' % e)

    # ---------- 输出 ----------
    for m in INFO:
        print('  ·  ' + m)
    for m in WARN:
        print('  !  ' + m)
    for m in ERR:
        print('  ✗  ' + m)
    print()
    if ERR:
        print('不通过：%d 个错误，%d 个警告' % (len(ERR), len(WARN)))
        return 1
    print('通过：%d 个警告' % len(WARN))
    return 0


def post(base, action, payload):
    req = urllib.request.Request(base.rstrip('/') + '/api/state',
                                 data=json.dumps({'action': action, 'payload': payload}).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=8) as r:
        return json.loads(r.read().decode('utf-8'))


def smoke_test(base, teams):
    with urllib.request.urlopen(base.rstrip('/') + '/api/health', timeout=5) as r:
        h = json.loads(r.read().decode('utf-8'))
    if not h.get('ok'):
        raise RuntimeError('health 不是 ok')
    q = json.loads(urllib.request.urlopen(base.rstrip('/') + '/api/questions', timeout=5).read().decode('utf-8'))
    if any('answer' in x for x in q.get('questions', [])):
        raise RuntimeError('/api/questions 泄露了答案')
    real = [t for t in teams if not t.get('demo')]
    if not real:
        raise RuntimeError('没有学生组可测')
    tid = 'T1'
    post(base, 'joinTeam', {'teamId': tid, 'member': '冒烟测试'})
    post(base, 'claimRole', {'teamId': tid, 'member': '冒烟测试', 'role': '测试'})
    r = post(base, 'submitQuiz', {'teamId': tid, 'member': '冒烟测试', 'qid': 'q1', 'chosen': 0})
    if r.get('result') is None:
        raise RuntimeError('submitQuiz 没有返回判分结果')
    post(base, 'setSlide', {'slide': 0})


if __name__ == '__main__':
    sys.exit(main())

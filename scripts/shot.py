# -*- coding: utf-8 -*-
"""shot.py —— 逐页截 1366×768 大屏图，人工过一遍版式

用法：
    python shot.py --port 5174 --dir D:/课程/我的新课 --out D:/课程/shots
    python shot.py --port 5174 --pages 0,4,9        # 只截指定页下标

前置：服务已经起来了（node server.js）。脚本会先探 /api/health。
"""
import json, os, subprocess, sys, tempfile, urllib.request

EDGE_CANDIDATES = [
    os.environ.get('EDGE_BIN'),
    r'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    r'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    r'C:/Program Files/Google/Chrome/Application/chrome.exe',
]


def find_browser():
    for p in EDGE_CANDIDATES:
        if p and os.path.exists(p):
            return p
    return None


def find_node():
    from shutil import which
    n = which('node')
    if n:
        return n
    g = os.path.expanduser('~/.workbuddy/binaries/node/versions')
    if os.path.isdir(g):
        for v in sorted(os.listdir(g), reverse=True):
            p = os.path.join(g, v, 'node.exe')
            if os.path.exists(p):
                return p
    return None


def slide_count(course_dir):
    node = find_node()
    if not node or not course_dir:
        return None
    script = "const C=require('./public/course.js');process.stdout.write(String(C.slides.length))"
    try:
        r = subprocess.run([node, '-e', script], cwd=course_dir, capture_output=True, text=True, timeout=20)
        return int(r.stdout.strip())
    except Exception:
        return None


def main():
    args = sys.argv[1:]

    def opt(name, default=None):
        return args[args.index(name) + 1] if name in args else default

    port = opt('--port', '5174')
    out = os.path.abspath(opt('--out', './shots'))
    course = opt('--dir')
    base = 'http://127.0.0.1:%s' % port

    browser = find_browser()
    if not browser:
        print('找不到 Edge / Chrome。设置环境变量 EDGE_BIN 指向浏览器可执行文件。')
        return 2

    try:
        with urllib.request.urlopen(base + '/api/health', timeout=5) as r:
            if not json.loads(r.read().decode()).get('ok'):
                raise ValueError
    except Exception:
        print('服务没起来：%s' % base)
        print('先在课程目录里跑  node server.js')
        return 2

    total = slide_count(course)
    if '--pages' in args:
        pages = [int(x) for x in opt('--pages').split(',') if x.strip()]
    elif total:
        pages = list(range(total))
    else:
        print('不知道有多少页：传 --dir <课程目录> 或 --pages 0,1,2')
        return 2

    os.makedirs(out, exist_ok=True)
    ok, bad = 0, []
    for i in pages:
        try:
            req = urllib.request.Request(base + '/api/state',
                                         data=json.dumps({'action': 'setSlide', 'payload': {'slide': i}}).encode(),
                                         headers={'Content-Type': 'application/json'})
            urllib.request.urlopen(req, timeout=8).read()
        except Exception as e:
            print('  第 %d 页切页失败：%s' % (i + 1, e))
            bad.append(i)
            continue

        png = os.path.join(out, 'p%02d.png' % (i + 1))
        ud = tempfile.mkdtemp(prefix='shot_ud_')
        cmd = [browser, '--headless=new', '--disable-gpu', '--hide-scrollbars',
               '--window-size=1366,768', '--user-data-dir=' + ud,
               '--screenshot=' + png,
               '%s/?mode=ppt&cb=%d' % (base, i)]
        try:
            subprocess.run(cmd, timeout=60, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            pass
        size = os.path.getsize(png) if os.path.exists(png) else 0
        if size > 0:
            ok += 1
            print('  ✓ 第 %2d 页  %s  (%d KB)' % (i + 1, os.path.basename(png), size // 1024))
        else:
            bad.append(i)
            print('  ✗ 第 %2d 页  没出图' % (i + 1))

    print()
    print('出图 %d/%d，目录：%s' % (ok, len(pages), out))
    if bad:
        print('失败页：%s' % ', '.join(str(i + 1) for i in bad))
        print('常见原因：浏览器路径没找对、user-data-dir 被占、页面还在渲染就截了。')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

# -*- coding: utf-8 -*-
"""new_course.py —— 用这套引擎起一门新课

用法：
    python new_course.py D:/课程/我的新课
    python new_course.py D:/课程/我的新课 --force     # 目录非空也照建（不覆盖已存在的文件）

做完的事：
    1. 复制引擎（server.js / app.js / style.css / index.html / platform.*）
    2. 生成空骨架 public/course.js（全部标了 TODO）
    3. 生成 answers.js
    4. 建 ppt-images / videos / uploads 三个空目录
    5. 打印接下来该做什么
"""
import io, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(os.path.dirname(HERE), 'assets')

ENGINE_ROOT = ['server.js', 'start_server.bat', 'config.example.json']
ENGINE_PUB = ['app.js', 'style.css', 'index.html', 'platform.html', 'platform-data.js']
EMPTY_DIRS = ['public/ppt-images', 'public/videos', 'public/uploads']

ANSWERS = """/* answers.js —— 题库答案（只给服务端判分用，放在 public 外，学生端取不到）
   值是正确选项的下标。course.js 里只有题面。 */
module.exports = {
  q1: 0
};
"""


def copy_engine(dst):
    for f in ENGINE_ROOT:
        s = os.path.join(ASSETS, f)
        if os.path.exists(s) and not os.path.exists(os.path.join(dst, f)):
            shutil.copy2(s, os.path.join(dst, f))
    for f in ENGINE_PUB:
        s = os.path.join(ASSETS, 'public', f)
        d = os.path.join(dst, 'public', f)
        if os.path.exists(s) and not os.path.exists(d):
            shutil.copy2(s, d)


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    dst = os.path.abspath(sys.argv[1])
    force = '--force' in sys.argv
    if os.path.isdir(dst) and os.listdir(dst) and not force:
        print('目录已存在且非空：%s' % dst)
        print('换一个目录，或加 --force（已存在的文件不会被覆盖）')
        return 1

    os.makedirs(os.path.join(dst, 'public'), exist_ok=True)
    for d in EMPTY_DIRS:
        os.makedirs(os.path.join(dst, d.replace('/', os.sep)), exist_ok=True)

    copy_engine(dst)

    course = os.path.join(dst, 'public', 'course.js')
    if not os.path.exists(course):
        shutil.copy2(os.path.join(ASSETS, 'course.skeleton.js'), course)

    ans = os.path.join(dst, 'answers.js')
    if not os.path.exists(ans):
        io.open(ans, 'w', encoding='utf-8', newline='\n').write(ANSWERS)

    print('已建好：%s' % dst)
    print()
    print('接下来：')
    print('  1. 编辑 public/course.js，把 7 处 TODO 换成你这节课的内容')
    print('     （字段说明见 references/01-内容清单.md，页面类型见 02）')
    print('  2. 把配图丢进 public/ppt-images/，名字对上 slides[].img')
    print('  3. 有视频就丢进 public/videos/，路径写成 /videos/xxx.mp4')
    print('  4. 检查：python scripts/verify.py "%s"' % dst)
    print('  5. 起服务：双击 start_server.bat，或 node server.js')
    print('     大屏 /?mode=ppt   学生端 /?mode=student')
    print()
    print('想看图一节课长什么样，可以直接翻 assets/public/course.js（黄河课完整样例）。')
    return 0


if __name__ == '__main__':
    sys.exit(main())

---
name: pbl-classroom
description: 产出「老师翻页驱动」的项目式学习课堂系统（一个 Node 服务器 + 一份 course.js 内容 + 学生端/大屏端同源）：老师在大屏上翻页就是推进课堂，学生端自动跟到同一页，分组认领岗位、填思维导图、向岗位 AI 助手提问、用课前录好的离线数据核实、填小组行程卡、互评打分，服务端实时汇总回流到当前页。当用户说「做一节项目式学习的课」「老师讲、学生跟着做」「分组分岗位完成一个任务」「学生端要能跟着我的 PPT 走」「要有 AI 助手但只能在岗位范围内答」时使用。不适用于：学生自主闯关、教师只看进度（走 dual-end-classroom）、单文件投屏互动课件（走 interactive-lesson-deck）、只要教案文字（走 classroom-lesson-pack）。
agent_created: true
---

# 项目式课堂（翻页驱动 · 分组岗位 · 岗位 AI）

一节课 = 一个服务器 + 一份 `course.js`。老师翻页，学生跟页，数据回流。

**核心承诺：换一门课只改 `course.js` 和 `answers.js`，`server.js` / `app.js` 一行不动。**
这条一旦破掉，第二节课就会分叉成两份 5000 行的代码，第三节课就没人敢改了。

## 何时用 / 不用

| 用 | 不用 |
|---|---|
| 「老师在大屏上讲，学生用电脑跟着做同一个任务」 | 学生自主闯关、老师只看进度看板 → `dual-end-classroom` |
| 「分 4 个岗位，每人管一块，最后拼起来」 | 一台电脑投屏、学生上台点 → `interactive-lesson-deck` |
| 「学生问 AI，但 AI 只能答他岗位那点事」 | 只要教案/学案文字 → `classroom-lesson-pack` |
| 「要能分组计分、互评、出徽章」 | 课后问卷/测验评分 → `quickform-score-dashboard` |

和 `dual-end-classroom` 最容易混，差别只有一句：
**那个是「编译期裁出教师端/学生端两份 HTML」，这个是「运行时按 `?mode=` 分支，服务端持唯一权威 state」。**
前者适合学生自学闯关，后者适合老师主导讲授——**别把两套混在一个项目里**。

## 三个硬前提

1. **内容与引擎分离。** 任何课程专有名词（地名、岗位名、组名、页数、日期）只许出现在 `course.js`。
   引擎里出现一个，就等于给下一次改课埋一颗雷。
2. **页面是老师的时间轴。** `slides` 数组的顺序 = 课堂流程顺序，每页带建议时长。
   老师按方向键翻页 → `setSlide` → 广播 → 所有学生端跟随。**不要做「学生自己翻」的入口。**
3. **1366×768 起步。** 机房最低分辨率，大屏和学生端都要在这个尺寸下不塌。

## 工作流

### 第 1 步 · 起骨架

```bash
python <技能目录>/scripts/new_course.py D:/课程/我的新课
```

生成的目录：

```
我的新课/
├── server.js            ← 引擎，不动
├── answers.js           ← 题库答案（改）
├── config.example.json  ← 复制成 config.json 填 AI key（可选，不填也能上课）
├── start_server.bat     ← 双击起服务
└── public/
    ├── index.html       ← 引擎，不动
    ├── app.js           ← 引擎，不动
    ├── style.css        ← 引擎，主题色可调
    ├── course.js        ← 内容，改这个（唯一）
    ├── platform.html    ← 可选：离线数据核实页
    ├── platform-data.js ← 可选：课前查好的真实数据
    ├── ppt-images/      ← 配图放这里
    └── videos/          ← 视频放这里
```

`node server.js` → 开 `http://127.0.0.1:5174/?mode=ppt`（大屏）、`/?mode=student`（学生端）。

想先看看"一节课长什么样"，翻 `assets/public/course.js`——那是一节完整可上的黄河课（16 页 / 37 分钟）。
`assets/course.skeleton.js` 才是新建用的空骨架。

### 第 2 步 · 写内容（唯一的重活）

打开 `course.js`，按 `references/01-内容清单.md` 逐段填。顺序建议：

1. `meta` —— 课名、品牌、出发地、时长、出行日期、年级学科
2. `teams` —— 几个组、每组颜色、每组目的地城市（`demo:true` 是教师组）
3. `roles` —— 几个岗位、每个岗位的四张卡、AI 硬约束 `scope`、子问题
4. `mindMap` —— 主分支 + 每支下的小任务
5. `cardRows` —— 最终成果卡有几行、图标、提示
6. `questions` + `answers.js` —— 题目与答案（**答案必须放 answers.js，不能进 public**）
7. `slides` —— 一页一行，参考 `references/02-页面类型.md` 选 `act`

**先定页数再写页面。** 一节课 14–18 页、35–40 分钟是舒适区；`min` 字段填建议分钟，加总应与课时对得上。

### 第 3 步 · 认岗位与 AI 范围

`roles[].scope` 是这套东西最值钱的地方（`references/03-AI岗位链路.md` 全文）：

```js
scope: {
  name: '交通',                                    // 用于匹配岗位名 & 过滤
  focus: '怎么从{origin}到{dest}：坐什么车…',       // 支持 {origin}{dest}{duration} 占位
  avoid: '景点、住宿、美食',
  kw: ['高铁','车次','换乘',…]                      // 句子级过滤用
}
```

- **`focus` 里必须写清「只管这一块」**，否则模型会热情地给出完整行程。
- **`kw` 不是装饰**：小模型不听话时，`scopeFilter` 会按它逐句删掉"串岗"的话。
- 没有 `kw` 的岗位不过滤——适合"总协调"这类天然跨块的岗位。

### 第 4 步 · 跑一遍再上课

```bash
# 内容完整性：必填项、act 合法性、资源缺失、答案覆盖、前后端 action 对齐
python <技能目录>/scripts/verify.py D:/课程/我的新课

# 起服务后逐页截图（1366×768），人工过一遍版式
python <技能目录>/scripts/shot.py --port 5174 --dir D:/课程/我的新课 --out D:/课程/shots
```

`verify.py` 会拦下：页数为 0、`act` 拼错、`quiz` 引用了不存在的题号、
`cardRow` 与 `cardRows` 对不上、`scope.name` 不是岗位名的子串（AI 会认不出岗位）、
`slides` 引用的图片/视频不存在、`answers.js` 被误放进 `public/`、客户端发了服务端没有的 action。

`shot.py` 的判据是**文件非 0 字节**，不是命令返回码——headless 浏览器经常 0 退出却没出图。

### 第 5 步 · 交付

打包整个目录 + `一键运行/start_server.bat`（双击起服务、打印两个地址）。
学生机只要浏览器，**不需要装任何 exe**。

## 页面类型速查

| `act` | 学生端做什么 | 大屏显示 |
|---|---|---|
| `null` | 只读图文（可带整页视频 `V()`） | 配图 + 标题 + 实时统计条 |
| `quiz` | 单选即时判分 | 答题进度 |
| `mindmap` | 拖主分支卡 + 拖小任务到分支下 | 进度 n/12 |
| `claim` | 认领岗位（一岗一人，认领后锁定） | 各组分工情况 |
| `pick` | 从混在一起的子问题里挑自己岗位的 | 完成组数 |
| `useAgent` | 四卡填完 → 向岗位 AI 提问 | — |
| `platform` | 点开离线数据页查真实信息 | — |
| `itinerary` | 填小组行程卡（每人只能改自己那行） | 各组填了几行 |
| `report` | 看别组行程卡并打星 | 收到多少条评星 |
| `reflect` | 写一句迁移应用 | — |

## 两处刻意的折叠（改代码时别拆）

学生端不是 1:1 跟页码，有两处合并，否则学生会来回翻：

- `pick` → 学生停在 `claim`（认完岗位，子问题直接出现在下面）
- `itinerary` → 学生停在 `platform`（查一条填一条）

实现在 `app.js` 的 `studentSlide()`。**新加页时若也想合并，在这里加一行，不要去改页码。**

## 交付前必须过的六条

1. 大屏 `?mode=ppt` 和学生端 `?mode=student` 都能开，控制台无报错。
2. 翻到最后一页不越界（页数上界由客户端 `SLIDES.length` 决定，不在服务端写死）。
3. 学生认领岗位后刷新页面，岗位还在（`localStorage` + 服务端 state 双写）。
4. 断网/关掉服务器时，学生端出现「本地演示」提示条而不是白屏。
5. 未配 AI key 时，提问仍返回示例答案（`offlineAnswer` 降级），不能报 500。
6. 1366×768 下大屏标题不换行、学生端表格不横向溢出。

## 踩坑

- **`answers.js` 不能放进 `public/`。** 学生按 F12 就能看到答案。服务端 `require('../answers.js')` 读它。
- **emoji 素材包可选。** `public/emoji/` 有就用图片，没有会自动回落成系统 emoji（`img.onerror` 兜底），不会出现破图。
- **`platform-data.js` 是可选模块。** 不用 `act:'platform'` 的课可以整块删掉，不影响其他页。
- **`scope.name` 必须是岗位名的连续子串。** 「交通规划师」里要有「交通」，否则 AI 认不出这是哪个岗位，退化成通用助手。
- 更多见 `references/05-验收与踩坑.md`。

## 技能包里都有什么

| 路径 | 作用 |
|---|---|
| `assets/course.skeleton.js` | **空骨架**，新建课程用（字段齐全、全标 TODO） |
| `assets/public/course.js` | **黄河课完整样例**（16 页 / 37 分钟，可直接上课，也可当参考书） |
| `assets/answers.js` | 样例的答案（`{q1:0, q3:1}`） |
| `assets/server.js` | 服务端引擎：SSE 广播 + 13 个 action + AI 代理 |
| `assets/public/app.js` | 前端引擎：9 种页面 + student/ppt/local 三模式 |
| `assets/public/style.css` | 主题样式（改配色只动 CSS 变量） |
| `assets/public/platform.html` `platform-data.js` | 离线数据核实模块（可选） |
| `assets/start_server.bat` `config.example.json` | 一键启动 + 配置样例 |
| `references/01-内容清单.md` | `course.js` 逐字段说明 + 改课检查表 |
| `references/02-页面类型.md` | 9 种 `act` 的课堂行为 + 页序设计 |
| `references/03-AI岗位链路.md` | 四层防线：提示词 → 参数 → 句子过滤 → 离线降级 |
| `references/04-实时同步.md` | state 结构 / SSE / 13 action / 身份识别 / 计分表 |
| `references/05-验收与踩坑.md` | 验收五步 + 8 个真实踩坑 + 课前检查 |
| `scripts/new_course.py` | 起一门新课 |
| `scripts/verify.py` | 内容检查（加 `--smoke <url>` 顺带跑行为冒烟） |
| `scripts/shot.py` | 逐页截 1366×768 大屏图 |

## 引擎里已经没有课程内容了

`server.js` 和 `app.js` 里**不含任何地名、岗位名、组名、页数、日期**。
所有内容从 `COURSE`（浏览器）/ `require('./public/course.js')`（服务端）读。

所以：

- 改课 = 改 `course.js` + `answers.js`
- 改引擎（修 bug、加页面类型）= 改 `app.js` / `server.js`，**同时更新本技能包里的 assets**，否则下一个课程又回到旧版
- 别在 `app.js` 里为某门课写 `if (课程名 === …)`——那就破了这条约定

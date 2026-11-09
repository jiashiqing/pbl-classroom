/* =========================================================
   course.js —— 一节课的全部内容（骨架版）
   ---------------------------------------------------------
   这是空模板：所有内容都标了 TODO，按 references/01-内容清单.md 逐段替换即可。
   填完用：python scripts/verify.py <课程目录>
   ---------------------------------------------------------
   双端共用：浏览器 window.COURSE / Node require('./public/course.js')
   做新课时【只改这个文件 + answers.js】，server.js 与 app.js 一行不动。
   ========================================================= */
(function (root, factory) {
  var C = factory();
  if (typeof module === 'object' && module.exports) module.exports = C;
  else root.COURSE = C;
})(typeof self !== 'undefined' ? self : this, function () {

  function S(title, sub, act, quiz, students, tag, min, file, prompt) {
    return { title: title, sub: sub, act: act || null, quiz: quiz || [], students: students, tag: tag, min: min, img: file, prompt: prompt };
  }
  function V(slide, videos, endText, afterVideo) {
    slide.videos = videos; slide.endText = endText || ''; slide.afterVideo = afterVideo || '';
    return slide;
  }

  return {
    /* ---------- TODO 1：课程元信息 ---------- */
    meta: {
      title: 'TODO 课程全名',
      kicker: 'TODO 一句话副标题',
      brand: 'TODO 学生端左上角品牌名',
      brandEmoji: '📘',
      origin: 'TODO 出发地（写全，如「山东省日照市」）',
      duration: 'TODO 时长（如「1 天 1 夜」或「2 课时」）',
      region: 'TODO 省份（如「山东省」）',
      grade: 'TODO 学段（如「小学三年级」）',
      subject: 'TODO 学科（如「信息科技」）',
      mindMapRoot: 'TODO 导图根部文字',
      tripLabel: 'TODO 日期（如「10月1日」；不涉及就留空）',
      tripDates: { d: '', ci: '', co: '' },
      defaultCity: 'TODO 兜底城市'
    },

    /* ---------- TODO 2：分组（至少 2 组；demo:true 是教师组） ---------- */
    teams: [
      { name: '第一组', color: '#f4a259', dest: 'TODO 这组要去/研究的对象', city: 'TODO 城市' },
      { name: '第二组', color: '#4caf7d', dest: 'TODO 这组要去/研究的对象', city: 'TODO 城市' },
      { name: '教师', color: '#8b93a7', dest: 'TODO 同第一组', city: 'TODO 城市', demo: true }
    ],

    /* ---------- TODO 3：岗位（一个岗位 = 一个 AI 助手 = 成果卡的一行） ---------- */
    roles: [
      {
        name: '岗位甲', emoji: '🔧', cardRow: '甲部分', roleWord: '甲',
        platformKind: '',                       // train | sight | hotel | rest，不用平台页就留空
        cards: {
          role: '我是岗位甲助手',
          goal: 'TODO 这个岗位要产出什么',
          know: 'TODO 这个岗位该依据什么知识',
          rules: 'TODO 好规矩：要求给几个方案、说清依据、不确定要说明',
          bad: 'TODO 坏规矩：故意写一个会误导人的（学生要对比两种规矩的效果）'
        },
        scope: {
          name: '甲',                            // 必须是岗位名里的连续子串
          focus: 'TODO 只说这一块：具体管什么（可用 {origin}{dest}{duration} 占位）',
          avoid: 'TODO 其它岗位负责的部分',
          kw: []                                 // 本岗位专属词，用于过滤串岗句子
        },
        subProblems: [
          { id: 'a1', text: 'TODO 岗位甲的子问题 1' },
          { id: 'a2', text: 'TODO 岗位甲的子问题 2' }
        ]
      },
      {
        name: '岗位乙', emoji: '🔩', cardRow: '乙部分', roleWord: '乙',
        platformKind: '',
        cards: {
          role: '我是岗位乙助手',
          goal: 'TODO',
          know: 'TODO',
          rules: 'TODO',
          bad: 'TODO'
        },
        scope: { name: '乙', focus: 'TODO', avoid: 'TODO', kw: [] },
        subProblems: [
          { id: 'b1', text: 'TODO 岗位乙的子问题 1' },
          { id: 'b2', text: 'TODO 岗位乙的子问题 2' }
        ]
      }
    ],

    /* ---------- TODO 4：导图主分支（建议 4 条 × 2 个小任务） ---------- */
    mindMap: [
      { key: '甲', label: '🔧 甲部分', subs: [{ id: 'c1', text: 'TODO 小任务 1' }, { id: 'c2', text: 'TODO 小任务 2' }] },
      { key: '乙', label: '🔩 乙部分', subs: [{ id: 'd1', text: 'TODO 小任务 3' }, { id: 'd2', text: 'TODO 小任务 4' }] }
    ],

    /* ---------- TODO 5：成果卡的行（顺序即显示顺序） ---------- */
    cardRows: [
      { key: '甲部分', icon: '🔧', tip: 'TODO 这一行填什么' },
      { key: '乙部分', icon: '🔩', tip: 'TODO 这一行填什么' }
    ],

    /* ---------- TODO 6：题面（答案写在项目根的 answers.js） ---------- */
    questions: [
      { id: 'q1', slide: 2, type: 'single', title: 'TODO 题干', options: ['正确选项', '干扰项', '干扰项', '干扰项'], points: 2 }
    ],

    /* ---------- TODO 7：页面（按课堂流程排序，min 加总 ≈ 课时） ---------- */
    slides: [
      S('TODO 课程名', 'TODO 副标题', null, [], 'TODO 学生端提示：今天你要做什么', '创设情境', 2, 's01.jpg',
        'TODO 配图提示词，16:9，儿童插画风格'),

      S('TODO 第一个互动页标题', 'TODO 副标题', 'quiz', ['q1'], '先想一想，再选答案。', '活动一', 2, 's02.jpg',
        'TODO 配图提示词'),

      // 更多页面类型见 references/02-页面类型.md：
      //   'mindmap' 动手分解 / 'claim' 认领岗位 / 'pick' 挑子问题
      //   'useAgent' 问 AI / 'platform' 查真实数据 / 'itinerary' 填成果卡
      //   'report' 汇报互评 / 'reflect' 迁移应用

      S('TODO 小结', 'TODO 回顾要点', null, [], 'TODO 学生端提示', '活动二', 2, 's03.jpg',
        'TODO 配图提示词'),

      S('下课', '', null, [], 'TODO 收尾语', '结束', 1, 's04.jpg',
        'TODO 配图提示词')
    ],

    /* ---------- 可选：平台核实（不用 act:'platform' 就整段删掉） ---------- */
    platform: { cityInfo: {}, sight: {} }
  };
});

// 从中文标题生成英文文件名（kebab-case）
//
// 为什么需要它：规范要求文章文件名必须是英文短横线式（目录与命名规范.md），
// 因为文件名会变成 URL 的一部分（/posts/<文件名>），中文会变成百分号编码。
// 而标题是中文 —— 所以需要"翻译"这一步。
//
// 设计立场（见 技术架构.md 5.4）：
//   工具只负责生成**候选**，最终由用户确认。
//   因为规范写明"文件名要能被搜索命中"，而哪几个词是别人会搜的，
//   这个判断只有作者知道。

// 常见技术词的中英对照。
// 不求全 —— 只覆盖出现频率高、翻译后更利于搜索的词。
const WORD_MAP = {
  // 编辑器 / 工具
  编辑器: 'editor',
  命令行: 'command-line',
  终端: 'terminal',
  代码: 'code',
  报错: 'error',
  错误: 'error',
  失败: 'failure',
  卡死: 'hang',
  卡住: 'hang',
  挂起: 'hang',
  假死: 'hang',
  超时: 'timeout',
  崩溃: 'crash',
  闪退: 'crash',
  修复: 'fix',
  解决: 'solution',
  方案: 'solution',
  教程: 'tutorial',
  入门: 'guide',
  笔记: 'notes',
  总结: 'summary',
  记录: 'notes',
  踩坑: 'pitfalls',
  坑: 'pitfall',
  问题: 'issue',
  原因: 'cause',
  排查: 'debugging',
  调试: 'debug',
  定位: 'diagnose',
  验证: 'verify',
  验证成功: 'verified',

  // 概念
  环境: 'environment',
  配置: 'config',
  安装: 'install',
  卸载: 'uninstall',
  升级: 'upgrade',
  迁移: 'migration',
  备份: 'backup',
  恢复: 'restore',
  部署: 'deploy',
  构建: 'build',
  编译: 'compile',
  运行: 'run',
  启动: 'start',
  性能: 'performance',
  优化: 'optimization',
  安全: 'security',
  测试: 'test',
  文档: 'docs',
  网站: 'website',
  博客: 'blog',
  服务器: 'server',
  数据库: 'database',
  网络: 'network',
  协议: 'protocol',
  进程: 'process',
  线程: 'thread',
  内存: 'memory',
  磁盘: 'disk',
  文件: 'file',
  文件夹: 'folder',
  目录: 'directory',
  路径: 'path',
  版本: 'version',
  依赖: 'dependency',
  脚本: 'script',
  函数: 'function',
  变量: 'variable',
  类型: 'type',
  接口: 'interface',
  对象: 'object',
  数组: 'array',
  字符串: 'string',
  数字: 'number',
  循环: 'loop',
  递归: 'recursion',
  排序: 'sort',
  查找: 'search',
  搜索: 'search',
  算法: 'algorithm',
  数据结构: 'data-structure',
  索引: 'index',
  事务: 'transaction',
  查询: 'query',
  缓存: 'cache',
  并发: 'concurrency',
  异步: 'async',
  同步: 'sync',
  请求: 'request',
  响应: 'response',
  域名: 'domain',
  证书: 'certificate',
  加解密: 'encryption',
  编码: 'encoding',
  乱码: 'garbled-text',

  // 语言 / 语法 / 编程概念
  语言: '',
  语法: 'syntax',
  指针: 'pointer',
  引用: 'reference',
  内存管理: 'memory-management',
  内存泄漏: 'memory-leak',
  泄漏: 'leak',
  溢出: 'overflow',
  越界: 'out-of-bounds',
  空指针: 'null-pointer',
  野指针: 'dangling-pointer',
  运算符: 'operator',
  表达式: 'expression',
  语句: 'statement',
  条件: 'condition',
  循环语句: 'loop-statement',
  判断: 'condition',
  继承: 'inheritance',
  多态: 'polymorphism',
  封装: 'encapsulation',
  重载: 'overload',
  重写: 'override',
  泛型: 'generics',
  模板: 'template',
  容器: 'container',
  迭代器: 'iterator',
  回调: 'callback',
  闭包: 'closure',
  作用域: 'scope',
  异常: 'exception',
  捕获: 'catch',
  抛出: 'throw',
  垃圾回收: 'garbage-collection',

  // 算法题（2026-11-01 补：题解类标题里这些词出现频率极高）
  两数之和: 'two-sum',
  三数之和: 'three-sum',
  题解: 'solution',
  题目: 'problem',
  双指针: 'two-pointers',
  二分查找: 'binary-search',
  二分: 'binary-search',
  滑动窗口: 'sliding-window',
  最长: 'longest',
  最短: 'shortest',
  子串: 'substring',
  子数组: 'subarray',
  回文: 'palindrome',
  合并: 'merge',
  矩阵: 'matrix',
  反转: 'reverse',
  括号: 'parentheses',
  排列: 'permutation',
  组合: 'combination',
  背包: 'knapsack',

  // 数据结构术语
  树: 'tree',
  二叉树: 'binary-tree',
  平衡树: 'balanced-tree',
  红黑树: 'red-black-tree',
  堆: 'heap',
  栈: 'stack',
  队列: 'queue',
  链表: 'linked-list',
  哈希: 'hash',
  散列: 'hash',
  图论: 'graph-theory',
  遍历: 'traversal',
  深度优先: 'dfs',
  广度优先: 'bfs',
  动态规划: 'dynamic-programming',
  贪心: 'greedy',
  回溯: 'backtracking',
  分治: 'divide-and-conquer',
  复杂度: 'complexity',
  时间复杂度: 'time-complexity',
  空间复杂度: 'space-complexity',

  // 软件工程 / 需求 / 设计（2026-11-06 补）
  // 起因：整章课程笔记批量入库，标题是「第5章 设计概念」这类，词表一个都没命中，
  // 六篇全退到 post-<今天>，同一批里名字一模一样。这一块是课程笔记的高频词。
  软件: 'software',
  工程: 'engineering',
  软件工程: 'software-engineering',
  需求: 'requirement',
  需求分析: 'requirement-analysis',
  建模: 'modeling',
  模型: 'model',
  过程: 'process',
  过程模型: 'process-model',
  敏捷: 'agile',
  开发: 'development',
  设计: 'design',
  概念: 'concept',
  体系结构: 'architecture',
  架构: 'architecture',
  构件: 'component',
  组件: 'component',
  模块: 'module',
  质量: 'quality',
  策略: 'strategy',
  分析: 'analysis',
  抽象: 'abstraction',
  信息: 'information',
  隐藏: 'hiding',
  重构: 'refactoring',
  维护: 'maintenance',
  可维护性: 'maintainability',
  可靠性: 'reliability',
  可用性: 'availability',
  缺陷: 'defect',
  评审: 'review',
  度量: 'metrics',
  集成: 'integration',
  用例: 'use-case',
  类图: 'class-diagram',
  分类: 'category',
  系统: 'system',
  应用: 'application',
  项目: 'project',
  风险: 'risk',
  成本: 'cost',
  团队: 'team',
  框架: 'framework',
  界面: 'ui',
  交互: 'interaction',
  用户: 'user',
  面向对象: 'oop',
  类: 'class',
  方法: 'method',
  属性: 'attribute',
  实体: 'entity',
  关系: 'relationship',
  层次: 'layer',
  分层: 'layered',
  复用: 'reuse',

  // 网络 / 系统
  TCP: 'tcp',
  UDP: 'udp',
  HTTP: 'http',
  HTTPS: 'https',
  握手: 'handshake',
  三次握手: 'three-way-handshake',
  四次挥手: 'four-way-handshake',
  报文: 'packet',
  数据包: 'packet',
  抓包: 'packet-capture',
  端口: 'port',
  路由: 'routing',
  子网: 'subnet',
  掩码: 'mask',
  防火墙: 'firewall',
  代理: 'proxy',
  线程池: 'thread-pool',
  死锁: 'deadlock',
  调度: 'scheduling',
  虚拟内存: 'virtual-memory',
  分页: 'paging',
  中断: 'interrupt',
  系统调用: 'system-call',
  内核: 'kernel',
  数据污染: 'data-corruption',

  // 中文里的常见修饰（翻译出来没意义，直接丢）
  一次: '',
  一个: '',
  一种: '',
  关于: '',
  使用: '',
  实现: '',
  进行: '',
  通过: '',
  如何: 'how-to',
  怎么: 'how-to',
  为什么: 'why',
  什么: '',
  我们: '',
  我的: '',
  你的: '',
  这个: '',
  那个: '',
  的: '',
  上: '',
  下: '',
  中: '',
  里: '',
  时: '',
  和: '',
  与: '',
  及: '',
  在: '',
  用: '',
  等: '',
  后: '',
  前: '',
  个: '',
};

// 无意义的尾词
const STOP_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'my']);

// 模型译出来的整句里，这些词对文件名没贡献（2026-11-06 加）
// 例：「Chapter 4 Modelling of needs: landscape, information and category analysis」
//     → 4-modelling-needs-landscape-information-category-analysis
const SENTENCE_FILLER = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'by', 'from', 'at', 'as',
  'into', 'over', 'under', 'about', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'this', 'that', 'these', 'those', 'it', 'its', 's', 'so', 'such', 'very', 'more', 'most',
  // 「第X章」的 chapter：数字已经留下了，chapter 本身是噪音
  'chapter', 'section', 'part',
]);


// 疑问词翻出来的这三个：只在标题里**没有别的实词**时才留着。
// 理由：`数据库索引为什么这么快` → database-index-why 里那个 why 是噪音；
// 但 `为什么 npm install 会卡死` 如果只剩 hang 反而丢了"为什么"这层意思 ——
// 所以规则是"有实词就丢掉疑问词"。
const QUESTION_WORDS = new Set(['why', 'what', 'how-to']);

/**
 * 从标题生成候选文件名
 *
 * 策略：
 *   1. 英文/数字部分：转小写、非字母数字换成短横线
 *   2. 中文部分：先查词表；查不到的按字切分，不硬翻（宁可留拼音也不乱翻）
 *   3. 合并、去重、截断
 *
 * @param {string} title 中文标题
 * @returns {string} 候选文件名（不含 .md）
 */
export function slugify(title) {
  const s = String(title || '').trim();

  // 标题为空 → 直接给个时间戳兜底名（不能返回空串，
  // 否则上层生成文件名时会得到一个空文件名 —— 首次实测踩到过）
  if (s === '') return 'post-' + todayStamp();

  // ---- 1. 抽出中文段，逐段尝试翻译 ----
  // 先按"非中文"切开，得到一串中文段和非中文段
  const parts = [];
  let buffer = '';
  let bufferIsCJK = null;

  const flush = () => {
    if (buffer === '') return;
    parts.push({ text: buffer, cjk: bufferIsCJK });
    buffer = '';
  };

  for (const ch of s) {
    const isCJK = /[\u4e00-\u9fff]/.test(ch);
    if (bufferIsCJK === null || isCJK === bufferIsCJK) {
      buffer += ch;
      bufferIsCJK = isCJK;
    } else {
      flush();
      buffer = ch;
      bufferIsCJK = isCJK;
    }
  }
  flush();

  // ---- 2. 逐段转换 ----
  const words = [];

  for (const part of parts) {
    if (part.cjk) {
      words.push(...translateCJK(part.text));
    } else {
      // 非中文：直接清洗成小写字母数字
      const cleaned = part.text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
      if (cleaned) words.push(...cleaned.split(/\s+/));
    }
  }

  // ---- 3. 清洗结果 ----
  const result = [];
  for (const w of words) {
    if (!w) continue;
    if (STOP_WORDS.has(w)) continue;
    if (result.includes(w)) continue; // 去重
    result.push(w);
  }

  // 疑问词只在"没有别的实词"时才留（见 QUESTION_WORDS 的注释）
  const hasRealWord = result.some((w) => !QUESTION_WORDS.has(w));
  const finalWords = hasRealWord ? result.filter((w) => !QUESTION_WORDS.has(w)) : result;

  let slug = finalWords.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  // ---- 4. 兜底 ----
  // 全中文标题、词表一个都没命中 → 结果可能是空的。
  // 另外「只剩数字」也算失败：`1-两数之和.md` 翻出来是 `1`，
  // 这种名字放进 URL 里等于没说，还不如按日期来（2026-11-01 踩到）。
  if (slug === '' || /^[0-9-]+$/.test(slug)) {
    slug = 'post-' + todayStamp();
  }

  // ---- 5. 截断 ----
  // URL 太长不好看。控制在 60 字符内，且在词边界断开。
  if (slug.length > 60) {
    slug = slug.slice(0, 60);
    const lastDash = slug.lastIndexOf('-');
    if (lastDash > 30) slug = slug.slice(0, lastDash);
    slug = slug.replace(/-+$/, '');
  }

  return slug;
}

/**
 * 把一段中文切成关键词
 *
 * 做法：从长到短在词表里找命中（贪心），找不到的字就跳过。
 * 不硬翻的原因：乱翻出来的英文反而降低搜索命中率，不如留原文来得诚实 ——
 * 反正最终要用户确认，界面上会把候选名和标题一起展示。
 */
function translateCJK(text) {
  const out = [];
  let i = 0;

  while (i < text.length) {
    let matched = false;

    // 最多尝试 4 个字的词（我们的词表里最长的就是 4 字，如"数据结构"）
    for (let len = 4; len >= 1; len--) {
      const candidate = text.slice(i, i + len);
      if (candidate.length < len) continue;

      if (WORD_MAP[candidate] !== undefined) {
        const translated = WORD_MAP[candidate];
        if (translated) out.push(translated);
        i += len;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // 词表里没有 → 跳过这个字（宁可少一个词，也不瞎猜）
      i += 1;
    }
  }

  return out;
}

function todayStamp() {
  const d = new Date();
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

/**
 * 翻译前把中文数字章号换成阿拉伯数字
 *
 * 为什么要换：模型看到「第一章」会往罗马数字 I 上翻，
 * 实测「计算机网络第一章 概述」被翻成 "I computer network"，
 * 后面的「概述」整个丢了，slug 变成 `i-computer-network`。
 * 换成「第1章」之后模型给的是 "Chapter 1 Overview"，正常。
 *
 * @param {string} s
 * @returns {string}
 */
function normalizeChapterNumbers(s) {
  const DIGITS = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

  const toNum = (cn) => {
    let total = 0;
    let cur = 0;
    for (const ch of cn) {
      if (ch === '十') {
        total += (cur || 1) * 10;
        cur = 0;
      } else if (ch === '百') {
        total += (cur || 1) * 100;
        cur = 0;
      } else if (DIGITS[ch] !== undefined) {
        cur = DIGITS[ch];
      }
    }
    return total + cur;
  };

  return s.replace(/第([零一二三四五六七八九十百]+)([章节篇讲课部])/g, (m, cn, unit) => {
    const n = toNum(cn);
    return n > 0 ? `第${n}${unit}` : m;
  });
}

/**
 * 把模型译出来的英文句子压成 slug
 *
 * 例：`Chapter 4 Modelling of needs: landscape, information and category analysis`
 *  →  `4-modelling-needs-landscape-information-category-analysis`
 *
 * @param {string} english 模型译文
 * @returns {string} 清洗后的 slug，可能为空串（表示这条译文不能用）
 */
export function slugFromEnglish(english) {
  const s = String(english || '').toLowerCase().trim();
  if (!s) return '';

  const words = s
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const kept = [];
  for (const w of words) {
    if (SENTENCE_FILLER.has(w)) continue;
    // 数字不参与去重：章号「第2-2章」会被拆成 2 和 2，
    // 去重就变成「2-agility-development」，把 -2 吃掉了（2026-11-06 踩到）
    if (kept.includes(w) && !/^\d+$/.test(w)) continue;
    kept.push(w);
  }

  if (kept.length === 0) return '';

  // 疑问词只在没有别的实词时才留（沿用 slugify 的规则）
  const hasRealWord = kept.some((w) => !QUESTION_WORDS.has(w));
  const finalWords = hasRealWord ? kept.filter((w) => !QUESTION_WORDS.has(w)) : kept;

  return finalWords.join('-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

/**
 * 中文标题 → 英文文件名（走本地模型）
 *
 * 和 slugify() 的分工：
 *   - slugify()     同步、纯词表，模型不可用时兜底
 *   - slugifyAsync() 主力，任意中文都能翻
 *
 * 为什么模型的结果还要过一遍清洗和校验：
 *   模型给的是「通顺的英文句子」，不是「文件名」。而且小模型会翻丢内容 ——
 *   实测 int8 量化版把「第6章 体系结构设计」翻成光秃秃一个 "Chapter 6"，
 *   这种直接判为不可用，交回词表兜底，否则文件名会变成 `6`。
 *
 * @param {string} title
 * @returns {Promise<string>}
 */
export async function slugifyAsync(title) {
  const raw = String(title || '').trim();
  if (raw === '') return 'post-' + todayStamp();

  // 「第一章」先换成「第1章」再送进模型，否则会翻成罗马数字 I（见上面的说明）
  const forTranslation = normalizeChapterNumbers(raw);

  let english = '';
  try {
    const { translateOne } = await import('./translate.mjs');
    english = await translateOne(forTranslation);
  } catch {
    english = '';
  }

  const slug = slugFromEnglish(english);

  // 校验：译文比原文短太多说明翻丢了（保留数字段是为了「第4章 …」这类标题）
  const cjkCount = (raw.match(/[\u4e00-\u9fff]/g) || []).length;
  const wordCount = slug ? slug.split('-').filter((w) => !/^\d+$/.test(w)).length : 0;
  const trustworthy = slug !== '' && !/^[0-9-]+$/.test(slug) && !(cjkCount >= 4 && wordCount < 1);

  if (!trustworthy) return slugify(raw);

  // 太长同样截断（和 slugify 保持一致的 60 字符规则）
  if (slug.length > 60) {
    const cut = slug.slice(0, 60);
    const lastDash = cut.lastIndexOf('-');
    return (lastDash > 30 ? cut.slice(0, lastDash) : cut).replace(/-+$/, '');
  }

  return slug;
}

/**
 * 检查文件名是否合法
 *
 * 规范（目录与命名规范.md 第三节）：全小写、短横线连接、不用中文。
 */
export function validateSlug(slug) {
  const s = String(slug || '').trim();

  if (s === '') return { ok: false, reason: '文件名不能为空' };

  if (/[\u4e00-\u9fff]/.test(s)) {
    return { ok: false, reason: '文件名不能用中文（会变成百分号编码，很难看也很难分享）' };
  }

  if (/[A-Z]/.test(s)) {
    return { ok: false, reason: '文件名必须全小写（Windows 能跑但 Linux 服务器会报错）' };
  }

  if (/[^a-z0-9-]/.test(s)) {
    return { ok: false, reason: '文件名只能用英文字母、数字和短横线 -' };
  }

  if (s.startsWith('-') || s.endsWith('-')) {
    return { ok: false, reason: '文件名不能以短横线开头或结尾' };
  }

  if (s.includes('--')) {
    return { ok: false, reason: '文件名里不要连续两个短横线' };
  }

  if (s.length > 80) {
    return { ok: false, reason: '文件名太长了（建议 60 字符以内）' };
  }

  return { ok: true };
}

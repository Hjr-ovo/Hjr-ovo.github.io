# 博客 UI 风格规范（可复制的设计模板）

> 用途：把这份文档交给任何 AI / 设计师，它就能还原出与本博客一致的界面风格。
> 技术栈背景：Astro 静态博客，纯手写 CSS（无 Tailwind / 无 UI 框架），样式集中在
> `src/styles/global.css`，全站外框在 `src/layouts/BaseLayout.astro`，固定文案/数据在
> `src/consts.ts`。颜色**全部走 CSS 变量**，深色模式只覆盖变量、不改任何具体规则。

---

## 1. 设计哲学（三个硬原则）

1. **朴素优先，先保证"读得下去"**：不炫技，把字距、行高、对比度做舒服。
2. **技术内容的三块硬骨头必须好看**：代码块、表格、引用块是技术站门面。
3. **亮色为默认，深色为同源衍生**：深色不是另一套设计，只是把同一组变量换一组值。
   所以**任何新增样式都禁止写死颜色**——写死一个 `#f1efe8`，深色下就是一块白斑。

整体气质：米白纸感 + 墨绿点缀，像一份排版考究的纸质技术手册，安静、克制、专业。

---

## 2. 设计令牌（Design Tokens）

### 2.1 颜色变量（`:root` 亮色 / `[data-theme='dark']` 深色）

| 变量 | 亮色值 | 深色值 | 用途 |
|---|---|---|---|
| `--ink` | `#2c2c2a` | `#e7e5de` | 正文主文字（暖调近黑 / 暖调近白） |
| `--muted` | `#6b6a65` | `#9c9a92` | 次要文字：摘要、日期、页脚 |
| `--line` | `#e2e0d8` | `#2f322c` | 描边、分隔线、边框 |
| `--bg` | `#fdfcf9` | `#171917` | 页面底色（米白 / 暖调深灰，非纯白非纯黑） |
| `--bg-card` | `#ffffff` | `#1e211e` | 卡片 / 输入框底色 |
| `--accent` | `#0f6e56` | `#6ed3ad` | 品牌强调色：链接、标签底、圆点、悬停态（墨绿；深色须提亮才看得见） |
| `--accent-soft` | `#e1f5ee` | `#1c3a31` | 强调色的浅底：标签胶囊底、聚焦光环、引用左边条 |
| `--code-bg` | `#f4f3ee` | `#21241f` | 代码块 / 行内代码底色 |
| `--mark-bg` | `#f9edbf` | `#4a3f18` | 正文 `<mark>` 高亮底色（浏览器默认纯黄在深色下是白斑，必须自定） |
| `--line-strong` | `#bcd9cd` | `#3c5a4e` | 卡片 / 输入框 hover 描边 |
| `--chip-bg` | `#f1efe8` | `#262a25` | 灰色次要胶囊底（如分类名） |
| `--table-head-bg` | `#f7f6f1` | `#1d201c` | 表头底色 |
| `--placeholder` | `#a5a39c` | `#74746c` | 输入框占位符 |
| `--shadow-card` | `0 1px 2px rgba(44,44,42,.04), 0 4px 12px rgba(44,44,42,.035)` | `0 1px 2px rgba(0,0,0,.45), 0 4px 12px rgba(0,0,0,.3)` | 卡片静态投影（双层：近细远散） |
| `--shadow-card-hover` | `0 2px 4px rgba(44,44,42,.05), 0 8px 20px rgba(15,110,86,.08)` | `0 2px 6px rgba(0,0,0,.5), 0 10px 24px rgba(0,0,0,.35)` | 卡片悬停投影（带一点绿调） |

派生色（深色下必须跟着变，因此同样提成变量）：`--line-strong` / `--chip-bg` / `--table-head-bg` / `--placeholder` / 两个阴影变量。

### 2.2 字体

```css
--font-sans: system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace;
```

- 正文 `font-size: 16px`，`line-height: 1.75`（中文长文阅读舒适线）。
- 等宽字体只用于代码。
- 数字用 `font-variant-numeric: tabular-nums`（日期、统计数对齐）。

### 2.3 布局尺度

- 内容最大宽度 `--maxw: 46rem`（约 736px，适合中文单栏阅读）。
- 居中容器 `.wrap`：`max-width: var(--maxw); margin: 0 auto; padding: 0 1.25rem;`
- 圆角统一档位：胶囊 `999px`、卡片 / 输入框 `10px`、代码块 `8px`、小元素 `4-6px`。
- 间距节奏：卡片间距 `1rem`、区块间距 `2-3.5rem`、页头下边距 `3rem`、页脚上边距 `4rem`。

### 2.4 阴影哲学

卡片"浮起"靠**描边 + 投影双保险**：描边负责在浅色屏勾边界，投影负责给厚度。
只用投影的话，护眼模式下会糊成一片灰。

---

## 3. 深色模式机制（关键，别的 AI 容易踩坑）

- 触发：`<html data-theme="dark">`，由 `BaseLayout.astro` 的 **`is:inline` 内联脚本**在首屏绘制前设好
  （普通 `<script>` 会被 Astro 打包成模块延后执行 → 会先闪白底再变深）。
  判定顺序：`localStorage.theme` 手动选过听用户的 → 否则跟 `prefers-color-scheme`。
- 切换按钮：两颗 SVG 图标（月亮 / 太阳）都留在 DOM，用 CSS 按 `data-theme` 显示其一，切换主题不动 DOM。
- 强调色在深色必须提亮（`#0f6e56` → `#6ed3ad`），否则深底上看不见。
- 代码高亮（Shiki 双主题）用 `!important` 覆盖内联样式：
  `[data-theme='dark'] .astro-code, [data-theme='dark'] .astro-code span { color: var(--shiki-dark) !important; ... }`
- `<meta name="color-scheme" content="light dark">` 让原生控件（滚动条等）也跟随。

---

## 4. 组件样式清单（给别的 AI 逐一对照）

### 4.1 页头（Header）
- 底部 `1px solid var(--line)` 分隔，内边距 `1.25rem 0`，下边距 `3rem`。
- 左侧：头像（36px 圆形，`object-fit: cover`，`1px` 描边）+ 站名，整体是一个链到首页的 `<a>`。
- 右侧：导航 `全部文章 / 分类 / 标签 / 搜索 / 关于` + 深色切换按钮。导航 `gap: 1.25rem`，字号 `0.9rem`，
  链接默认 `--muted`，悬停变 `--accent`。
- 窄屏 `flex-wrap: wrap`，导航自动折到第二行（不强行压缩）。

### 4.2 文章列表卡片（`.post-item`）
- 白底卡片浮在米色页面上：`padding: 1.35rem 1.5rem`，`border: 1px solid var(--line)`，
  `border-radius: 10px`，`box-shadow: var(--shadow-card)`，卡片间 `gap: 1rem`。
- 悬停：`translateY(-2px)` 轻微上浮 + 描边转绿 + **左侧冒出一道 3px 绿条**（`::before` 实现，
  平时 `opacity:0`，hover 变 1，独立动画、不参与盒模型）。
- 标题 `h2`：`font-size: 1.45em`、`font-weight: 600`、`letter-spacing: -0.01em`，默认 `--ink`，hover 变 `--accent`。
- 摘要 `.post-desc`：`--muted`、`0.95rem`。
- 日期/分类小字：`.post-meta` 一行，日期用 `tabular-nums`。

### 4.3 标签胶囊（`.tag`）
- 实心底胶囊：`padding: 0 0.55rem`、`border-radius: 999px`、`font-size: 0.78rem`、
  底色 `--accent-soft`、文字 `--accent`。
- 次要灰胶囊加 `.muted` 类：`--chip-bg` 底、`--muted` 文字（用于分类名）。

### 4.4 代码块（技术站命根子）
- 行内 `code`：等宽、`0.88em`、`--code-bg` 底、`0.15em 0.4em` 内边距、`4px` 圆角。
- 块级 `pre`：`--code-bg` 底、`1rem 1.1rem` 内边距、`8px` 圆角、`1px` 描边、`overflow-x: auto`、
  `font-size: 0.88rem`、`line-height: 1.6`。
- ⚠️ `pre code` 必须 `background: none; padding: 0`（否则双层底色）。
- 超宽代码 / 表格 / 行间公式都用自身 `overflow-x: auto`，**靠内部横向滚动防页面级溢出**（不撑破布局）。
- **多语言切换框**（`.code-tabs`）：`1px` 描边 + `8px` 圆角 + `overflow: hidden`，整体底色 `--code-bg`。
  顶部标签栏 `.code-tabs-bar`：`--bg-card` 底、下 `1px` 描边、内边距 `0.35rem 0.45rem`、`gap: 0.2rem`。
  标签 `.code-tabs-tab`：字号 `0.82rem`、内边距 `0.34rem 0.72rem`、`6px` 圆角、`--muted` 文字；
  选中态 = `--accent` 文字 + `--accent-soft` 底 + `font-weight: 500`。面板内 `pre` 去掉边框与圆角。
  脚本接管前用 `.code-tabs:not([data-ready]) .code-tab-panel ~ .code-tab-panel { display: none }`
  只露第一块，避免先全渲染再收起导致高度跳动。
- **代码复制按钮**（`.code-copy`）：绝对定位右上 `0.45rem`，字号 `0.75rem`、`--bg-card` 底、
  `1px` 描边、`6px` 圆角、默认 `opacity: .72`，hover / focus 提到 `1`，复制成功时文字变 `--accent`；
  触屏（`@media (hover: none)`）常显。普通代码块由脚本外包一层 `.code-wrap { position: relative }` 定位。

### 4.5 表格
- `width: 100%`、`border-collapse: collapse`、`display: block; overflow-x: auto`（窄屏可横滚）。
- 单元格 `1px solid var(--line)`、`0.5rem 0.75rem` 内边距；表头 `--table-head-bg` 底、`font-weight: 500`。

### 4.6 引用块
- 左 `3px solid var(--accent-soft)` 竖条 + `--muted` 文字，左右内边距 `0.2em 1.1em`，上下 `1.2em`。

**正文高亮 `<mark>`**（对应 Obsidian 的 `==高亮==`）
- `background: var(--mark-bg)`（亮 `#f9edbf` / 深 `#4a3f18`），`padding: 0.1em 0.2em`，`border-radius: 3px`，
  文字颜色继承正文（不另设）。
- **必须自定底色**：浏览器默认 `<mark>` 是刺眼的纯黄，深色模式下更像一块发光白斑。

### 4.7 数学公式（KaTeX）
- `.katex` 字号压到 `1.05em`（默认 1.21em 偏大突兀）。
- 行间公式 `.katex-display`：`margin: 1.4em 0; overflow-x: auto`（超宽公式横向滚，不撑破）。

### 4.8 文章页两栏布局（正文 + 目录）
- 宽屏（>1200px）：`grid-template-areas: 'head toc' / 'body toc'`，右侧目录栏 `13rem` 宽，
  整体 `width: calc(100% + 14.5rem)` 把目录落在 `.wrap` 右侧留白里，**正文宽度不变**。
- 窄屏（≤1200px）：单栏，顺序 `页头 → 目录 → 正文`；目录不再是隐藏，而是可折叠 `<details>` 面板
  （默认收起，内联脚本按视口定默认态，避免先渲染再收起时闪一下）。
- 目录侧栏宽屏 `position: sticky; top: 2rem`（滚长文也常驻），`max-height: calc(100vh - 4rem)` + 自身滚动。
- 窄屏目录：带边框小盒子，自己画「展开 / 收起」文字（不用浏览器默认三角），展开限高 `55vh`。

**目录条目（和 Obsidian 大纲同一套观感）**
- 收录 **h2 / h3 / h4** 三级（h1 留给页面大标题）。三档缩进分别是 `0.75rem / 1.5rem / 2.25rem`，
  h4 字号 `0.93em` 且允许折两行（长小节名截断就失去区分价值）。
- 行距紧凑：`padding: 0.24rem 0.75rem`、`line-height: 1.5`、`--muted` 文字，
  长标题 `nowrap` + 省略号（h4 例外）。
- **当前章节**：`--accent` 文字 + `font-weight: 500` + 左侧 `2px` 竖条 + 整行 `--accent-soft`
  底块（`border-radius: 0 5px 5px 0`）。只变字色在长目录里不够显眼，底块才让人一眼扫到。
- **跟随滚动**：当前项变化时自动滚到侧栏垂直居中（防抖：状态未变不动；与中心距离小于侧栏高
  30% 不动；侧栏内容没超出可视区时不滚）。

### 4.9 文末「相关文章」
- 正文之后、`1px` 细线隔开；标题小字 + `--muted`（属于补充不是新章节）。
- 竖排列表，每条：标题（`--ink`，hover 变 `--accent`）+ 下方一行元信息（`--muted`，日期·分类）。

### 4.10 关于页
- 身份区：头像（88px）+ 站名 `h1` + tagline（`--muted`）。
- 统计三卡（N 篇文章 / 分类 / 标签）：`flex` 平分，`min-width: 6.5rem`，数字 `--accent` 大字号。
- 「最近在折腾」：自定义小圆点列表（比默认实心圆点轻）。
- 联系：一排**描边**胶囊（区别于标签的实心底），hover 描边转绿。

### 4.11 分类 / 标签总览
- 分类：卡片网格 `repeat(auto-fill, minmax(13rem, 1fr))`，每张卡显示分类名 + 文章数 + 最近更新。
- 标签：流式小胶囊云（`flex-wrap`），胶囊里带文章数角标（`opacity: 0.65` 更淡）。

### 4.12 归档页时间轴（`/posts/`）
- 左一根 `2px` 竖线（`::before` 绝对定位）贯穿，每个**有文章的月份**一个节点：
  实心圆点（`--accent`，`0.5rem`）+ 月份标签「2026 年 9 月」（带年份，跨年时区分）。
- 当月文章列在节点下，每行：`月-日`（tabular-nums）+ 标题 + 分类胶囊。
- 窄屏（≤520px）：一行变「月日 + 分类」同行、标题单独一行（用 `order` 重排）。

### 4.13 站内搜索（`/search/`）
- 搜索框：全宽 `input`，聚焦时 `--accent` 描边 + `--accent-soft` 光环。
- 搜索范围：胶囊式多选（原生 checkbox 藏 `opacity:0` 但保留可聚焦，点整颗胶囊切换），
  选中态 `--accent-soft` 底 + `--accent` 字；「清除 / 全选」是低调文字按钮（不做成胶囊，避免抢注意力）。
- 命中来源徽标（标题 / 标签 / 正文）：浅绿小胶囊。
- 摘要高亮：覆盖浏览器默认黄底，改用 `--accent-soft` 底 + `--accent` 字。

### 4.14 首页
- 顶部一句 `--muted` 介绍（`.intro`），解释站点是什么。
- 只列最近 10 篇；底部「查看更多历史文章」是**描边胶囊**（不是卡片，避免被当成第 11 篇），链到 `/posts/`。

### 4.15 空状态 / 404
- `.empty`：上下 `3rem` 内边距、居中、`--muted`。

---

## 5. 响应式断点（三档，够用就好）

| 断点 | 针对 | 主要调整 |
|---|---|---|
| `≤1200px` | 文章页 | 两栏 → 单栏，目录变折叠面板 |
| `≤640px` | 常规手机 | 页头下边距 `3rem → 2rem`（少留白多看一行） |
| `≤520px` | 手机 | 搜索范围去掉「搜索范围」四字；归档行重排 |
| `≤480px` | 手机 | `h1` 降到 `1.45rem`；卡片内边距收紧；代码块内边距收紧 |
| `≤400px` | 小手机 | 导航 `gap` 收紧；关于页头像/统计卡缩小防换行 |

横向溢出靠各块自身 `overflow-x: auto`（代码、表格、公式），实测 360~1440px 无页面级横向滚动条。

---

## 6. 给「别的 AI」的落地清单（照做即可还原）

1. **先建变量表**：把第 2.1 节的亮/深两列变量原样搬进 `:root` 和 `[data-theme='dark']`。
2. **新增任何样式别写死色值**，一律引用变量（`var(--xxx)`）。
3. **深色开关用 `is:inline` 内联脚本**在 `<head>` 里设 `data-theme`，否则会闪白。
4. **卡片 = 描边 + 双层投影**；悬停反馈统一是「轻微上浮 + 绿描边 + 左侧绿条」。
5. **代码块 / 表格 / 公式全部 `overflow-x: auto`**，绝不撑破布局。
6. **圆角档位**：胶囊 999 / 卡片输入框 10 / 代码块 8 / 小元素 4-6。
7. **间距与字号**遵循第 2.3 节节奏；中文正文 `16px / 1.75` 行高。
8. **墨绿 `#0f6e56` 是品牌色**，仅用于强调（链接、标签、圆点、聚焦），不做大面积铺底。
9. 文章页目录用 `grid-template-areas` 实现宽屏右栏 / 窄屏插入页头正文之间。
10. 多语言代码切换的容器**必须在 Markdown（remark）阶段生成**，不能写 rehype 插件：
    Astro 的 Shiki 高亮跑在自定义 rehype 插件之前，到 rehype 时代码块已被替换、结构拿不到。
11. 若内容源来自 Obsidian，加一个 remark 插件把 `==高亮==` 转 `<mark>`、正文 `#` 章节整体
    降一级（否则章节进不了目录）；frontmatter 的 `date` / `explain` 在校验前映射成
    `pubDate` / `description`。**`==` 要跨节点配对**（`==**粗体**==` 在 AST 里是三个节点）。
12. 目录「当前章节」必须有**整行底色块**，不能只变字色 —— 长目录（50+ 条）里只变字色扫不到；
    条目多时还要让当前项自动滚到侧栏中间，否则当前项会滚出可视区。
13. **验证 IntersectionObserver 不要用 iframe**：无头环境里 iframe 内的 `isIntersecting`
    恒为 false（环境问题，不是代码问题），要开真实浏览器跳锚点后截图。

---

> 本文档由站点现有 `global.css` + `BaseLayout.astro` + `consts.ts` 提炼，是真实生效样式的子集，
> 可作为其他项目 / 其他 AI 复刻该视觉风格的权威依据。

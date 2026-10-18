// 博客后台工具 —— 界面逻辑
//
// 原生 JavaScript，没有任何框架（见 技术架构.md 第四节）。
// 结构很简单：三个"页"（列表、编辑）、两个弹窗、一组接口调用。

'use strict';

// ============ 状态 ============

const state = {
  posts: [],
  meta: { categories: [], today: '', postsDir: '' },

  // 分类 / 标签的统计（来自 /api/taxonomy）。
  // 站点上已经有分类页和标签页了，这里拿的是同一份数据，
  // 用来做总览、筛选，以及给填写表单时提供"实际用过的值"。
  taxonomy: { categories: [], tags: [], postCount: 0, draftCount: 0, unparsed: [] },

  // 当前的筛选条件：{ kind: 'category' | 'tag', name: string }，null = 不筛
  filter: null,

  // 改名弹窗的上下文：{ kind, from }
  taxEdit: null,

  // 当前编辑的文章：null = 新建
  editing: null,
  // 打开的原始标题（用于判断"标题变了没"）
  originalTitle: '',
  originalSlug: '',
  // 正文是否有未保存改动
  dirty: false,

  // 编辑表单里选中的分类 / 标签（2026-10-18 起都是多选）。
  // 不再从输入框的文本反解析 —— 选中态由胶囊点击维护，
  // 输入框只负责「添加一个还没人选过的新值」。
  formCategories: [],
  formTags: [],
};

// 博客站点的地址 —— 「去博客看」的分类页/标签页链接要用它
const BLOG_BASE = 'http://localhost:4321';

// ============ DOM 快捷方式 ============

const $ = (id) => document.getElementById(id);

// ============ 接口调用 ============

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('服务器返回的内容看不懂（不是 JSON）');
  }

  return data;
}

const apiGet = (p) => api(p);
const apiPost = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });
const apiPut = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body || {}) });
const apiDelete = (p) => api(p, { method: 'DELETE' });

// ============ 提示 ============

let toastTimer = null;

function toast(text, ms = 2600) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

function showBanner(kind, text) {
  const el = $('save-message');
  el.className = 'banner banner-' + kind;
  el.textContent = text;
  el.hidden = false;
}

function hideBanner() {
  $('save-message').hidden = true;
}

// ============ 启动 ============

async function boot() {
  await loadMeta();
  await refreshBlogStatus();
  await loadPosts();
  await loadTaxonomy(); // 分类/标签统计（失败不影响主流程）
  bindEvents();

  // 每 8 秒看一次博客状态，让状态灯是活的
  setInterval(refreshBlogStatus, 8000);
}

async function loadMeta() {
  const res = await apiGet('/api/meta');
  if (!res.ok) return;

  state.meta = res;

  // 分类候选要等 taxonomy 拿到之后才能填完整（见 renderCategoryPicker）
  renderCategoryPicker();

  // 提示文章目录（让你知道工具在操作哪儿）
  $('posts-dir-hint').textContent = '文章目录：' + res.postsDir;
}

async function loadTaxonomy() {
  try {
    const res = await apiGet('/api/taxonomy');
    if (!res.ok) return;

    state.taxonomy = res;

    renderTaxonomy();
    renderFilterBar();
    renderTagPicker();

    // 分类候选要更新 —— 文章里实际用过的分类才最可能是你想选的
    renderCategoryPicker();

    // 格式有问题的文章单独提醒一下（它们没被统计进去）
    if (res.unparsed && res.unparsed.length > 0) {
      console.warn('有文章没能解析，未计入分类标签统计：', res.unparsed);
    }
  } catch {
    /* 统计拿不到不影响发文章 */
  }
}

// ============ 博客状态 ============

// 记住最近一次查到的状态，按钮据此决定"打开"还是"关闭"
let blogRunning = false;

async function refreshBlogStatus() {
  try {
    const res = await apiGet('/api/blog/status');
    blogRunning = !!res.running;

    const el = $('blog-status');
    if (blogRunning) {
      el.textContent = '博客运行中 :4321';
      el.className = 'status status-on';
    } else {
      el.textContent = '博客未启动';
      el.className = 'status status-off';
    }

    renderBlogButton();
  } catch {
    /* 状态查不到不影响主流程 */
  }
}

// 一个按钮，两种形态：没跑时是「打开博客」，跑着时是「关闭博客」
function renderBlogButton() {
  const btn = $('btn-open-blog');
  if (btn.dataset.busy === '1') return; // 正在启动/关闭中，别覆盖提示文字

  if (blogRunning) {
    btn.textContent = '关闭博客';
    btn.className = 'btn btn-danger-ghost';
    btn.title = '关掉本地博客，释放它占用的资源';
  } else {
    btn.textContent = '打开博客';
    btn.className = 'btn btn-primary';
    btn.title = '在本地启动博客并打开页面';
  }
}

// 按钮点下去的分发：按当前状态决定是开还是关
function toggleBlog() {
  if (blogRunning) return closeBlog();
  return openBlog();
}

async function openBlog() {
  const btn = $('btn-open-blog');
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = '启动中…';

  try {
    const res = await apiPost('/api/blog/start');
    if (res.ok) {
      toast(res.alreadyRunning ? '博客已在运行，已打开页面' : '博客已启动');
    } else {
      // 失败时把原因完整告诉用户（包括日志尾巴）
      const detail = res.output ? '\n\n--- 日志 ---\n' + res.output : '';
      showModal('启动博客失败', res.message + detail, { ok: false });
    }
  } catch (err) {
    showModal('启动博客失败', String(err.message || err), { ok: false });
  } finally {
    btn.dataset.busy = '';
    btn.disabled = false;
    await refreshBlogStatus();
  }
}

async function closeBlog() {
  const yes = await askModal(
    '关闭本地博客？',
    '关掉后博客页面就打不开了（浏览器标签页可以留着，刷新会失败）。\n\n' +
      '想再看的时候，点一下「打开博客」重新启动即可。',
    { danger: true, okText: '关闭博客', cancelText: '取消' }
  );

  if (!yes) return;

  const btn = $('btn-open-blog');
  btn.dataset.busy = '1';
  btn.disabled = true;
  btn.textContent = '关闭中…';

  try {
    const res = await apiPost('/api/blog/stop');
    if (res.ok) {
      toast('博客已关闭');
    } else {
      showModal('关闭博客失败', res.message, { ok: false });
    }
  } catch (err) {
    showModal('关闭博客失败', String(err.message || err), { ok: false });
  } finally {
    btn.dataset.busy = '';
    btn.disabled = false;
    // 关完稍等一下再查状态（进程退出需要一点点时间）
    setTimeout(refreshBlogStatus, 800);
    await refreshBlogStatus();
  }
}

// ============ 列表 ============

async function loadPosts() {
  $('list-loading').hidden = false;
  $('list-empty').hidden = true;

  try {
    const res = await apiGet('/api/posts');
    if (!res.ok) throw new Error(res.error || '读取失败');

    state.posts = res.posts;
    renderList();
  } catch (err) {
    $('list-loading').textContent = '读取失败：' + (err.message || err);
    return;
  }

  $('list-loading').hidden = true;
}

function renderList() {
  const ul = $('post-list');
  ul.innerHTML = '';

  const all = state.posts;
  // 有筛选条件时只渲染匹配的那些（见 filteredPosts）
  const posts = filteredPosts();

  // 计数：筛选时显示「显示 x / 共 y 篇」，一眼看出被筛掉了多少
  if (state.filter) {
    $('post-count').textContent =
      all.length > 0 ? `显示 ${posts.length} / 共 ${all.length} 篇` : '';
  } else {
    $('post-count').textContent = all.length > 0 ? `共 ${all.length} 篇` : '';
  }

  if (posts.length === 0) {
    const emptyEl = $('list-empty');
    if (all.length > 0 && state.filter) {
      const label = state.filter.kind === 'category' ? '分类' : '标签';
      emptyEl.textContent = `${label}「${state.filter.name}」下没有文章。`;
    } else {
      emptyEl.textContent = '还没有文章。点右上角「新建文章」发第一篇。';
    }
    emptyEl.hidden = false;
    return;
  }

  $('list-empty').hidden = true;

  for (const post of posts) {
    const li = document.createElement('li');
    li.className = 'post-item';

    // ---- 左侧信息 ----
    const main = document.createElement('div');
    main.className = 'post-main';

    const h3 = document.createElement('h3');
    h3.className = 'post-title' + (post.draft ? ' is-draft' : '');
    h3.textContent = post.title;
    main.appendChild(h3);

    if (post.description) {
      const desc = document.createElement('p');
      desc.className = 'post-desc';
      desc.textContent = post.description;
      main.appendChild(desc);
    }

    const meta = document.createElement('div');
    meta.className = 'post-meta';

    if (post.pubDate) {
      const d = document.createElement('span');
      d.textContent = post.pubDate + (post.updatedDate ? `（更新 ${post.updatedDate}）` : '');
      meta.appendChild(d);
    }

    // 分类徽章：一篇可以有多个（2026-10-18 起），挨个显示
    for (const c of post.categories || []) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = c;
      meta.appendChild(badge);
    }

    if (post.draft) {
      const dd = document.createElement('span');
      dd.className = 'badge badge-draft';
      dd.textContent = '草稿';
      meta.appendChild(dd);
    }

    if (!post.parseOk) {
      const bad = document.createElement('span');
      bad.className = 'badge badge-bad';
      bad.textContent = '格式有问题';
      meta.appendChild(bad);
    }

    for (const t of post.tags || []) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t;
      meta.appendChild(tag);
    }

    const code = document.createElement('code');
    code.className = 'post-slug';
    code.textContent = '/posts/' + post.slug + '/';
    meta.appendChild(code);

    main.appendChild(meta);
    li.appendChild(main);

    // ---- 右侧按钮 ----
    const actions = document.createElement('div');
    actions.className = 'post-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn';
    editBtn.textContent = '编辑';
    editBtn.onclick = () => openEditor(post.slug);
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger';
    delBtn.textContent = '删除';
    delBtn.onclick = () => confirmDelete(post);
    actions.appendChild(delBtn);

    li.appendChild(actions);
    ul.appendChild(li);
  }
}

// ============ 分类 / 标签（总览 · 筛选 · 改名） ============

// ---- 筛选 ----

// 按当前筛选条件过滤文章；没有筛选就返回全部
function filteredPosts() {
  const posts = state.posts;
  if (!state.filter) return posts;

  const { kind, name } = state.filter;

  if (kind === 'category') {
    // 多分类：文章的 categories 里含这个名字就留下
    return posts.filter((p) =>
      (p.categories || []).some((c) => String(c).trim() === name),
    );
  }

  return posts.filter((p) => (p.tags || []).some((t) => String(t).trim() === name));
}

// 点一下筛选，再点一下取消
function toggleFilter(kind, name) {
  if (state.filter && state.filter.kind === kind && state.filter.name === name) {
    state.filter = null;
  } else {
    state.filter = { kind, name };
  }
  afterFilterChange();
}

function clearFilter() {
  state.filter = null;
  afterFilterChange();
}

function afterFilterChange() {
  renderTaxonomy(); // 高亮被选中的那个胶囊
  renderFilterBar();
  renderList();

  // 滚回顶部，不然筛完停在页面中间、看不见列表变了
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderFilterBar() {
  const bar = $('filter-bar');

  if (!state.filter) {
    bar.hidden = true;
    return;
  }

  const label = state.filter.kind === 'category' ? '分类' : '标签';
  const matched = filteredPosts().length;

  $('filter-text').textContent = `${label}「${state.filter.name}」 —— ${matched} 篇`;
  bar.hidden = false;
}

// ---- 总览 ----

function renderTaxonomy() {
  const cats = state.taxonomy.categories || [];
  const tags = state.taxonomy.tags || [];

  // 一篇都还没写的时候，没必要摆一个空面板
  if (cats.length === 0 && tags.length === 0) {
    $('tax-panel').hidden = true;
    return;
  }

  $('tax-panel').hidden = false;
  renderChips('tax-categories', 'category', cats);
  renderChips('tax-tags', 'tag', tags);
}

function renderChips(boxId, kind, items) {
  const box = $(boxId);
  box.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'tax-tip';
    empty.textContent = kind === 'category' ? '还没有分类' : '还没有标签';
    box.appendChild(empty);
    return;
  }

  for (const item of items) box.appendChild(makeChip(kind, item));
}

// 一个胶囊 = 左边「筛选」按钮 + 右边「去博客看」链接
function makeChip(kind, item) {
  const label = kind === 'category' ? '分类' : '标签';
  const chip = document.createElement('span');
  chip.className = 'tax-chip';

  const isActive =
    state.filter && state.filter.kind === kind && state.filter.name === item.name;
  if (isActive) chip.classList.add('is-active');

  // 主体：点了筛选
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tax-chip-btn';
  btn.title = isActive ? '再点一下取消筛选' : `只看这个${label}的文章`;

  const name = document.createElement('span');
  name.textContent = item.name;
  btn.appendChild(name);

  const count = document.createElement('span');
  count.className = 'tax-count';
  count.textContent = String(item.count);
  // 草稿在站点上不显示，但工具里要看得到 —— 鼠标停上去说清楚
  if (item.draftCount > 0) {
    count.title =
      `共 ${item.count} 篇，其中 ${item.draftCount} 篇是草稿` +
      `（站点上只显示 ${item.count - item.draftCount} 篇）`;
  }
  btn.appendChild(count);

  btn.onclick = () => toggleFilter(kind, item.name);
  chip.appendChild(btn);

  // 右侧：去博客里看读者的实际效果
  const open = document.createElement('a');
  open.className = 'tax-chip-open';
  open.textContent = '↗';
  open.title = `在博客里打开「${item.name}」的${label}页`;
  open.href = taxonomyUrl(kind, item.name);
  open.target = '_blank';
  open.rel = 'noopener';
  chip.appendChild(open);

  return chip;
}

function taxonomyUrl(kind, name) {
  const prefix = kind === 'category' ? '/categories/' : '/tags/';
  return `${BLOG_BASE}${prefix}${encodeURIComponent(name)}/`;
}

// ---- 填写表单时复用已有的分类 / 标签（2026-10-18 升级为多选） ----

// 候选清单 = 「文章里实际用过的」+「meta 里的预设」，
// 用过的排前面（最常用的一定能直接选到），预设里没用过的接在后面。
function pickerCandidates(kind) {
  const used =
    kind === 'category' ? state.taxonomy.categories || [] : state.taxonomy.tags || [];
  const presets = kind === 'category' ? state.meta.categories || [] : [];
  const counts = new Map(used.map((x) => [x.name, x.count]));
  const names = used.map((x) => x.name);
  for (const p of presets) {
    if (!names.includes(p)) names.push(p);
  }
  return names.map((name) => ({ name, count: counts.get(name) || 0 }));
}

function renderCategoryPicker() {
  renderPicker('category');
}

function renderTagPicker() {
  renderPicker('tag');
}

// 渲染一个多选选择器：已选行（× 移除 + 清除全部）+ 候选行（点一下切换选中）
function renderPicker(kind) {
  const isCat = kind === 'category';
  const selectedBox = $(isCat ? 'cat-selected' : 'tag-selected');
  const optionsBox = $(isCat ? 'cat-options' : 'tag-options');
  if (!selectedBox || !optionsBox) return;

  const selected = isCat ? state.formCategories : state.formTags;
  const candidates = pickerCandidates(kind);

  // 已选但不在候选里的（刚手打添加的），也补一个候选位 ——
  // 不然点了添加之后候选区看不到它，想反悔取消都找不到
  for (const name of selected) {
    if (!candidates.some((c) => c.name === name)) {
      candidates.push({ name, count: 0 });
    }
  }

  // ---- 已选行 ----
  selectedBox.innerHTML = '';
  if (selected.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'picker-empty';
    empty.textContent = isCat ? '还没选分类（至少选一个）' : '还没选标签';
    selectedBox.appendChild(empty);
  } else {
    for (const name of selected) {
      selectedBox.appendChild(makePickedChip(kind, name));
    }
    // 一键清除。分类至少要留一个，所以只剩一个时分类不显示清除按钮
    //（标签随便清，选多少是自由）
    if (!isCat || selected.length > 1) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'pick-clear';
      clear.textContent = '清除全部';
      clear.title = isCat
        ? '清空所有分类（保存时会提醒至少留一个）'
        : '清空所有标签';
      clear.onclick = () => clearPicks(kind);
      selectedBox.appendChild(clear);
    }
  }

  // ---- 候选行 ----
  optionsBox.innerHTML = '';
  if (candidates.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'picker-empty';
    empty.textContent =
      '还没有可选的' + (isCat ? '分类' : '标签') + '，用下面的输入框添加第一个';
    optionsBox.appendChild(empty);
    return;
  }
  for (const cand of candidates) {
    optionsBox.appendChild(makeOptionChip(kind, cand));
  }
}

// 已选胶囊：名字 + 右侧 ×
function makePickedChip(kind, name) {
  const chip = document.createElement('span');
  chip.className = 'pick-chip';

  const label = document.createElement('span');
  label.textContent = name;
  chip.appendChild(label);

  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'pick-chip-x';
  x.textContent = '×';
  x.title = `去掉「${name}」`;
  x.onclick = () => togglePick(kind, name);
  chip.appendChild(x);

  return chip;
}

// 候选胶囊：选中态实心高亮；角标是「已有几篇用过」
function makeOptionChip(kind, cand) {
  const selected = kind === 'category' ? state.formCategories : state.formTags;
  const isOn = selected.includes(cand.name);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pick-option' + (isOn ? ' is-selected' : '');
  btn.title = isOn ? '再点一下取消' : '点一下选中';

  const name = document.createElement('span');
  name.textContent = cand.name;
  btn.appendChild(name);

  if (cand.count > 0) {
    const n = document.createElement('span');
    n.className = 'pick-n';
    n.textContent = String(cand.count);
    n.title = `已有 ${cand.count} 篇用过`;
    btn.appendChild(n);
  }

  btn.onclick = () => togglePick(kind, cand.name);
  return btn;
}

// 点一下选中、再点一下取消
function togglePick(kind, name) {
  const key = kind === 'category' ? 'formCategories' : 'formTags';
  const list = state[key];
  const at = list.indexOf(name);
  if (at === -1) list.push(name);
  else list.splice(at, 1);
  state.dirty = true;
  renderPicker(kind);
}

// 一键清除
function clearPicks(kind) {
  if (kind === 'category') state.formCategories = [];
  else state.formTags = [];
  state.dirty = true;
  renderPicker(kind);
}

// 输入框添加：给「候选里还没有的新名字」用。回车或点「添加」都行
function addPickFromInput(kind) {
  const input = $(kind === 'category' ? 'cat-new' : 'tag-new');
  const name = input.value.trim();
  if (!name) {
    toast('先输入名字');
    return;
  }

  const key = kind === 'category' ? 'formCategories' : 'formTags';
  if (state[key].includes(name)) {
    toast(`「${name}」已经选了`);
    input.value = '';
    return;
  }

  state[key].push(name);
  input.value = '';
  state.dirty = true;
  renderPicker(kind);
  toast(`已添加「${name}」`);
}

// ---- 改名 / 合并 ----

// 入口：筛选状态下点「改名 / 合并…」
function openTaxEdit() {
  if (!state.filter) return;
  openTaxModal(state.filter.kind, state.filter.name);
}

let taxPreviewTimer = null;

function openTaxModal(kind, from) {
  const label = kind === 'category' ? '分类' : '标签';

  const item = (kind === 'category' ? state.taxonomy.categories : state.taxonomy.tags).find(
    (x) => x.name === from,
  );
  const count = item ? item.count : 0;

  $('tax-modal-title').textContent = `改${label}名（或合并到别的${label}）`;
  $('tax-modal-desc').textContent =
    `「${from}」现在有 ${count} 篇文章，改了名字这些文章会一起跟着改。`;

  const input = $('tax-new-name');
  input.value = from;

  const info = $('tax-modal-info');
  info.hidden = true;
  info.className = 'tax-info';
  info.textContent = '';

  // 名字还没改，按钮先禁用 —— 别让用户点了个"名字没变"的确定
  $('tax-ok').disabled = true;

  state.taxEdit = { kind, from };

  $('tax-modal').hidden = false;
  input.focus();
  input.select();
}

function closeTaxModal() {
  clearTimeout(taxPreviewTimer);
  $('tax-modal').hidden = true;
  state.taxEdit = null;
}

// 输入新名字后延迟一下，去问后端「这一改会影响多少篇」（dryRun，不写文件）。
// 延迟是为了别每敲一个字就打一次接口。
function onTaxNameInput() {
  clearTimeout(taxPreviewTimer);
  taxPreviewTimer = setTimeout(previewTaxRename, 320);
}

async function previewTaxRename() {
  const ctx = state.taxEdit;
  if (!ctx) return;

  const info = $('tax-modal-info');
  const okBtn = $('tax-ok');
  const to = $('tax-new-name').value.trim();
  const label = ctx.kind === 'category' ? '分类' : '标签';

  if (!to) {
    info.hidden = true;
    okBtn.disabled = true;
    return;
  }

  if (to === ctx.from) {
    info.className = 'tax-info';
    info.textContent = '名字没变。改一个不一样的，或者点取消。';
    info.hidden = false;
    okBtn.disabled = true;
    return;
  }

  try {
    const res = await apiPost('/api/taxonomy/rename', {
      kind: ctx.kind,
      from: ctx.from,
      to,
      dryRun: true,
    });

    if (!res.ok) {
      info.className = 'tax-info is-warn';
      info.textContent = res.error || '这个新名字不能用';
      info.hidden = false;
      okBtn.disabled = true;
      return;
    }

    const lines = [];

    if (res.isMerge) {
      lines.push(`⚠️ 「${to}」已经存在，所以这次是合并：`);
      lines.push(`两边共 ${res.affectedCount} 篇文章会归到「${to}」下面。`);
    } else {
      lines.push(`会把 ${res.affectedCount} 篇文章的${label}改成「${to}」。`);
    }

    lines.push('');
    lines.push(`旧地址：${res.oldUrl}`);
    lines.push(`新地址：${res.newUrl}`);
    lines.push('工具会自动补一条跳转，别人收藏的旧地址不会失效。');

    info.className = res.isMerge ? 'tax-info is-warn' : 'tax-info';
    info.textContent = lines.join('\n');
    info.hidden = false;
    okBtn.disabled = false;
  } catch (err) {
    info.className = 'tax-info is-warn';
    info.textContent = String(err.message || err);
    info.hidden = false;
    okBtn.disabled = true;
  }
}

async function runTaxRename() {
  const ctx = state.taxEdit;
  if (!ctx) return;

  const to = $('tax-new-name').value.trim();
  if (!to) return;

  const okBtn = $('tax-ok');
  okBtn.disabled = true;
  okBtn.textContent = '处理中…';

  try {
    const res = await apiPost('/api/taxonomy/rename', {
      kind: ctx.kind,
      from: ctx.from,
      to,
    });

    if (!res.ok) {
      showModal('改名失败', res.error || '未知错误', { ok: false });
      return;
    }

    const label = ctx.kind === 'category' ? '分类' : '标签';
    const succeeded = res.changed ? res.changed.length : 0;

    let msg = res.isMerge
      ? `已合并：${succeeded} 篇文章的${label}归到了「${res.to}」。`
      : `已改名：${succeeded} 篇文章的${label}改成了「${res.to}」。`;

    if (res.redirectAdded) {
      msg += `\n\n旧地址会自动跳转：\n${res.oldUrl}\n  → ${res.newUrl}`;
    } else if (res.redirectError) {
      msg +=
        `\n\n⚠️ 旧地址的跳转没能记上：\n${res.redirectError}` +
        '\n（文章本身已经改好了，但旧链接会 404）';
    }

    if (res.failed && res.failed.length > 0) {
      msg += `\n\n⚠️ 有 ${res.failed.length} 篇没能改成功：`;
      for (const f of res.failed.slice(0, 5)) {
        msg += `\n· ${f.slug}：${f.error}`;
      }
      if (res.failed.length > 5) msg += `\n…还有 ${res.failed.length - 5} 篇`;
    }

    msg += `\n\n原文都备份在：\n${res.backupDir}`;

    closeTaxModal();

    // 被改掉的那个名字已经不存在了，筛选条件跟着清掉
    if (state.filter && state.filter.kind === ctx.kind && state.filter.name === ctx.from) {
      state.filter = null;
    }

    await loadPosts();
    await loadTaxonomy();

    showModal(res.isMerge ? '合并完成' : '改名完成', msg, { ok: false });
  } catch (err) {
    showModal('改名出错', String(err.message || err), { ok: false });
  } finally {
    okBtn.disabled = false;
    okBtn.textContent = '确定改名';
  }
}

// ============ 视图切换 ============

function showList() {
  $('view-list').hidden = false;
  $('view-edit').hidden = true;
}

function showEditor() {
  $('view-list').hidden = true;
  $('view-edit').hidden = false;
}

// ============ 打开编辑器 ============

async function newPost() {
  state.editing = null;
  state.originalTitle = '';
  state.originalSlug = '';
  state.dirty = false;

  clearForm();
  $('f-pubdate').value = state.meta.today;
  $('edit-title').textContent = '新建文章';
  $('btn-delete').hidden = true;
  $('rename-box').hidden = true;
  hideBanner();

  showEditor();
  $('f-title').focus();
}

async function openEditor(slug) {
  hideBanner();

  let res;
  try {
    res = await apiGet('/api/posts/' + encodeURIComponent(slug));
  } catch (err) {
    toast('打不开这篇：' + (err.message || err));
    return;
  }

  if (!res.ok) {
    toast('打不开这篇：' + (res.error || '未知错误'));
    return;
  }

  const { data, body } = res.post;

  state.editing = slug;
  state.originalTitle = String(data.title || '');
  state.originalSlug = slug;
  state.dirty = false;

  $('f-title').value = String(data.title || '');
  $('f-description').value = String(data.description || '');
  $('f-pubdate').value = String(data.pubDate || '');
  $('f-updateddate').value = data.updatedDate ? String(data.updatedDate) : '';
  $('f-draft').checked = data.draft === true;
  $('f-slug').value = slug;
  $('f-body').value = body;

  // 分类 / 标签：回填多选选中态（2026-10-18 起都是数组）
  state.formCategories = Array.isArray(data.categories)
    ? data.categories.map((c) => String(c).trim()).filter((c) => c !== '')
    : [];
  state.formTags = Array.isArray(data.tags)
    ? data.tags.map((t) => String(t).trim()).filter((t) => t !== '')
    : [];
  renderCategoryPicker();
  renderTagPicker();

  $('edit-title').textContent = '编辑文章';
  $('btn-delete').hidden = false;
  $('rename-box').hidden = false;

  updateSlugPreview();
  updateBodyStats();
  showEditor();
}

function clearForm() {
  for (const id of [
    'f-title',
    'f-description',
    'f-pubdate',
    'f-updateddate',
    'cat-new',
    'tag-new',
    'f-slug',
    'f-body',
  ]) {
    $(id).value = '';
  }
  $('f-draft').checked = false;
  $('slug-warning').hidden = true;

  // 多选选中态一起清掉，并重绘（否则上一篇的已选胶囊还挂在编辑区）
  state.formCategories = [];
  state.formTags = [];
  renderCategoryPicker();
  renderTagPicker();

  updateBodyStats();
}

// ============ 表单辅助 ============

function updateSlugPreview() {
  const slug = $('f-slug').value.trim();
  $('url-preview').textContent = slug ? '/posts/' + slug + '/' : '/posts/…';

  const warn = $('slug-warning');
  const check = checkSlugLocally(slug);

  if (slug && !check.ok) {
    warn.textContent = '文件名有问题：' + check.reason;
    warn.hidden = false;
  } else {
    warn.hidden = true;
  }
}

/**
 * 前端也做一遍简单校验，让你边打就能看到问题
 * （后端还会再校验一次 —— 前端的提示是体验，后端的校验是保险）
 */
function checkSlugLocally(slug) {
  if (!slug) return { ok: false, reason: '不能为空' };
  if (/[\u4e00-\u9fff]/.test(slug)) return { ok: false, reason: '不能用中文' };
  if (/[A-Z]/.test(slug)) return { ok: false, reason: '必须全小写' };
  if (/[^a-z0-9-]/.test(slug)) return { ok: false, reason: '只能用字母、数字和短横线' };
  if (/^-|-$/.test(slug)) return { ok: false, reason: '不能以短横线开头或结尾' };
  if (slug.includes('--')) return { ok: false, reason: '不要连续两个短横线' };
  return { ok: true };
}

function updateBodyStats() {
  const text = $('f-body').value;
  const chars = text.length;
  const lines = text === '' ? 0 : text.split('\n').length;
  $('body-stats').textContent = text === '' ? '' : `${chars} 字符 · ${lines} 行`;
}

async function suggestSlug() {
  const title = $('f-title').value.trim();
  if (!title) {
    toast('先填标题，我才能生成文件名');
    return;
  }

  const res = await apiPost('/api/slug', { title });
  if (!res.ok) return;

  $('f-slug').value = res.candidate;
  updateSlugPreview();
  toast('已生成候选文件名，可以自己改');
}

// ============ 保存 ============

async function save() {
  // 输入框里可能还有没点「添加」的内容 —— 自动并入，别让用户白打一顿
  for (const [kind, key, inputId] of [
    ['category', 'formCategories', 'cat-new'],
    ['tag', 'formTags', 'tag-new'],
  ]) {
    const pending = $(inputId).value.trim();
    if (pending && !state[key].includes(pending)) {
      state[key].push(pending);
    }
    $(inputId).value = '';
  }

  const data = {
    title: $('f-title').value.trim(),
    description: $('f-description').value.trim(),
    pubDate: $('f-pubdate').value,
    updatedDate: $('f-updateddate').value,
    categories: state.formCategories,
    tags: state.formTags,
    draft: $('f-draft').checked,
  };

  const slug = $('f-slug').value.trim();
  const body = $('f-body').value;

  // ---- 前端先自查，避免白跑一趟 ----
  const problems = [];
  if (!data.title) problems.push('· 标题没填');
  if (!data.description) problems.push('· 摘要没填');
  if (!data.pubDate) problems.push('· 发布日期没填');
  if (data.categories.length === 0) problems.push('· 分类至少选一个');
  if (!slug) problems.push('· 文件名没填');
  else {
    const c = checkSlugLocally(slug);
    if (!c.ok) problems.push('· 文件名：' + c.reason);
  }

  if (problems.length > 0) {
    showBanner('error', '还不能保存：\n' + problems.join('\n'));
    return;
  }

  const btn = $('btn-save');
  btn.disabled = true;
  btn.textContent = '保存中…';

  try {
    if (state.editing === null) {
      // ---- 新建 ----
      const res = await apiPost('/api/posts', { slug, data, body });

      if (!res.ok) {
        showBanner('error', '保存失败：\n' + (res.error || '未知错误'));
        return;
      }

      state.editing = slug;
      state.originalTitle = data.title;
      state.originalSlug = slug;
      $('edit-title').textContent = '编辑文章';
      $('btn-delete').hidden = false;
      $('rename-box').hidden = false;
      state.dirty = false;

      showBanner('ok', `已保存：/posts/${slug}/\n博客页面会自动更新。`);
      await loadPosts();
    } else {
      // ---- 更新 ----
      const res = await apiPut('/api/posts/' + encodeURIComponent(state.editing), {
        data,
        body,
      });

      if (!res.ok) {
        showBanner('error', '保存失败：\n' + (res.error || '未知错误'));
        return;
      }

      state.dirty = false;

      let msg = '已保存，更新日期已设为今天。';
      if (res.warnings && res.warnings.length > 0) {
        msg += '\n\n提醒：\n' + res.warnings.join('\n');
      }
      showBanner(res.warnings && res.warnings.length ? 'warn' : 'ok', msg);
      await loadPosts();

      // ---- 标题变了？问要不要顺便改文件名（ADR-011）----
      if (data.title !== state.originalTitle) {
        await askRename(data.title);
      }
    }
  } catch (err) {
    showBanner('error', '保存出错：\n' + (err.message || err));
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

// ============ 改名询问（ADR-011）============

async function askRename(newTitle) {
  // 先把新文件名算出来，让弹窗里能显示**真实的**新 URL。
  // 以前这里写的是 '/posts/<新的文件名>/' 占位符 —— 用户根本看不见自己要改成什么，
  // 等于让他盲选。现在提前算好，选择前就能看到前后对比。
  let candidate = '';
  try {
    const res = await apiPost('/api/slug', { title: newTitle });
    if (res.ok && res.candidate) candidate = res.candidate;
  } catch {
    // 算不出来就不显示新 URL，弹窗照常弹（用户仍可选择「保持文件名不变」）
  }

  return new Promise((resolve) => {
    const modal = $('rename-modal');

    $('rm-old-title').textContent = state.originalTitle || '(空)';
    $('rm-new-title').textContent = newTitle;
    $('rm-old-url').textContent = '/posts/' + state.originalSlug + '/';
    $('rm-new-url').textContent = candidate
      ? '/posts/' + candidate + '/'
      : '（暂无法自动生成，可稍后手动改）';

    // 文件名没变的话，「顺便改」按钮没意义，直接禁掉
    const changeBtn = $('rm-change');
    changeBtn.disabled = !candidate || candidate === state.originalSlug;

    modal.hidden = false;

    const cleanup = () => {
      modal.hidden = true;
      $('rm-keep').onclick = null;
      changeBtn.onclick = null;
    };

    // 默认：不改
    $('rm-keep').onclick = () => {
      cleanup();
      resolve(false);
    };

    changeBtn.onclick = async () => {
      cleanup();

      const confirmed = await askNewSlugName(candidate);
      if (!confirmed) {
        resolve(false);
        return;
      }

      try {
        const r = await apiPost('/api/rename', {
          oldSlug: state.originalSlug,
          newSlug: confirmed,
        });

        if (!r.ok) {
          showBanner('error', '改名失败：\n' + (r.error || '未知错误'));
          resolve(false);
          return;
        }

        state.editing = confirmed;
        state.originalSlug = confirmed;
        $('f-slug').value = confirmed;
        updateSlugPreview();
        await loadPosts();

        // 重定向表没写成功时说清楚 —— 改名本身已经生效，但旧链接会 404
        if (r.redirectAdded === false) {
          showBanner(
            'error',
            `文件名已改：${r.oldUrl}\n       → ${r.newUrl}\n\n` +
              '⚠️ 但旧地址的跳转页没能记上：\n' +
              (r.redirectError || '未知原因') +
              '\n\n文章本身没丢，但访问旧链接会 404。\n' +
              '请把这个情况告诉我，我来看怎么补。',
          );
        } else {
          showBanner(
            'warn',
            `文件名已改：${r.oldUrl}\n       → ${r.newUrl}\n\n` +
              '旧链接不会失效 —— 构建后会生成一个跳转页，\n' +
              '访问旧地址的人会自动被送到新地址。\n' +
              `旧文件也备份了一份：${r.backupPath}`,
          );
        }
      } catch (err) {
        showBanner('error', '改名出错：\n' + (err.message || err));
      }

      resolve(true);
    };
  });
}

function askNewSlugName(candidate) {
  return new Promise((resolve) => {
    showModal(
      '确认新文件名',
      '工具根据新标题生成了这个文件名，可以直接用，也可以自己改：',
      {
        ok: true,
        okText: '就用这个',
        extra: candidate,
        onOk: () => resolve(candidate),
        onCancel: () => resolve(false),
      },
    );
  });
}

// ============ 删除 ============

function confirmDelete(post) {
  showModal(
    '确定删除这篇文章？',
    `《${post.title}》\n\n会先从文章目录里移到备份目录，再删除。删错了可以从备份找回来。`,
    {
      ok: true,
      okText: '确定删除',
      danger: true,
      extra: '文件：' + post.slug + '.md',
      onOk: async () => {
        try {
          const res = await apiDelete('/api/posts/' + encodeURIComponent(post.slug));

          if (!res.ok) {
            showModal('删除失败', res.error || '未知错误', { ok: false });
            return;
          }

          toast('已删除，备份在 .workbuddy/tmp/deleted-posts/');
          await loadPosts();

          if (state.editing === post.slug) {
            showList();
          }
        } catch (err) {
          showModal('删除出错', String(err.message || err), { ok: false });
        }
      },
    },
  );
}

// ============ 通用弹窗 ============

let modalHandlers = { onOk: null, onCancel: null };

function showModal(title, text, opts = {}) {
  const modal = $('modal');
  $('modal-title').textContent = title;
  $('modal-text').textContent = text;

  const extra = $('modal-extra');
  if (opts.extra) {
    extra.textContent = opts.extra;
    extra.hidden = false;
  } else {
    extra.hidden = true;
  }

  const okBtn = $('modal-ok');
  const cancelBtn = $('modal-cancel');

  if (opts.ok === false) {
    // 纯提示，只有一个"知道了"
    okBtn.textContent = '知道了';
    okBtn.className = 'btn btn-primary';
    cancelBtn.hidden = true;
  } else {
    okBtn.textContent = opts.okText || '确定';
    okBtn.className = opts.danger ? 'btn btn-danger' : 'btn btn-primary';
    cancelBtn.hidden = false;
  }

  modalHandlers = {
    onOk: opts.onOk || null,
    onCancel: opts.onCancel || null,
  };

  modal.hidden = false;
  okBtn.focus();
}

function closeModal() {
  $('modal').hidden = true;
  modalHandlers = { onOk: null, onCancel: null };
}

// 把弹窗包成 Promise 用起来方便：await askModal(...) 拿到 true/false
function askModal(title, text, opts = {}) {
  return new Promise((resolve) => {
    showModal(title, text, {
      ...opts,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

// 关闭管理工具自己。
// 注意：只关管理工具，博客运行在另一个进程里，不受影响。
async function quitTool() {
  const yes = await askModal(
    '关闭博客后台工具？',
    '关掉后这个管理界面就打不开了（浏览器标签页可以一起关掉）。\n\n' +
      '注意：博客本身不受影响 —— 它跑在另一个进程里。\n' +
      '想再打开管理工具时，双击一次「启动.bat」就行。',
    { danger: true, okText: '关闭工具', cancelText: '取消' }
  );

  if (!yes) return;

  try {
    await apiPost('/api/quit');
  } catch {
    // 服务已经退出时这个请求会失败，属正常情况，忽略
  }

  document.body.innerHTML =
    '<div class="wrap" style="padding-top:60px">' +
    '<h2 style="margin-bottom:12px">管理工具已关闭</h2>' +
    '<p class="hint" style="font-size:14px;line-height:1.8">' +
    '这个标签页可以关掉了。<br />' +
    '想再用的时候，双击一次「启动.bat」即可。<br /><br />' +
    '博客本身不受影响。' +
    '</p></div>';
}

// ============ 事件绑定 ============

function bindEvents() {
  // 顶栏
  $('btn-open-blog').onclick = toggleBlog;
  $('btn-quit').onclick = quitTool;

  // 列表
  $('btn-new').onclick = newPost;

  // 分类 / 标签（总览 + 筛选 + 改名）
  $('btn-filter-clear').onclick = clearFilter;
  $('btn-tax-edit').onclick = openTaxEdit;
  $('tax-cancel').onclick = closeTaxModal;
  $('tax-ok').onclick = runTaxRename;
  $('tax-new-name').addEventListener('input', onTaxNameInput);

  // 编辑页
  $('btn-back').onclick = async () => {
    if (state.dirty && !confirm('有改动还没保存，确定返回吗？')) return;
    showList();
  };

  $('btn-cancel').onclick = () => {
    if (state.dirty && !confirm('有改动还没保存，确定放弃吗？')) return;
    showList();
  };

  $('btn-save').onclick = save;
  $('btn-suggest').onclick = suggestSlug;
  $('btn-delete').onclick = () => {
    const post = state.posts.find((p) => p.slug === state.editing);
    if (post) confirmDelete(post);
  };

  // 文件名实时预览
  $('f-slug').addEventListener('input', () => {
    state.dirty = true;
    updateSlugPreview();
  });

  // 正文统计 + 脏标记
  $('f-body').addEventListener('input', () => {
    state.dirty = true;
    updateBodyStats();
  });

  // 其他字段改动也标脏
  // （分类/标签不走这里 —— 它们由胶囊点击维护，togglePick 里自己标脏）
  for (const id of ['f-title', 'f-description', 'f-pubdate', 'f-updateddate']) {
    $(id).addEventListener('input', () => {
      state.dirty = true;
    });
  }
  $('f-draft').addEventListener('change', () => {
    state.dirty = true;
  });

  // ---- 分类 / 标签多选 ----
  $('cat-add').onclick = () => addPickFromInput('category');
  $('tag-add').onclick = () => addPickFromInput('tag');
  $('cat-new').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPickFromInput('category');
    }
  });
  $('tag-new').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addPickFromInput('tag');
    }
  });

  // ---- 从文件导入正文 ----
  $('btn-import').onclick = () => $('import-file').click();

  $('import-file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const text = await file.text();

    // 如果导入的文件本身带 frontmatter，只取正文部分
    const body = stripFrontmatter(text);

    const existing = $('f-body').value.trim();
    if (existing !== '') {
      const choice = confirm(
        '正文里已经有内容了。\n\n确定 = 用导入的内容替换\n取消 = 追加到现有内容后面',
      );
      $('f-body').value = choice ? body : existing + '\n\n' + body;
    } else {
      $('f-body').value = body;
    }

    state.dirty = true;
    updateBodyStats();
    toast('已导入：' + file.name);

    // 清空 input，这样同一个文件能再导入一次
    e.target.value = '';
  });

  // ---- 弹窗按钮 ----
  $('modal-ok').onclick = async () => {
    const handler = modalHandlers.onOk;
    if (handler) {
      closeModal();
      await handler();
    } else {
      closeModal();
    }
  };

  $('modal-cancel').onclick = () => {
    const handler = modalHandlers.onCancel;
    closeModal();
    if (handler) handler();
  };

  // ---- 快捷键 ----
  document.addEventListener('keydown', (e) => {
    // Ctrl/Cmd + S 保存
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      if (!$('view-edit').hidden) save();
    }
    // Esc 关弹窗
    if (e.key === 'Escape') {
      if (!$('modal').hidden) $('modal-cancel').click();
      else if (!$('rename-modal').hidden) $('rm-keep').click();
      else if (!$('tax-modal').hidden) closeTaxModal();
    }
  });

  // 离开页面前提醒未保存
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/**
 * 去掉导入文件的 frontmatter
 *
 * 因为你在 Obsidian 里写的文件可能自带 frontmatter，
 * 直接粘进来会和工具生成的重复、把文件搞坏。
 */
function stripFrontmatter(text) {
  const normalized = text.replace(/\r\n/g, '\n');

  if (!normalized.startsWith('---\n')) return normalized;

  const lines = normalized.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return lines
        .slice(i + 1)
        .join('\n')
        .replace(/^\n+/, '');
    }
  }

  // 没闭合 → 原样返回（让用户自己看）
  return normalized;
}

// ============ 出发 ============

boot();

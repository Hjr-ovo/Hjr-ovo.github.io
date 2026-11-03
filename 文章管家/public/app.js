// 文章管家 · 前端逻辑（原生 JS，无框架）
//
// 界面三条规矩（2026-10-31 按用户要求重做）：
//   1. 中间**始终**是全部文章的格子墙，切导航不会把它换走
//   2. 入库和编辑是盖在中间的悬浮窗，不是"页面"
//   3. 标签 / 分类是第二列抽屉，可以拖东西进去，也可以从里面拖出来
//
// 数据依旧全部来自后端现读磁盘，前端只留「哪篇开着、开着的哈希」这类临时状态。

const $ = (id) => document.getElementById(id);

const state = {
  posts: [],
  trash: [],
  meta: null, // 分类 / 标签候选
  current: null, // 正在编辑的那篇（含 hash，用于冲突检测）
  dirty: false,
  plan: null, // 入库诊断结果
  raw: '', // 入库文件原文
  drawer: null, // null | 'tags' | 'categories' | 'trash'
  selected: null, // { kind, name } 抽屉里点中的那一项
  drag: null, // { type:'term'|'post', ... } 当前正在拖的东西
};

// ---------- 列宽 ----------

const LIMIT = { side: [150, 320], drawer: [140, 380] };
const layout = {
  side: Number(localStorage.getItem('mgr.sideW')) || 188,
  drawer: Number(localStorage.getItem('mgr.drawerW')) || 0, // 0 = 还没单独调过
};

function applyLayout() {
  const root = document.documentElement.style;
  root.setProperty('--side-w', `${layout.side}px`);
  // 没单独调过时就跟左侧栏一样宽（用户要求"新弹出的这一列和原左侧栏大小相同"）
  root.setProperty('--drawer-w', `${layout.drawer || layout.side}px`);
}

/** 绑定一个拖动把手；双击复位 */
function bindResizer(el, key) {
  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = key === 'side' ? layout.side : layout.drawer || layout.side;
    const [min, max] = LIMIT[key];

    el.classList.add('active');
    document.body.classList.add('resizing');

    const move = (ev) => {
      const next = Math.min(max, Math.max(min, startW + (ev.clientX - startX)));
      layout[key] = Math.round(next);
      applyLayout();
    };
    const up = () => {
      el.classList.remove('active');
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      localStorage.setItem(`mgr.${key}W`, String(layout[key]));
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  el.addEventListener('dblclick', () => {
    layout[key] = key === 'side' ? 188 : layout.side;
    applyLayout();
    localStorage.setItem(`mgr.${key}W`, String(layout[key]));
  });
}

// ---------- 基础 ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（${res.status}）`);
    err.code = data.code;
    err.problems = data.problems;
    throw err;
  }
  return data;
}

let toastTimer = 0;
function toast(msg, bad = false) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.className = 'toast';
  }, 2600);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

const KIND_CN = { tags: '标签', categories: '分类' };

// ---------- 分类 / 标签输入框（chips + 下拉候选 + 新建提示） ----------
//
// 用户要求（2026-11-01）：有下拉可选，也能按输入匹配；
// 输入的东西不存在时要明确告诉用户「正在新建」。
//
// 所以这里的候选菜单最后一行永远是 `＋ 新建分类「xxx」`（输入框有内容时），
// 已经加进去、但磁盘上还不存在的项，chip 会带虚线圈和提示 ——
// 保存后才真的建出来，界面上要先说清楚。

const TERMS = {};

function mountTerms(el) {
  const kind = el.dataset.kind; // 'tags' | 'categories'
  const cn = KIND_CN[kind];

  el.innerHTML =
    '<div class="terms-box"><span class="terms-chips"></span>' +
    `<input class="terms-input" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(el.dataset.placeholder || '')}" />` +
    '</div><div class="terms-menu" hidden></div>';

  const box = el.querySelector('.terms-box');
  const chipsEl = el.querySelector('.terms-chips');
  const input = el.querySelector('.terms-input');
  const menu = el.querySelector('.terms-menu');

  let values = [];
  let options = []; // [{ name, count }]
  let rows = []; // 菜单当前渲染的项
  let active = -1;
  const listeners = [];

  const isNew = (name) => !options.some((o) => o.name === name);

  function renderChips() {
    chipsEl.innerHTML = values
      .map((v) => {
        const fresh = isNew(v);
        return (
          `<span class="chip${fresh ? ' is-new' : ''}"${fresh ? ` title="新建${cn}「${esc(v)}」——保存后才会真正建出来"` : ''}>` +
          `${esc(v)}<button type="button" data-remove="${esc(v)}" title="移除">×</button></span>`
        );
      })
      .join('');
  }

  function closeMenu() {
    menu.hidden = true;
    active = -1;
    rows = [];
  }

  function renderMenu() {
    if (rows.length === 0) return closeMenu();
    menu.innerHTML = rows
      .map((r, i) => {
        const cls = 'terms-row' + (r.type === 'new' ? ' is-new' : '') + (i === active ? ' active' : '');
        if (r.type === 'new') return `<div class="${cls}" data-idx="${i}"><span class="plus">＋</span>新建${cn}「${esc(r.name)}」</div>`;
        return `<div class="${cls}" data-idx="${i}"><span class="nm">${esc(r.name)}</span><span class="cnt">${r.count}</span></div>`;
      })
      .join('');
    menu.hidden = false;

    // 弹窗的 .modal-body 是 overflow:auto，菜单朝下展开会被裁掉一截。
    // 下面放不下、上面放得下时，翻到输入框上方。
    menu.classList.remove('up');
    const rect = el.getBoundingClientRect();
    const h = menu.scrollHeight || 208;
    if (window.innerHeight - rect.bottom < h + 16 && rect.top > h + 16) menu.classList.add('up');
  }

  function openMenu() {
    const q = input.value.trim().toLowerCase();
    const chosen = new Set(values);
    const hits = options.filter((o) => !chosen.has(o.name) && (!q || o.name.toLowerCase().includes(q)));
    rows = hits.map((o) => ({ type: 'pick', name: o.name, count: o.count }));

    const typed = input.value.trim();
    if (typed && !chosen.has(typed) && !options.some((o) => o.name === typed)) {
      // 「新建」放**最后**：打字时多半是在找已有的那个（输「双」是想找「双指针」），
      // 把它顶到第一行会让人习惯性回车就误建一个新标签。
      rows.push({ type: 'new', name: typed });
    }

    active = rows.length > 0 ? 0 : -1;
    renderMenu();
  }

  function commit(name) {
    const v = String(name ?? '').trim();
    input.value = '';
    if (!v) return closeMenu();
    if (!values.includes(v)) {
      values.push(v);
      renderChips();
      listeners.forEach((fn) => fn());
    }
    closeMenu();
    if (document.activeElement === input) openMenu();
  }

  input.addEventListener('focus', openMenu);
  input.addEventListener('input', () => {
    // 逗号 = 上一个词说完了（中英文逗号、顿号都认），直接落成 chip
    if (/[,，、]/.test(input.value)) {
      const parts = input.value.split(/[,，、]/);
      const tail = parts.pop();
      parts.forEach((p) => {
        const v = p.trim();
        if (v && !values.includes(v)) values.push(v);
      });
      input.value = tail;
      renderChips();
      listeners.forEach((fn) => fn());
    }
    openMenu();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (menu.hidden) return openMenu();
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length;
      renderMenu();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!menu.hidden && active >= 0 && rows[active]) commit(rows[active].name);
      else commit(input.value);
      return;
    }
    if (e.key === 'Escape') {
      if (!menu.hidden) {
        e.stopPropagation(); // 有菜单时 Esc 先关菜单，别顺手把整个悬浮窗关了
        closeMenu();
        return;
      }
      if (input.value) {
        e.stopPropagation();
        input.value = '';
      }
      return;
    }
    if (e.key === 'Backspace' && input.value === '' && values.length > 0) {
      values.pop();
      renderChips();
      listeners.forEach((fn) => fn());
    }
  });

  input.addEventListener('blur', () => {
    // 输入完直接点别处：把没确认的文字也收下，别让用户白打一遍
    if (input.value.trim()) commit(input.value);
    else closeMenu();
  });

  // 用 mousedown 而不是 click：click 之前 blur 已经把菜单关了
  menu.addEventListener('mousedown', (e) => {
    const row = e.target.closest('.terms-row');
    if (!row) return;
    e.preventDefault();
    commit(rows[Number(row.dataset.idx)]?.name);
    input.focus();
  });

  chipsEl.addEventListener('mousedown', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    e.preventDefault();
    values = values.filter((v) => v !== btn.dataset.remove);
    renderChips();
    listeners.forEach((fn) => fn());
    input.focus();
  });

  const api = {
    get: () => values.slice(),
    set(list) {
      values = (Array.isArray(list) ? list : list ? [list] : []).map(String).map((s) => s.trim()).filter(Boolean);
      renderChips();
    },
    setOptions(list) {
      options = (list || []).map((o) => (typeof o === 'string' ? { name: o, count: 0 } : o));
      renderChips(); // 「新建」标记要跟着候选名单重算
      if (!menu.hidden) openMenu();
    },
    onChange(fn) {
      listeners.push(fn);
    },
    focus: () => input.focus(),
  };

  TERMS[el.id] = api;
  renderChips();
  return api;
}

/** 把最新的分类 / 标签候选喂给所有输入框 */
function syncTermOptions() {
  if (!state.meta) return;
  for (const id of ['gCats', 'fCats']) TERMS[id]?.setOptions(state.meta.categories || []);
  for (const id of ['gTags', 'fTags']) TERMS[id]?.setOptions(state.meta.tags || []);
}

// ---------- 白天 / 黑夜 ----------

const THEME_KEY = 'mgr.theme';

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** 切换主题。persist=false 用于「跟随系统」，此时不写 localStorage */
function applyTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  const next = theme === 'dark' ? '切换到白天' : '切换到黑夜';
  const btn = $('btnTheme');
  btn.title = next;
  btn.setAttribute('aria-label', next);
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* 存不了就算了，本次会话内仍然有效 */
    }
  }
}

function bindTheme() {
  applyTheme(currentTheme(), false); // 把 title 同步成当前状态，别写 localStorage

  $('btnTheme').addEventListener('click', () => {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  });

  // 用户从没手动选过的时候跟着系统走；一旦点过按钮就以他的选择为准
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    let saved = null;
    try {
      saved = localStorage.getItem(THEME_KEY);
    } catch {
      /* 忽略 */
    }
    if (saved !== 'light' && saved !== 'dark') applyTheme(mq.matches ? 'dark' : 'light', false);
  });
}

// ---------- 状态栏 ----------

async function loadStatus() {
  try {
    const s = await api('/api/status');
    $('devDot').className = 'dot ' + (s.dev ? 'on' : 'off');
    $('devText').textContent = s.dev ? '站点运行中' : '站点未运行';
    $('devText').parentElement.title = s.dev
      ? '本地预览已开着，点「打开」可直接看效果'
      : '双击根目录的 预览.bat 启动站点';
    // 整串路径太长会在侧栏折成两行，只显示末两段，完整路径放 title
    const parts = String(s.postsDir || '').split(/[\\/]/);
    $('dirHint').textContent = parts.slice(-2).join('/');
    $('dirHint').title = s.postsDir;
  } catch {
    $('devText').textContent = '服务异常';
  }
}

// ---------- 文章格子墙 ----------

async function loadPosts() {
  try {
    const data = await api('/api/posts');
    state.posts = data.posts || [];
    renderStats();
    renderList();
  } catch (err) {
    $('postGrid').innerHTML = `<div class="empty">读取失败：${err.message}</div>`;
  }
}

function renderStats() {
  const total = state.posts.length;
  const drafts = state.posts.filter((p) => p.draft).length;
  const broken = state.posts.filter((p) => p.broken).length;
  $('stats').textContent = `${total} 篇${drafts ? ` · ${drafts} 草稿` : ''}${broken ? ` · ${broken} 异常` : ''}`;
}

function matches(p, sel) {
  if (!sel) return false;
  return (sel.kind === 'tags' ? p.tags : p.categories).includes(sel.name);
}

function cardHtml(p) {
  const cats = p.categories.map((c) => `<span class="chip accent">${esc(c)}</span>`).join('');
  const head = p.tags.slice(0, 3).map((t) => `<span class="chip">${esc(t)}</span>`).join('');
  const more = p.tags.length > 3 ? `<span class="chip">+${p.tags.length - 3}</span>` : '';
  return `
    <article class="card${matches(p, state.selected) ? ' match' : ''}" draggable="true" data-slug="${esc(p.slug)}">
      <div class="card-head">
        <h3 class="card-title" data-edit="${esc(p.slug)}">${esc(p.title)}</h3>
        ${p.draft ? '<span class="badge draft">草稿</span>' : ''}
        ${p.broken ? `<span class="badge error" title="${esc(p.broken)}">解析失败</span>` : ''}
      </div>
      ${p.description ? `<p class="card-desc">${esc(p.description)}</p>` : ''}
      <div class="card-meta">
        <span class="card-date">${esc(p.pubDate || '无日期')}</span>
        <span class="card-count">· ${p.chars} 字</span>
        ${cats}${head}${more}
        <span class="card-actions">
          <button class="btn" data-edit="${esc(p.slug)}">编辑</button>
          <button class="btn" data-open="${esc(p.slug)}">打开</button>
          <button class="btn danger" data-del="${esc(p.slug)}" title="移入回收箱">删除</button>
        </span>
      </div>
    </article>`;
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const sort = $('sortBy').value;

  let list = state.posts.filter((p) => {
    if (!q) return true;
    return [p.title, p.slug, ...p.tags, ...p.categories].join(' ').toLowerCase().includes(q);
  });

  if (sort === 'title') list = list.slice().sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  if (sort === 'chars') list = list.slice().sort((a, b) => b.chars - a.chars);

  // 选中某个分类 / 标签时，把命中的文章排到最前面（各自内部仍按上面的排序）。
  // 灰化由 .grid.filtering .card 负责，这里只动顺序，不改变「谁被选中」这件事。
  if (state.selected) {
    const hit = [];
    const rest = [];
    for (const p of list) (matches(p, state.selected) ? hit : rest).push(p);
    list = hit.concat(rest);
  }

  const grid = $('postGrid');
  grid.classList.toggle('filtering', !!state.selected);

  if (list.length === 0) {
    grid.innerHTML = `<div class="empty">${
      state.posts.length === 0
        ? '站里还没有文章。<br><br><button class="btn primary" id="emptyIngest">拖一篇进来</button>'
        : '没有匹配的文章'
    }</div>`;
    const b = $('emptyIngest');
    if (b) b.addEventListener('click', () => openModal('ingest'));
    return;
  }

  grid.innerHTML = list.map(cardHtml).join('');
}

// ---------- 第二列：标签 / 分类抽屉 ----------

function openDrawer(kind) {
  state.drawer = kind;
  state.selected = null;
  $('drawerTitle').textContent = kind === 'trash' ? '回收箱' : KIND_CN[kind];
  // 换抽屉就把搜索条件清掉：从「标签」切到「分类」还留着上一个关键词只会让人困惑
  $('drawerSearch').value = '';
  $('drawerSearch').placeholder = kind === 'trash' ? '搜索回收箱' : `搜索${KIND_CN[kind]}`;

  // 「新建 / 改名 / 删除」全在右键菜单里（回收箱没有这套），这里不用管按钮
  $('drawer').hidden = false;
  $('resizerDrawer').hidden = false;
  // 宽度不用管：applyLayout 里 --drawer-w 取 layout.drawer || layout.side，
  // 没单独调过就自动等于左侧栏 —— 别在这里把当时的 side 写死，
  // 否则用户之后拖宽左栏，抽屉会僵在旧宽度上不跟。
  renderDrawer();
  syncNav();
  if (kind === 'trash') loadTrash();
}

function closeDrawer() {
  state.drawer = null;
  state.selected = null;
  state.drag = null;
  closeCtx(); // 抽屉都收了，右键菜单别留在屏幕上
  $('drawer').hidden = true;
  $('resizerDrawer').hidden = true;
  renderList();
  syncNav();
}

function renderDrawer() {
  const kind = state.drawer;
  if (!kind) return;
  if (kind === 'trash') return renderTrash();

  const box = $('drawerList');
  const all = (state.meta && state.meta[kind]) || [];
  const raw = $('drawerSearch').value.trim();
  const q = raw.toLowerCase();
  const list = q ? all.filter((it) => it.name.toLowerCase().includes(q)) : all;

  // 没搜的时候讲怎么拖；搜了以后改成报匹配数，否则用户不知道筛掉了多少
  $('drawerHint').textContent = q
    ? `匹配 ${list.length} / ${all.length} 个${KIND_CN[kind]}`
    : kind === 'categories'
      ? '拖到文章上即可添加；右键可编辑简介 / 改名 / 删除'
      : `把${KIND_CN[kind]}拖到文章上即可添加；右键可新建 / 改名 / 删除`;

  if (all.length === 0) {
    box.innerHTML = `<div class="drawer-empty">还没有${KIND_CN[kind]}</div>`;
    return;
  }
  if (list.length === 0) {
    box.innerHTML = `<div class="drawer-empty">没有匹配「${esc(raw)}」的${KIND_CN[kind]}</div>`;
    return;
  }

  const descs = (state.meta && state.meta.descs) || {};

  box.innerHTML = list
    .map((it) => {
      const sel = state.selected && state.selected.kind === kind && state.selected.name === it.name;
      // 有简介的分类把简介挂进 title：抽屉很窄，不适合再塞一行字
      const desc = kind === 'categories' ? descs[it.name] : '';
      const tip = `拖到文章上，或点一下高亮同类；右键可操作${desc ? `\n简介：${desc}` : ''}`;
      return `<div class="drawer-item${sel ? ' selected' : ''}" draggable="true" data-kind="${kind}" data-term="${esc(it.name)}" title="${esc(tip)}">
        <i class="mark"></i><span class="name">${esc(it.name)}</span><span class="count">${it.count}</span>
      </div>`;
    })
    .join('');
}

// ---------- 新建 / 重命名 / 删除 分类、标签 ----------
//
// 用浏览器原生的 prompt / confirm，和「删除文章」那套确认保持一致，不额外造弹窗。
// 分类 / 标签没有独立数据：改名和删除会扫全部文章，把引用一起改掉。

async function createTerm(kind) {
  const name = prompt(`新建${KIND_CN[kind]}：\n起个名字就好，之后把文章拖进来即可。`);
  if (name === null) return;
  const term = name.trim();
  if (!term) return;
  try {
    await api('/api/taxonomy', {
      method: 'POST',
      body: JSON.stringify({ action: 'create', kind, name: term }),
    });
    toast(`已新建${KIND_CN[kind]}「${term}」`);
    // 新建后直接选中它，并清掉搜索，免得刚建的就因为搜索词看不见
    $('drawerSearch').value = '';
    state.selected = { kind, name: term };
    await refreshMeta();
    renderList();
    syncNav();
  } catch (err) {
    toast(err.message, true);
  }
}

async function renameTerm(kind, oldName) {
  const name = prompt(`把${KIND_CN[kind]}「${oldName}」改成：`, oldName);
  if (name === null) return;
  const term = name.trim();
  if (!term || term === oldName) return;
  try {
    const res = await api('/api/taxonomy', {
      method: 'POST',
      body: JSON.stringify({ action: 'rename', kind, oldName, newName: term }),
    });
    toast(res.affected ? `已改名，更新了 ${res.affected} 篇文章` : '已改名');
    if (state.selected && state.selected.kind === kind && state.selected.name === oldName) {
      state.selected = { kind, name: term };
    }
    await Promise.all([loadPosts(), refreshMeta()]);
    syncNav();
  } catch (err) {
    toast(err.message, true);
  }
}

async function removeTerm(kind, name) {
  const item = ((state.meta && state.meta[kind]) || []).find((x) => x.name === name);
  const count = item ? item.count : 0;
  const ok = confirm(
    `删除${KIND_CN[kind]}「${name}」？\n\n` +
      (count > 0
        ? `· ${count} 篇文章会失去这个${KIND_CN[kind]}\n· 文章本身不会被删，只是不再归在这一类\n· 这一步没法撤销`
        : '· 它现在没有挂任何文章\n· 删掉后列表里就看不到了'),
  );
  if (!ok) return;
  try {
    const res = await api('/api/taxonomy', {
      method: 'POST',
      body: JSON.stringify({ action: 'delete', kind, name }),
    });
    toast(res.affected ? `已删除，${res.affected} 篇文章已移出该${KIND_CN[kind]}` : '已删除');
    if (state.selected && state.selected.kind === kind && state.selected.name === name) {
      state.selected = null;
    }
    await Promise.all([loadPosts(), refreshMeta()]);
    syncNav();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- 分类简介 ----------
//
// 简介不属于文章，存在博客仓库的 site/src/data/categories.ts；
// 保存后 dev 会自动刷新，正式站要重新构建才看得到。
//
// 用 prompt 而不是自定义弹窗：和「重命名」一致，而且是一句话的东西。
// 预填当前值，直接回车不改；清空则删掉这条简介。

async function editCategoryDesc(name) {
  const cur = (state.meta && state.meta.descs && state.meta.descs[name]) || '';
  const text = prompt(
    `给分类「${name}」写一句简介：\n\n` +
      '· 会显示在「分类」列表的卡片上，以及该分类页标题下面\n' +
      '· 一句话就够，留空表示不要简介',
    cur,
  );
  if (text === null) return;

  try {
    const res = await api('/api/taxonomy', {
      method: 'POST',
      body: JSON.stringify({ action: 'desc', name, desc: text }),
    });
    if (!res.changed) toast('简介没有变化');
    else if (!res.desc) toast(`已清空「${name}」的简介`);
    else toast(`已保存「${name}」的简介`);
    await refreshMeta(); // 里面会重绘抽屉，title 上的简介跟着更新
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- 右键菜单：新建 / 改名 / 删除 ----------
//
// 2026-11-03 用户要求：抽屉里不放小按钮，改成右键唤出。
// 菜单只有几种动作，直接拆 DOM 拼，不引组件。
// 用 fixed + 贴边夹取：抽屉窄，靠屏幕右边 / 底边右键也能完整看到。
//
// ctxTarget 记住「右键点的是哪一项」：name 为 null 表示点的是空白区（只能新建）。

let ctxTarget = null;

function closeCtx() {
  const m = $('ctxMenu');
  if (!m || m.hidden) return false;
  m.hidden = true;
  ctxTarget = null;
  return true;
}

function openCtx(x, y, rows) {
  const m = $('ctxMenu');
  if (!m) return;
  m.innerHTML = rows
    .map((r) =>
      r.sep
        ? '<div class="ctx-sep"></div>'
        : `<button type="button" class="ctx-item${r.danger ? ' danger' : ''}" data-ctx-act="${r.id}">${esc(r.label)}</button>`,
    )
    .join('');
  m.hidden = false;
  // 先量再夹：内容撑出来的宽高只有在显示后才知道
  const { width, height } = m.getBoundingClientRect();
  m.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  m.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}

function bindCtx() {
  const list = $('drawerList');

  list.addEventListener('contextmenu', (e) => {
    const kind = state.drawer;
    if (!KIND_CN[kind]) return; // 回收箱没有分类 / 标签这套
    e.preventDefault();
    const item = e.target.closest('.drawer-item');
    if (item) {
      ctxTarget = { kind, name: item.dataset.term };
      const hasDesc = kind === 'categories' && !!(state.meta.descs && state.meta.descs[item.dataset.term]);
      openCtx(e.clientX, e.clientY, [
        // 简介只有分类有：站点的标签页没有「简介」这个概念
        ...(kind === 'categories' ? [{ id: 'desc', label: hasDesc ? '编辑简介' : '写简介' }] : []),
        { id: 'rename', label: '重命名' },
        { id: 'delete', label: '删除', danger: true },
        { sep: true },
        { id: 'create', label: `新建${KIND_CN[kind]}` },
      ]);
    } else {
      // 空白处右键：只给「新建」，其它两个没有对象
      ctxTarget = { kind, name: null };
      openCtx(e.clientX, e.clientY, [{ id: 'create', label: `新建${KIND_CN[kind]}` }]);
    }
  });

  $('ctxMenu').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-ctx-act]');
    if (!btn || !ctxTarget) return;
    const { kind, name } = ctxTarget;
    const act = btn.dataset.ctxAct;
    closeCtx();
    if (act === 'create') return createTerm(kind);
    if (act === 'desc' && name) return editCategoryDesc(name);
    if (act === 'rename' && name) return renameTerm(kind, name);
    if (act === 'delete' && name) return removeTerm(kind, name);
  });

  // 点别处 / 滚动 / 改窗口大小都收起来，免得菜单飘在内容上
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#ctxMenu')) closeCtx();
  });
  document.addEventListener('scroll', closeCtx, true);
  window.addEventListener('resize', closeCtx);
  window.addEventListener('blur', closeCtx);
}

// ---------- 回收箱 ----------
//
// 删除分两级（2026-11-01 用户要求）：
//   卡片上「删除」→ 文件移到 文章管家/回收箱/，博客上立刻消失，可以恢复
//   回收箱里再删 → 交给 Windows 回收站
// 回收箱在 site/ 之外，所以 Astro 根本扫不到，也用不着在构建时排除。

async function loadTrash() {
  try {
    const data = await api('/api/trash');
    state.trash = data.items || [];
  } catch {
    state.trash = [];
  }
  if (state.drawer === 'trash') renderTrash();
}

function shortDateTime(iso) {
  // ISO → 11-01 14:30（只取月日时，年份对回收箱没意义）
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderTrash() {
  const box = $('drawerList');
  const all = state.trash;
  const raw = $('drawerSearch').value.trim();
  const q = raw.toLowerCase();
  const list = q ? all.filter((t) => `${t.title} ${t.slug}`.toLowerCase().includes(q)) : all;

  $('drawerHint').textContent = q
    ? `匹配 ${list.length} / ${all.length} 篇回收箱里的文章`
    : '这里的文章在博客上已经看不到。恢复就点「恢复」，彻底删除会丢进电脑的回收站';

  if (all.length === 0) {
    box.innerHTML = '<div class="drawer-empty">回收箱是空的</div>';
    return;
  }
  if (list.length === 0) {
    box.innerHTML = `<div class="drawer-empty">没有匹配「${esc(raw)}」的文章</div>`;
    return;
  }

  box.innerHTML = list
    .map(
      (t) => `<div class="trash-row">
        <div class="trash-title" title="${esc(t.slug)}.md">${esc(t.title)}</div>
        <div class="trash-meta">${esc(t.pubDate || '无日期')} · 删于 ${esc(shortDateTime(t.deletedAt))}</div>
        <div class="trash-btns">
          <button class="btn tiny" data-restore="${esc(t.slug)}">恢复</button>
          <button class="btn tiny danger" data-purge="${esc(t.slug)}">彻底删除</button>
        </div>
      </div>`,
    )
    .join('');
}

async function trashPost(slug) {
  const post = state.posts.find((p) => p.slug === slug);
  const name = post ? post.title : slug;
  const ok = confirm(
    `把《${name}》移进回收箱？\n\n· 博客上会立刻看不到它\n· 文件还在「回收箱」里，随时可以恢复\n· 想彻底删掉，要在回收箱里再删一次`,
  );
  if (!ok) return;

  try {
    const res = await api(`/api/posts/${encodeURIComponent(slug)}/trash`, { method: 'POST' });
    if (state.current && state.current.slug === slug) closeModal('edit');
    toast(`已移入回收箱：${res.trashedAs}.md`);
    await Promise.all([loadPosts(), refreshMeta(), loadTrash()]);
  } catch (err) {
    toast(err.message, true);
  }
}

async function restorePost(slug) {
  try {
    const res = await api(`/api/trash/${encodeURIComponent(slug)}/restore`, { method: 'POST' });
    toast(res.renamed ? `已恢复，站里已有同名，改名为 ${res.slug}.md` : `已恢复 ${res.slug}.md`);
    await Promise.all([loadPosts(), refreshMeta(), loadTrash()]);
  } catch (err) {
    toast(err.message, true);
  }
}

async function purgePost(slug) {
  const item = state.trash.find((t) => t.slug === slug);
  const name = item ? item.title : slug;
  const ok = confirm(
    `彻底删除《${name}》？\n\n文件会被放进**电脑的回收站**（不是永久删除），要彻底清掉得自己去清空系统回收站。\n\n在文章管家里，这一步之后就没法撤销了。`,
  );
  if (!ok) return;

  try {
    await api(`/api/trash/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    toast('已放进电脑回收站');
    await loadTrash();
  } catch (err) {
    toast(err.message, true);
  }
}

function syncNav() {
  document.querySelectorAll('.nav-item').forEach((b) => {
    const k = b.dataset.nav;
    const cur = k === 'posts' ? !state.drawer : k === state.drawer;
    b.setAttribute('aria-current', String(cur));
  });
  $('pageTitle').textContent = state.selected
    ? `全部文章 · ${KIND_CN[state.selected.kind]}「${state.selected.name}」`
    : '全部文章';
}

// ---------- 拖拽：标签 / 分类 ⇄ 文章 ----------

function clearDropMarks() {
  document.querySelectorAll('.drop-ok').forEach((el) => el.classList.remove('drop-ok'));
  document.querySelectorAll('.card.dragging').forEach((el) => el.classList.remove('dragging'));
}

function markOnly(el) {
  document.querySelectorAll('.drop-ok').forEach((x) => {
    if (x !== el) x.classList.remove('drop-ok');
  });
  if (el) el.classList.add('drop-ok');
}

async function addTerm(slug, kind, name) {
  const post = state.posts.find((p) => p.slug === slug);
  if (!post) return;
  const has = (kind === 'tags' ? post.tags : post.categories).includes(name);
  if (has) {
    toast(`「${post.title}」已经有${KIND_CN[kind]}「${name}」了`);
    return;
  }

  try {
    const res = await api(`/api/posts/${encodeURIComponent(slug)}/terms`, {
      method: 'POST',
      body: JSON.stringify({ kind, name, action: 'add' }),
    });
    if (!res.changed) {
      toast('没有变化');
      return;
    }
    toast(`已给「${post.title}」加上${KIND_CN[kind]}「${name}」`);
    await Promise.all([loadPosts(), refreshMeta()]);
  } catch (err) {
    toast(err.message, true);
  }
}

function bindDrag() {
  const grid = $('postGrid');
  const list = $('drawerList');

  // --- 从文章开始拖 ---
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    state.drag = { type: 'post', slug: card.dataset.slug };
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', card.dataset.slug); // Firefox 不设就不开始拖
  });

  // --- 从抽屉开始拖 ---
  list.addEventListener('dragstart', (e) => {
    const item = e.target.closest('.drawer-item');
    if (!item) return;
    state.drag = { type: 'term', kind: item.dataset.kind, name: item.dataset.term };
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', item.dataset.term);
  });

  document.addEventListener('dragend', () => {
    state.drag = null;
    clearDropMarks();
  });

  // --- 标签 / 分类 → 文章 ---
  grid.addEventListener('dragover', (e) => {
    if (!state.drag || state.drag.type !== 'term') return;
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    markOnly(card);
  });

  grid.addEventListener('drop', async (e) => {
    if (!state.drag || state.drag.type !== 'term') return;
    const card = e.target.closest('.card');
    if (!card) return;
    e.preventDefault();
    const { kind, name } = state.drag;
    state.drag = null;
    clearDropMarks();
    await addTerm(card.dataset.slug, kind, name);
  });

  // --- 文章 → 抽屉里的某一项 ---
  list.addEventListener('dragover', (e) => {
    if (!state.drag || state.drag.type !== 'post') return;
    const item = e.target.closest('.drawer-item');
    if (!item) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    markOnly(item);
  });

  list.addEventListener('drop', async (e) => {
    if (!state.drag || state.drag.type !== 'post') return;
    const item = e.target.closest('.drawer-item');
    if (!item) return;
    e.preventDefault();
    const slug = state.drag.slug;
    state.drag = null;
    clearDropMarks();
    await addTerm(slug, item.dataset.kind, item.dataset.term);
  });

  // --- 抽屉项点击：高亮同类文章，再点取消 ---
  list.addEventListener('click', (e) => {
    const item = e.target.closest('.drawer-item');
    if (!item) return;
    const kind = item.dataset.kind;
    const name = item.dataset.term;
    const same = state.selected && state.selected.kind === kind && state.selected.name === name;
    state.selected = same ? null : { kind, name };
    renderDrawer();
    renderList();
    syncNav();
  });
}

// ---------- 悬浮窗 ----------

const MODAL_ID = { ingest: 'modalIngest', edit: 'modalEdit' };

function openModal(name) {
  const el = $(MODAL_ID[name]);
  if (!el) return;
  el.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeModal(name) {
  const el = $(MODAL_ID[name]);
  if (!el) return;
  el.hidden = true;
  if (!document.querySelector('.modal:not([hidden])')) document.body.style.overflow = '';
  if (name === 'edit') {
    state.current = null;
    state.dirty = false;
  }
}

function closeTopModal() {
  const open = [...document.querySelectorAll('.modal')].filter((m) => !m.hidden);
  if (open.length === 0) return false;
  const name = open[open.length - 1].id === 'modalEdit' ? 'edit' : 'ingest';
  if (name === 'edit' && state.dirty && !confirm('有未保存的改动，确定关闭吗？')) return true;
  if (name === 'ingest') resetIngest();
  closeModal(name);
  return true;
}

// ---------- 编辑 ----------

async function openEdit(slug) {
  try {
    const post = await api(`/api/posts/${encodeURIComponent(slug)}`);
    state.current = post;
    state.dirty = false;

    const d = post.data;
    $('fTitle').value = d.title ?? '';
    $('fDesc').value = d.description ?? d.explain ?? '';
    $('fDate').value = String(d.pubDate ?? d.date ?? d.created ?? '').slice(0, 10);
    $('fUpdated').value = String(d.updatedDate ?? '').slice(0, 10);
    TERMS.fCats.set(Array.isArray(d.categories) ? d.categories : d.categories ? [d.categories] : []);
    TERMS.fTags.set(Array.isArray(d.tags) ? d.tags : d.tags ? [d.tags] : []);
    $('fDraft').checked = d.draft === true;
    $('fBody').value = post.body;

    $('editSlug').textContent = `${slug}.md`;
    setSaveState('没有改动');
    syncTermOptions();
    openModal('edit');
  } catch (err) {
    toast(err.message, true);
  }
}

function setSaveState(text, dirty = false) {
  const el = $('saveState');
  el.textContent = text;
  el.className = 'state' + (dirty ? ' dirty' : '');
}

function markDirty() {
  state.dirty = true;
  setSaveState('有未保存的改动（Ctrl+S 保存）', true);
}

async function save(force = false) {
  if (!state.current) return;
  const meta = {
    title: $('fTitle').value,
    description: $('fDesc').value,
    pubDate: $('fDate').value,
    updatedDate: $('fUpdated').value || undefined,
    categories: TERMS.fCats.get(),
    tags: TERMS.fTags.get(),
    draft: $('fDraft').checked,
  };

  $('btnSave').disabled = true;
  try {
    const res = await api(`/api/posts/${encodeURIComponent(state.current.slug)}`, {
      method: 'PUT',
      body: JSON.stringify({
        meta,
        body: $('fBody').value,
        baseHash: force ? undefined : state.current.hash,
      }),
    });

    // 存完重读一次，拿新哈希
    const fresh = await api(`/api/posts/${encodeURIComponent(state.current.slug)}`);
    state.current = fresh;
    state.dirty = false;
    setSaveState(
      res.saved
        ? `已保存${res.changed && res.changed.length ? `（改了 ${res.changed.join('、')}）` : ''}${res.bodyChanged ? '（含正文）' : ''}`
        : '没有变化，未写文件',
    );
    toast(res.saved ? '已保存，站点会自动热更新' : '没有变化');
    await Promise.all([loadStatus(), refreshMeta(), loadPosts()]);
  } catch (err) {
    if (err.code === 'CONFLICT') {
      const cover = confirm(
        '磁盘上的文件比这里打开时的版本新（可能刚在 Obsidian 或编辑器里改过）。\n\n点「确定」用这里的版本覆盖磁盘；点「取消」放弃本次保存。',
      );
      if (cover) {
        $('btnSave').disabled = false;
        return save(true);
      }
      setSaveState('保存已取消（磁盘版本更新）');
      return;
    }
    toast(err.message, true);
    setSaveState('保存失败：' + err.message, true);
  } finally {
    $('btnSave').disabled = false;
  }
}

async function refreshMeta() {
  try {
    state.meta = await api('/api/taxonomy');
    syncTermOptions();
    if (state.drawer) renderDrawer();
  } catch {
    /* 分类候选拿不到不影响主流程 */
  }
}

// ---------- 入库 ----------

function renderChecks(checks) {
  const markOf = { error: '错误', warn: '注意', info: '说明', ok: '正常' };
  $('checks').innerHTML = checks
    .map((c) => `<div class="check ${c.level}"><span class="mark">${markOf[c.level] || '·'}</span><span>${esc(c.text)}</span></div>`)
    .join('');
}

async function handleFile(file) {
  if (!file) return;
  if (!/\.(md|markdown)$/i.test(file.name)) {
    toast('只认 .md / .markdown 文件', true);
    return;
  }
  const raw = await file.text();
  state.raw = raw;

  try {
    const plan = await api('/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ raw, filename: file.name }),
    });
    state.plan = plan;

    $('ingestBody').hidden = false;
    renderChecks(plan.checks);

    if (!plan.meta) {
      $('btnIngest').disabled = true;
      return;
    }
    $('btnIngest').disabled = false;

    // 文件名和标题都是自动的，用户不用改；重复了服务端会自动加 -2
    $('gSlug').value = plan.slug || plan.slugCandidates[0] || '';
    $('gTitle').value = plan.meta.title || '';
    $('gDesc').value = plan.meta.description || '';
    $('gDate').value = plan.meta.pubDate || '';
    TERMS.gCats.set(plan.meta.categories);
    TERMS.gTags.set(plan.meta.tags);
    $('gDraft').checked = plan.meta.draft === true;

    $('pickSlug').innerHTML = plan.slugCandidates
      .map((s) => `<span class="chip click" data-slug="${esc(s)}">${esc(s)}</span>`)
      .join('');

    $('pickTitle').innerHTML = (plan.altTitles || [])
      .map((t) => `<span class="chip click" data-title="${esc(t.value)}">${esc(t.label)}</span>`)
      .join('');

    $('descHint').textContent = plan.descFromFile
      ? '来自原文，可以改'
      : '原文没写摘要 —— 自动截取了正文第一段，可以直接改';

    await refreshMeta();
    updateSlugPreview();
    $('bodyPreview').textContent = plan.body.split('\n').slice(0, 40).join('\n');
  } catch (err) {
    toast(err.message, true);
  }
}

function updateSlugPreview() {
  const s = $('gSlug').value.trim();
  $('slugPreview').textContent = s ? `最终地址：/posts/${s}/` : '还没填文件名';
}

async function doIngest() {
  const slug = $('gSlug').value.trim();
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    toast('文件名只能用英文小写、数字、短横线', true);
    return;
  }
  const meta = {
    title: $('gTitle').value,
    description: $('gDesc').value,
    pubDate: $('gDate').value,
    categories: TERMS.gCats.get(), // 可以为空
    tags: TERMS.gTags.get(),
  };
  if (!meta.description.trim()) {
    toast('摘要不能空着（会显示在列表和搜索结果里）', true);
    $('gDesc').focus();
    return;
  }

  $('btnIngest').disabled = true;
  try {
    const res = await api('/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ raw: state.raw, slug, meta }),
    });

    toast(res.renamed ? `已写入 ${res.slug}.md（原名重复，自动加了序号）` : '已写入，源文件请留在 Obsidian，以后改站点这一份');
    resetIngest();
    closeModal('ingest');
    await Promise.all([refreshMeta(), loadPosts()]);

    // 站点开着就顺手打开这篇
    try {
      const st = await api('/api/status');
      if (st.dev) window.open(`${st.blogUrl}${res.url}`, '_blank');
    } catch {
      /* 打不开就算了，不影响入库 */
    }
  } catch (err) {
    toast(err.message, true);
  } finally {
    $('btnIngest').disabled = false;
  }
}

function resetIngest() {
  state.plan = null;
  state.raw = '';
  $('ingestBody').hidden = true;
  $('fileInput').value = '';
  $('drop').classList.remove('over');
}

// ---------- 打开站点 ----------

async function openInSite(slug, askLaunch = false) {
  try {
    const st = await api('/api/status');
    if (st.dev) {
      window.open(`${st.blogUrl}/posts/${slug}/`, '_blank');
      return;
    }
    if (!askLaunch) {
      toast('站点没在运行 —— 双击根目录的 预览.bat', true);
      return;
    }
    if (!confirm('站点没在运行。要现在启动预览吗？（会打开一个新窗口跑 dev）')) return;
    await api('/api/open-dev', { method: 'POST' });
    toast('正在启动站点，等几秒后刷新');
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------- 事件绑定 ----------

function bind() {
  // 导航
  document.querySelectorAll('.nav-item').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.nav;
      if (k === 'posts') return closeDrawer();
      if (k === 'ingest') return openModal('ingest');
      if (state.drawer === k) return closeDrawer(); // 再点一次收起
      openDrawer(k);
      $('drawerSearch').focus(); // 打开就是来搜或来拖的，光标直接落在搜索框
    }),
  );

  $('drawerClose').addEventListener('click', closeDrawer);

  $('drawerSearch').addEventListener('input', renderDrawer);
  $('drawerSearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !e.target.value) return;
    e.stopPropagation(); // 有搜索词时 Esc 先清搜索，别顺手把整个抽屉关了
    e.target.value = '';
    renderDrawer();
  });
  $('btnOpenIngest').addEventListener('click', () => openModal('ingest'));

  // 悬浮窗关闭（遮罩、× 按钮、底部按钮都走 data-close）
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) {
      const name = closer.dataset.close;
      if (name === 'edit' && state.dirty && !confirm('有未保存的改动，确定关闭吗？')) return;
      if (name === 'ingest') resetIngest();
      return closeModal(name);
    }

    const edit = e.target.closest('[data-edit]');
    if (edit) return openEdit(edit.dataset.edit);

    const open = e.target.closest('[data-open]');
    if (open) return openInSite(open.dataset.open);

    const del = e.target.closest('[data-del]');
    if (del) return trashPost(del.dataset.del);

    const restore = e.target.closest('[data-restore]');
    if (restore) return restorePost(restore.dataset.restore);

    const purge = e.target.closest('[data-purge]');
    if (purge) return purgePost(purge.dataset.purge);

    const slugPick = e.target.closest('[data-slug]');
    if (slugPick) {
      $('gSlug').value = slugPick.dataset.slug;
      updateSlugPreview();
    }

    const titlePick = e.target.closest('[data-title]');
    if (titlePick) $('gTitle').value = titlePick.dataset.title;
  });

  // 工具栏
  $('search').addEventListener('input', renderList);
  $('sortBy').addEventListener('change', renderList);
  $('btnReload').addEventListener('click', async () => {
    await Promise.all([loadPosts(), loadStatus(), refreshMeta()]);
    toast('已重新读盘');
  });

  // 编辑窗
  $('btnSave').addEventListener('click', () => save());
  $('btnReloadPost').addEventListener('click', async () => {
    if (state.dirty && !confirm('重新读盘会丢掉当前未保存的改动，继续？')) return;
    await openEdit(state.current.slug);
    toast('已从磁盘重读');
  });
  $('btnOpenPost').addEventListener('click', () => state.current && openInSite(state.current.slug, true));

  for (const id of ['fTitle', 'fDesc', 'fDate', 'fUpdated']) {
    $(id).addEventListener('input', markDirty);
  }
  TERMS.fCats.onChange(markDirty);
  TERMS.fTags.onChange(markDirty);
  $('fDraft').addEventListener('change', markDirty);
  $('fBody').addEventListener('input', markDirty);

  // 正文里 Tab 插入两个空格，不跳焦点
  $('fBody').addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const t = e.target;
      const start = t.selectionStart;
      t.value = t.value.slice(0, start) + '  ' + t.value.slice(t.selectionEnd);
      t.selectionStart = t.selectionEnd = start + 2;
      markDirty();
    }
  });

  // 入库
  const drop = $('drop');
  drop.addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => handleFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    }),
  );
  drop.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));

  $('gSlug').addEventListener('input', updateSlugPreview);
  $('btnIngest').addEventListener('click', doIngest);
  $('btnResetIngest').addEventListener('click', resetIngest);

  bindResizer($('resizerSide'), 'side');
  bindResizer($('resizerDrawer'), 'drawer');
  bindDrag();
  bindCtx();
  bindTheme();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (closeCtx()) return; // 右键菜单开着时，Esc 先收菜单
      if (closeTopModal()) return;
      if (state.drawer) closeDrawer();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!$('modalEdit').hidden) save();
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

// ---------- 启动 ----------

(async function init() {
  applyLayout();
  // 分类 / 标签输入框要先建好，bind() 里会给它们挂「有改动」的回调
  for (const id of ['gCats', 'gTags', 'fCats', 'fTags']) mountTerms($(id));
  bind();
  await refreshMeta();
  await loadStatus();
  await loadPosts();
  await loadTrash();

  // 直接用地址进来：/#/edit/<文件名> 、/#/ingest 、/#/tags 、/#/categories
  const hash = decodeURIComponent(location.hash || '');
  if (hash.startsWith('#/edit/')) {
    await openEdit(hash.slice('#/edit/'.length));
  } else if (hash === '#/ingest') {
    openModal('ingest');
  } else if (hash === '#/tags' || hash === '#/categories' || hash === '#/trash') {
    openDrawer(hash.slice(2));
  }

  setInterval(loadStatus, 30000);
})();

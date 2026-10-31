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
  meta: null, // 分类 / 标签候选
  current: null, // 正在编辑的那篇（含 hash，用于冲突检测）
  dirty: false,
  plan: null, // 入库诊断结果
  raw: '', // 入库文件原文
  drawer: null, // null | 'tags' | 'categories'
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

function splitList(text) {
  return String(text || '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const KIND_CN = { tags: '标签', categories: '分类' };

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
        <span>${esc(p.pubDate || '无日期')}</span>
        <span>· ${p.chars} 字</span>
        ${cats}${head}${more}
        <span class="card-actions">
          <button class="btn" data-edit="${esc(p.slug)}">编辑</button>
          <button class="btn" data-open="${esc(p.slug)}">打开</button>
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
  $('drawerTitle').textContent = KIND_CN[kind];
  $('drawerHint').textContent = `把${KIND_CN[kind]}拖到右边的文章上即可添加；也可以把文章拖进这里`;
  $('drawer').hidden = false;
  $('resizerDrawer').hidden = false;
  // 宽度不用管：applyLayout 里 --drawer-w 取 layout.drawer || layout.side，
  // 没单独调过就自动等于左侧栏 —— 别在这里把当时的 side 写死，
  // 否则用户之后拖宽左栏，抽屉会僵在旧宽度上不跟。
  renderDrawer();
  syncNav();
}

function closeDrawer() {
  state.drawer = null;
  state.selected = null;
  state.drag = null;
  $('drawer').hidden = true;
  $('resizerDrawer').hidden = true;
  renderList();
  syncNav();
}

function renderDrawer() {
  const kind = state.drawer;
  if (!kind) return;
  const box = $('drawerList');
  const list = (state.meta && state.meta[kind]) || [];

  if (list.length === 0) {
    box.innerHTML = `<div class="drawer-empty">还没有${KIND_CN[kind]}</div>`;
    return;
  }

  box.innerHTML = list
    .map((it) => {
      const sel = state.selected && state.selected.kind === kind && state.selected.name === it.name;
      return `<div class="drawer-item${sel ? ' selected' : ''}" draggable="true" data-kind="${kind}" data-term="${esc(it.name)}" title="拖到文章上，或点一下高亮同类">
        <i class="mark"></i><span class="name">${esc(it.name)}</span><span class="count">${it.count}</span>
      </div>`;
    })
    .join('');
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
    $('fCats').value = (Array.isArray(d.categories) ? d.categories : d.categories ? [d.categories] : []).join(', ');
    $('fTags').value = (Array.isArray(d.tags) ? d.tags : d.tags ? [d.tags] : []).join(', ');
    $('fDraft').checked = d.draft === true;
    $('fBody').value = post.body;

    $('editSlug').textContent = `${slug}.md`;
    setSaveState('没有改动');
    renderPickers();
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

function renderPickers() {
  if (!state.meta) return;
  $('pickCats').innerHTML = (state.meta.categories || [])
    .map((c) => `<span class="chip click" data-add="fCats" data-val="${esc(c.name)}">＋ ${esc(c.name)}</span>`)
    .join('');
  $('pickTags').innerHTML = (state.meta.tags || [])
    .map((t) => `<span class="chip click" data-add="fTags" data-val="${esc(t.name)}">＋ ${esc(t.name)}</span>`)
    .join('');
}

async function save(force = false) {
  if (!state.current) return;
  const meta = {
    title: $('fTitle').value,
    description: $('fDesc').value,
    pubDate: $('fDate').value,
    updatedDate: $('fUpdated').value || undefined,
    categories: splitList($('fCats').value),
    tags: splitList($('fTags').value),
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
    renderPickers();
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

    $('gSlug').value = plan.slugCandidates[0] || '';
    $('gTitle').value = plan.meta.title || '';
    $('gDesc').value = plan.meta.description || '';
    $('gDate').value = plan.meta.pubDate || '';
    $('gCats').value = plan.meta.categories.join(', ');
    $('gTags').value = plan.meta.tags.join(', ');
    $('gDraft').checked = plan.meta.draft === true;

    $('pickSlug').innerHTML = plan.slugCandidates
      .slice(1)
      .map((s) => `<span class="chip click" data-slug="${esc(s)}">${esc(s)}</span>`)
      .join('');

    $('descHint').textContent = plan.meta.description
      ? '来自原文，可以改'
      : '原文件没写摘要 —— 请用一句话说清这篇讲什么（会出现在列表和搜索结果里）';

    await refreshMeta();
    renderGTags();
    updateSlugPreview();
    $('bodyPreview').textContent = plan.body.split('\n').slice(0, 40).join('\n');
  } catch (err) {
    toast(err.message, true);
  }
}

function renderGTags() {
  if (!state.meta) return;
  $('pickGTags').innerHTML = (state.meta.tags || [])
    .map((t) => `<span class="chip click" data-add="gTags" data-val="${esc(t.name)}">＋ ${esc(t.name)}</span>`)
    .join('');
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
    categories: splitList($('gCats').value),
    tags: splitList($('gTags').value),
  };
  if (!meta.description.trim()) {
    toast('摘要不能空着', true);
    $('gDesc').focus();
    return;
  }

  $('btnIngest').disabled = true;
  try {
    const res = await api('/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ raw: state.raw, slug, meta }),
    });

    toast('已写入，源文件请留在 Obsidian，以后改站点这一份');
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
    }),
  );

  $('drawerClose').addEventListener('click', closeDrawer);
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

    const add = e.target.closest('[data-add]');
    if (add) {
      const input = $(add.dataset.add);
      const cur = splitList(input.value);
      const v = add.dataset.val;
      if (!cur.includes(v)) cur.push(v);
      input.value = cur.join(', ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const slugPick = e.target.closest('[data-slug]');
    if (slugPick) {
      $('gSlug').value = slugPick.dataset.slug;
      updateSlugPreview();
    }
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

  for (const id of ['fTitle', 'fDesc', 'fDate', 'fUpdated', 'fCats', 'fTags']) {
    $(id).addEventListener('input', markDirty);
  }
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

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
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
  bind();
  await refreshMeta();
  await loadStatus();
  await loadPosts();

  // 直接用地址进来：/#/edit/<文件名> 、/#/ingest 、/#/tags 、/#/categories
  const hash = decodeURIComponent(location.hash || '');
  if (hash.startsWith('#/edit/')) {
    await openEdit(hash.slice('#/edit/'.length));
  } else if (hash === '#/ingest') {
    openModal('ingest');
  } else if (hash === '#/tags' || hash === '#/categories') {
    openDrawer(hash.slice(2));
  }

  setInterval(loadStatus, 30000);
})();

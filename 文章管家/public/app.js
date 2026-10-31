// 文章管家 · 前端逻辑（原生 JS，无框架）
//
// 原则：所有数据都来自后端现读磁盘，前端不缓存任何「文章内容」。
// 唯一保留的状态是：当前打开的是哪篇、打开时的文件哈希（用于冲突检测）。

const $ = (id) => document.getElementById(id);

const state = {
  posts: [],
  meta: null, // 当前编辑的分类/标签候选
  current: null, // { slug, hash, ... }
  dirty: false,
  plan: null, // 入库诊断结果
  raw: '', // 入库文件的原文
};

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

function splitList(text) {
  return String(text || '')
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------- 视图切换 ----------

function show(view) {
  for (const v of ['list', 'edit', 'ingest']) {
    $(`view-${v}`).hidden = v !== view;
  }
  document.querySelectorAll('.nav-item').forEach((b) => {
    const target = b.dataset.view;
    b.setAttribute('aria-current', String(target === view || (view === 'edit' && target === 'list')));
  });
  $('pageTitle').textContent = view === 'edit' ? '编辑文章' : view === 'ingest' ? '入库' : '文章';
  if (view === 'list') loadPosts();
  window.scrollTo(0, 0);
}

// ---------- 状态栏 ----------

async function loadStatus() {
  try {
    const s = await api('/api/status');
    $('devDot').className = 'dot ' + (s.dev ? 'on' : 'off');
    $('devText').textContent = s.dev ? '站点运行中' : '站点未运行';
    $('devText').parentElement.title = s.dev
      ? '本地预览已开着，点「在站点打开」可直接看效果'
      : '双击根目录的 预览.bat 启动站点';
    // 路径整串太长会在侧栏折成两行，只显示末两段，完整路径放 title
    const parts = String(s.postsDir || '').split(/[\\/]/);
    $('dirHint').textContent = parts.slice(-2).join('/');
    $('dirHint').title = s.postsDir;
  } catch {
    $('devText').textContent = '服务异常';
  }
}

// ---------- 文章列表 ----------

async function loadPosts() {
  const box = $('postList');
  try {
    const data = await api('/api/posts');
    state.posts = data.posts || [];
    renderStats();
    renderCatFilter();
    renderList();
  } catch (err) {
    box.innerHTML = `<div class="empty">读取失败：${err.message}</div>`;
  }
}

function renderStats() {
  const total = state.posts.length;
  const drafts = state.posts.filter((p) => p.draft).length;
  const broken = state.posts.filter((p) => p.broken).length;
  $('stats').textContent = `${total} 篇${drafts ? ` · ${drafts} 草稿` : ''}${broken ? ` · ${broken} 异常` : ''}`;
}

function renderCatFilter() {
  const sel = $('filterCat');
  const now = sel.value;
  const cats = [...new Set(state.posts.flatMap((p) => p.categories))].sort((a, b) => a.localeCompare(b, 'zh'));
  sel.innerHTML = '<option value="">全部分类</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = cats.includes(now) ? now : '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderList() {
  const q = $('search').value.trim().toLowerCase();
  const cat = $('filterCat').value;
  const sort = $('sortBy').value;

  let list = state.posts.filter((p) => {
    if (cat && !p.categories.includes(cat)) return false;
    if (!q) return true;
    return [p.title, p.slug, ...p.tags, ...p.categories].join(' ').toLowerCase().includes(q);
  });

  if (sort === 'title') list = list.slice().sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  if (sort === 'chars') list = list.slice().sort((a, b) => b.chars - a.chars);

  const box = $('postList');
  if (list.length === 0) {
    box.innerHTML = `<div class="empty">${
      state.posts.length === 0 ? '站里还没有文章。<br><br><button class="btn primary" data-goto="ingest">拖一篇进来</button>' : '没有匹配的文章'
    }</div>`;
    return;
  }

  box.innerHTML = list
    .map((p) => {
      const cats = p.categories.map((c) => `<span class="chip accent">${esc(c)}</span>`).join('');
      const tags = p.tags.slice(0, 4).map((t) => `<span class="chip">${esc(t)}</span>`).join('');
      return `
      <div class="card">
        <div class="card-head">
          <h3 class="card-title" data-edit="${esc(p.slug)}">${esc(p.title)}</h3>
          ${p.draft ? '<span class="badge draft">草稿</span>' : ''}
          ${p.broken ? `<span class="badge error" title="${esc(p.broken)}">解析失败</span>` : ''}
        </div>
        ${p.description ? `<p class="card-desc">${esc(p.description)}</p>` : ''}
        <div class="card-meta">
          <span>${esc(p.pubDate || '无日期')}</span>
          ${p.updatedDate ? `<span>· 已更新 ${esc(p.updatedDate)}</span>` : ''}
          ${cats}${tags}
          <span>· ${p.chars} 字 · ${p.minutes} 分钟</span>
          <span>· /posts/${esc(p.slug)}/</span>
          <span class="card-actions">
            <button class="btn" data-edit="${esc(p.slug)}">编辑</button>
            <button class="btn" data-open="${esc(p.slug)}">打开</button>
          </span>
        </div>
      </div>`;
    })
    .join('');
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
    show('edit');
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
  const cats = state.meta.categories || [];
  const tags = state.meta.tags || [];
  $('pickCats').innerHTML = cats.map((c) => `<span class="chip click" data-add="fCats" data-val="${esc(c.name)}">＋ ${esc(c.name)}</span>`).join('');
  $('pickTags').innerHTML = tags.map((t) => `<span class="chip click" data-add="fTags" data-val="${esc(t.name)}">＋ ${esc(t.name)}</span>`).join('');
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

    // 保存后重新读一次，拿到新的哈希和规范化后的正文
    const fresh = await api(`/api/posts/${encodeURIComponent(state.current.slug)}`);
    state.current = fresh;
    state.dirty = false;
    setSaveState(
      res.saved
        ? `已保存${res.changed && res.changed.length ? `（改了 ${res.changed.join('、')}）` : ''}${res.bodyChanged ? '（含正文）' : ''}`
        : '没有变化，未写文件',
    );
    toast(res.saved ? '已保存，站点会自动热更新' : '没有变化');
    await Promise.all([loadStatus(), refreshMeta()]);
  } catch (err) {
    if (err.code === 'CONFLICT') {
      const cover = confirm('磁盘上的文件比这里打开时的版本新（可能刚在 Obsidian 或编辑器里改过）。\n\n点「确定」用这里的版本覆盖磁盘；点「取消」放弃本次保存。');
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

    if (!plan.meta.description) {
      $('descHint').textContent = '原文件没写摘要 —— 请用一句话说清这篇讲什么（会出现在列表和搜索结果里）';
    } else {
      $('descHint').textContent = '来自原文，可以改';
    }

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
  $('btnIngest').disabled = true;
  try {
    const meta = {
      title: $('gTitle').value,
      description: $('gDesc').value,
      pubDate: $('gDate').value,
      categories: splitList($('gCats').value),
      tags: splitList($('gTags').value),
    };
    if (!meta.description.trim()) {
      toast('摘要不能空着', true);
      $('btnIngest').disabled = false;
      $('gDesc').focus();
      return;
    }

    const res = await api('/api/ingest', {
      method: 'POST',
      body: JSON.stringify({ raw: state.raw, slug, meta }),
    });

    toast('已写入，源文件请留在 Obsidian，以后改站点这一份');
    resetIngest();
    show('list');
    await refreshMeta();

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

// ---------- 事件绑定 ----------

function bind() {
  // 导航
  document.querySelectorAll('.nav-item').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  document.addEventListener('click', (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) return show(goto.dataset.goto);

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

  // 列表
  $('search').addEventListener('input', renderList);
  $('filterCat').addEventListener('change', renderList);
  $('sortBy').addEventListener('change', renderList);
  $('btnReload').addEventListener('click', async () => {
    await loadPosts();
    await loadStatus();
    toast('已重新读盘');
  });

  // 编辑
  $('btnBack').addEventListener('click', () => {
    if (state.dirty && !confirm('有未保存的改动，确定离开吗？')) return;
    state.dirty = false;
    show('list');
  });
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

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!$('view-edit').hidden) save();
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

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

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

// ---------- 启动 ----------

(async function init() {
  bind();
  await refreshMeta();
  await loadStatus();
  await loadPosts();

  // 支持直接用地址进某一页：/#/edit/<文件名> 或 /#/ingest
  // 好处是刷新不会跳回列表，改到一半按 F5 还能回到同一篇。
  const hash = decodeURIComponent(location.hash || '');
  if (hash.startsWith('#/edit/')) {
    await openEdit(hash.slice('#/edit/'.length));
  } else if (hash === '#/ingest') {
    show('ingest');
  }

  setInterval(loadStatus, 30000);
})();

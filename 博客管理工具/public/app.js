// 博客管理工具 —— 界面逻辑
//
// 原生 JavaScript，没有任何框架（见 技术架构.md 第四节）。
// 结构很简单：三个"页"（列表、编辑）、两个弹窗、一组接口调用。

'use strict';

// ============ 状态 ============

const state = {
  posts: [],
  meta: { categories: [], today: '', postsDir: '' },
  // 当前编辑的文章：null = 新建
  editing: null,
  // 打开的原始标题（用于判断"标题变了没"）
  originalTitle: '',
  originalSlug: '',
  // 正文是否有未保存改动
  dirty: false,
};

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
  bindEvents();

  // 每 8 秒看一次博客状态，让状态灯是活的
  setInterval(refreshBlogStatus, 8000);
}

async function loadMeta() {
  const res = await apiGet('/api/meta');
  if (!res.ok) return;

  state.meta = res;

  // 分类下拉
  const dl = $('category-list');
  dl.innerHTML = '';
  for (const c of res.categories) {
    const opt = document.createElement('option');
    opt.value = c;
    dl.appendChild(opt);
  }

  // 提示文章目录（让你知道工具在操作哪儿）
  $('posts-dir-hint').textContent = '文章目录：' + res.postsDir;
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

  const posts = state.posts;
  $('post-count').textContent = posts.length > 0 ? `共 ${posts.length} 篇` : '';

  if (posts.length === 0) {
    $('list-empty').hidden = false;
    return;
  }

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

    if (post.category) {
      const c = document.createElement('span');
      c.className = 'badge';
      c.textContent = post.category;
      meta.appendChild(c);
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
  $('f-category').value = String(data.category || '');
  $('f-tags').value = Array.isArray(data.tags) ? data.tags.join(', ') : '';
  $('f-draft').checked = data.draft === true;
  $('f-slug').value = slug;
  $('f-body').value = body;

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
    'f-category',
    'f-tags',
    'f-slug',
    'f-body',
  ]) {
    $(id).value = '';
  }
  $('f-draft').checked = false;
  $('slug-warning').hidden = true;
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
  const data = {
    title: $('f-title').value.trim(),
    description: $('f-description').value.trim(),
    pubDate: $('f-pubdate').value,
    updatedDate: $('f-updateddate').value,
    category: $('f-category').value.trim(),
    tags: $('f-tags')
      .value.split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
    draft: $('f-draft').checked,
  };

  const slug = $('f-slug').value.trim();
  const body = $('f-body').value;

  // ---- 前端先自查，避免白跑一趟 ----
  const problems = [];
  if (!data.title) problems.push('· 标题没填');
  if (!data.description) problems.push('· 摘要没填');
  if (!data.pubDate) problems.push('· 发布日期没填');
  if (!data.category) problems.push('· 分类没填');
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

function askRename(newTitle) {
  return new Promise((resolve) => {
    const modal = $('rename-modal');

    $('rm-old-title').textContent = state.originalTitle || '(空)';
    $('rm-new-title').textContent = newTitle;
    $('rm-old-url').textContent = '/posts/' + state.originalSlug + '/';
    $('rm-new-url').textContent = '/posts/<新的文件名>/';

    modal.hidden = false;

    const cleanup = () => {
      modal.hidden = true;
      $('rm-keep').onclick = null;
      $('rm-change').onclick = null;
    };

    // 默认：不改
    $('rm-keep').onclick = () => {
      cleanup();
      resolve(false);
    };

    $('rm-change').onclick = async () => {
      cleanup();

      const res = await apiPost('/api/slug', { title: newTitle });
      if (!res.ok || !res.candidate) {
        toast('没能生成新文件名，文件名保持原样');
        resolve(false);
        return;
      }

      const confirmed = await askNewSlugName(res.candidate);
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

        showBanner(
          'warn',
          `文件名已改：${r.oldUrl}\n       → ${r.newUrl}\n\n` +
            '注意：旧链接已经失效（现在还没上线，所以没人受影响）。\n' +
            '以后再改标题，工具还会问你。',
        );
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
    '关闭博客管理工具？',
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
  for (const id of ['f-title', 'f-description', 'f-pubdate', 'f-updateddate', 'f-category', 'f-tags']) {
    $(id).addEventListener('input', () => {
      state.dirty = true;
    });
  }
  $('f-draft').addEventListener('change', () => {
    state.dirty = true;
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

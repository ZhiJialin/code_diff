// ── State ──

let authState = {
  token: null,
  tokenType: null,
  gitlabUrl: '',
  user: null,
};

let selectedProject = null;
let selectedBranch = null;
let selectedBaseBranch = null;
let currentFiles = [];
let activeFileName = null;
let currentMode = 'diff';
let browseCurrentPath = '';

// ── DOM ──

const loginPage = document.getElementById('loginPage');
const mainApp = document.getElementById('mainApp');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const tabBtns = document.querySelectorAll('.tab-btn');
const passwordFields = document.getElementById('passwordFields');
const tokenFields = document.getElementById('tokenFields');
const gitlabUrlInput = document.getElementById('gitlabUrl');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const privateTokenInput = document.getElementById('privateToken');

const projectSearch = document.getElementById('projectSearch');
const projectDropdown = document.getElementById('projectDropdown');
const branchSearch = document.getElementById('branchSearch');
const branchDropdown = document.getElementById('branchDropdown');
const baseBranchSearch = document.getElementById('baseBranchSearch');
const baseBranchDropdown = document.getElementById('baseBranchDropdown');
const compareBtn = document.getElementById('compareBtn');
const logoutBtn = document.getElementById('logoutBtn');
const userInfoEl = document.getElementById('userInfo');

const fileListContent = document.getElementById('fileListContent');
const fileStats = document.getElementById('fileStats');
const diffView = document.getElementById('diffView');

const diffContainer = document.getElementById('diffContainer');
const browseContainer = document.getElementById('browseContainer');
const modeTabs = document.querySelectorAll('.mode-tab');
const treeContent = document.getElementById('treeContent');
const treeBreadcrumb = document.getElementById('treeBreadcrumb');
const codeView = document.getElementById('codeView');

// ── Login Tab Switch ──

tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    passwordFields.style.display = tab === 'password' ? 'block' : 'none';
    tokenFields.style.display = tab === 'token' ? 'block' : 'none';
    loginError.textContent = '';
  });
});

// ── Login ──

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  loginBtn.disabled = true;
  loginBtn.textContent = '登录中...';

  const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
  const body = { gitlabUrl: gitlabUrlInput.value.trim() };

  if (activeTab === 'password') {
    body.username = usernameInput.value.trim();
    body.password = passwordInput.value;
    if (!body.username || !body.password) {
      loginError.textContent = '请填写用户名和密码';
      loginBtn.disabled = false;
      loginBtn.textContent = '登 录';
      return;
    }
  } else {
    body.privateToken = privateTokenInput.value.trim();
    if (!body.privateToken) {
      loginError.textContent = '请填写 Access Token';
      loginBtn.disabled = false;
      loginBtn.textContent = '登 录';
      return;
    }
  }

  try {
    const resp = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await resp.json();

    if (resp.ok) {
      authState = {
        token: data.token,
        tokenType: data.tokenType,
        gitlabUrl: body.gitlabUrl,
        user: data.user,
      };
      sessionStorage.setItem('auth', JSON.stringify(authState));
      showMainApp();
    } else {
      loginError.textContent = data.error || '登录失败';
    }
  } catch (err) {
    loginError.textContent = '连接失败: ' + err.message;
  }

  loginBtn.disabled = false;
  loginBtn.textContent = '登 录';
});

// ── Logout ──

logoutBtn.addEventListener('click', () => {
  authState = { token: null, tokenType: null, gitlabUrl: '', user: null };
  sessionStorage.removeItem('auth');
  selectedProject = null;
  selectedBranch = null;
  selectedBaseBranch = null;
  currentFiles = [];
  activeFileName = null;
  mainApp.style.display = 'none';
  loginPage.style.display = 'flex';
  loginError.textContent = '';
});

// ── Show Main App ──

function showMainApp() {
  loginPage.style.display = 'none';
  mainApp.style.display = 'flex';

  if (authState.user) {
    let html = '';
    if (authState.user.avatar) {
      html += `<img class="avatar" src="${escapeHtml(authState.user.avatar)}" alt="">`;
    }
    html += `<span>${escapeHtml(authState.user.name || authState.user.username)}</span>`;
    userInfoEl.innerHTML = html;
  }

  projectSearch.value = '';
  branchSearch.value = '';
  compareBtn.disabled = true;
}

// ── Auth Headers ──

function authHeaders() {
  return {
    'X-Gitlab-Token': authState.token || '',
    'X-Token-Type': authState.tokenType || '',
    'X-Gitlab-Url': authState.gitlabUrl || '',
  };
}

// ── Project Selector ──

let projectSearchTimer = null;
let allProjects = [];

projectSearch.addEventListener('focus', () => {
  projectDropdown.classList.add('open');
  if (!projectSearch.value.trim()) loadProjects('');
});

projectSearch.addEventListener('input', () => {
  clearTimeout(projectSearchTimer);
  projectSearchTimer = setTimeout(() => loadProjects(projectSearch.value.trim()), 300);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#projectSelector')) {
    projectDropdown.classList.remove('open');
  }
  if (!e.target.closest('#branchSelector')) {
    branchDropdown.classList.remove('open');
  }
});

async function loadProjects(search) {
  projectDropdown.innerHTML = '<div class="dropdown-loading"><div class="spinner"></div> 加载中...</div>';
  projectDropdown.classList.add('open');

  try {
    const params = new URLSearchParams({ search, per_page: '50' });
    const resp = await fetch(`/api/projects?${params}`, { headers: authHeaders() });
    const data = await resp.json();

    if (!resp.ok) {
      projectDropdown.innerHTML = `<div class="dropdown-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }

    allProjects = data.projects;
    renderProjectDropdown();
  } catch (err) {
    projectDropdown.innerHTML = `<div class="dropdown-empty">加载失败</div>`;
  }
}

function renderProjectDropdown() {
  if (allProjects.length === 0) {
    projectDropdown.innerHTML = '<div class="dropdown-empty">没有找到项目</div>';
    return;
  }

  projectDropdown.innerHTML = allProjects.map(p => `
    <div class="dropdown-item ${selectedProject?.id === p.id ? 'active' : ''}" data-id="${p.id}">
      <div class="item-name">${escapeHtml(p.name)}</div>
      <div class="item-sub">${escapeHtml(p.path)}</div>
    </div>
  `).join('');

  projectDropdown.querySelectorAll('.dropdown-item').forEach(el => {
    el.addEventListener('click', () => {
      const proj = allProjects.find(p => p.id === parseInt(el.dataset.id));
      if (proj) selectProject(proj);
    });
  });
}

function selectProject(proj) {
  selectedProject = proj;
  selectedBranch = null;
  selectedBaseBranch = null;
  projectSearch.value = proj.nameWithNamespace || proj.name;
  projectDropdown.classList.remove('open');
  branchSearch.value = '';
  baseBranchSearch.value = '';
  compareBtn.disabled = true;
  currentFiles = [];
  activeFileName = null;
  fileListContent.innerHTML = '<div class="empty-state">请选择分支</div>';
  fileStats.innerHTML = '';
  showDiffPlaceholder('选择分支后点击"对比"');
  allBranches = [];
  loadBranches('');
}

// ── Branch Selector ──

let branchSearchTimer = null;
let allBranches = [];
let branchesLoading = false;

branchSearch.addEventListener('focus', () => {
  if (!selectedProject) return;
  branchDropdown.classList.add('open');
  if (allBranches.length === 0 && !branchesLoading) loadBranches('');
  else renderBranchDropdown(branchSearch.value.trim());
});

branchSearch.addEventListener('input', () => {
  clearTimeout(branchSearchTimer);
  branchSearchTimer = setTimeout(() => {
    renderBranchDropdown(branchSearch.value.trim());
  }, 150);
});

async function loadBranches(search) {
  if (!selectedProject) return;
  branchesLoading = true;

  branchDropdown.innerHTML = '<div class="dropdown-loading"><div class="spinner"></div> 加载所有分支...</div>';
  branchDropdown.classList.add('open');

  try {
    const params = new URLSearchParams({ project_id: selectedProject.id, search });
    const resp = await fetch(`/api/branches?${params}`, { headers: authHeaders() });
    const data = await resp.json();

    if (!resp.ok) {
      branchDropdown.innerHTML = `<div class="dropdown-empty">${escapeHtml(data.error || '加载失败')}</div>`;
      branchesLoading = false;
      return;
    }

    allBranches = data.branches;
    renderBranchDropdown(branchSearch.value.trim());
  } catch (err) {
    branchDropdown.innerHTML = `<div class="dropdown-empty">加载失败</div>`;
  }
  branchesLoading = false;
}

function renderBranchDropdown(filter) {
  let filtered = allBranches;
  if (filter) {
    const lower = filter.toLowerCase();
    filtered = allBranches.filter(b => b.name.toLowerCase().includes(lower));
  }

  if (filtered.length === 0) {
    branchDropdown.innerHTML = '<div class="dropdown-empty">没有匹配的分支</div>';
    return;
  }

  filtered.sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    const da = a.committedDate ? new Date(a.committedDate).getTime() : 0;
    const db = b.committedDate ? new Date(b.committedDate).getTime() : 0;
    return db - da;
  });

  const countInfo = filter
    ? `<div class="dropdown-loading" style="padding:4px 12px;font-size:11px">匹配 ${filtered.length} / ${allBranches.length} 个分支</div>`
    : `<div class="dropdown-loading" style="padding:4px 12px;font-size:11px">共 ${allBranches.length} 个分支</div>`;

  branchDropdown.innerHTML = countInfo + filtered.map(b => `
    <div class="dropdown-item ${selectedBranch?.name === b.name ? 'active' : ''}" data-name="${escapeHtml(b.name)}">
      <div class="item-name">${escapeHtml(b.name)}</div>
      <div class="item-sub ${b.isDefault ? 'default-tag' : ''}">${b.isDefault ? '默认分支' : formatDate(b.committedDate)}</div>
    </div>
  `).join('');

  branchDropdown.querySelectorAll('.dropdown-item').forEach(el => {
    el.addEventListener('click', () => {
      const br = allBranches.find(b => b.name === el.dataset.name);
      if (br) selectBranch(br);
    });
  });
}

function selectBranch(br) {
  selectedBranch = br;
  branchSearch.value = br.name;
  branchDropdown.classList.remove('open');
  compareBtn.disabled = false;
}

// ── Base Branch Selector ──

baseBranchSearch.addEventListener('focus', () => {
  if (!selectedProject || allBranches.length === 0) return;
  baseBranchDropdown.classList.add('open');
  renderBaseBranchDropdown(baseBranchSearch.value.trim());
});

baseBranchSearch.addEventListener('input', () => {
  clearTimeout(baseBranchSearchTimer);
  baseBranchSearchTimer = setTimeout(() => {
    renderBaseBranchDropdown(baseBranchSearch.value.trim());
  }, 150);
});

let baseBranchSearchTimer = null;

document.addEventListener('click', (e) => {
  if (!e.target.closest('#baseBranchSelector')) {
    baseBranchDropdown.classList.remove('open');
  }
});

function renderBaseBranchDropdown(filter) {
  let filtered = allBranches;
  if (filter) {
    const lower = filter.toLowerCase();
    filtered = allBranches.filter(b => b.name.toLowerCase().includes(lower));
  }

  if (filtered.length === 0) {
    baseBranchDropdown.innerHTML = '<div class="dropdown-empty">没有匹配的分支</div>';
    return;
  }

  filtered.sort((a, b) => {
    if (a.isDefault) return -1;
    if (b.isDefault) return 1;
    const da = a.committedDate ? new Date(a.committedDate).getTime() : 0;
    const db = b.committedDate ? new Date(b.committedDate).getTime() : 0;
    return db - da;
  });

  const defaultBranch = selectedProject?.defaultBranch || 'master';
  baseBranchDropdown.innerHTML = filtered.map(b => `
    <div class="dropdown-item ${selectedBaseBranch?.name === b.name ? 'active' : ''}" data-name="${escapeHtml(b.name)}">
      <div class="item-name">${escapeHtml(b.name)}</div>
      <div class="item-sub ${b.isDefault ? 'default-tag' : ''}">${b.isDefault ? '默认分支' : formatDate(b.committedDate)}</div>
    </div>
  `).join('');

  baseBranchDropdown.querySelectorAll('.dropdown-item').forEach(el => {
    el.addEventListener('click', () => {
      const br = allBranches.find(b => b.name === el.dataset.name);
      if (br) {
        selectedBaseBranch = br;
        baseBranchSearch.value = br.name;
        baseBranchDropdown.classList.remove('open');
      }
    });
  });
}

// ── Compare ──

compareBtn.addEventListener('click', () => runCompare());

async function runCompare() {
  if (!selectedProject || !selectedBranch) return;

  compareBtn.disabled = true;
  showLoading();
  fileListContent.innerHTML = '<div class="loading"><div class="spinner"></div> 分析中...</div>';
  fileStats.innerHTML = '';

  try {
    const baseBranch = selectedBaseBranch ? selectedBaseBranch.name : (selectedProject.defaultBranch || 'master');
    const params = new URLSearchParams({
      project_id: selectedProject.id,
      branch: selectedBranch.name,
      default_branch: baseBranch,
    });
    const resp = await fetch(`/api/compare?${params}`, { headers: authHeaders() });
    const data = await resp.json();

    if (!resp.ok) {
      showError(data.error || '对比失败');
      fileListContent.innerHTML = `<div class="empty-state">${escapeHtml(data.error || '对比失败')}</div>`;
      compareBtn.disabled = false;
      return;
    }

    if (data.message) {
      showInfoMsg(data.message);
      fileListContent.innerHTML = `<div class="empty-state">${escapeHtml(data.message)}</div>`;
      compareBtn.disabled = false;
      return;
    }

    currentFiles = (data.files || []).filter(f => f.lines && f.lines.length > 0);
    renderFileList();

    if (currentFiles.length > 0) {
      selectFile(currentFiles[0].fileName);
    } else {
      showInfoMsg(`该分支与 ${escapeHtml(baseBranch)} 没有差异`);
    }
  } catch (err) {
    showError('请求失败: ' + err.message);
    fileListContent.innerHTML = '<div class="empty-state">请求失败</div>';
  }

  compareBtn.disabled = false;
}

// ── File List ──

function renderFileList() {
  if (currentFiles.length === 0) {
    fileListContent.innerHTML = '<div class="empty-state">无变更文件</div>';
    fileStats.innerHTML = '';
    return;
  }

  const counts = { added: 0, modified: 0, deleted: 0, renamed: 0 };
  currentFiles.forEach(f => { if (counts[f.status] !== undefined) counts[f.status]++; });

  fileListContent.innerHTML = currentFiles.map(f => {
    const parts = f.fileName.split('/');
    const name = parts.pop();
    return `
      <div class="file-item ${f.fileName === activeFileName ? 'active' : ''}"
           data-file="${escapeHtml(f.fileName)}"
           title="${escapeHtml(f.fileName)}">
        <span class="status-dot ${f.status}"></span>
        <span class="file-name">${escapeHtml(name)}</span>
      </div>
    `;
  }).join('');

  const statsHtml = [];
  if (counts.added) statsHtml.push(`<span class="stat"><span class="dot added"></span>${counts.added} 新增</span>`);
  if (counts.modified) statsHtml.push(`<span class="stat"><span class="dot modified"></span>${counts.modified} 修改</span>`);
  if (counts.deleted) statsHtml.push(`<span class="stat"><span class="dot deleted"></span>${counts.deleted} 删除</span>`);
  if (counts.renamed) statsHtml.push(`<span class="stat"><span class="dot renamed"></span>${counts.renamed} 重命名</span>`);
  fileStats.innerHTML = statsHtml.join('');

  fileListContent.querySelectorAll('.file-item').forEach(el => {
    el.addEventListener('click', () => selectFile(el.dataset.file));
  });
}

function selectFile(fileName) {
  activeFileName = fileName;
  const file = currentFiles.find(f => f.fileName === fileName);
  if (!file) return;

  fileListContent.querySelectorAll('.file-item').forEach(el => {
    el.classList.toggle('active', el.dataset.file === fileName);
  });

  renderDiff(file);
}

// ── Diff Rendering ──

function renderDiff(file) {
  const defaultBranch = selectedBaseBranch ? selectedBaseBranch.name : (selectedProject?.defaultBranch || 'master');

  const headerHtml = `
    <div class="diff-header">
      <div class="pane-title">Base (${escapeHtml(defaultBranch)})<span class="file-path">${escapeHtml(file.oldPath || file.fileName)}</span></div>
      <div class="pane-title">${escapeHtml(selectedBranch?.name || '')}<span class="file-path">${escapeHtml(file.newPath || file.fileName)}</span></div>
    </div>
  `;

  const lines = alignDiffLines(file.lines);
  let bodyHtml = '';

  for (const line of lines) {
    if (line.type === 'hunk') {
      bodyHtml += `<div class="hunk-separator">${escapeHtml(line.text)}</div>`;
    } else {
      bodyHtml += renderDiffRow(line);
    }
  }

  diffView.innerHTML = `
    ${headerHtml}
    <div class="diff-body">${bodyHtml}</div>
  `;
}

function alignDiffLines(rawLines) {
  const aligned = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    if (line.type === 'hunk' || line.type === 'unchanged') {
      aligned.push(line);
      i++;
      continue;
    }

    if (line.type === 'remove') {
      const removals = [];
      while (i < rawLines.length && rawLines[i].type === 'remove') {
        removals.push(rawLines[i]);
        i++;
      }
      const additions = [];
      while (i < rawLines.length && rawLines[i].type === 'add') {
        additions.push(rawLines[i]);
        i++;
      }

      const maxLen = Math.max(removals.length, additions.length);
      for (let j = 0; j < maxLen; j++) {
        const rem = removals[j] || null;
        const add = additions[j] || null;

        if (rem && add) {
          aligned.push({
            type: 'modify',
            baseLine: rem.baseLine,
            submittedLine: add.submittedLine,
            baseContent: rem.baseContent,
            submittedContent: add.submittedContent,
          });
        } else if (rem) {
          aligned.push(rem);
        } else if (add) {
          aligned.push(add);
        }
      }
    } else if (line.type === 'add') {
      aligned.push(line);
      i++;
    } else {
      aligned.push(line);
      i++;
    }
  }

  return aligned;
}

function renderDiffRow(line) {
  const type = line.type;

  if (type === 'unchanged') {
    return `
      <div class="diff-row unchanged">
        <div class="side left">
          <div class="gutter">${line.baseLine ?? ''}</div>
          <div class="code">${escapeHtml(line.baseContent)}</div>
        </div>
        <div class="side right">
          <div class="gutter">${line.submittedLine ?? ''}</div>
          <div class="code">${escapeHtml(line.submittedContent)}</div>
        </div>
      </div>`;
  }

  if (type === 'modify') {
    return `
      <div class="diff-row modify-left">
        <div class="side left">
          <div class="gutter">${line.baseLine ?? ''}</div>
          <div class="code">${escapeHtml(line.baseContent)}</div>
        </div>
        <div class="side right">
          <div class="gutter"></div>
          <div class="code"></div>
        </div>
      </div>
      <div class="diff-row modify-right">
        <div class="side left">
          <div class="gutter"></div>
          <div class="code"></div>
        </div>
        <div class="side right">
          <div class="gutter">${line.submittedLine ?? ''}</div>
          <div class="code">${escapeHtml(line.submittedContent)}</div>
        </div>
      </div>`;
  }

  if (type === 'add') {
    return `
      <div class="diff-row add">
        <div class="side left">
          <div class="gutter"></div>
          <div class="code"></div>
        </div>
        <div class="side right">
          <div class="gutter">${line.submittedLine ?? ''}</div>
          <div class="code">${escapeHtml(line.submittedContent)}</div>
        </div>
      </div>`;
  }

  if (type === 'remove') {
    return `
      <div class="diff-row remove">
        <div class="side left">
          <div class="gutter">${line.baseLine ?? ''}</div>
          <div class="code">${escapeHtml(line.baseContent)}</div>
        </div>
        <div class="side right">
          <div class="gutter"></div>
          <div class="code"></div>
        </div>
      </div>`;
  }

  return '';
}

// ── Utilities ──

function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch { return dateStr; }
}

function showLoading() {
  diffView.innerHTML = '<div class="loading"><div class="spinner"></div> 正在加载...</div>';
}

function showError(msg) {
  diffView.innerHTML = `<div class="error-msg">${escapeHtml(msg)}</div>`;
}

function showInfoMsg(msg) {
  diffView.innerHTML = `<div class="info-msg"><p>${escapeHtml(msg)}</p></div>`;
}

function showDiffPlaceholder(msg) {
  diffView.innerHTML = `
    <div class="diff-placeholder">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>
      <p>${escapeHtml(msg || '选择文件查看差异')}</p>
    </div>`;
}

// ── Mode Tabs ──

modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const mode = tab.dataset.mode;
    if (mode === currentMode) return;
    currentMode = mode;
    modeTabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
    if (mode === 'diff') {
      diffContainer.style.display = 'flex';
      browseContainer.style.display = 'none';
    } else {
      diffContainer.style.display = 'none';
      browseContainer.style.display = 'flex';
      if (selectedProject && selectedBranch) loadTree('');
    }
  });
});

// ── Browse Mode ──

async function loadTree(dirPath) {
  if (!selectedProject || !selectedBranch) return;
  browseCurrentPath = dirPath;
  renderBreadcrumb(dirPath);
  treeContent.innerHTML = '<div class="loading"><div class="spinner"></div> 加载中...</div>';

  try {
    const params = new URLSearchParams({
      project_id: selectedProject.id,
      branch: selectedBranch.name,
      path: dirPath,
    });
    const resp = await fetch(`/api/tree?${params}`, { headers: authHeaders() });
    const data = await resp.json();
    if (!resp.ok) {
      treeContent.innerHTML = `<div class="empty-state">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    renderTree(data.items || []);
  } catch (err) {
    treeContent.innerHTML = `<div class="empty-state">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function renderBreadcrumb(dirPath) {
  let html = `<span class="crumb" data-path="">根目录</span>`;
  if (dirPath) {
    const parts = dirPath.split('/');
    let accumulated = '';
    for (const part of parts) {
      accumulated = accumulated ? accumulated + '/' + part : part;
      html += `<span class="crumb-sep">/</span><span class="crumb" data-path="${escapeHtml(accumulated)}">${escapeHtml(part)}</span>`;
    }
  }
  treeBreadcrumb.innerHTML = html;
  treeBreadcrumb.querySelectorAll('.crumb').forEach(el => {
    el.addEventListener('click', () => loadTree(el.dataset.path));
  });
}

function renderTree(items) {
  if (items.length === 0) {
    treeContent.innerHTML = '<div class="empty-state">空目录</div>';
    return;
  }
  treeContent.innerHTML = items.map(item => {
    const isDir = item.type === 'tree';
    const icon = isDir
      ? '<svg class="tree-icon folder" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>'
      : '<svg class="tree-icon file" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    return `<div class="tree-item" data-path="${escapeHtml(item.path)}" data-type="${item.type}">${icon}<span>${escapeHtml(item.name)}</span></div>`;
  }).join('');

  treeContent.querySelectorAll('.tree-item').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.type === 'tree') {
        loadTree(el.dataset.path);
      } else {
        loadFileContent(el.dataset.path);
      }
    });
  });
}

async function loadFileContent(filePath) {
  codeView.innerHTML = '<div class="loading"><div class="spinner"></div> 加载中...</div>';
  try {
    const params = new URLSearchParams({
      project_id: selectedProject.id,
      branch: selectedBranch.name,
      path: filePath,
    });
    const resp = await fetch(`/api/file?${params}`, { headers: authHeaders() });
    const data = await resp.json();
    if (!resp.ok) {
      codeView.innerHTML = `<div class="error-msg">${escapeHtml(data.error || '加载失败')}</div>`;
      return;
    }
    renderCodeView(filePath, data.content || '');
  } catch (err) {
    codeView.innerHTML = `<div class="error-msg">加载失败: ${escapeHtml(err.message)}</div>`;
  }
}

function renderCodeView(filePath, content) {
  const lines = content.split('\n');
  const linesHtml = lines.map((line, i) =>
    `<div class="code-line"><span class="line-num">${i + 1}</span><span class="line-content">${escapeHtml(line)}</span></div>`
  ).join('');

  codeView.innerHTML = `
    <div class="code-viewer-header">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span class="cv-path">${escapeHtml(filePath)}</span>
      <span style="color:var(--text-muted);font-size:12px">${lines.length} 行</span>
    </div>
    <div class="code-viewer-body">${linesHtml}</div>
  `;
}

// ── Auto-login from session ──

(function init() {
  const saved = sessionStorage.getItem('auth');
  if (saved) {
    try {
      authState = JSON.parse(saved);
      if (authState.token) {
        showMainApp();
        return;
      }
    } catch {}
  }
  loginPage.style.display = 'flex';
})();

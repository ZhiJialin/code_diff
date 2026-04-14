const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const urlModule = require('url');

const PORT = 3000;
const DEFAULT_GITLAB = 'http://git.100credit.cn';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ── GitLab HTTP Client ──

function gitlabRequest(gitlabUrl, method, apiPath, token, body, tokenType) {
  const parsed = new URL(gitlabUrl);
  const isHttps = parsed.protocol === 'https:';
  const mod = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) {
      if (tokenType === 'oauth') {
        headers['Authorization'] = `Bearer ${token}`;
      } else {
        headers['PRIVATE-TOKEN'] = token;
      }
    }

    let bodyStr;
    if (body) {
      bodyStr = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: apiPath,
      method,
      headers,
    };

    const req = mod.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let data;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, data, headers: res.headers });
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('请求超时')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── Request body parser ──

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch { resolve({}); }
    });
  });
}

// ── API Route Helpers ──

function jsonRes(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function getTokenFromReq(req) {
  const auth = req.headers['x-gitlab-token'] || '';
  const tokenType = req.headers['x-token-type'] || 'private';
  const gitlabUrl = req.headers['x-gitlab-url'] || DEFAULT_GITLAB;
  return { token: auth, tokenType, gitlabUrl };
}

// ── API Routes ──

async function handleLogin(req, res) {
  const { gitlabUrl, username, password, privateToken } = await readBody(req);
  const baseUrl = gitlabUrl || DEFAULT_GITLAB;

  try {
    if (privateToken) {
      const resp = await gitlabRequest(baseUrl, 'GET', '/api/v4/user', privateToken, null, 'private');
      if (resp.status === 200) {
        return jsonRes(res, 200, {
          token: privateToken,
          tokenType: 'private',
          user: { name: resp.data.name, username: resp.data.username, avatar: resp.data.avatar_url },
        });
      }
      return jsonRes(res, 401, { error: 'Token 无效，请检查后重试' });
    }

    // Try OAuth2 password grant
    const oauthResp = await gitlabRequest(baseUrl, 'POST', '/oauth/token', null, {
      grant_type: 'password',
      username,
      password,
    });

    if (oauthResp.status === 200 && oauthResp.data.access_token) {
      const userResp = await gitlabRequest(baseUrl, 'GET', '/api/v4/user', oauthResp.data.access_token, null, 'oauth');
      const user = userResp.status === 200
        ? { name: userResp.data.name, username: userResp.data.username, avatar: userResp.data.avatar_url }
        : { name: username, username };

      return jsonRes(res, 200, {
        token: oauthResp.data.access_token,
        tokenType: 'oauth',
        user,
      });
    }

    // Fallback: try basic auth by testing /api/v4/user
    const basic = Buffer.from(`${username}:${password}`).toString('base64');
    const basicResp = await gitlabRequest(baseUrl, 'GET', '/api/v4/user', null, null, 'basic');
    // Override headers manually for basic auth
    const basicTest = await new Promise((resolve, reject) => {
      const parsed = new URL(baseUrl);
      const isHttps = parsed.protocol === 'https:';
      const mod = isHttps ? https : http;
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: '/api/v4/user',
        method: 'GET',
        headers: { 'Authorization': `Basic ${basic}` },
      };
      const r = mod.request(opts, (resp) => {
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let data; try { data = JSON.parse(raw); } catch { data = raw; }
          resolve({ status: resp.statusCode, data });
        });
      });
      r.on('error', reject);
      r.setTimeout(15000, () => { r.destroy(); reject(new Error('超时')); });
      r.end();
    });

    if (basicTest.status === 200 && basicTest.data.id) {
      // Basic auth works - we need to create a personal access token or use basic for every request
      // For simplicity, store credentials and use basic auth header
      return jsonRes(res, 200, {
        token: basic,
        tokenType: 'basic',
        user: { name: basicTest.data.name, username: basicTest.data.username, avatar: basicTest.data.avatar_url },
      });
    }

    return jsonRes(res, 401, { error: '登录失败，请检查账号密码。也可尝试使用 Personal Access Token 登录。' });
  } catch (err) {
    return jsonRes(res, 500, { error: '连接 GitLab 失败: ' + err.message });
  }
}

function buildAuthHeaders(token, tokenType) {
  if (tokenType === 'oauth') return { 'Authorization': `Bearer ${token}` };
  if (tokenType === 'basic') return { 'Authorization': `Basic ${token}` };
  return { 'PRIVATE-TOKEN': token };
}

async function proxyGitlab(gitlabUrl, method, apiPath, token, tokenType, body) {
  const parsed = new URL(gitlabUrl);
  const isHttps = parsed.protocol === 'https:';
  const mod = isHttps ? https : http;

  return new Promise((resolve, reject) => {
    const headers = buildAuthHeaders(token, tokenType);
    let bodyStr;
    if (body) {
      bodyStr = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: apiPath,
      method,
      headers,
    };

    const req = mod.request(opts, (resp) => {
      const chunks = [];
      resp.on('data', c => chunks.push(c));
      resp.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let data; try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: resp.statusCode, data, headers: resp.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error('请求超时')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function handleProjects(req, res) {
  const { token, tokenType, gitlabUrl } = getTokenFromReq(req);
  const parsed = urlModule.parse(req.url, true);
  const search = parsed.query.search || '';
  const page = parsed.query.page || '1';
  const perPage = parsed.query.per_page || '20';

  let apiPath = `/api/v4/projects?membership=true&order_by=last_activity_at&sort=desc&page=${page}&per_page=${perPage}&simple=true`;
  if (search) apiPath += `&search=${encodeURIComponent(search)}`;

  try {
    const resp = await proxyGitlab(gitlabUrl, 'GET', apiPath, token, tokenType);
    if (resp.status === 200) {
      const projects = resp.data.map(p => ({
        id: p.id,
        name: p.name,
        nameWithNamespace: p.name_with_namespace,
        path: p.path_with_namespace,
        defaultBranch: p.default_branch,
        webUrl: p.web_url,
      }));
      return jsonRes(res, 200, {
        projects,
        totalPages: parseInt(resp.headers['x-total-pages'] || '1'),
        total: parseInt(resp.headers['x-total'] || projects.length),
      });
    }
    return jsonRes(res, resp.status, { error: '获取项目列表失败' });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleBranches(req, res) {
  const { token, tokenType, gitlabUrl } = getTokenFromReq(req);
  const parsed = urlModule.parse(req.url, true);
  const projectId = parsed.query.project_id;
  const search = parsed.query.search || '';

  if (!projectId) return jsonRes(res, 400, { error: '缺少 project_id' });

  try {
    let allBranches = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      let apiPath = `/api/v4/projects/${projectId}/repository/branches?page=${page}&per_page=${perPage}`;
      if (search) apiPath += `&search=${encodeURIComponent(search)}`;

      const resp = await proxyGitlab(gitlabUrl, 'GET', apiPath, token, tokenType);
      if (resp.status !== 200) {
        return jsonRes(res, resp.status, { error: '获取分支列表失败' });
      }

      const items = resp.data;
      if (!Array.isArray(items) || items.length === 0) break;

      allBranches = allBranches.concat(items);

      const nextPage = resp.headers['x-next-page'];
      if (!nextPage || nextPage === '' || parseInt(nextPage) <= page) break;
      page = parseInt(nextPage);
    }

    const branches = allBranches.map(b => ({
      name: b.name,
      isDefault: b.default,
      commitId: b.commit?.id,
      commitMessage: b.commit?.message,
      committedDate: b.commit?.committed_date,
    }));

    return jsonRes(res, 200, { branches, totalCount: branches.length });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleCompare(req, res) {
  const { token, tokenType, gitlabUrl } = getTokenFromReq(req);
  const parsed = urlModule.parse(req.url, true);
  const projectId = parsed.query.project_id;
  const branch = parsed.query.branch;
  const defaultBranch = parsed.query.default_branch || 'master';

  if (!projectId || !branch) return jsonRes(res, 400, { error: '缺少 project_id 或 branch' });

  if (branch === defaultBranch) {
    return jsonRes(res, 200, { files: [], message: '当前分支就是默认分支，没有差异' });
  }

  // straight=false (default) uses merge-base comparison, which gives us
  // exactly the diff since the branch diverged from the default branch.
  const apiPath = `/api/v4/projects/${projectId}/repository/compare?from=${encodeURIComponent(defaultBranch)}&to=${encodeURIComponent(branch)}&straight=false`;

  try {
    const resp = await proxyGitlab(gitlabUrl, 'GET', apiPath, token, tokenType);
    if (resp.status !== 200) {
      return jsonRes(res, resp.status, { error: '获取对比数据失败: ' + (resp.data?.message || resp.status) });
    }

    const compareData = resp.data;
    const diffs = compareData.diffs || [];

    const files = diffs.map(d => {
      let status = 'modified';
      if (d.new_file) status = 'added';
      else if (d.deleted_file) status = 'deleted';
      else if (d.renamed_file) status = 'renamed';

      const lines = parseUnifiedDiff(d.diff || '');

      return {
        fileName: d.new_path || d.old_path,
        oldPath: d.old_path,
        newPath: d.new_path,
        status,
        lines,
      };
    });

    files.sort((a, b) => {
      const order = { added: 0, renamed: 1, modified: 2, deleted: 3 };
      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
    });

    return jsonRes(res, 200, {
      files,
      commitCount: (compareData.commits || []).length,
      compareTimeout: compareData.compare_timeout || false,
    });
  } catch (err) {
    return jsonRes(res, 500, { error: err.message });
  }
}

async function handleTree(req, res) {
  const { token, tokenType, gitlabUrl } = getTokenFromReq(req);
  const parsed = urlModule.parse(req.url, true);
  const projectId = parsed.query.project_id;
  const branch = parsed.query.branch;
  const dirPath = parsed.query.path || '';
  if (!projectId || !branch) return jsonRes(res, 400, { error: '缺少 project_id 或 branch' });
  let apiPath = `/api/v4/projects/${projectId}/repository/tree?ref=${encodeURIComponent(branch)}&per_page=100`;
  if (dirPath) apiPath += `&path=${encodeURIComponent(dirPath)}`;
  try {
    const resp = await proxyGitlab(gitlabUrl, 'GET', apiPath, token, tokenType);
    if (resp.status !== 200) return jsonRes(res, resp.status, { error: '获取文件树失败' });
    const items = resp.data.map(item => ({ name: item.name, path: item.path, type: item.type }));
    items.sort((a, b) => {
      if (a.type === 'tree' && b.type !== 'tree') return -1;
      if (a.type !== 'tree' && b.type === 'tree') return 1;
      return a.name.localeCompare(b.name);
    });
    return jsonRes(res, 200, { items });
  } catch (err) { return jsonRes(res, 500, { error: err.message }); }
}

async function handleFile(req, res) {
  const { token, tokenType, gitlabUrl } = getTokenFromReq(req);
  const parsed = urlModule.parse(req.url, true);
  const projectId = parsed.query.project_id;
  const branch = parsed.query.branch;
  const filePath = parsed.query.path;
  if (!projectId || !branch || !filePath) return jsonRes(res, 400, { error: '缺少参数' });
  const encodedPath = encodeURIComponent(filePath);
  const apiPath = `/api/v4/projects/${projectId}/repository/files/${encodedPath}/raw?ref=${encodeURIComponent(branch)}`;
  try {
    const resp = await proxyGitlab(gitlabUrl, 'GET', apiPath, token, tokenType);
    if (resp.status !== 200) return jsonRes(res, resp.status, { error: '获取文件内容失败' });
    const content = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data, null, 2);
    return jsonRes(res, 200, { content, path: filePath });
  } catch (err) { return jsonRes(res, 500, { error: err.message }); }
}

// ── Unified Diff Parser ──

function parseUnifiedDiff(diffText) {
  if (!diffText) return [];

  const rawLines = diffText.split('\n');
  const result = [];
  let oldLine = 0, newLine = 0;

  for (const line of rawLines) {
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (line.startsWith('\\ No newline')) continue;

    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1]);
        newLine = parseInt(match[2]);
      }
      result.push({ type: 'hunk', text: line });
      continue;
    }

    if (line.startsWith('-')) {
      result.push({
        type: 'remove',
        baseLine: oldLine++,
        submittedLine: null,
        baseContent: line.substring(1),
        submittedContent: '',
      });
    } else if (line.startsWith('+')) {
      result.push({
        type: 'add',
        baseLine: null,
        submittedLine: newLine++,
        baseContent: '',
        submittedContent: line.substring(1),
      });
    } else if (line.startsWith(' ')) {
      result.push({
        type: 'unchanged',
        baseLine: oldLine++,
        submittedLine: newLine++,
        baseContent: line.substring(1),
        submittedContent: line.substring(1),
      });
    }
  }

  return result;
}

// ── Static File Serving ──

function serveStatic(req, res) {
  const parsed = urlModule.parse(req.url);
  let pathname = parsed.pathname;
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.join(__dirname, 'public', pathname);
  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ── HTTP Server ──

const server = http.createServer(async (req, res) => {
  const parsed = urlModule.parse(req.url, true);

  try {
    if (req.method === 'POST' && parsed.pathname === '/api/login') {
      return await handleLogin(req, res);
    }
    if (req.method === 'GET' && parsed.pathname === '/api/projects') {
      return await handleProjects(req, res);
    }
    if (req.method === 'GET' && parsed.pathname === '/api/branches') {
      return await handleBranches(req, res);
    }
    if (req.method === 'GET' && parsed.pathname === '/api/compare') {
      return await handleCompare(req, res);
    }
    if (req.method === 'GET' && parsed.pathname === '/api/tree') {
      return await handleTree(req, res);
    }
    if (req.method === 'GET' && parsed.pathname === '/api/file') {
      return await handleFile(req, res);
    }
    serveStatic(req, res);
  } catch (err) {
    jsonRes(res, 500, { error: '服务器错误: ' + err.message });
  }
});

server.listen(PORT, () => {
  console.log(`代码 Diff 查看器已启动: http://localhost:${PORT}`);
});

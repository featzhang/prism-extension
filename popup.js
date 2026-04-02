'use strict';

// ===== CONFIG =====
const CONFIG = {
  PER_PAGE: 20,
  CONCURRENT: 4,
  TTL_STATS: 10 * 60 * 1000,   // 10 minutes
  TTL_PRS: 5 * 60 * 1000,      // 5 minutes
  TTL_COMMENTS: 5 * 60 * 1000, // 5 minutes
  DEFAULT_REPO: 'apache/flink',
  GITHUB_API: 'https://api.github.com',
  // 预设项目列表
  PRESET_REPOS: [
    { value: 'apache/flink', label: 'Apache Flink' },
    { value: 'apache/flink-connector-http', label: 'Flink Connector HTTP' },
    { value: 'apache/flink-connector-kafka', label: 'Flink Connector Kafka' },
    { value: 'apache/flink-connector-jdbc', label: 'Flink Connector JDBC' },
    { value: 'apache/flink-connector-elasticsearch', label: 'Flink Connector ES' },
    { value: 'apache/flink-cdc', label: 'Flink CDC' },
    { value: 'apache/flink-ml', label: 'Flink ML' },
    { value: 'apache/flink-kubernetes-operator', label: 'Flink K8s Operator' },
  ],
};

// ===== STORAGE =====
const Storage = {
  async getCache(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, result => {
        const entry = result[key];
        if (!entry) return resolve(null);
        if (Date.now() - entry.timestamp > entry.ttl) return resolve(null);
        resolve(entry.data);
      });
    });
  },

  async setCache(key, data, ttl) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: { data, timestamp: Date.now(), ttl } }, resolve);
    });
  },

  async clearCacheByPrefix(prefix) {
    return new Promise(resolve => {
      chrome.storage.local.get(null, items => {
        const keysToRemove = Object.keys(items).filter(k => k.startsWith(prefix));
        if (keysToRemove.length === 0) return resolve();
        chrome.storage.local.remove(keysToRemove, resolve);
      });
    });
  },

  async getRepo() {
    return new Promise(resolve => {
      chrome.storage.local.get('repo', result => {
        resolve(result.repo || CONFIG.DEFAULT_REPO);
      });
    });
  },

  async getUsername() {
    return new Promise(resolve => {
      chrome.storage.local.get('username', result => {
        resolve(result.username || '');
      });
    });
  },

  async getToken() {
    return new Promise(resolve => {
      chrome.storage.local.get('gh_token', result => {
        resolve(result.gh_token || '');
      });
    });
  },

  async getCustomRepos() {
    return new Promise(resolve => {
      chrome.storage.local.get('customRepos', result => {
        resolve(result.customRepos || []);
      });
    });
  },

  async clearAuth() {
    return new Promise(resolve => {
      chrome.storage.local.remove(['gh_token', 'username', 'gh_login_error'], resolve);
    });
  },
};

// ===== GITHUB API =====
const GitHubAPI = {
  _token: '',

  async fetch(url) {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Flink-PR-Status-Extension/1.0',
    };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;

    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const msg = resp.status === 403
        ? 'Rate limit exceeded. Please wait before refreshing.'
        : `GitHub API error: ${resp.status} ${resp.statusText}`;
      throw new Error(msg);
    }
    return resp.json();
  },

  async getStats(repo, author = '') {
    const cacheKey = `cache_stats_${repo}_a${author}`;
    const cached = await Storage.getCache(cacheKey);
    if (cached) return cached;

    const authorQ = author ? `+author:${encodeURIComponent(author)}` : '';
    const [openResult, closedResult, mergedResult] = await Promise.all([
      this.fetch(`${CONFIG.GITHUB_API}/search/issues?q=repo:${repo}+is:pr+is:open${authorQ}&per_page=1`),
      this.fetch(`${CONFIG.GITHUB_API}/search/issues?q=repo:${repo}+is:pr+is:closed+is:unmerged${authorQ}&per_page=1`),
      this.fetch(`${CONFIG.GITHUB_API}/search/issues?q=repo:${repo}+is:pr+is:merged${authorQ}&per_page=1`),
    ]);

    const stats = {
      open: openResult.total_count,
      closed: closedResult.total_count,
      merged: mergedResult.total_count,
      total: openResult.total_count + closedResult.total_count + mergedResult.total_count,
    };

    await Storage.setCache(cacheKey, stats, CONFIG.TTL_STATS);
    return stats;
  },

  async getPRList(repo, { state = 'open', page = 1, sort = 'created', direction = 'desc', author = '' } = {}) {
    const cacheKey = `cache_prs_${repo}_${state}_${sort}_${direction}_p${page}_a${author}`;
    const cached = await Storage.getCache(cacheKey);
    if (cached) return cached;

    let prs;
    if (author) {
      // Use Search API to filter by author
      const stateQ = state === 'merged' ? 'is:merged' : (state === 'all' ? '' : `is:${state}`);
      const q = `repo:${repo}+is:pr+author:${encodeURIComponent(author)}${stateQ ? '+' + stateQ : ''}`;
      const sortParam = sort === 'updated' ? 'updated' : 'created';
      const url = `${CONFIG.GITHUB_API}/search/issues?q=${q}&sort=${sortParam}&order=${direction}&page=${page}&per_page=${CONFIG.PER_PAGE}`;
      const result = await this.fetch(url);
      prs = result.items;
      // Search API returns issues; map pull_request field presence is guaranteed for is:pr
    } else {
      const apiState = state === 'all' ? 'all' : (state === 'merged' ? 'closed' : state);
      const url = `${CONFIG.GITHUB_API}/repos/${repo}/pulls?state=${apiState}&page=${page}&per_page=${CONFIG.PER_PAGE}&sort=${sort}&direction=${direction}`;
      prs = await this.fetch(url);
      if (state === 'merged') {
        prs = prs.filter(pr => pr.merged_at != null);
      }
    }

    await Storage.setCache(cacheKey, prs, CONFIG.TTL_PRS);
    return prs;
  },

  async getPRComments(repo, prNumber) {
    const cacheKey = `cache_comments_${repo}_${prNumber}`;
    const cached = await Storage.getCache(cacheKey);
    if (cached) return cached;

    const url = `${CONFIG.GITHUB_API}/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
    const comments = await this.fetch(url);

    await Storage.setCache(cacheKey, comments, CONFIG.TTL_COMMENTS);
    return comments;
  },

  // 获取 PR 详情（包含 head sha）
  async getPRDetail(repo, prNumber) {
    const cacheKey = `cache_pr_detail_${repo}_${prNumber}`;
    const cached = await Storage.getCache(cacheKey);
    if (cached) return cached;

    const url = `${CONFIG.GITHUB_API}/repos/${repo}/pulls/${prNumber}`;
    const pr = await this.fetch(url);

    await Storage.setCache(cacheKey, pr, CONFIG.TTL_PRS);
    return pr;
  },

  // 获取 Check Runs（GitHub Actions CI 状态）
  async getCheckRuns(repo, ref) {
    const cacheKey = `cache_checks_${repo}_${ref}`;
    const cached = await Storage.getCache(cacheKey);
    if (cached) return cached;

    const url = `${CONFIG.GITHUB_API}/repos/${repo}/commits/${ref}/check-runs?per_page=100`;
    const result = await this.fetch(url);

    await Storage.setCache(cacheKey, result.check_runs || [], CONFIG.TTL_COMMENTS);
    return result.check_runs || [];
  },

  // 获取 Commit Status（传统 CI 状态）
  async getCommitStatuses(repo, ref) {
    const cacheKey = `cache_statuses_${repo}_${ref}`;
    const cached = await Storage.getCache(cacheKey);
    if (cached) return cached;

    const url = `${CONFIG.GITHUB_API}/repos/${repo}/commits/${ref}/statuses?per_page=100`;
    const statuses = await this.fetch(url);

    await Storage.setCache(cacheKey, statuses, CONFIG.TTL_COMMENTS);
    return statuses;
  },

  async fetchGraphQL(query, variables) {
    if (!this._token) return null;
    const resp = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this._token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!resp.ok) throw new Error(`GraphQL error: ${resp.status}`);
    const data = await resp.json();
    if (data.errors) throw new Error(data.errors[0].message);
    return data.data;
  },

  async getUnresolvedThreadCount(owner, repo, prNumber) {
    const cacheKey = `cache_cr_${owner}_${repo}_${prNumber}`;
    const cached = await Storage.getCache(cacheKey);
    if (cached !== null) return cached;

    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner: $owner, name: $repo) {
          pullRequest(number: $number) {
            reviewThreads(first: 100) {
              nodes { isResolved }
            }
          }
        }
      }`;
    const data = await this.fetchGraphQL(query, { owner, repo, number: prNumber });
    if (!data) return null;

    const threads = data.repository.pullRequest.reviewThreads.nodes;
    const count = threads.filter(t => !t.isResolved).length;
    await Storage.setCache(cacheKey, count, CONFIG.TTL_COMMENTS);
    return count;
  },

  async batchGetUnresolvedCR(owner, repo, prNumbers, onResult) {
    const queue = [...prNumbers];
    const workers = Array.from({ length: CONFIG.CONCURRENT }, async () => {
      while (queue.length > 0) {
        const prNumber = queue.shift();
        if (prNumber === undefined) break;
        try {
          const count = await this.getUnresolvedThreadCount(owner, repo, prNumber);
          onResult(prNumber, count);
        } catch (err) {
          console.warn(`Failed to get CR for PR #${prNumber}:`, err.message);
          onResult(prNumber, null);
        }
      }
    });
    await Promise.all(workers);
  },

  async batchGetComments(repo, prNumbers, onResult) {
    // Concurrency-limited queue
    const queue = [...prNumbers];
    const workers = Array.from({ length: CONFIG.CONCURRENT }, async () => {
      while (queue.length > 0) {
        const prNumber = queue.shift();
        if (prNumber === undefined) break;
        try {
          const comments = await this.getPRComments(repo, prNumber);
          const ciStatus = CIParser.extractCIStatus(comments);
          onResult(prNumber, ciStatus);
        } catch (err) {
          console.warn(`Failed to get comments for PR #${prNumber}:`, err.message);
          onResult(prNumber, null);
        }
      }
    });
    await Promise.all(workers);
  },

  // 通用的 CI 状态获取方法，根据项目类型选择不同策略
  async batchGetCIStatus(repo, prs, onResult) {
    // 判断项目类型：apache/flink 使用 Azure CI（flinkbot 评论），其他使用 GitHub Actions
    const useAzureCI = repo === 'apache/flink';
    
    const queue = [...prs];
    const workers = Array.from({ length: CONFIG.CONCURRENT }, async () => {
      while (queue.length > 0) {
        const pr = queue.shift();
        if (pr === undefined) break;
        const prNumber = pr.number;
        
        try {
          let ciStatus = null;
          
          if (useAzureCI) {
            // Apache Flink 主项目：从 flinkbot 评论获取 Azure CI 状态
            const comments = await this.getPRComments(repo, prNumber);
            ciStatus = CIParser.extractCIStatusFromComments(comments);
          } else {
            // Connector 等其他项目：从 GitHub Check Runs 获取 CI 状态
            // 获取 head SHA（如果 PR 对象没有，则获取 PR 详情）
            let headSha = pr.head?.sha;
            if (!headSha) {
              const prDetail = await this.getPRDetail(repo, prNumber);
              headSha = prDetail?.head?.sha;
            }
            
            if (headSha) {
              // 优先尝试 Check Runs (GitHub Actions)
              const checkRuns = await this.getCheckRuns(repo, headSha);
              if (checkRuns && checkRuns.length > 0) {
                ciStatus = CIParser.parseCheckRunsStatus(checkRuns);
              }
              
              // 如果没有 Check Runs，尝试 Commit Status
              if (!ciStatus) {
                const statuses = await this.getCommitStatuses(repo, headSha);
                if (statuses && statuses.length > 0) {
                  ciStatus = CIParser.parseCommitStatus(statuses);
                }
              }
            }
          }
          
          onResult(prNumber, ciStatus);
        } catch (err) {
          console.warn(`Failed to get CI for PR #${prNumber}:`, err.message);
          onResult(prNumber, null);
        }
      }
    });
    await Promise.all(workers);
  },
};

// ===== CI PARSER =====
const CIParser = {
  AZURE_PATTERN: /Azure:\s*\[([A-Z_]+)\]\((https?:\/\/dev\.azure\.com[^)]+)\)/gi,
  FLINKBOT_USER: 'flinkbot',

  // 从评论中提取 CI 状态（适用于 apache/flink 主项目）
  extractCIStatusFromComments(comments) {
    // Filter flinkbot comments with Azure CI reports, sorted by created_at desc
    const flinkbotComments = comments
      .filter(c => c.user && c.user.login === this.FLINKBOT_USER)
      .filter(c => /Azure:/i.test(c.body))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    if (flinkbotComments.length === 0) return null;

    // Use the most recent flinkbot CI comment
    return this.parseAzureStatus(flinkbotComments[0].body);
  },

  // 兼容旧方法名
  extractCIStatus(comments) {
    return this.extractCIStatusFromComments(comments);
  },

  parseAzureStatus(body) {
    const matches = [];
    const pattern = new RegExp(this.AZURE_PATTERN.source, 'gi');
    let match;
    while ((match = pattern.exec(body)) !== null) {
      matches.push({ status: match[1].toUpperCase(), url: match[2] });
    }

    if (matches.length === 0) return null;

    // Take the last match (most recent commit status in the comment)
    const last = matches[matches.length - 1];
    return {
      status: last.status,
      url: last.url,
      cssClass: this.statusToCssClass(last.status),
      label: this.statusToLabel(last.status),
      source: 'azure',
    };
  },

  // 从 GitHub Check Runs 解析 CI 状态（适用于 flink-connector-* 项目）
  parseCheckRunsStatus(checkRuns) {
    if (!checkRuns || checkRuns.length === 0) return null;

    // 查找主要的 CI check（通常是 "Build" 或包含 "CI" 的）
    const priorityKeywords = ['build', 'ci', 'test', 'check'];
    let mainCheck = null;

    // 优先查找包含关键词的 check
    for (const keyword of priorityKeywords) {
      mainCheck = checkRuns.find(cr => 
        cr.name.toLowerCase().includes(keyword)
      );
      if (mainCheck) break;
    }

    // 如果没找到，使用第一个 check
    if (!mainCheck) {
      mainCheck = checkRuns[0];
    }

    // 解析状态
    const status = this.mapCheckRunStatus(mainCheck.status, mainCheck.conclusion);
    
    return {
      status: status,
      url: mainCheck.html_url || mainCheck.details_url || '',
      cssClass: this.statusToCssClass(status),
      label: this.statusToLabelGitHub(status, mainCheck.name),
      source: 'github-actions',
      checkName: mainCheck.name,
    };
  },

  // 从 GitHub Commit Status 解析 CI 状态
  parseCommitStatus(statuses) {
    if (!statuses || statuses.length === 0) return null;

    // 获取最新的状态（通常是合并后的状态）
    const latestStatus = statuses[0];
    const status = latestStatus.state.toUpperCase();

    return {
      status: status,
      url: latestStatus.target_url || '',
      cssClass: this.statusToCssClass(status),
      label: this.statusToLabelGitHub(status, latestStatus.context || 'CI'),
      source: 'github-status',
    };
  },

  // 映射 GitHub Check Run 状态
  mapCheckRunStatus(status, conclusion) {
    if (status === 'completed') {
      switch (conclusion) {
        case 'success': return 'SUCCESS';
        case 'failure': return 'FAILURE';
        case 'cancelled': return 'CANCELLED';
        case 'skipped': return 'SKIPPED';
        case 'timed_out': return 'TIMEOUT';
        case 'action_required': return 'ACTION_REQUIRED';
        case 'neutral': return 'NEUTRAL';
        default: return 'UNKNOWN';
      }
    }
    switch (status) {
      case 'queued': return 'QUEUED';
      case 'in_progress': return 'IN_PROGRESS';
      case 'waiting': return 'WAITING';
      default: return 'PENDING';
    }
  },

  statusToCssClass(status) {
    if (['SUCCEEDED', 'SUCCESS', 'PASSED', 'NEUTRAL'].includes(status)) return 'ci-success';
    if (['FAILED', 'FAILURE', 'ERROR', 'TIMEOUT'].includes(status)) return 'ci-failure';
    if (['PENDING', 'RUNNING', 'IN_PROGRESS', 'INPROGRESS', 'QUEUED', 'WAITING'].includes(status)) return 'ci-pending';
    if (['DELETED', 'CANCELED', 'CANCELLED', 'SKIPPED'].includes(status)) return 'ci-unknown';
    return 'ci-unknown';
  },

  statusToLabel(status) {
    const labels = {
      SUCCEEDED: 'Azure: Pass',
      SUCCESS: 'Azure: Pass',
      PASSED: 'Azure: Pass',
      FAILED: 'Azure: Fail',
      FAILURE: 'Azure: Fail',
      ERROR: 'Azure: Error',
      PENDING: 'Azure: Pending',
      RUNNING: 'Azure: Running',
      IN_PROGRESS: 'Azure: Running',
      INPROGRESS: 'Azure: Running',
      DELETED: 'Azure: Deleted',
      CANCELED: 'Azure: Canceled',
      CANCELLED: 'Azure: Canceled',
      SKIPPED: 'Azure: Skipped',
    };
    return labels[status] || `Azure: ${status}`;
  },

  statusToLabelGitHub(status, checkName) {
    const shortName = checkName ? checkName.split('/').pop().substring(0, 12) : 'CI';
    const labels = {
      SUCCESS: `✓ ${shortName}`,
      FAILURE: `✗ ${shortName}`,
      ERROR: `✗ ${shortName}`,
      TIMEOUT: `⏱ ${shortName}`,
      PENDING: `◷ ${shortName}`,
      IN_PROGRESS: `◷ ${shortName}`,
      QUEUED: `◷ ${shortName}`,
      WAITING: `◷ ${shortName}`,
      CANCELLED: `⊘ ${shortName}`,
      SKIPPED: `⊘ ${shortName}`,
      NEUTRAL: `◯ ${shortName}`,
    };
    return labels[status] || `${shortName}`;
  },
};

// ===== RENDERER =====
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function timeAgo(dateStr) {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

function getPRState(pr) {
  if (pr.merged_at) return 'merged';
  if (pr.state === 'closed') return 'closed';
  return 'open';
}

function renderPRTitle(title, prUrl) {
  // Match one or more leading [FLINK-XXXXX] tokens
  const issuePattern = /^(\[FLINK-(\d+)\])+/i;
  const match = title.match(issuePattern);

  if (!match) {
    return `<a class="pr-title pr-title-text" href="${escapeHtml(prUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(title)}</a>`;
  }

  const issueToken = match[0]; // e.g. "[FLINK-39176]"
  const rest = title.slice(issueToken.length).trimStart();

  // Extract issue number(s) — take the last one if multiple
  const issueNumbers = [];
  const re = /\[FLINK-(\d+)\]/gi;
  let m;
  while ((m = re.exec(issueToken)) !== null) issueNumbers.push(m[1]);
  const issueNum = issueNumbers[issueNumbers.length - 1];
  const issueUrl = `https://issues.apache.org/jira/browse/FLINK-${issueNum}`;

  const issueLink = `<a class="pr-title-issue" href="${escapeHtml(issueUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(issueToken)}</a>`;
  const restLink = rest
    ? `<a class="pr-title pr-title-text" href="${escapeHtml(prUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(rest)}</a>`
    : `<a class="pr-title pr-title-text" href="${escapeHtml(prUrl)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(title)}">${escapeHtml(issueToken)}</a>`;

  return `<span class="pr-title">${issueLink}${rest ? ' ' : ''}${rest ? restLink : ''}</span>`;
}


const Renderer = {
  renderStats(stats) {
    document.getElementById('num-open').textContent = stats.open.toLocaleString();
    document.getElementById('num-done').textContent = (stats.closed + stats.merged).toLocaleString();
  },

  renderStatsLoading() {
    ['num-open', 'num-done', 'num-unresolved-cr'].forEach(id => {
      document.getElementById(id).textContent = '…';
    });
  },

  renderPRList(prs) {
    const list = document.getElementById('pr-list');
    if (!prs || prs.length === 0) {
      list.innerHTML = '<div class="empty-state">No pull requests found.</div>';
      return;
    }

    const html = prs.map(pr => {
      const state = getPRState(pr);
      const stateLabel = state.charAt(0).toUpperCase() + state.slice(1);
      const dateField = state === 'merged' ? pr.merged_at : (state === 'closed' ? pr.closed_at : pr.created_at);
      const timeLabel = state === 'merged' ? 'Merged' : (state === 'closed' ? 'Closed' : 'Opened');

      return `
        <div class="pr-item">
          <div class="pr-item-inner">
            <div class="pr-left">
              <span class="pr-number">#${pr.number}</span>
              <span class="pr-state-badge ${escapeHtml(state)}">${escapeHtml(stateLabel)}</span>
            </div>
            <div class="pr-right">
              <div class="pr-title-row">${renderPRTitle(pr.title, pr.html_url)}</div>
            </div>
          </div>
          <div class="pr-row-bottom">
            <span class="pr-meta">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 3.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4.001 4.001 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.49 3.49 0 0 1 2 5.5z"/></svg>
              <a class="pr-author" href="https://github.com/${escapeHtml(pr.user ? pr.user.login : '')}" target="_blank" rel="noopener noreferrer">${escapeHtml(pr.user ? pr.user.login : 'unknown')}</a>
            </span>
            <span class="pr-meta" title="${new Date(dateField).toLocaleString()}">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0zM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0zm7-3.25v2.992l2.028.812a.75.75 0 0 1-.557 1.392l-2.5-1A.75.75 0 0 1 7 8.25v-3.5a.75.75 0 0 1 1.5 0z"/></svg>
              ${escapeHtml(timeLabel)} ${escapeHtml(timeAgo(dateField))}
            </span>
            <span class="pr-meta">
              <svg viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
              ${pr.comments || 0}
            </span>
            <span id="ci-${pr.number}" class="ci-loading">loading CI…</span>
            <button class="expert-suggestion-btn" 
                    data-pr-number="${pr.number}"
                    title="Suggest experts for this PR">
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
                <path d="M7.5 5.5A.5.5 0 0 1 8 5h1.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H8a.5.5 0 0 1-.5-.5v-3zm2 0a.5.5 0 0 1 1 0v3a.5.5 0 0 1-1 0v-3z"/>
                <path d="M8 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
              </svg>
            </button>
            <span id="cr-${pr.number}"></span>
          </div>
          <div id="expert-results-${pr.number}" class="expert-results-row hidden"></div>
        </div>
      `;
    }).join('');

    list.innerHTML = html;
  },

  renderLoading() {
    document.getElementById('pr-list').innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <span>Loading PRs…</span>
      </div>
    `;
  },

  updateCIStatus(prNumber, ciStatus) {
    const el = document.getElementById(`ci-${prNumber}`);
    if (!el) return;

    if (!ciStatus) {
      el.className = '';
      el.innerHTML = '';
      return;
    }

    const safeLabel = escapeHtml(ciStatus.label);
    const safeUrl = escapeHtml(ciStatus.url);

    if (ciStatus.url) {
      el.outerHTML = `<a id="ci-${prNumber}" class="ci-badge ${escapeHtml(ciStatus.cssClass)} clickable"
        href="${safeUrl}" target="_blank" rel="noopener noreferrer"
        title="Azure CI: ${escapeHtml(ciStatus.status)}">${safeLabel}</a>`;
    } else {
      el.className = `ci-badge ${ciStatus.cssClass}`;
      el.textContent = ciStatus.label;
    }
  },

  updateCRCount(prNumber, count) {
    const el = document.getElementById(`cr-${prNumber}`);
    if (!el) return;
    if (count === null || count === 0) {
      el.className = '';
      el.textContent = '';
      return;
    }
    el.className = 'cr-badge';
    el.textContent = `${count} CR`;
  },

  renderCRStat(total) {
    const el = document.getElementById('num-unresolved-cr');
    if (el) el.textContent = total.toLocaleString();
  },

  renderPagination(page, hasMore, totalCount) {
    const totalPages = totalCount > 0 ? Math.ceil(totalCount / CONFIG.PER_PAGE) : (hasMore ? '?' : page);
    document.getElementById('page-info').textContent = `Page ${page} / ${totalPages}`;
    document.getElementById('btn-prev').disabled = page <= 1;
    document.getElementById('btn-next').disabled = !hasMore;
  },

  showStatus(msg, isError = false) {
    const bar = document.getElementById('status-bar');
    bar.textContent = msg;
    bar.className = `status-bar${isError ? ' error' : ''}`;
  },

  hideStatus() {
    document.getElementById('status-bar').className = 'status-bar hidden';
  },
};

// ===== APP =====
window.App = {
  repo: CONFIG.DEFAULT_REPO,
  customRepos: [],
  currentState: 'open',
  currentPage: 1,
  currentSort: 'created',
  currentDirection: 'desc',
  currentAuthor: '',
  currentCIFilter: 'all',
  currentPRs: [],
  currentTotalCount: 0,
  isLoading: false,
  isLoadingAllStats: false,

  async init() {
    this.repo = await Storage.getRepo();
    GitHubAPI._token = await Storage.getToken();
    this.currentAuthor = await Storage.getUsername();
    this.customRepos = await Storage.getCustomRepos();
    
    // 初始化项目选择下拉框
    this.initRepoSelect();
    
    this.renderAuthState();
    this.bindEvents();
    this.watchAuthStorage();
    await this.loadAll();
  },

  initRepoSelect() {
    const repoSelect = document.getElementById('repo-select');
    if (!repoSelect) return;
    
    // 清空并填充下拉框
    repoSelect.innerHTML = '';
    
    // 合并预设项目和自定义项目
    const allRepos = this.getAllRepos();
    
    allRepos.forEach(repo => {
      const option = document.createElement('option');
      option.value = repo.value;
      option.textContent = repo.label;
      repoSelect.appendChild(option);
    });
    
    // 检查当前项目是否在列表中
    const isInList = allRepos.some(r => r.value === this.repo);
    if (!isInList && this.repo) {
      // 如果不在列表中，添加临时选项
      const customOption = document.createElement('option');
      customOption.value = this.repo;
      customOption.textContent = this.repo + ' (Unlisted)';
      repoSelect.appendChild(customOption);
    }
    
    // 设置当前选中值
    repoSelect.value = this.repo;
  },

  getAllRepos() {
    // 合并预设项目和自定义项目，避免重复
    const presetValues = new Set(CONFIG.PRESET_REPOS.map(r => r.value));
    const filteredCustom = (this.customRepos || []).filter(r => !presetValues.has(r.value));
    return [...CONFIG.PRESET_REPOS, ...filteredCustom];
  },

  bindEvents() {
    // Refresh button
    document.getElementById('btn-refresh').addEventListener('click', () => this.refresh());

    // Refresh all repos stats button
    document.getElementById('btn-refresh-stats').addEventListener('click', () => this.loadAllReposStats());

    // Settings button
    document.getElementById('btn-settings').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });

    // Repo select
    document.getElementById('repo-select').addEventListener('change', async e => {
      if (this.isLoading) return;
      const newRepo = e.target.value;
      if (newRepo !== this.repo) {
        this.repo = newRepo;
        // 保存到 storage
        await new Promise(resolve => {
          chrome.storage.local.set({ repo: newRepo }, resolve);
        });
        // 清除缓存并重新加载
        await Storage.clearCacheByPrefix('cache_');
        this.currentPage = 1;
        Renderer.renderStatsLoading();
        await this.loadAll();
      }
    });

    // State select
    document.getElementById('state-select').addEventListener('change', e => {
      if (this.isLoading) return;
      this.currentState = e.target.value;
      this.currentPage = 1;
      this.loadPRs();
    });

    // Sort select
    document.getElementById('sort-select').addEventListener('change', e => {
      if (this.isLoading) return;
      const [sort, dir] = e.target.value.split('-');
      this.currentSort = sort;
      this.currentDirection = dir;
      this.currentPage = 1;
      this.loadPRs();
    });

    // Pagination
    document.getElementById('btn-prev').addEventListener('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        this.loadPRs();
      }
    });

    document.getElementById('btn-next').addEventListener('click', () => {
      this.currentPage++;
      this.loadPRs();
    });



    // Stat cards click to filter
    document.getElementById('stat-open').addEventListener('click', () => this.switchTab('open'));
    document.getElementById('stat-done').addEventListener('click', () => this.switchTab('closed'));

    // CI filter
    document.getElementById('ci-filter-select').addEventListener('change', e => {
      this.currentCIFilter = e.target.value;
      this.applyCIFilter();
    });

    // Login / Logout
    document.getElementById('btn-login').addEventListener('click', () => this.startLogin());
    document.getElementById('btn-logout').addEventListener('click', () => this.logout());

    // Expert recommendation
    document.getElementById('btn-close-experts').addEventListener('click', () => this.hideExpertPanel());

    // Expert suggestion buttons (event delegation)
    document.addEventListener('click', (e) => {
      if (e.target.closest('.expert-suggestion-btn')) {
        console.log('Expert suggestion button clicked');
        const button = e.target.closest('.expert-suggestion-btn');
        const prNumber = button.getAttribute('data-pr-number');
        console.log(`PR number: ${prNumber}`);
        if (prNumber) {
          window.App.suggestExpertsForSinglePR(parseInt(prNumber));
        }
      }
    });
  },

  // 显示专家推荐面板
  showExpertPanel() {
    const panel = document.getElementById('expert-panel');
    panel.classList.remove('hidden');
  },

  // 隐藏专家推荐面板
  hideExpertPanel() {
    const panel = document.getElementById('expert-panel');
    panel.classList.add('hidden');
  },

  // 在PR item下方显示专家推荐加载状态
  showExpertLoading(prNumber) {
    const expertRow = document.getElementById(`expert-results-${prNumber}`);
    if (expertRow) {
      expertRow.innerHTML = `
        <div class="expert-loading">
          <div class="spinner small"></div>
          <span>Analyzing for expert recommendations...</span>
        </div>
      `;
      expertRow.classList.remove('hidden');
    } else {
      // 创建新的专家结果行
      const prItem = document.querySelector(`.pr-item[data-pr-number="${prNumber}"]`);
      if (prItem) {
        const expertRow = document.createElement('div');
        expertRow.id = `expert-results-${prNumber}`;
        expertRow.className = 'expert-results-row';
        expertRow.innerHTML = `
          <div class="expert-loading">
            <div class="spinner small"></div>
            <span>Analyzing for expert recommendations...</span>
          </div>
        `;
        prItem.appendChild(expertRow);
      }
    }
  },

  // 在PR item下方显示专家推荐结果
  showExpertResults(prNumber, experts) {
    const expertRow = document.getElementById(`expert-results-${prNumber}`);
    if (!expertRow) return;

    if (!experts || experts.length === 0) {
      expertRow.innerHTML = `
        <div class="expert-empty">
          <span>No expert recommendations found for this PR</span>
        </div>
      `;
      return;
    }

    let html = `
      <div class="expert-results-header">
        <span>Recommended Reviewers:</span>
        <button class="expert-toggle-btn" onclick="app.toggleExpertResults(${prNumber})" title="Hide recommendations">
          <svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>
        </button>
      </div>
      <div class="expert-suggestions">
    `;

    experts.forEach(expert => {
      const scoreClass = this.getExpertScoreClass(expert.score);
      html += `
        <div class="expert-suggestion">
          <a href="https://github.com/${expert.author}" target="_blank" class="expert-github-link" title="View GitHub profile">
            <span class="expert-avatar">${expert.author.charAt(0).toUpperCase()}</span>
          </a>
          <span class="expert-name">${expert.author}</span>
          <span class="expert-score-badge ${scoreClass}">${expert.score}</span>
          <span class="expert-description">${expert.expertise}</span>
        </div>
      `;
    });

    html += '</div>';
    expertRow.innerHTML = html;
    expertRow.classList.remove('hidden');
  },

  // 切换专家推荐结果的显示/隐藏
  toggleExpertResults(prNumber) {
    const expertRow = document.getElementById(`expert-results-${prNumber}`);
    if (expertRow) {
      expertRow.classList.toggle('hidden');
      const toggleBtn = expertRow.querySelector('.expert-toggle-btn');
      if (toggleBtn) {
        const isHidden = expertRow.classList.contains('hidden');
        toggleBtn.innerHTML = isHidden 
          ? '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"/></svg>'
          : '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z" transform="rotate(90 8 8)"/></svg>';
        toggleBtn.title = isHidden ? 'Show recommendations' : 'Hide recommendations';
      }
    }
  },

  // 为当前PR列表推荐专家
  async suggestExperts() {
    if (this.isLoading || this.currentPRs.length === 0) return;

    const btn = document.getElementById('btn-suggest-experts');
    const originalText = btn.innerHTML;
    
    btn.disabled = true;
    btn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.5 5.5A.5.5 0 0 1 8 5h1.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H8a.5.5 0 0 1-.5-.5v-3zm2 0a.5.5 0 0 1 1 0v3a.5.5 0 0 1-1 0v-3z"/><path d="M8 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg> Analyzing...';

    try {
      this.showExpertPanel();
      const expertList = document.getElementById('expert-list');
      expertList.innerHTML = '<div class="loading"><div class="spinner"></div><span>Analyzing PRs for expert recommendations...</span></div>';

      const prNumbers = this.currentPRs.map(pr => pr.number);
      const expertResults = {};

      await ExpertRecommender.batchSuggestExperts(this.repo, prNumbers, (prNumber, experts) => {
        expertResults[prNumber] = experts;
        this.updateExpertPanel(expertResults);
      });

    } catch (error) {
      console.error('Failed to suggest experts:', error);
      const expertList = document.getElementById('expert-list');
      expertList.innerHTML = `<div class="empty-state">Failed to get expert recommendations: ${error.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  },

  // 为单个PR推荐专家
  async suggestExpertsForSinglePR(prNumber) {
    console.log(`点击专家推荐按钮，PR #${prNumber}`);
    
    // 检查是否已经显示了推荐结果
    const expertRow = document.getElementById(`expert-results-${prNumber}`);
    if (expertRow && !expertRow.classList.contains('hidden')) {
      // 如果已经显示，则隐藏
      this.toggleExpertResults(prNumber);
      return;
    }

    if (this.isLoading) return;

    this.isLoading = true;
    const btn = document.querySelector(`.expert-btn[data-pr="${prNumber}"]`);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.5 5.5A.5.5 0 0 1 8 5h1.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H8a.5.5 0 0 1-.5-.5v-3zm2 0a.5.5 0 0 1 1 0v3a.5.5 0 0 1-1 0v-3z"/><path d="M8 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>';
    }

    try {
      console.log(`开始处理PR #${prNumber}的专家推荐，仓库: ${this.repo}`);
      // 显示加载状态在PR item下方
      this.showExpertLoading(prNumber);

      // 获取单个PR的专家推荐
      const experts = await ExpertRecommender.suggestExpertsForPR(this.repo, prNumber);
      console.log(`PR #${prNumber}专家推荐结果:`, experts);
      
      // 在PR item下方显示专家推荐结果
      this.showExpertResults(prNumber, experts);
    } catch (error) {
      console.error(`Failed to suggest experts for PR #${prNumber}:`, error);
      const expertList = document.getElementById('expert-list');
      expertList.innerHTML = `<div class="empty-state">Failed to get expert recommendations for PR #${prNumber}: ${error.message}</div>`;
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
    }
  },

  // 为单个PR更新专家推荐面板
  updateExpertPanelForSinglePR(prNumber, experts) {
    const expertList = document.getElementById('expert-list');
    
    if (!experts || experts.length === 0) {
      expertList.innerHTML = `<div class="empty-state">No expert recommendations found for PR #${prNumber}</div>`;
      return;
    }

    // 找到对应的PR信息
    const pr = this.currentPRs.find(p => p.number === prNumber);
    if (!pr) return;

    let html = `
      <div class="expert-pr-item">
        <div class="expert-pr-header">
          <span class="expert-pr-title">PR #${prNumber}</span>
          <span class="expert-pr-number">${escapeHtml(pr.title)}</span>
        </div>
        <div class="expert-suggestions">
    `;

    experts.forEach(expert => {
      const scoreClass = this.getExpertScoreClass(expert.score);
      html += `
        <div class="expert-suggestion">
          <span class="expert-avatar">${expert.author.charAt(0).toUpperCase()}</span>
          <span class="expert-name">${expert.author}</span>
          <span class="expert-score-badge ${scoreClass}">${expert.score}</span>
          <span class="expert-description">${expert.expertise}</span>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;

    expertList.innerHTML = html;
  },

  // 更新专家推荐面板
  updateExpertPanel(expertResults) {
    const expertList = document.getElementById('expert-list');
    
    if (Object.keys(expertResults).length === 0) {
      expertList.innerHTML = '<div class="empty-state">No expert recommendations available</div>';
      return;
    }

    let html = '';
    
    // 为每个PR显示专家推荐
    this.currentPRs.forEach(pr => {
      const experts = expertResults[pr.number] || [];
      if (experts.length === 0) return;

      html += `
        <div class="expert-pr-item">
          <div class="expert-pr-header">
            <span class="expert-pr-title">PR #${pr.number}</span>
            <span class="expert-pr-number">${pr.title}</span>
          </div>
          <div class="expert-suggestions">
      `;

      experts.forEach(expert => {
        const scoreClass = this.getExpertScoreClass(expert.score);
        html += `
          <div class="expert-suggestion">
            <span class="expert-avatar">${expert.author.charAt(0).toUpperCase()}</span>
            <span class="expert-name">${expert.author}</span>
            <span class="expert-score-badge ${scoreClass}">${expert.score}</span>
            <span class="expert-description">${expert.expertise}</span>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    if (html === '') {
      html = '<div class="empty-state">No expert recommendations found for current PRs</div>';
    }

    expertList.innerHTML = html;
  },

  // 根据专家评分获取CSS类
  getExpertScoreClass(score) {
    if (score >= 80) return 'expert-score-high';
    if (score >= 60) return 'expert-score-medium';
    if (score >= 40) return 'expert-score-low';
    return 'expert-score-low';
  },

  renderAuthState() {
    const username = this.currentAuthor || '';
    const token = GitHubAPI._token;
    const loginBtn = document.getElementById('btn-login');
    const logoutBtn = document.getElementById('btn-logout');
    const userLabel = document.getElementById('auth-user');

    if (token && username) {
      loginBtn.style.display = 'none';
      logoutBtn.style.display = 'inline-flex';
      userLabel.textContent = username;
      userLabel.style.display = 'inline';
    } else {
      loginBtn.style.display = 'inline-flex';
      logoutBtn.style.display = 'none';
      userLabel.style.display = 'none';
    }
  },

  startLogin() {
    const loginBtn = document.getElementById('btn-login');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Connecting…';

    chrome.runtime.sendMessage({ type: 'START_LOGIN' }, resp => {
      if (!resp || !resp.ok) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        Renderer.showStatus(`Login failed: ${resp?.error || 'Unknown error'}`, true);
        return;
      }
      // Show user_code; token arrival is handled by watchAuthStorage
      loginBtn.textContent = 'Authorizing…';
      Renderer.showStatus(`Enter code  ${resp.user_code}  at ${resp.verification_uri}`);
    });
  },

  async logout() {
    await Storage.clearAuth();
    GitHubAPI._token = '';
    this.currentAuthor = '';
    this.renderAuthState();
    await Storage.clearCacheByPrefix('cache_');
    await this.loadAll();
  },

  // Watch storage for token written by background after polling completes
  watchAuthStorage() {
    // Listen for direct message from background (primary, more reliable)
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'LOGIN_SUCCESS') {
        Storage.getToken().then(token => {
          GitHubAPI._token = token;
          this.currentAuthor = msg.username;
          this.renderAuthState();
          Renderer.hideStatus();
          const loginBtn = document.getElementById('btn-login');
          loginBtn.disabled = false;
          loginBtn.textContent = 'Login';
          Storage.clearCacheByPrefix('cache_').then(() => this.loadAll());
        });
      }
      if (msg.type === 'LOGIN_ERROR') {
        Renderer.showStatus(`Login error: ${msg.error}`, true);
        const loginBtn = document.getElementById('btn-login');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
      }
    });

    // Fallback: storage.onChanged in case message is missed
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;

      if (changes.gh_token || changes.username) {
        GitHubAPI._token = await Storage.getToken();
        this.currentAuthor = await Storage.getUsername();
        this.renderAuthState();
        Renderer.hideStatus();
        const loginBtn = document.getElementById('btn-login');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        await Storage.clearCacheByPrefix('cache_');
        await this.loadAll();
      }

      if (changes.gh_login_error) {
        const err = changes.gh_login_error.newValue;
        Renderer.showStatus(`Login error: ${err}`, true);
        const loginBtn = document.getElementById('btn-login');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        chrome.storage.local.remove('gh_login_error');
      }
    });
  },

  applyCIFilter() {
    const filter = this.currentCIFilter;
    document.querySelectorAll('.pr-item').forEach(item => {
      if (filter === 'all') {
        item.style.display = '';
        return;
      }
      // Find the ci badge element inside this item
      const badge = item.querySelector('[id^="ci-"]');
      const hasClass = badge && badge.classList.contains(filter);
      item.style.display = hasClass ? '' : 'none';
    });
  },



  switchTab(state) {
    document.getElementById('state-select').value = state;
    this.currentState = state;
    this.currentPage = 1;
    this.loadPRs();
  },

  async refresh() {
    await Storage.clearCacheByPrefix('cache_');
    this.currentPage = 1;
    Renderer.renderStatsLoading();
    await this.loadAll();
  },

  async loadAll() {
    // Load stats and PRs in parallel
    this.setLoading(true);
    try {
      await Promise.all([
        this.loadStats(),
        this.loadPRs(),
      ]);
    } finally {
      this.setLoading(false);
    }
  },

  async loadStats() {
    try {
      const stats = await GitHubAPI.getStats(this.repo, this.currentAuthor);
      Renderer.renderStats(stats);
      // Update total count for current state to compute total pages
      const stateCount = this.currentState === 'all' ? (stats.open + stats.closed + stats.merged)
        : this.currentState === 'merged' ? stats.merged
        : this.currentState === 'closed' ? stats.closed
        : stats.open;
      this.currentTotalCount = stateCount || 0;
      Renderer.renderPagination(this.currentPage, this.currentPage * CONFIG.PER_PAGE < this.currentTotalCount, this.currentTotalCount);
    } catch (err) {
      console.error('Failed to load stats:', err);
      Renderer.showStatus(`Stats error: ${err.message}`, true);
    }
  },

  async loadPRs() {
    if (this.isLoading && this._prLoadInProgress) return;
    this._prLoadInProgress = true;
    this.setLoading(true);
    Renderer.renderLoading();
    Renderer.hideStatus();
    // Reset CI filter on new load
    this.currentCIFilter = 'all';
    document.getElementById('ci-filter-select').value = 'all';

    try {
      const prs = await GitHubAPI.getPRList(this.repo, {
        state: this.currentState,
        page: this.currentPage,
        sort: this.currentSort,
        direction: this.currentDirection,
        author: this.currentAuthor,
      });

      this.currentPRs = prs;
      Renderer.renderPRList(prs);
      Renderer.renderPagination(this.currentPage, prs.length >= CONFIG.PER_PAGE, this.currentTotalCount);

      // Async load CI statuses and unresolved CR counts
      if (prs.length > 0) {
        const prNumbers = prs.map(pr => pr.number);
        const [ownerName, repoName] = this.repo.split('/');

        // 使用通用的 CI 状态获取方法（自动判断使用 Azure CI 或 GitHub Actions）
        GitHubAPI.batchGetCIStatus(this.repo, prs, (prNumber, ciStatus) => {
          Renderer.updateCIStatus(prNumber, ciStatus);
          this.applyCIFilter();
        });

        if (GitHubAPI._token) {
          let totalCR = 0;
          GitHubAPI.batchGetUnresolvedCR(ownerName, repoName, prNumbers, (prNumber, count) => {
            Renderer.updateCRCount(prNumber, count);
            if (count) totalCR += count;
            Renderer.renderCRStat(totalCR);
          });
        }
      }
    } catch (err) {
      console.error('Failed to load PRs:', err);
      Renderer.showStatus(err.message, true);
      document.getElementById('pr-list').innerHTML =
        `<div class="empty-state">Failed to load PRs: ${escapeHtml(err.message)}</div>`;
    } finally {
      this._prLoadInProgress = false;
      this.setLoading(false);
    }
  },

  setLoading(loading) {
    this.isLoading = loading;
    const btn = document.getElementById('btn-refresh');
    const container = document.getElementById('pr-list-container');
    if (loading) {
      btn.classList.add('spinning');
      btn.disabled = true;
      container.classList.add('loading');
    } else {
      btn.classList.remove('spinning');
      btn.disabled = false;
      container.classList.remove('loading');
    }
  },

  // ===== ALL REPOS STATS =====
  async loadAllReposStats() {
    if (this.isLoadingAllStats) return;
    this.isLoadingAllStats = true;

    const refreshBtn = document.getElementById('btn-refresh-stats');
    const totalOpenEl = document.getElementById('total-open');
    const totalDoneEl = document.getElementById('total-done');
    const totalCREl = document.getElementById('total-cr');
    const hintEl = document.getElementById('summary-hint');

    // Set loading state
    refreshBtn.classList.add('loading');
    refreshBtn.disabled = true;
    totalOpenEl.textContent = '…';
    totalDoneEl.textContent = '…';
    totalCREl.textContent = '…';
    hintEl.textContent = 'Loading...';
    hintEl.classList.remove('error');

    const allRepos = this.getAllRepos();
    const author = this.currentAuthor;

    let totalOpen = 0;
    let totalDone = 0;
    let totalCR = 0;
    let completedRepos = 0;
    let failedRepos = 0;

    try {
      // Load stats for all repos with concurrency limit
      const CONCURRENT = 3;
      const queue = [...allRepos];

      const workers = Array.from({ length: CONCURRENT }, async () => {
        while (queue.length > 0) {
          const repo = queue.shift();
          if (!repo) break;

          try {
            // Get basic stats
            const stats = await GitHubAPI.getStats(repo.value, author);
            totalOpen += stats.open;
            totalDone += stats.closed + stats.merged;

            // Update UI progressively
            totalOpenEl.textContent = totalOpen.toLocaleString();
            totalDoneEl.textContent = totalDone.toLocaleString();

            // Get CR counts for open PRs (only if logged in)
            if (GitHubAPI._token && stats.open > 0) {
              const [ownerName, repoName] = repo.value.split('/');
              // Get open PR numbers for this repo
              const prs = await GitHubAPI.getPRList(repo.value, { state: 'open', page: 1, author });
              const prNumbers = prs.slice(0, 20).map(pr => pr.number); // Limit to first 20 PRs

              for (const prNumber of prNumbers) {
                try {
                  const crCount = await GitHubAPI.getUnresolvedThreadCount(ownerName, repoName, prNumber);
                  if (crCount) {
                    totalCR += crCount;
                    totalCREl.textContent = totalCR.toLocaleString();
                  }
                } catch (e) {
                  // Ignore individual CR errors
                }
              }
            }

            completedRepos++;
            hintEl.textContent = `Loading... (${completedRepos}/${allRepos.length})`;
          } catch (err) {
            console.warn(`Failed to load stats for ${repo.value}:`, err.message);
            failedRepos++;
          }
        }
      });

      await Promise.all(workers);

      // Final update
      if (failedRepos > 0) {
        hintEl.textContent = `${completedRepos}/${allRepos.length} repos`;
      } else {
        const now = new Date();
        hintEl.textContent = now.toLocaleTimeString();
      }

      if (!GitHubAPI._token) {
        totalCREl.textContent = '—';
        hintEl.textContent = 'Login for CR stats';
        hintEl.classList.add('error');
      }

    } catch (err) {
      console.error('Failed to load all repos stats:', err);
      hintEl.textContent = `Error: ${err.message}`;
      hintEl.classList.add('error');
    } finally {
      refreshBtn.classList.remove('loading');
      refreshBtn.disabled = false;
      this.isLoadingAllStats = false;
    }
  },
};

// ===== EXPERT RECOMMENDATION =====
const ExpertRecommender = {
  // 获取文件的历史贡献者
  async getFileContributors(repo, filePath, limit = 10) {
    const cacheKey = `cache_contributors_${repo}_${btoa(filePath)}`;
    const cached = await Storage.getCache(cacheKey);
    if (cached) {
      console.log(`使用缓存获取 ${filePath} 的贡献者`);
      return cached;
    }

    try {
      // 使用GitHub API获取文件提交历史
      const url = `${CONFIG.GITHUB_API}/repos/${repo}/commits?path=${encodeURIComponent(filePath)}&per_page=${limit}`;
      console.log(`获取文件贡献者: ${url}`);
      console.log(`当前GitHub Token状态: ${GitHubAPI._token ? '已设置' : '未设置'}`);
      const commits = await GitHubAPI.fetch(url);
      console.log(`文件 ${filePath} 的提交历史获取成功，共${commits.length}条提交`);
      
      // 统计每个作者的提交次数
      const contributors = {};
      commits.forEach(commit => {
        const author = commit.author?.login || commit.commit.author.name;
        if (author) {
          contributors[author] = (contributors[author] || 0) + 1;
        }
      });

      // 转换为排序数组
      const result = Object.entries(contributors)
        .map(([author, count]) => ({ author, count, lastCommit: commits[0]?.commit.author.date }))
        .sort((a, b) => b.count - a.count);

      await Storage.setCache(cacheKey, result, CONFIG.TTL_COMMENTS);
      return result;
    } catch (error) {
      console.warn(`Failed to get contributors for ${filePath}:`, error.message);
      return [];
    }
  },

  // 分析PR的变更文件并推荐专家
  async suggestExpertsForPR(repo, prNumber) {
    try {
      console.log(`开始分析PR #${prNumber}的专家推荐...`);
      // 获取PR的变更文件列表
      const prDetail = await GitHubAPI.getPRDetail(repo, prNumber);
      console.log(`PR详情获取成功:`, prDetail);
      // 使用标准的GitHub API端点获取PR文件列表（支持分页）
      let allFiles = [];
      let page = 1;
      const perPage = 100; // GitHub API每页最大数量
      
      while (true) {
        const filesUrl = `${CONFIG.GITHUB_API}/repos/${repo}/pulls/${prNumber}/files?page=${page}&per_page=${perPage}`;
        console.log(`获取文件列表第${page}页: ${filesUrl}`);
        const files = await GitHubAPI.fetch(filesUrl);
        
        if (files.length === 0) break;
        
        allFiles = allFiles.concat(files);
        
        // 如果获取的文件数量少于每页数量，说明已经是最后一页
        if (files.length < perPage) break;
        
        page++;
      }
      
      console.log(`文件列表获取成功，共${allFiles.length}个文件`);
      if (allFiles.length === 0) {
        console.warn(`PR #${prNumber}没有变更文件`);
        return [];
      }
      
      // 对每个文件获取贡献者
      const fileExperts = await Promise.all(
        allFiles.map(async file => {
          const contributors = await this.getFileContributors(repo, file.filename, 5);
          return {
            file: file.filename,
            contributors: contributors
          };
        })
      );

      // 合并所有贡献者并计算综合评分
      const expertScores = {};
      
      fileExperts.forEach(fileData => {
        fileData.contributors.forEach(contributor => {
          if (!expertScores[contributor.author]) {
            expertScores[contributor.author] = {
              author: contributor.author,
              totalCommits: 0,
              fileCount: 0,
              recentActivity: 0,
              score: 0
            };
          }
          
          const expert = expertScores[contributor.author];
          expert.totalCommits += contributor.count;
          expert.fileCount += 1;
          
          // 时间衰减因子：最近6个月的提交权重更高
          if (contributor.lastCommit) {
            const monthsAgo = this.getMonthsAgo(contributor.lastCommit);
            const timeWeight = Math.max(0, 1 - monthsAgo / 6); // 6个月内线性衰减
            expert.recentActivity += contributor.count * timeWeight;
          }
        });
      });

      // 计算综合评分
      const experts = Object.values(expertScores).map(expert => {
        // 评分公式：基础提交数 + 文件覆盖度 + 近期活跃度
        const baseScore = Math.log(expert.totalCommits + 1) * 10;
        const fileCoverage = expert.fileCount / allFiles.length * 20;
        const recentScore = expert.recentActivity * 5;
        
        expert.score = baseScore + fileCoverage + recentScore;
        return expert;
      });

      // 按评分排序并返回前5名专家
      return experts
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(expert => ({
          author: expert.author,
          score: Math.round(expert.score),
          expertise: this.getExpertiseDescription(expert, fileExperts.length)
        }));

    } catch (error) {
      console.warn(`Failed to suggest experts for PR #${prNumber}:`, error.message);
      return [];
    }
  },

  // 计算距离现在的月数
  getMonthsAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    return (now.getFullYear() - date.getFullYear()) * 12 + 
           (now.getMonth() - date.getMonth());
  },

  // 生成专家描述
  getExpertiseDescription(expert, totalFiles) {
    const coverage = Math.round((expert.fileCount / totalFiles) * 100);
    if (coverage >= 80) return 'Primary expert';
    if (coverage >= 50) return 'Key contributor';
    if (expert.totalCommits > 10) return 'Experienced contributor';
    return 'Occasional contributor';
  },

  // 批量获取多个PR的专家推荐
  async batchSuggestExperts(repo, prNumbers, onResult) {
    const queue = [...prNumbers];
    const workers = Array.from({ length: CONFIG.CONCURRENT }, async () => {
      while (queue.length > 0) {
        const prNumber = queue.shift();
        if (prNumber === undefined) break;
        
        try {
          const experts = await this.suggestExpertsForPR(repo, prNumber);
          onResult(prNumber, experts);
        } catch (err) {
          console.warn(`Failed to get experts for PR #${prNumber}:`, err.message);
          onResult(prNumber, []);
        }
      }
    });
    
    await Promise.all(workers);
  }
};

// 在CONFIG中添加专家推荐相关的配置
if (typeof CONFIG !== 'undefined') {
  CONFIG.TTL_COMMENTS = CONFIG.TTL_COMMENTS || 5 * 60 * 1000;
  CONFIG.CONCURRENT = CONFIG.CONCURRENT || 4;
}

// ===== ENTRY POINT =====
document.addEventListener('DOMContentLoaded', () => {
  App.init().catch(err => {
    console.error('App init failed:', err);
    Renderer.showStatus(`Init error: ${err.message}`, true);
  });
});

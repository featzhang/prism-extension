// GitHub API client for the PRism extension

import { CONFIG } from './config.js';
import { StorageManager } from './storage.js';
import { CIParser } from './ci-parser.js';

class GitHubAPI {
  constructor() {
    this._token = '';
    this.storage = new StorageManager();
    this.requestCount = 0; // Initialize request counter
    this.lastRequestTime = null; // Track last request time
  }

  async fetch(url, retries = 3, delay = 1000) {
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Flink-PR-Status-Extension/1.0',
    };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;

    // Increment request counter
    this.requestCount++;
    this.lastRequestTime = new Date();

    // Emit request count update to UI (include rate limit info every 10 requests)
    const includeRateLimit = this.requestCount % 10 === 0;
    this.emitRequestCountUpdate(includeRateLimit);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(url, { headers });
        
        if (resp.ok) {
          return resp.json();
        }
        
        // Handle authentication / authorization errors
        if (resp.status === 401) {
          // Clear invalid token immediately
          this._token = '';
          chrome.storage.local.remove('gh_token', () => {
            console.log('Invalid token cleared from storage');
          });
          throw new Error(
            'GitHub token is invalid or has been revoked. Please log in again to get a new token.'
          );
        }

        if (resp.status === 403) {
          // Try to read rate-limit headers for a more actionable message
          const remaining = resp.headers.get('X-RateLimit-Remaining');
          const reset = resp.headers.get('X-RateLimit-Reset');
          let resetInfo = '';
          if (reset) {
            const resetDate = new Date(parseInt(reset, 10) * 1000);
            const minutesLeft = Math.ceil((resetDate - Date.now()) / 60000);
            resetInfo = minutesLeft > 0
              ? ` Resets in ${minutesLeft} min (at ${resetDate.toLocaleTimeString()}).`
              : ' Rate limit should reset shortly.';
          }
          const quotaMsg = remaining === '0'
            ? `GitHub API rate limit exhausted.${resetInfo} Use a Personal Access Token for 5,000 req/hour.`
            : `GitHub API request forbidden (403).${resetInfo} Your token may lack required permissions (needs repo scope).`;
          throw new Error(quotaMsg);
        }
        
        // Retry on 5xx errors
        if (resp.status >= 500 && resp.status < 600 && attempt < retries) {
          console.warn(`GitHub API ${resp.status} error, retrying in ${delay}ms (attempt ${attempt}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }

        // 5xx exhausted all retries
        if (resp.status >= 500 && resp.status < 600) {
          throw new Error(
            `GitHub server error (${resp.status}). Tried ${retries} times but the server kept failing. GitHub may be having an outage — check https://githubstatus.com`
          );
        }
        
        // Handle other errors
        throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
        
      } catch (error) {
        // Retry on network errors or 5xx errors
        const isNetworkError = error.message.includes('Failed to fetch')
          || error.message.includes('NetworkError')
          || error.message.includes('503')
          || error.message.includes('500');

        if (isNetworkError && attempt < retries) {
          console.warn(`Network error, retrying in ${delay}ms (attempt ${attempt}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }

        // Enrich bare network errors with an offline hint on final attempt
        if (isNetworkError) {
          throw new Error(
            'Unable to reach GitHub API. Check your internet connection or visit https://githubstatus.com to see if GitHub is having an outage.'
          );
        }

        throw error;
      }
    }
  }

  // Emit request count update event with rate limit info
  async emitRequestCountUpdate(includeRateLimit = false) {
    try {
      let rateLimitInfo = null;
      if (includeRateLimit) {
        rateLimitInfo = await this.getRateLimitInfo();
      }
      
      const event = new CustomEvent('githubApiRequestCount', {
        detail: {
          count: this.requestCount,
          lastRequestTime: this.lastRequestTime,
          rateLimitInfo: rateLimitInfo
        }
      });
      
      window.dispatchEvent(event);
    } catch (error) {
      console.warn('Failed to emit request count update:', error.message);
      // Still emit the event without rate limit info
      const event = new CustomEvent('githubApiRequestCount', {
        detail: {
          count: this.requestCount,
          lastRequestTime: this.lastRequestTime,
          rateLimitInfo: null
        }
      });
      window.dispatchEvent(event);
    }
  }

  // Get rate limit information
  async getRateLimitInfo() {
    try {
      const rateLimitUrl = `${CONFIG.GITHUB_API}/rate_limit`;
      const rateLimitData = await this.fetch(rateLimitUrl);
      
      const core = rateLimitData.resources.core;
      const remaining = core.remaining;
      const limit = core.limit;
      const resetTime = new Date(core.reset * 1000);
      const now = new Date();
      const resetInMinutes = Math.ceil((resetTime - now) / (1000 * 60));
      
      return {
        remaining: remaining,
        limit: limit,
        resetTime: resetTime,
        resetInMinutes: resetInMinutes,
        used: limit - remaining,
        usedPercentage: Math.round(((limit - remaining) / limit) * 100)
      };
    } catch (error) {
      console.warn('Failed to get rate limit info:', error.message);
      return null;
    }
  }

  // Reset request counter
  resetRequestCount() {
    this.requestCount = 0;
    this.lastRequestTime = null;
    this.emitRequestCountUpdate(false);
  }

  // Get current request count
  getRequestCount() {
    return this.requestCount;
  }

  async getStats(repo, author = '') {
    const cacheKey = `cache_stats_${repo}_a${author}`;
    const cached = await this.storage.getCache(cacheKey);
    if (cached) return cached;

    try {
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

      await this.storage.setCache(cacheKey, stats, CONFIG.TTL_STATS);
      return stats;
    } catch (error) {
      console.warn(`Failed to get stats for ${repo}:`, error.message);
      // Return default empty stats instead of throwing error
      return {
        open: 0,
        closed: 0,
        merged: 0,
        total: 0
      };
    }
  }

  async getPRList(repo, { state = 'open', page = 1, sort = 'created', direction = 'desc', author = '', perPage = CONFIG.DEFAULT_PER_PAGE } = {}) {
    const cacheKey = `cache_prs_${repo}_${state}_${sort}_${direction}_p${page}_a${author}_pp${perPage}`;
    
    // Check cache first (if chrome.storage is available)
    try {
      const cached = await this.storage.getCache(cacheKey);
      if (cached) return cached;
    } catch (error) {
      console.warn('Cache access failed, proceeding without cache:', error.message);
    }

    try {
      let prs;
      if (author) {
        // Use Search API to filter by author
        const stateQ = state === 'merged' ? 'is:merged' : (state === 'all' ? '' : `is:${state}`);
        const q = `repo:${repo}+is:pr+author:${encodeURIComponent(author)}${stateQ ? '+' + stateQ : ''}`;
        const sortParam = sort === 'updated' ? 'updated' : 'created';
        const url = `${CONFIG.GITHUB_API}/search/issues?q=${q}&sort=${sortParam}&order=${direction}&page=${page}&per_page=${perPage}`;
        const result = await this.fetch(url);
        prs = result.items;
      } else {
        const apiState = state === 'all' ? 'all' : (state === 'merged' ? 'closed' : state);
        const url = `${CONFIG.GITHUB_API}/repos/${repo}/pulls?state=${apiState}&page=${page}&per_page=${perPage}&sort=${sort}&direction=${direction}`;
        prs = await this.fetch(url);
        
        // For 'merged' state, filter to only include merged PRs
        if (state === 'merged') {
          prs = prs.filter(pr => pr.merged_at != null);
        }
      }

      // Cache the result (if chrome.storage is available)
      try {
        await this.storage.setCache(cacheKey, prs, CONFIG.TTL_PRS);
      } catch (error) {
        console.warn('Cache set failed:', error.message);
      }
      
      return prs;
    } catch (error) {
      console.warn(`Failed to get PR list for ${repo}:`, error.message);
      // Return empty array instead of throwing error to prevent UI blocking
      return [];
    }
  }

  async getPRComments(repo, prNumber) {
    const cacheKey = `cache_comments_${repo}_${prNumber}`;
    const cached = await this.storage.getCache(cacheKey);
    if (cached) return cached;

    const url = `${CONFIG.GITHUB_API}/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
    const comments = await this.fetch(url);

    await this.storage.setCache(cacheKey, comments, CONFIG.TTL_COMMENTS);
    return comments;
  }

  async getPRDetail(repo, prNumber) {
    const cacheKey = `cache_pr_detail_${repo}_${prNumber}`;
    const cached = await this.storage.getCache(cacheKey);
    if (cached) return cached;

    const url = `${CONFIG.GITHUB_API}/repos/${repo}/pulls/${prNumber}`;
    const pr = await this.fetch(url);

    await this.storage.setCache(cacheKey, pr, CONFIG.TTL_PRS);
    return pr;
  }

  async getCheckRuns(repo, ref) {
    const cacheKey = `cache_checks_${repo}_${ref}`;
    const cached = await this.storage.getCache(cacheKey);
    if (cached) return cached;

    const url = `${CONFIG.GITHUB_API}/repos/${repo}/commits/${ref}/check-runs?per_page=100`;
    const result = await this.fetch(url);

    await this.storage.setCache(cacheKey, result.check_runs || [], CONFIG.TTL_COMMENTS);
    return result.check_runs || [];
  }

  async getCommitStatuses(repo, ref) {
    const cacheKey = `cache_statuses_${repo}_${ref}`;
    const cached = await this.storage.getCache(cacheKey);
    if (cached) return cached;

    const url = `${CONFIG.GITHUB_API}/repos/${repo}/commits/${ref}/statuses?per_page=100`;
    const statuses = await this.fetch(url);

    await this.storage.setCache(cacheKey, statuses, CONFIG.TTL_COMMENTS);
    return statuses;
  }

  // Read the cached CI provider for a repo (set by getCIStatus during waterfall detection).
  // Returns: 'github-actions' | 'github-status' | 'flinkbot' | null
  async getCachedCIProvider(repo) {
    return this.storage.getCache(`cache_ci_provider_${repo}`);
  }

  // Persist the detected CI provider for a repo so subsequent PRs skip the full waterfall.
  async setCachedCIProvider(repo, provider) {
    const TTL_4H = 4 * 60 * 60 * 1000;
    await this.storage.setCache(`cache_ci_provider_${repo}`, provider, TTL_4H);
  }

  // Resolve CI status for a single PR using a waterfall detection strategy:
  //   1. GitHub Check Runs  (GitHub Actions)
  //   2. GitHub Commit Status
  //   3. flinkbot PR comments (Azure CI)
  //
  // The first source that returns a result is cached as the CI provider for the repo
  // so future PRs skip straight to the known source instead of running all three.
  async getCIStatus(repo, pr) {
    const prNumber = pr.number;

    // Resolve head SHA — available directly on most PR list responses.
    let headSha = pr.head?.sha;
    if (!headSha) {
      const prDetail = await this.getPRDetail(repo, prNumber);
      headSha = prDetail?.head?.sha;
    }

    const knownProvider = await this.getCachedCIProvider(repo);

    // Fast path when we already know the CI provider for this repo.
    if (knownProvider === 'github-actions' || knownProvider === 'github-status') {
      return this._getCIStatusViaSHA(repo, prNumber, headSha);
    }
    if (knownProvider === 'flinkbot') {
      // Try flinkbot first; fall back to SHA-based if the PR has no flinkbot comment.
      const ciStatus = await this._getCIStatusViaFlinkbot(repo, prNumber);
      if (ciStatus) return ciStatus;
      return headSha ? this._getCIStatusViaSHA(repo, prNumber, headSha) : null;
    }

    // Full waterfall when provider is unknown.
    if (headSha) {
      // 1. Check Runs (GitHub Actions)
      const checkRuns = await this.getCheckRuns(repo, headSha);
      if (checkRuns && checkRuns.length > 0) {
        const ciStatus = CIParser.parseCheckRunsStatus(checkRuns);
        if (ciStatus) {
          await this.setCachedCIProvider(repo, 'github-actions');
          return ciStatus;
        }
      }

      // 2. Commit Status
      const statuses = await this.getCommitStatuses(repo, headSha);
      if (statuses && statuses.length > 0) {
        const ciStatus = CIParser.parseCommitStatus(statuses);
        if (ciStatus) {
          await this.setCachedCIProvider(repo, 'github-status');
          return ciStatus;
        }
      }
    }

    // 3. flinkbot comments (Azure CI) — works without a SHA
    const ciStatus = await this._getCIStatusViaFlinkbot(repo, prNumber);
    if (ciStatus) {
      await this.setCachedCIProvider(repo, 'flinkbot');
      return ciStatus;
    }

    return null;
  }

  // Internal helper: resolve CI via GitHub Actions / Commit Status using head SHA.
  async _getCIStatusViaSHA(repo, prNumber, headSha) {
    if (!headSha) return null;

    const checkRuns = await this.getCheckRuns(repo, headSha);
    if (checkRuns && checkRuns.length > 0) {
      const ciStatus = CIParser.parseCheckRunsStatus(checkRuns);
      if (ciStatus) return ciStatus;
    }

    const statuses = await this.getCommitStatuses(repo, headSha);
    if (statuses && statuses.length > 0) {
      return CIParser.parseCommitStatus(statuses);
    }

    return null;
  }

  // Internal helper: resolve CI via flinkbot PR comments.
  async _getCIStatusViaFlinkbot(repo, prNumber) {
    const comments = await this.getPRComments(repo, prNumber);
    return CIParser.extractCIStatusFromComments(comments);
  }

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
  }

  async getUnresolvedThreadCount(owner, repo, prNumber) {
    const cacheKey = `cache_cr_${owner}_${repo}_${prNumber}`;
    const cached = await this.storage.getCache(cacheKey);
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
    await this.storage.setCache(cacheKey, count, CONFIG.TTL_COMMENTS);
    return count;
  }

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
  }

  async batchGetCIStatus(repo, prs, onResult) {
    const queue = [...prs];
    const workers = Array.from({ length: CONFIG.CONCURRENT }, async () => {
      while (queue.length > 0) {
        const pr = queue.shift();
        if (pr === undefined) break;
        const prNumber = pr.number;
        
        try {
          const ciStatus = await this.getCIStatus(repo, pr);
          onResult(prNumber, ciStatus);
        } catch (err) {
          console.warn(`Failed to get CI for PR #${prNumber}:`, err.message);
          onResult(prNumber, null);
        }
      }
    });
    await Promise.all(workers);
  }

  setToken(token) {
    this._token = token;
  }
}

export { GitHubAPI };
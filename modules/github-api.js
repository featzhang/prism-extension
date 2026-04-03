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
    
    // Emit request count update event
    this.emitRequestCountUpdate();

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(url, { headers });
        
        if (resp.ok) {
          return resp.json();
        }
        
        // Handle authentication errors
        if (resp.status === 401 || resp.status === 403) {
          const errorMsg = resp.status === 401 
            ? 'Authentication failed. Please login again.'
            : 'Rate limit exceeded. Please wait before refreshing.';
          
          // Clear token if authentication failed
          if (resp.status === 401) {
            this._token = '';
            // Use callback to avoid async issues
            chrome.storage.local.remove('gh_token', () => {
              console.log('Invalid token cleared from storage');
            });
          }
          
          throw new Error(errorMsg);
        }
        
        // Retry on 5xx errors
        if (resp.status >= 500 && resp.status < 600 && attempt < retries) {
          console.warn(`GitHub API ${resp.status} error, retrying in ${delay}ms (attempt ${attempt}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
        
        // Handle other errors
        throw new Error(`GitHub API error: ${resp.status} ${resp.statusText}`);
        
      } catch (error) {
        // Retry on network errors or 5xx errors
        if ((error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || 
             error.message.includes('503') || error.message.includes('500')) && attempt < retries) {
          console.warn(`Network error, retrying in ${delay}ms (attempt ${attempt}/${retries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
        throw error;
      }
    }
  }

  // Emit request count update event
  emitRequestCountUpdate() {
    const event = new CustomEvent('githubApiRequestCount', {
      detail: {
        count: this.requestCount,
        lastRequestTime: this.lastRequestTime
      }
    });
    window.dispatchEvent(event);
  }

  // Reset request counter
  resetRequestCount() {
    this.requestCount = 0;
    this.lastRequestTime = null;
    this.emitRequestCountUpdate();
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
    const cached = await this.storage.getCache(cacheKey);
    if (cached) return cached;

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
        if (state === 'merged') {
          prs = prs.filter(pr => pr.merged_at != null);
        }
      }

      await this.storage.setCache(cacheKey, prs, CONFIG.TTL_PRS);
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
    // Determine project type: apache/flink uses Azure CI, others use GitHub Actions
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
            // Apache Flink main project: get Azure CI status from flinkbot comments
            const comments = await this.getPRComments(repo, prNumber);
            ciStatus = CIParser.extractCIStatusFromComments(comments);
          } else {
            // Connector projects: get CI status from GitHub Check Runs
            let headSha = pr.head?.sha;
            if (!headSha) {
              const prDetail = await this.getPRDetail(repo, prNumber);
              headSha = prDetail?.head?.sha;
            }
            
            if (headSha) {
              // Try Check Runs (GitHub Actions) first
              const checkRuns = await this.getCheckRuns(repo, headSha);
              if (checkRuns && checkRuns.length > 0) {
                ciStatus = CIParser.parseCheckRunsStatus(checkRuns);
              }
              
              // Fallback to Commit Status
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
  }

  setToken(token) {
    this._token = token;
  }
}

export { GitHubAPI };
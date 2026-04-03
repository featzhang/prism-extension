// Expert recommender for the PRism extension

import { CONFIG } from './config.js';
import { StorageManager } from './storage.js';
import { GitHubAPI } from './github-api.js';

class ExpertRecommender {
  constructor(githubApi) {
    this.storage = new StorageManager();
    // Use shared GitHubAPI instance if provided, otherwise create a new one
    this.github = githubApi || new GitHubAPI();
  }

  // Get file contributors
  async getFileContributors(repo, filePath, limit = 10) {
    const cacheKey = `cache_contributors_${repo}_${btoa(filePath)}`;
    const cached = await this.storage.getCache(cacheKey);
    if (cached) {
      console.log(`Using cached contributors for ${filePath}`);
      return cached;
    }

    try {
      // Use GitHub API to get file commit history
      const url = `${CONFIG.GITHUB_API}/repos/${repo}/commits?path=${encodeURIComponent(filePath)}&per_page=${limit}`;
      console.log(`Fetching file contributors: ${url}`);
      console.log(`Current GitHub Token status: ${this.github._token ? 'Set' : 'Not set'}`);
      const commits = await this.github.fetch(url);
      console.log(`File ${filePath} commit history retrieved, ${commits.length} commits`);
      
      // Count commits per author
      const contributors = {};
      commits.forEach(commit => {
        const author = commit.author?.login || commit.commit.author.name;
        if (author) {
          contributors[author] = (contributors[author] || 0) + 1;
        }
      });

      // Convert to sorted array
      const result = Object.entries(contributors)
        .map(([author, count]) => ({ author, count, lastCommit: commits[0]?.commit.author.date }))
        .sort((a, b) => b.count - a.count);

      await this.storage.setCache(cacheKey, result, CONFIG.TTL_CONTRIBUTORS);
      return result;
    } catch (error) {
      console.warn(`Failed to get contributors for ${filePath}:`, error.message);
      return [];
    }
  }

  // Analyze PR changes and recommend experts
  async suggestExpertsForPR(repo, prNumber) {
    try {
      console.log(`Starting expert recommendation analysis for PR #${prNumber}...`);
      
      // Check rate limit status with detailed information
      const rateLimitStatus = await this.getRateLimitStatus();
      console.log(`Rate limit status: ${rateLimitStatus.status}`);
      
      if (rateLimitStatus.status === 'exhausted') {
        throw new Error(rateLimitStatus.message);
      }
      
      // More intelligent rate limiting based on available quota
      if (rateLimitStatus.status === 'critical' && rateLimitStatus.maxPRsToAnalyze === 0) {
        throw new Error(`${rateLimitStatus.message} Expert recommendations require multiple API calls.`);
      }
      
      // Check if we have cached results for this PR
      const cacheKey = `cache_experts_${repo}_${prNumber}`;
      const cached = await this.storage.getCache(cacheKey);
      if (cached) {
        console.log(`Using cached expert recommendations for PR #${prNumber}`);
        // Mark results as from cache so UI can show cache indicator
        return cached.map(expert => ({ ...expert, fromCache: true }));
      }
      
      // Get PR changed files list
      const prDetail = await this.github.getPRDetail(repo, prNumber);
      console.log(`PR details retrieved:`, prDetail);
      
      // Use standard GitHub API endpoint to get PR files list (supports pagination)
      let allFiles = [];
      let page = 1;
      const perPage = 100; // GitHub API max per page
      
      while (true) {
        const filesUrl = `${CONFIG.GITHUB_API}/repos/${repo}/pulls/${prNumber}/files?page=${page}&per_page=${perPage}`;
        console.log(`Fetching file list page ${page}: ${filesUrl}`);
        const files = await this.github.fetch(filesUrl);
        
        if (files.length === 0) break;
        
        allFiles = allFiles.concat(files);
        
        // If fewer files than per page, it's the last page
        if (files.length < perPage) break;
        
        page++;
      }
      
      console.log(`File list retrieved successfully, ${allFiles.length} files`);
      if (allFiles.length === 0) {
        console.warn(`PR #${prNumber} has no changed files`);
        return [];
      }
      
      // Intelligent file analysis limits based on rate limit status and file count
      let maxFilesToAnalyze;
      if (rateLimitStatus.status === 'critical') {
        maxFilesToAnalyze = 3; // Very conservative when rate limit is critical
      } else if (rateLimitStatus.status === 'low') {
        maxFilesToAnalyze = 5; // Conservative when rate limit is low
      } else if (rateLimitStatus.remaining < 30) {
        maxFilesToAnalyze = 8; // Conservative when approaching limit
      } else {
        maxFilesToAnalyze = 15; // Normal limit
      }
      
      // Further limit based on actual file count to avoid unnecessary API calls
      maxFilesToAnalyze = Math.min(maxFilesToAnalyze, allFiles.length);
      
      const filesToAnalyze = allFiles.slice(0, maxFilesToAnalyze);
      
      if (allFiles.length > maxFilesToAnalyze) {
        console.log(`Limiting analysis to first ${maxFilesToAnalyze} files out of ${allFiles.length} due to rate limits (${rateLimitStatus.remaining}/${rateLimitStatus.limit} remaining)`);
      }
      
      // Get contributors for each file with intelligent rate limiting
      const fileExperts = [];
      for (let i = 0; i < filesToAnalyze.length; i++) {
        const file = filesToAnalyze[i];
        
        // Add intelligent delay between API calls based on rate limit status
        if (i > 0) {
          const delay = rateLimitStatus.status === 'critical' ? 2000 : 
                       rateLimitStatus.status === 'low' ? 1000 : 500;
          console.log(`Adding ${delay}ms delay between API calls (rate limit: ${rateLimitStatus.status})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        try {
          const contributors = await this.getFileContributors(repo, file.filename, 3); // Limit to top 3 contributors per file
          fileExperts.push({
            file: file.filename,
            contributors: contributors
          });
        } catch (error) {
          console.warn(`Failed to get contributors for ${file.filename}:`, error.message);
          // Continue with other files even if one fails
        }
      }

      if (fileExperts.length === 0) {
        console.warn(`No file contributors found for PR #${prNumber}`);
        return [];
      }

      // Merge all contributors and calculate comprehensive scores
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
          
          // Time decay factor: commits in last 6 months have higher weight
          if (contributor.lastCommit) {
            const monthsAgo = this.getMonthsAgo(contributor.lastCommit);
            const timeWeight = Math.max(0, 1 - monthsAgo / 6); // Linear decay over 6 months
            expert.recentActivity += contributor.count * timeWeight;
          }
        });
      });

      // Calculate comprehensive scores
      const experts = Object.values(expertScores).map(expert => {
        // Score formula: base commits + file coverage + recent activity
        const baseScore = Math.log(expert.totalCommits + 1) * 10;
        const fileCoverage = expert.fileCount / fileExperts.length * 20;
        const recentScore = expert.recentActivity * 5;
        
        expert.score = baseScore + fileCoverage + recentScore;
        return expert;
      });

      // Sort by score and return top 5 experts
      const finalExperts = experts
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(expert => ({
          author: expert.author,
          score: Math.round(expert.score),
          expertise: this.getExpertiseDescription(expert, fileExperts.length)
        }));

      // Cache the results for 24 hours since expert recommendations rarely change
      await this.storage.setCache(cacheKey, finalExperts, CONFIG.TTL_EXPERTS);
      console.log(`Cached expert recommendations for PR #${prNumber} (TTL: 24h)`);
      
      return finalExperts;

    } catch (error) {
      console.error(`Failed to suggest experts for PR #${prNumber}:`, error.message);
      
      // Enhanced error handling with detailed rate limit information
      let detailedError = error.message;
      
      if (error.message.includes('Rate limit') || error.message.includes('rate limit')) {
        const rateLimitStatus = await this.getRateLimitStatus();
        if (rateLimitStatus) {
          detailedError += `\n\nRate Limit Details:`;
          detailedError += `\n• Status: ${rateLimitStatus.status.toUpperCase()}`;
          detailedError += `\n• Remaining: ${rateLimitStatus.remaining}/${rateLimitStatus.limit}`;
          detailedError += `\n• Resets in: ${rateLimitStatus.resetInMinutes} minutes`;
          
          if (rateLimitStatus.suggestions && rateLimitStatus.suggestions.length > 0) {
            detailedError += `\n\nSuggestions:`;
            rateLimitStatus.suggestions.forEach(suggestion => {
              detailedError += `\n• ${suggestion}`;
            });
          }
          
          detailedError += `\n\nExpert Recommendations Usage:`;
          detailedError += `\n• Estimated API calls per PR: 10-20+`;
          detailedError += `\n• Current capacity: ${rateLimitStatus.maxPRsToAnalyze} PRs`;
        }
      }
      
      // Re-throw with more descriptive error for the UI
      if (error.message.includes('Rate limit') || error.message.includes('rate limit')) {
        throw new Error(detailedError);
      }
      throw new Error(`Unable to get expert recommendations: ${error.message}`);
    }
  }

  // Check GitHub API rate limit status
  async checkRateLimit() {
    try {
      const rateLimitUrl = `${CONFIG.GITHUB_API}/rate_limit`;
      const rateLimitData = await this.github.fetch(rateLimitUrl);
      
      const core = rateLimitData.resources.core;
      const remaining = core.remaining;
      const resetTime = new Date(core.reset * 1000);
      const now = new Date();
      const resetInMinutes = Math.ceil((resetTime - now) / (1000 * 60));
      
      return {
        remaining: remaining,
        limit: core.limit,
        resetTime: resetTime,
        resetInMinutes: resetInMinutes
      };
    } catch (error) {
      console.warn('Failed to check rate limit:', error.message);
      return null;
    }
  }

  // Get rate limit status with detailed information and expert-specific guidance
  async getRateLimitStatus() {
    const rateLimitInfo = await this.checkRateLimit();
    if (!rateLimitInfo) {
      return {
        status: 'unknown',
        message: 'Unable to check rate limit status',
        suggestions: [
          'Proceed with caution - rate limit status unknown',
          'Consider using a GitHub Personal Access Token'
        ]
      };
    }

    const { remaining, limit, resetInMinutes } = rateLimitInfo;
    
    // Expert recommendations require multiple API calls per PR
    const estimatedCallsPerPR = 10; // Conservative estimate
    const maxPRsToAnalyze = Math.floor(remaining / estimatedCallsPerPR);
    
    if (remaining === 0) {
      return {
        status: 'exhausted',
        message: `GitHub API rate limit exhausted (${remaining}/${limit} remaining). Please wait ${resetInMinutes} minutes before trying again.`,
        resetInMinutes: resetInMinutes,
        maxPRsToAnalyze: 0,
        suggestions: [
          'Wait for the rate limit to reset automatically (usually 1 hour)',
          'Use a GitHub Personal Access Token for higher limits (5000/hour)',
          'Try again later when the limit resets',
          'Expert recommendations require multiple API calls per PR'
        ]
      };
    } else if (remaining < 5) {
      return {
        status: 'critical',
        message: `GitHub API rate limit is critical (${remaining}/${limit} remaining). Expert recommendations may fail.`,
        remaining: remaining,
        maxPRsToAnalyze: Math.min(maxPRsToAnalyze, 1), // Only 1 PR at most
        suggestions: [
          'Proceed with extreme caution - may hit rate limit',
          'Consider using a GitHub Personal Access Token',
          'Limit analysis to 1 PR only',
          'Expert recommendations require 10+ API calls per PR'
        ]
      };
    } else if (remaining < 20) {
      return {
        status: 'low',
        message: `GitHub API rate limit is low (${remaining}/${limit} remaining). Expert recommendations will be limited.`,
        remaining: remaining,
        maxPRsToAnalyze: Math.min(maxPRsToAnalyze, 3), // Limit to 3 PRs
        suggestions: [
          'Proceed with caution - rate limit is low',
          'Consider using a GitHub Personal Access Token',
          'Expert recommendations will analyze fewer files',
          `Can analyze up to ${Math.min(maxPRsToAnalyze, 3)} PRs`
        ]
      };
    } else {
      return {
        status: 'healthy',
        message: `GitHub API rate limit is healthy (${remaining}/${limit} remaining)`,
        remaining: remaining,
        maxPRsToAnalyze: maxPRsToAnalyze,
        suggestions: [
          'Rate limit is sufficient for expert recommendations',
          `Can analyze up to ${maxPRsToAnalyze} PRs`
        ]
      };
    }
  }

  // Calculate months ago from now
  getMonthsAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    return (now.getFullYear() - date.getFullYear()) * 12 + 
           (now.getMonth() - date.getMonth());
  }

  // Generate expertise description
  getExpertiseDescription(expert, totalFiles) {
    const coverage = Math.round((expert.fileCount / totalFiles) * 100);
    if (coverage >= 80) return {short: 'PE', full: 'Primary expert'};
    if (coverage >= 50) return {short: 'KC', full: 'Key contributor'};
    if (expert.totalCommits > 10) return {short: 'EC', full: 'Experienced contributor'};
    return {short: 'OC', full: 'Occasional contributor'};
  }

  // Batch get expert recommendations for multiple PRs
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
}

export { ExpertRecommender };
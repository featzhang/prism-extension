// Expert recommender for the PRism extension

import { CONFIG } from './config.js';
import { StorageManager } from './storage.js';
import { GitHubAPI } from './github-api.js';

class ExpertRecommender {
  constructor() {
    this.storage = new StorageManager();
    this.github = new GitHubAPI();
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

      await this.storage.setCache(cacheKey, result, CONFIG.TTL_COMMENTS);
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
      
      // Check if we're likely to hit rate limits
      const rateLimitInfo = await this.checkRateLimit();
      if (rateLimitInfo && rateLimitInfo.remaining < 10) {
        throw new Error(`GitHub API rate limit is low (${rateLimitInfo.remaining} remaining). Please wait ${rateLimitInfo.resetInMinutes} minutes before trying again.`);
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
      
      // Limit the number of files to analyze to avoid rate limits
      const maxFilesToAnalyze = 20;
      const filesToAnalyze = allFiles.slice(0, maxFilesToAnalyze);
      
      if (allFiles.length > maxFilesToAnalyze) {
        console.log(`Limiting analysis to first ${maxFilesToAnalyze} files out of ${allFiles.length} to avoid rate limits`);
      }
      
      // Get contributors for each file with rate limiting
      const fileExperts = [];
      for (let i = 0; i < filesToAnalyze.length; i++) {
        const file = filesToAnalyze[i];
        
        // Add small delay between API calls to avoid hitting rate limits
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 200));
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
      return experts
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(expert => ({
          author: expert.author,
          score: Math.round(expert.score),
          expertise: this.getExpertiseDescription(expert, fileExperts.length)
        }));

    } catch (error) {
      console.error(`Failed to suggest experts for PR #${prNumber}:`, error.message);
      // Re-throw with more descriptive error for the UI
      if (error.message.includes('Rate limit')) {
        throw new Error(`GitHub API rate limit exceeded. Please wait a few minutes before trying again.`);
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
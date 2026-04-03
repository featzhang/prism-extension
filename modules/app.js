// Main application for the PRism extension

import { CONFIG } from './config.js';
import { StorageManager } from './storage.js';
import { GitHubAPI } from './github-api.js';
import { Renderer } from './renderer.js';
import { ExpertRecommender } from './expert-recommender.js';
import { escapeHtml } from './utils.js';

class PRismApp {
  constructor() {
    this.repo = CONFIG.DEFAULT_REPO;
    this.customRepos = [];
    this.currentState = 'open';
    this.currentPage = 1;
    this.currentSort = 'created';
    this.currentDirection = 'desc';
    this.currentAuthor = '';
    this.currentCIFilter = 'all';
    this.currentPRs = [];
    this.currentTotalCount = 0;
    this.isLoading = false;
    this.isLoadingAllStats = false;
    
    this.storage = new StorageManager();
    this.github = new GitHubAPI();
    this.renderer = new Renderer();
    this.expertRecommender = new ExpertRecommender();
  }

  async init() {
    this.repo = await this.storage.getRepo();
    this.github.setToken(await this.storage.getToken());
    this.currentAuthor = await this.storage.getUsername();
    this.customRepos = await this.storage.getCustomRepos();
    
    // Initialize repository selector
    this.initRepoSelect();
    
    // Initialize page size selector
    const userPerPage = await this.storage.getUserConfig('perPage', CONFIG.DEFAULT_PER_PAGE);
    const pageSizeSelect = document.getElementById('page-size-select');
    if (pageSizeSelect) {
      pageSizeSelect.value = userPerPage;
    }
    
    this.renderAuthState();
    this.bindEvents();
    this.watchAuthStorage();
    await this.loadAll();
  }

  initRepoSelect() {
    const repoSelect = document.getElementById('repo-select');
    if (!repoSelect) return;
    
    // Clear and populate dropdown
    repoSelect.innerHTML = '';
    
    // Combine preset and custom repositories
    const allRepos = this.getAllRepos();
    
    allRepos.forEach(repo => {
      const option = document.createElement('option');
      option.value = repo.value;
      option.textContent = repo.label;
      repoSelect.appendChild(option);
    });
    
    // Check if current repo is in list
    const isInList = allRepos.some(r => r.value === this.repo);
    if (!isInList && this.repo) {
      // Add temporary option if not in list
      const customOption = document.createElement('option');
      customOption.value = this.repo;
      customOption.textContent = this.repo + ' (Unlisted)';
      repoSelect.appendChild(customOption);
    }
    
    // Set current selected value
    repoSelect.value = this.repo;
  }

  getAllRepos() {
    // Combine preset and custom repositories, avoid duplicates
    const presetValues = new Set(CONFIG.PRESET_REPOS.map(r => r.value));
    const filteredCustom = (this.customRepos || []).filter(r => !presetValues.has(r.value));
    return [...CONFIG.PRESET_REPOS, ...filteredCustom];
  }

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
        // Save to storage
        await new Promise(resolve => {
          chrome.storage.local.set({ repo: newRepo }, resolve);
        });
        // Clear cache and reload
        await this.storage.clearCacheByPrefix('cache_');
        this.currentPage = 1;
        this.renderer.renderStatsLoading();
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

    // Page size control
    document.getElementById('page-size-select').addEventListener('change', async e => {
      if (this.isLoading) return;
      const perPage = parseInt(e.target.value);
      await this.storage.setUserConfig('perPage', perPage);
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
    
    // Expert panel copy reviewers button
    document.getElementById('btn-copy-reviewers').addEventListener('click', () => this.copyExpertPanelReviewers());

    // Expert suggestion buttons (event delegation)
    document.addEventListener('click', (e) => {
      if (e.target.closest('.expert-suggestion-btn')) {
        console.log('Expert suggestion button clicked');
        const button = e.target.closest('.expert-suggestion-btn');
        const prNumber = button.getAttribute('data-pr-number');
        console.log(`PR number: ${prNumber}`);
        if (prNumber) {
          this.suggestExpertsForSinglePR(parseInt(prNumber));
        }
      }
    });
  }

  // Show expert panel
  showExpertPanel() {
    const panel = document.getElementById('expert-panel');
    panel.classList.remove('hidden');
  }

  // Hide expert panel
  hideExpertPanel() {
    const panel = document.getElementById('expert-panel');
    panel.classList.add('hidden');
  }

  // Show expert loading state below PR item
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
      // Create new expert results row
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
  }

  // Show expert results below PR item
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

    // Generate reviewer list for copying, format: "@user1 @user2 @user3"
    const reviewerList = experts.map(expert => `@${expert.author}`).join(' ');

    let html = `
      <div class="expert-results-header">
        <span>Recommended Reviewers:</span>
        <button class="copy-reviewers-btn" title="Copy reviewers for comment" data-reviewers="${reviewerList}">
          <svg viewBox="0 0 16 16" fill="currentColor">
            <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
            <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
          </svg>
        </button>
      </div>
      <div class="expert-suggestions">
    `;

    experts.forEach(expert => {
      const scoreClass = this.getExpertScoreClass(expert.score);
      const expertiseInfo = typeof expert.expertise === 'object' ? expert.expertise : {short: expert.expertise, full: expert.expertise};
      html += `
        <div class="expert-suggestion">
          <a href="https://github.com/${expert.author}" target="_blank" class="expert-github-link" title="View GitHub profile">
            <span class="expert-avatar">${expert.author.charAt(0).toUpperCase()}</span>
          </a>
          <span class="expert-name">${expert.author}</span>
          <span class="expert-score-badge ${scoreClass}">${expert.score}</span>
          <span class="expert-description" title="${expertiseInfo.full}">${expertiseInfo.short}</span>
        </div>
      `;
    });

    html += '</div>';
    expertRow.innerHTML = html;
    expertRow.classList.remove('hidden');

    // Bind copy button events
    this.bindCopyReviewersEvents();
  }

  // Bind copy reviewer button events
  bindCopyReviewersEvents() {
    const copyButtons = document.querySelectorAll('.copy-reviewers-btn');
    copyButtons.forEach(button => {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const reviewers = button.getAttribute('data-reviewers');
        this.copyReviewers(reviewers, button);
      });
    });
  }

  // Copy reviewers to clipboard
  copyReviewers(reviewers, button) {
    if (!reviewers) return;

    // Copy to clipboard
    navigator.clipboard.writeText(reviewers).then(() => {
      // Show copy success feedback
      const originalHTML = button.innerHTML;
      button.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';
      button.title = 'Copied!';
      
      // Restore original state after 2 seconds
      setTimeout(() => {
        button.innerHTML = originalHTML;
        button.title = 'Copy reviewers for comment';
      }, 2000);
    }).catch(err => {
      console.error('Failed to copy reviewers:', err);
      // Fallback method: use document.execCommand
      const textArea = document.createElement('textarea');
      textArea.value = reviewers;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        
        // Show copy success feedback
        const originalHTML = button.innerHTML;
        button.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';
        button.title = 'Copied!';
        
        // Restore original state after 2 seconds
        setTimeout(() => {
          button.innerHTML = originalHTML;
          button.title = 'Copy reviewers for comment';
        }, 2000);
      } catch (err) {
        console.error('Fallback copy failed:', err);
        alert('Failed to copy reviewers to clipboard');
      }
      document.body.removeChild(textArea);
    });
  }

  // Copy all reviewers from expert panel
  copyExpertPanelReviewers() {
    const expertList = document.getElementById('expert-list');
    if (!expertList) return;
    
    // Get all reviewer names
    const reviewerNames = [];
    const expertSuggestions = expertList.querySelectorAll('.expert-suggestion');
    
    expertSuggestions.forEach(suggestion => {
      const nameElement = suggestion.querySelector('.expert-name');
      if (nameElement) {
        const name = nameElement.textContent.trim();
        if (name) {
          reviewerNames.push(`@${name}`);
        }
      }
    });
    
    if (reviewerNames.length === 0) {
      alert('No reviewers found to copy');
      return;
    }
    
    // Format as "@user1 @user2 @user3"
    const reviewerList = reviewerNames.join(' ');
    
    // Copy to clipboard
    navigator.clipboard.writeText(reviewerList).then(() => {
      // Show copy success feedback
      const copyBtn = document.getElementById('btn-copy-reviewers');
      if (copyBtn) {
        const originalHTML = copyBtn.innerHTML;
        copyBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';
        copyBtn.title = 'Copied!';
        
        // Restore original state after 2 seconds
        setTimeout(() => {
          copyBtn.innerHTML = originalHTML;
          copyBtn.title = 'Copy reviewers for comment';
        }, 2000);
      }
    }).catch(err => {
      console.error('Failed to copy reviewers:', err);
      // Fallback method: use document.execCommand
      const textArea = document.createElement('textarea');
      textArea.value = reviewerList;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand('copy');
        
        // Show copy success feedback
        const copyBtn = document.getElementById('btn-copy-reviewers');
        if (copyBtn) {
          const originalHTML = copyBtn.innerHTML;
          copyBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>';
          copyBtn.title = 'Copied!';
          
          // Restore original state after 2 seconds
          setTimeout(() => {
            copyBtn.innerHTML = originalHTML;
            copyBtn.title = 'Copy reviewers for comment';
          }, 2000);
        }
      } catch (err) {
        console.error('Fallback copy failed:', err);
        alert('Failed to copy reviewers to clipboard');
      }
      document.body.removeChild(textArea);
    });
  }

  // Toggle expert results visibility
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
  }

  // Suggest experts for current PR list
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

      await this.expertRecommender.batchSuggestExperts(this.repo, prNumbers, (prNumber, experts) => {
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
  }

  // Suggest experts for single PR
  async suggestExpertsForSinglePR(prNumber) {
    console.log(`Expert suggestion button clicked, PR #${prNumber}`);
    
    // Check if recommendations are already shown
    const expertRow = document.getElementById(`expert-results-${prNumber}`);
    if (expertRow && !expertRow.classList.contains('hidden')) {
      // If already shown, hide
      this.toggleExpertResults(prNumber);
      return;
    }

    if (this.isLoading) return;

    this.isLoading = true;
    const btn = document.querySelector(`.expert-btn[data-pr="${prNumber}"]`);
    let originalHTML = '';
    if (btn) {
      originalHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.5 5.5A.5.5 0 0 1 8 5h1.5a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H8a.5.5 0 0 1-.5-.5v-3zm2 0a.5.5 0 0 1 1 0v3a.5.5 0 0 1-1 0v-3z"/><path d="M8 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/></svg>';
    }

    try {
      console.log(`Starting expert recommendation for PR #${prNumber}, repo: ${this.repo}`);
      // Show loading state below PR item
      this.showExpertLoading(prNumber);

      // Get expert recommendations for single PR
      const experts = await this.expertRecommender.suggestExpertsForPR(this.repo, prNumber);
      console.log(`PR #${prNumber} expert recommendations:`, experts);
      
      // Show expert results below PR item
      this.showExpertResults(prNumber, experts);
    } catch (error) {
      console.error(`Failed to suggest experts for PR #${prNumber}:`, error);
      const expertList = document.getElementById('expert-list');
      expertList.innerHTML = `<div class="empty-state">Failed to get expert recommendations for PR #${prNumber}: ${error.message}</div>`;
    } finally {
      this.isLoading = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
      }
    }
  }

  // Update expert panel for single PR
  updateExpertPanelForSinglePR(prNumber, experts) {
    const expertList = document.getElementById('expert-list');
    
    if (!experts || experts.length === 0) {
      expertList.innerHTML = `<div class="empty-state">No expert recommendations found for PR #${prNumber}</div>`;
      return;
    }

    // Find corresponding PR info
    const pr = this.currentPRs.find(p => p.number === prNumber);
    if (!pr) return;

    // Generate reviewer list for copying, format: "@user1 @user2 @user3"
    const reviewerList = experts.map(expert => `@${expert.author}`).join(' ');

    let html = `
      <div class="expert-pr-item">
        <div class="expert-pr-header">
          <span class="expert-pr-title">PR #${prNumber}</span>
          <span class="expert-pr-number">${escapeHtml(pr.title)}</span>
          <button class="copy-reviewers-btn" title="Copy reviewers for comment" data-reviewers="${reviewerList}">
            <svg viewBox="0 0 16 16" fill="currentColor">
              <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
              <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
            </svg>
          </button>
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
    
    // Bind copy button events
    this.bindCopyReviewersEvents();
  }

  // Update expert panel
  updateExpertPanel(expertResults) {
    const expertList = document.getElementById('expert-list');
    
    if (Object.keys(expertResults).length === 0) {
      expertList.innerHTML = '<div class="empty-state">No expert recommendations available</div>';
      return;
    }

    let html = '';
    
    // Show expert recommendations for each PR
    this.currentPRs.forEach(pr => {
      const experts = expertResults[pr.number] || [];
      if (experts.length === 0) return;

      // Generate reviewer list for copying, format: "@user1 @user2 @user3"
      const reviewerList = experts.map(expert => `@${expert.author}`).join(' ');

      html += `
        <div class="expert-pr-item">
          <div class="expert-pr-header">
            <span class="expert-pr-title">PR #${pr.number}</span>
            <span class="expert-pr-number">${pr.title}</span>
            <button class="copy-reviewers-btn" title="Copy reviewers for comment" data-reviewers="${reviewerList}">
              <svg viewBox="0 0 16 16" fill="currentColor">
                <path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
                <path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
              </svg>
            </button>
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
  }

  // Get CSS class based on expert score
  getExpertScoreClass(score) {
    if (score >= 80) return 'expert-score-high';
    if (score >= 60) return 'expert-score-medium';
    if (score >= 40) return 'expert-score-low';
    return 'expert-score-low';
  }

  renderAuthState() {
    const username = this.currentAuthor || '';
    const token = this.github._token;
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
  }

  startLogin() {
    const loginBtn = document.getElementById('btn-login');
    loginBtn.disabled = true;
    loginBtn.textContent = 'Connecting…';

    chrome.runtime.sendMessage({ type: 'START_LOGIN' }, resp => {
      if (!resp || !resp.ok) {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        this.renderer.showStatus(`Login failed: ${resp?.error || 'Unknown error'}`, true);
        return;
      }
      // Show user_code; token arrival is handled by watchAuthStorage
      loginBtn.textContent = 'Authorizing…';
      this.renderer.showStatus(`Enter code  ${resp.user_code}  at ${resp.verification_uri}`);
    });
  }

  async logout() {
    await this.storage.clearAuth();
    this.github.setToken('');
    this.currentAuthor = '';
    this.renderAuthState();
    await this.storage.clearCacheByPrefix('cache_');
    await this.loadAll();
  }

  // Watch storage for token written by background after polling completes
  watchAuthStorage() {
    // Listen for direct message from background (primary, more reliable)
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'LOGIN_SUCCESS') {
        this.storage.getToken().then(token => {
          this.github.setToken(token);
          this.currentAuthor = msg.username;
          this.renderAuthState();
          this.renderer.hideStatus();
          const loginBtn = document.getElementById('btn-login');
          loginBtn.disabled = false;
          loginBtn.textContent = 'Login';
          this.storage.clearCacheByPrefix('cache_').then(() => this.loadAll());
        });
      }
      if (msg.type === 'LOGIN_ERROR') {
        this.renderer.showStatus(`Login error: ${msg.error}`, true);
        const loginBtn = document.getElementById('btn-login');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
      }
    });

    // Fallback: storage.onChanged in case message is missed
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;

      if (changes.gh_token || changes.username) {
        this.github.setToken(await this.storage.getToken());
        this.currentAuthor = await this.storage.getUsername();
        this.renderAuthState();
        this.renderer.hideStatus();
        const loginBtn = document.getElementById('btn-login');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        await this.storage.clearCacheByPrefix('cache_');
        await this.loadAll();
      }

      if (changes.gh_login_error) {
        const err = changes.gh_login_error.newValue;
        this.renderer.showStatus(`Login error: ${err}`, true);
        const loginBtn = document.getElementById('btn-login');
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
        chrome.storage.local.remove('gh_login_error');
      }
    });
  }

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
  }

  switchTab(state) {
    document.getElementById('state-select').value = state;
    this.currentState = state;
    this.currentPage = 1;
    this.loadPRs();
  }

  async refresh() {
    await this.storage.clearCacheByPrefix('cache_');
    this.currentPage = 1;
    this.renderer.renderStatsLoading();
    await this.loadAll();
  }

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
  }

  async loadStats() {
    try {
      const stats = await this.github.getStats(this.repo, this.currentAuthor);
      this.renderer.renderStats(stats);
      // Update total count for current state to compute total pages
      const stateCount = this.currentState === 'all' ? (stats.open + stats.closed + stats.merged)
        : this.currentState === 'merged' ? stats.merged
        : this.currentState === 'closed' ? stats.closed
        : stats.open;
      this.currentTotalCount = stateCount || 0;
      const userPerPage = await this.storage.getUserConfig('perPage', CONFIG.DEFAULT_PER_PAGE);
      await this.renderer.renderPagination(this.currentPage, this.currentPage * userPerPage < this.currentTotalCount, this.currentTotalCount);
    } catch (err) {
      console.error('Failed to load stats:', err);
      this.renderer.showStatus(`Stats error: ${err.message}`, true);
    }
  }

  async loadPRs() {
    if (this.isLoading && this._prLoadInProgress) return;
    this._prLoadInProgress = true;
    this.setLoading(true);
    this.renderer.renderLoading();
    this.renderer.hideStatus();
    // Reset CI filter on new load
    this.currentCIFilter = 'all';
    document.getElementById('ci-filter-select').value = 'all';

    try {
      const userPerPage = await this.storage.getUserConfig('perPage', CONFIG.DEFAULT_PER_PAGE);
      const prs = await this.github.getPRList(this.repo, {
        state: this.currentState,
        page: this.currentPage,
        sort: this.currentSort,
        direction: this.currentDirection,
        author: this.currentAuthor,
        perPage: userPerPage,
      });

      this.currentPRs = prs;
      this.renderer.renderPRList(prs);
      await this.renderer.renderPagination(this.currentPage, prs.length >= userPerPage, this.currentTotalCount);

      // Async load CI statuses and unresolved CR counts
      if (prs.length > 0) {
        const prNumbers = prs.map(pr => pr.number);
        const [ownerName, repoName] = this.repo.split('/');

        // Use generic CI status fetching (auto-detect Azure CI or GitHub Actions)
        this.github.batchGetCIStatus(this.repo, prs, (prNumber, ciStatus) => {
          this.renderer.updateCIStatus(prNumber, ciStatus);
          this.applyCIFilter();
        });

        if (this.github._token) {
          let totalCR = 0;
          this.github.batchGetUnresolvedCR(ownerName, repoName, prNumbers, (prNumber, count) => {
            this.renderer.updateCRCount(prNumber, count);
            if (count) totalCR += count;
            this.renderer.renderCRStat(totalCR);
          });
        }
      }
    } catch (err) {
      console.error('Failed to load PRs:', err);
      this.renderer.showStatus(err.message, true);
      document.getElementById('pr-list').innerHTML =
        `<div class="empty-state">Failed to load PRs: ${escapeHtml(err.message)}</div>`;
    } finally {
      this._prLoadInProgress = false;
      this.setLoading(false);
    }
  }

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
  }

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
            const stats = await this.github.getStats(repo.value, author);
            totalOpen += stats.open;
            totalDone += stats.closed + stats.merged;

            // Update UI progressively
            totalOpenEl.textContent = totalOpen.toLocaleString();
            totalDoneEl.textContent = totalDone.toLocaleString();

            // Get CR counts for open PRs (only if logged in)
            if (this.github._token && stats.open > 0) {
              const [ownerName, repoName] = repo.value.split('/');
              // Get open PR numbers for this repo
              const prs = await this.github.getPRList(repo.value, { state: 'open', page: 1, author });
              const prNumbers = prs.slice(0, 20).map(pr => pr.number); // Limit to first 20 PRs

              for (const prNumber of prNumbers) {
                try {
                  const crCount = await this.github.getUnresolvedThreadCount(ownerName, repoName, prNumber);
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

      if (!this.github._token) {
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
  }
}

export { PRismApp };
'use strict';

const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const DEFAULT_REPO = 'apache/flink';

// 预设项目列表（不可删除）
const PRESET_REPOS = [
  { value: 'apache/flink', label: 'Apache Flink' },
  { value: 'apache/flink-connector-http', label: 'Flink Connector HTTP' },
  { value: 'apache/flink-connector-kafka', label: 'Flink Connector Kafka' },
  { value: 'apache/flink-connector-jdbc', label: 'Flink Connector JDBC' },
  { value: 'apache/flink-connector-elasticsearch', label: 'Flink Connector ES' },
  { value: 'apache/flink-cdc', label: 'Flink CDC' },
  { value: 'apache/flink-ml', label: 'Flink ML' },
  { value: 'apache/flink-kubernetes-operator', label: 'Flink K8s Operator' },
];

// DOM elements
const repoListEl = document.getElementById('repo-list-items');
const repoCountEl = document.getElementById('repo-count');
const newRepoInput = document.getElementById('new-repo-input');
const newRepoLabel = document.getElementById('new-repo-label');
const newRepoError = document.getElementById('new-repo-error');
const addRepoBtn = document.getElementById('btn-add-repo');
const usernameInput = document.getElementById('username-input');
const saveBtn = document.getElementById('btn-save');
const resetBtn = document.getElementById('btn-reset');
const statusEl = document.getElementById('save-status');

// Current state
let customRepos = [];

// ===== INIT =====
async function init() {
  await loadSettings();
  renderRepoList();
  bindEvents();
}

async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['customRepos', 'username'], result => {
      customRepos = result.customRepos || [];
      usernameInput.value = result.username || '';
      resolve();
    });
  });
}

// ===== RENDER =====
function renderRepoList() {
  const allRepos = getAllRepos();
  repoCountEl.textContent = `${allRepos.length} repos`;

  if (allRepos.length === 0) {
    repoListEl.innerHTML = '<div class="repo-empty">No repositories configured.</div>';
    return;
  }

  const html = allRepos.map(repo => {
    const isPreset = PRESET_REPOS.some(p => p.value === repo.value);
    const badgeClass = isPreset ? 'preset' : 'custom';
    const badgeText = isPreset ? 'Preset' : 'Custom';
    
    return `
      <div class="repo-item" data-repo="${escapeHtml(repo.value)}">
        <div class="repo-item-info">
          <span class="repo-item-name">
            ${escapeHtml(repo.value)}
            <span class="repo-item-badge ${badgeClass}">${badgeText}</span>
          </span>
          ${repo.label && repo.label !== repo.value ? `<span class="repo-item-label">${escapeHtml(repo.label)}</span>` : ''}
        </div>
        <div class="repo-item-actions">
          ${!isPreset ? `<button class="btn-danger" data-action="delete" data-repo="${escapeHtml(repo.value)}">Delete</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  repoListEl.innerHTML = html;
}

function getAllRepos() {
  // Merge preset repos with custom repos, avoiding duplicates
  const presetValues = new Set(PRESET_REPOS.map(r => r.value));
  const filteredCustom = customRepos.filter(r => !presetValues.has(r.value));
  return [...PRESET_REPOS, ...filteredCustom];
}

// ===== EVENTS =====
function bindEvents() {
  // Add repo button
  addRepoBtn.addEventListener('click', () => addRepo());

  // Enter key in input
  newRepoInput.addEventListener('keypress', e => {
    if (e.key === 'Enter') addRepo();
  });
  newRepoLabel.addEventListener('keypress', e => {
    if (e.key === 'Enter') addRepo();
  });

  // Validate on input
  newRepoInput.addEventListener('input', () => {
    clearRepoError();
  });

  // Delete repo buttons (event delegation)
  repoListEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-action="delete"]');
    if (btn) {
      const repoValue = btn.dataset.repo;
      deleteRepo(repoValue);
    }
  });

  // Save button
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      await saveSettings();
      showStatus('Settings saved! Reload the popup to apply changes.', 'success');
    } catch (err) {
      showStatus('Failed to save: ' + err.message, 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Reset button
  resetBtn.addEventListener('click', async () => {
    if (!confirm('This will remove all custom repositories and reset settings. Continue?')) {
      return;
    }
    resetBtn.disabled = true;
    try {
      customRepos = [];
      usernameInput.value = '';
      renderRepoList();
      await saveSettings();
      showStatus('Reset to default.', 'success');
    } catch (err) {
      showStatus('Failed to reset: ' + err.message, 'error');
    } finally {
      resetBtn.disabled = false;
    }
  });
}

// ===== REPO MANAGEMENT =====
function addRepo() {
  const repoValue = newRepoInput.value.trim();
  const repoLabel = newRepoLabel.value.trim();

  // Validate
  if (!repoValue) {
    setRepoError('Repository is required.');
    return;
  }

  if (!REPO_PATTERN.test(repoValue)) {
    setRepoError('Invalid format. Use owner/repo.');
    return;
  }

  // Check if already exists
  const allRepos = getAllRepos();
  if (allRepos.some(r => r.value.toLowerCase() === repoValue.toLowerCase())) {
    setRepoError('This repository already exists.');
    return;
  }

  // Add to custom repos
  customRepos.push({
    value: repoValue,
    label: repoLabel || repoValue.split('/').pop()
  });

  // Clear inputs and re-render
  newRepoInput.value = '';
  newRepoLabel.value = '';
  clearRepoError();
  renderRepoList();

  showStatus('Repository added. Click Save to persist changes.', 'success');
}

function deleteRepo(repoValue) {
  // Check if it's a preset repo
  if (PRESET_REPOS.some(p => p.value === repoValue)) {
    showStatus('Cannot delete preset repositories.', 'error');
    return;
  }

  // Remove from custom repos
  customRepos = customRepos.filter(r => r.value !== repoValue);
  renderRepoList();

  showStatus('Repository removed. Click Save to persist changes.', 'success');
}

// ===== SAVE =====
async function saveSettings() {
  await new Promise((resolve, reject) => {
    chrome.storage.local.set({
      customRepos: customRepos,
      username: usernameInput.value.trim()
    }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });

  // Clear all PR/stats caches so popup reloads fresh data
  await new Promise((resolve, reject) => {
    chrome.storage.local.get(null, items => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      const cacheKeys = Object.keys(items).filter(k => k.startsWith('cache_'));
      if (cacheKeys.length === 0) return resolve();
      chrome.storage.local.remove(cacheKeys, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    });
  });
}

// ===== UI HELPERS =====
function setRepoError(msg) {
  newRepoInput.classList.add('error');
  newRepoError.textContent = msg;
  newRepoError.classList.add('visible');
}

function clearRepoError() {
  newRepoInput.classList.remove('error');
  newRepoError.classList.remove('visible');
}

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `save-status visible ${type}`;
  setTimeout(() => {
    statusEl.classList.remove('visible');
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== ENTRY POINT =====
document.addEventListener('DOMContentLoaded', init);

'use strict';

const REPO_PATTERN = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
const DEFAULT_REPO = 'apache/flink';

const input = document.getElementById('repo-input');
const errorEl = document.getElementById('repo-error');
const saveBtn = document.getElementById('btn-save');
const resetBtn = document.getElementById('btn-reset');
const statusEl = document.getElementById('save-status');
const usernameInput = document.getElementById('username-input');

// Load current settings
chrome.storage.local.get(['repo', 'username'], result => {
  input.value = result.repo || DEFAULT_REPO;
  usernameInput.value = result.username || '';
});

// Validate on input
input.addEventListener('input', () => {
  validateInput(input.value.trim());
});

// Example repo buttons
document.querySelectorAll('.example-repos button').forEach(btn => {
  btn.addEventListener('click', () => {
    input.value = btn.dataset.repo;
    validateInput(input.value);
  });
});

// Save button
saveBtn.addEventListener('click', async () => {
  const repo = input.value.trim();
  if (!validateInput(repo)) return;

  saveBtn.disabled = true;
  try {
    await saveSettings(repo, usernameInput.value.trim());
    showStatus('Saved! Reload the popup to apply changes.', 'success');
  } catch (err) {
    showStatus('Failed to save: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
});

// Reset button
resetBtn.addEventListener('click', async () => {
  input.value = DEFAULT_REPO;
  validateInput(DEFAULT_REPO);
  resetBtn.disabled = true;
  try {
    await saveSettings(DEFAULT_REPO, usernameInput.value.trim());
    showStatus('Reset to default.', 'success');
  } catch (err) {
    showStatus('Failed to reset: ' + err.message, 'error');
  } finally {
    resetBtn.disabled = false;
  }
});

function validateInput(value) {
  if (!value) {
    setError('Repository is required.');
    return false;
  }
  if (!REPO_PATTERN.test(value)) {
    setError('Invalid format. Use owner/repo.');
    return false;
  }
  clearError();
  return true;
}

function setError(msg) {
  input.classList.add('error');
  errorEl.textContent = msg;
  errorEl.classList.add('visible');
}

function clearError() {
  input.classList.remove('error');
  errorEl.classList.remove('visible');
}

function showStatus(msg, type) {
  statusEl.textContent = msg;
  statusEl.className = `save-status visible ${type}`;
  setTimeout(() => {
    statusEl.classList.remove('visible');
  }, 3000);
}

async function saveSettings(repo, username) {
  await new Promise((resolve, reject) => {
    chrome.storage.local.set({ repo, username }, () => {
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

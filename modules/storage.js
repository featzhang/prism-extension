// Storage management for the PRism extension

import { CONFIG } from './config.js';

class StorageManager {
  async getCache(key) {
    return new Promise(resolve => {
      chrome.storage.local.get(key, result => {
        const entry = result[key];
        if (!entry) return resolve(null);
        if (Date.now() - entry.timestamp > entry.ttl) return resolve(null);
        resolve(entry.data);
      });
    });
  }

  async setCache(key, data, ttl) {
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: { data, timestamp: Date.now(), ttl } }, resolve);
    });
  }

  async clearCacheByPrefix(prefix) {
    return new Promise(resolve => {
      chrome.storage.local.get(null, items => {
        const keysToRemove = Object.keys(items).filter(k => k.startsWith(prefix));
        if (keysToRemove.length === 0) return resolve();
        chrome.storage.local.remove(keysToRemove, resolve);
      });
    });
  }

  async getRepo() {
    return new Promise(resolve => {
      chrome.storage.local.get('repo', result => {
        resolve(result.repo || CONFIG.DEFAULT_REPO);
      });
    });
  }

  async getUsername() {
    return new Promise(resolve => {
      chrome.storage.local.get('username', result => {
        resolve(result.username || '');
      });
    });
  }

  async getToken() {
    return new Promise(resolve => {
      chrome.storage.local.get('gh_token', result => {
        resolve(result.gh_token || '');
      });
    });
  }

  async getCustomRepos() {
    return new Promise(resolve => {
      chrome.storage.local.get('customRepos', result => {
        resolve(result.customRepos || []);
      });
    });
  }

  async clearAuth() {
    return new Promise(resolve => {
      chrome.storage.local.remove(['gh_token', 'username', 'gh_login_error'], resolve);
    });
  }

  async getUserConfig(key, defaultValue) {
    return new Promise(resolve => {
      chrome.storage.local.get('userConfig', result => {
        const config = result.userConfig || {};
        resolve(config[key] !== undefined ? config[key] : defaultValue);
      });
    });
  }

  async setUserConfig(key, value) {
    return new Promise(resolve => {
      chrome.storage.local.get('userConfig', result => {
        const config = result.userConfig || {};
        config[key] = value;
        chrome.storage.local.set({ userConfig: config }, resolve);
      });
    });
  }
}

export { StorageManager };
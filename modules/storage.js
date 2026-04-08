// Storage management for the PRism extension

import { CONFIG } from './config.js';

// Keys with these prefixes are stored in IndexedDB instead of chrome.storage.local.
// These tend to be large and long-lived (experts: 24h, contributors: 12h), and
// IndexedDB has no meaningful size limit vs the ~5 MB cap of chrome.storage.local.
const IDB_PREFIXES = ['cache_experts_', 'cache_contributors_'];

function usesIDB(key) {
  return IDB_PREFIXES.some(p => key.startsWith(p));
}

// ---------------------------------------------------------------------------
// Lightweight IndexedDB wrapper (single object store "cache")
// ---------------------------------------------------------------------------
class IDBCache {
  constructor() {
    this._db = null;
    this._ready = this._open();
  }

  _open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('prism_cache', 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' });
        }
      };
      req.onsuccess = e => {
        this._db = e.target.result;
        resolve(this._db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async _getDB() {
    if (this._db) return this._db;
    return this._ready;
  }

  async get(key) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', 'readonly');
      const req = tx.objectStore('cache').get(key);
      req.onsuccess = () => {
        const entry = req.result;
        if (!entry) return resolve(null);
        if (Date.now() - entry.timestamp > entry.ttl) return resolve(null);
        resolve(entry.data);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async set(key, data, ttl) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', 'readwrite');
      const req = tx.objectStore('cache').put({ key, data, timestamp: Date.now(), ttl });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async delete(key) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', 'readwrite');
      const req = tx.objectStore('cache').delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // Delete all entries whose key starts with prefix
  async clearByPrefix(prefix) {
    const db = await this._getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('cache', 'readwrite');
      const store = tx.objectStore('cache');
      const req = store.openCursor();
      const toDelete = [];
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (cursor) {
          if (cursor.key.startsWith(prefix)) toDelete.push(cursor.key);
          cursor.continue();
        } else {
          // All keys enumerated — now delete
          let pending = toDelete.length;
          if (pending === 0) return resolve();
          toDelete.forEach(k => {
            const delReq = store.delete(k);
            delReq.onsuccess = () => { if (--pending === 0) resolve(); };
            delReq.onerror = () => reject(delReq.error);
          });
        }
      };
      req.onerror = () => reject(req.error);
    });
  }
}

// ---------------------------------------------------------------------------
// StorageManager — public API used by the rest of the extension
// ---------------------------------------------------------------------------
class StorageManager {
  constructor() {
    this._idb = new IDBCache();
  }

  async getCache(key) {
    if (usesIDB(key)) {
      try {
        return await this._idb.get(key);
      } catch (err) {
        console.warn('[IDBCache] get failed, falling back to chrome.storage:', err);
        // Fall through to chrome.storage on IDB error
      }
    }
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
    if (usesIDB(key)) {
      try {
        return await this._idb.set(key, data, ttl);
      } catch (err) {
        console.warn('[IDBCache] set failed, falling back to chrome.storage:', err);
        // Fall through to chrome.storage on IDB error
      }
    }
    return new Promise(resolve => {
      chrome.storage.local.set({ [key]: { data, timestamp: Date.now(), ttl } }, resolve);
    });
  }

  async clearCacheByPrefix(prefix) {
    // Clear from both stores — a key may have been written to either during migration
    const idbClear = IDB_PREFIXES.some(p => prefix.startsWith(p) || p.startsWith(prefix))
      ? this._idb.clearByPrefix(prefix).catch(err =>
          console.warn('[IDBCache] clearByPrefix failed:', err))
      : Promise.resolve();

    const chromeClear = new Promise(resolve => {
      chrome.storage.local.get(null, items => {
        const keysToRemove = Object.keys(items).filter(k => k.startsWith(prefix));
        if (keysToRemove.length === 0) return resolve();
        chrome.storage.local.remove(keysToRemove, resolve);
      });
    });

    await Promise.all([idbClear, chromeClear]);
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal chrome.storage.local mock
// ---------------------------------------------------------------------------
function makeChromeMock() {
  let store = {};
  return {
    _store: store,
    _reset() { store = {}; this._store = store; },
    get(keys, cb) {
      if (keys === null) return cb({ ...store });
      if (typeof keys === 'string') return cb(store[keys] !== undefined ? { [keys]: store[keys] } : {});
      const result = {};
      for (const k of keys) if (store[k] !== undefined) result[k] = store[k];
      cb(result);
    },
    set(obj, cb) { Object.assign(store, obj); cb && cb(); },
    remove(keys, cb) {
      const ks = Array.isArray(keys) ? keys : [keys];
      for (const k of ks) delete store[k];
      cb && cb();
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal IndexedDB mock (in-memory, synchronous-ish via microtasks)
// ---------------------------------------------------------------------------
function makeIDBMock() {
  const databases = {};

  function makeRequest(value, error = null) {
    const req = {
      result: value,
      error,
      onsuccess: null,
      onerror: null,
    };
    // Queue resolution as a microtask so callers can attach handlers first
    Promise.resolve().then(() => {
      if (error) req.onerror && req.onerror({ target: req });
      else req.onsuccess && req.onsuccess({ target: req });
    });
    return req;
  }

  function makeObjectStore(storeName, dbData) {
    return {
      get(key) {
        return makeRequest(dbData[storeName][key]);
      },
      put(value) {
        dbData[storeName][value.key] = value;
        return makeRequest(undefined);
      },
      delete(key) {
        delete dbData[storeName][key];
        return makeRequest(undefined);
      },
      openCursor() {
        const keys = Object.keys(dbData[storeName]);
        let i = 0;
        const req = { onsuccess: null, onerror: null };
        function advance() {
          Promise.resolve().then(() => {
            if (i < keys.length) {
              const key = keys[i++];
              const cursor = {
                key,
                value: dbData[storeName][key],
                continue() { advance(); },
              };
              req.onsuccess && req.onsuccess({ target: { result: cursor } });
            } else {
              req.onsuccess && req.onsuccess({ target: { result: null } });
            }
          });
        }
        advance();
        return req;
      },
    };
  }

  function makeTransaction(dbData, storeNames, _mode) {
    return {
      objectStore(name) { return makeObjectStore(name, dbData); },
    };
  }

  const idbMock = {
    open(name, version) {
      if (!databases[name]) databases[name] = { cache: {} };
      const dbData = databases[name];
      const db = {
        objectStoreNames: {
          contains: storeName => !!dbData[storeName],
        },
        createObjectStore(storeName) {
          dbData[storeName] = {};
        },
        transaction: (storeNames, mode) => makeTransaction(dbData, storeNames, mode),
      };
      const req = {
        result: db,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      Promise.resolve().then(() => {
        req.onupgradeneeded && req.onupgradeneeded({ target: { result: db } });
      }).then(() => {
        req.onsuccess && req.onsuccess({ target: { result: db } });
      });
      return req;
    },
    _reset() { for (const k in databases) delete databases[k]; },
  };

  return idbMock;
}

// ---------------------------------------------------------------------------
// Setup globals before importing module
// ---------------------------------------------------------------------------
const chromeMock = makeChromeMock();
const idbMock = makeIDBMock();

vi.stubGlobal('chrome', { storage: { local: chromeMock } });
vi.stubGlobal('indexedDB', idbMock);

// CONFIG mock — storage.js imports from config.js which uses no chrome APIs
vi.mock('../modules/config.js', () => ({
  CONFIG: { DEFAULT_REPO: 'apache/flink' },
}));

// Dynamic import AFTER globals are set up
const { StorageManager } = await import('../modules/storage.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeStorageManager() {
  chromeMock._reset();
  idbMock._reset();
  return new StorageManager();
}

// ---------------------------------------------------------------------------
// chrome.storage routing (non-IDB prefixes)
// ---------------------------------------------------------------------------
describe('StorageManager — chrome.storage routing', () => {
  let sm;
  beforeEach(() => { sm = makeStorageManager(); });

  it('getCache returns null for missing key', async () => {
    await expect(sm.getCache('cache_other_key')).resolves.toBeNull();
  });

  it('setCache / getCache round-trip via chrome.storage', async () => {
    await sm.setCache('cache_ci_provider_apache/flink', { provider: 'azure' }, 1_000_000);
    const val = await sm.getCache('cache_ci_provider_apache/flink');
    expect(val).toEqual({ provider: 'azure' });
  });

  it('getCache returns null when TTL expired (chrome.storage path)', async () => {
    const expiredEntry = { data: 'old', timestamp: Date.now() - 10_000, ttl: 5_000 };
    chromeMock._store['cache_ci_x'] = expiredEntry;
    await expect(sm.getCache('cache_ci_x')).resolves.toBeNull();
  });

  it('getCache returns data when TTL still valid (chrome.storage path)', async () => {
    const entry = { data: { x: 1 }, timestamp: Date.now() - 1_000, ttl: 60_000 };
    chromeMock._store['cache_ci_x'] = entry;
    await expect(sm.getCache('cache_ci_x')).resolves.toEqual({ x: 1 });
  });
});

// ---------------------------------------------------------------------------
// IDBCache routing (cache_experts_ and cache_contributors_ prefixes)
// ---------------------------------------------------------------------------
describe('StorageManager — IndexedDB routing', () => {
  let sm;
  beforeEach(() => { sm = makeStorageManager(); });

  it('setCache / getCache round-trip for cache_experts_ key', async () => {
    await sm.setCache('cache_experts_apache/flink', [{ login: 'user1' }], 86_400_000);
    const val = await sm.getCache('cache_experts_apache/flink');
    expect(val).toEqual([{ login: 'user1' }]);
  });

  it('getCache returns null for expired IDB entry', async () => {
    // Write an already-expired entry directly via IDB
    await sm._idb.set('cache_experts_x', { data: 'old' }, 1); // ttl=1ms
    await new Promise(r => setTimeout(r, 10)); // let it expire
    await expect(sm.getCache('cache_experts_x')).resolves.toBeNull();
  });

  it('setCache / getCache round-trip for cache_contributors_ key', async () => {
    await sm.setCache('cache_contributors_user1', { score: 42 }, 43_200_000);
    const val = await sm.getCache('cache_contributors_user1');
    expect(val).toEqual({ score: 42 });
  });
});

// ---------------------------------------------------------------------------
// clearCacheByPrefix
// ---------------------------------------------------------------------------
describe('StorageManager — clearCacheByPrefix', () => {
  let sm;
  beforeEach(() => { sm = makeStorageManager(); });

  it('clears matching chrome.storage keys', async () => {
    await sm.setCache('cache_ci_apache', { x: 1 }, 60_000);
    await sm.setCache('cache_ci_other', { y: 2 }, 60_000);
    await sm.setCache('cache_pr_stuff', { z: 3 }, 60_000);
    await sm.clearCacheByPrefix('cache_ci_');
    expect(await sm.getCache('cache_ci_apache')).toBeNull();
    expect(await sm.getCache('cache_ci_other')).toBeNull();
    expect(await sm.getCache('cache_pr_stuff')).not.toBeNull();
  });

  it('bulk clear with "cache_" prefix also clears IDB', async () => {
    await sm.setCache('cache_experts_flink', ['e1'], 86_400_000);
    await sm.clearCacheByPrefix('cache_');
    await expect(sm.getCache('cache_experts_flink')).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getUserConfig / setUserConfig
// ---------------------------------------------------------------------------
describe('StorageManager — getUserConfig / setUserConfig', () => {
  let sm;
  beforeEach(() => { sm = makeStorageManager(); });

  it('returns defaultValue when config key is not set', async () => {
    await expect(sm.getUserConfig('filterState', 'open')).resolves.toBe('open');
  });

  it('setUserConfig then getUserConfig returns stored value', async () => {
    await sm.setUserConfig('filterState', 'closed');
    await expect(sm.getUserConfig('filterState', 'open')).resolves.toBe('closed');
  });

  it('setUserConfig preserves other keys in userConfig', async () => {
    await sm.setUserConfig('filterState', 'merged');
    await sm.setUserConfig('filterSort', 'updated');
    await expect(sm.getUserConfig('filterState', '')).resolves.toBe('merged');
    await expect(sm.getUserConfig('filterSort', '')).resolves.toBe('updated');
  });

  it('returns default when key exists in config but is undefined', async () => {
    chromeMock._store['userConfig'] = {};
    await expect(sm.getUserConfig('filterCI', 'all')).resolves.toBe('all');
  });
});

// ---------------------------------------------------------------------------
// getRepo / getToken / getUsername / getCustomRepos
// ---------------------------------------------------------------------------
describe('StorageManager — getRepo / getToken / getUsername / getCustomRepos', () => {
  let sm;
  beforeEach(() => { sm = makeStorageManager(); });

  it('getRepo returns DEFAULT_REPO when not set', async () => {
    await expect(sm.getRepo()).resolves.toBe('apache/flink');
  });

  it('getRepo returns stored value', async () => {
    chromeMock._store['repo'] = 'apache/flink-connector-kafka';
    await expect(sm.getRepo()).resolves.toBe('apache/flink-connector-kafka');
  });

  it('getToken returns empty string when not set', async () => {
    await expect(sm.getToken()).resolves.toBe('');
  });

  it('getToken returns stored value', async () => {
    chromeMock._store['gh_token'] = 'ghp_abc123';
    await expect(sm.getToken()).resolves.toBe('ghp_abc123');
  });

  it('getUsername returns empty string when not set', async () => {
    await expect(sm.getUsername()).resolves.toBe('');
  });

  it('getCustomRepos returns empty array when not set', async () => {
    await expect(sm.getCustomRepos()).resolves.toEqual([]);
  });

  it('getCustomRepos returns stored array', async () => {
    chromeMock._store['customRepos'] = ['apache/flink-cdc'];
    await expect(sm.getCustomRepos()).resolves.toEqual(['apache/flink-cdc']);
  });
});

// ---------------------------------------------------------------------------
// clearAuth
// ---------------------------------------------------------------------------
describe('StorageManager — clearAuth', () => {
  let sm;
  beforeEach(() => { sm = makeStorageManager(); });

  it('removes gh_token, username, gh_login_error keys', async () => {
    chromeMock._store['gh_token'] = 'token';
    chromeMock._store['username'] = 'user';
    chromeMock._store['gh_login_error'] = 'some error';
    await sm.clearAuth();
    expect(chromeMock._store['gh_token']).toBeUndefined();
    expect(chromeMock._store['username']).toBeUndefined();
    expect(chromeMock._store['gh_login_error']).toBeUndefined();
  });

  it('does not remove other keys', async () => {
    chromeMock._store['gh_token'] = 'token';
    chromeMock._store['userConfig'] = { filterState: 'open' };
    await sm.clearAuth();
    expect(chromeMock._store['userConfig']).toEqual({ filterState: 'open' });
  });
});

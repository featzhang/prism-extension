'use strict';

const CLIENT_ID = 'Ov23liwUOP3nwcUzgUPs';

chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// ===== GitHub Device Flow =====

async function startDeviceFlow() {
  const resp = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: 'public_repo read:user' }),
  });
  if (!resp.ok) throw new Error(`Device code request failed: ${resp.status}`);
  return resp.json();
}

async function pollForToken(deviceCode, interval) {
  const intervalMs = (interval || 5) * 1000;

  return new Promise((resolve, reject) => {
    const poll = async () => {
      try {
        const resp = await fetch('https://github.com/login/oauth/access_token', {
          method: 'POST',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });
        const data = await resp.json();

        if (data.access_token) return resolve(data.access_token);
        if (data.error === 'authorization_pending') return setTimeout(poll, intervalMs);
        if (data.error === 'slow_down') return setTimeout(poll, intervalMs + 5000);
        reject(new Error(data.error_description || data.error || 'Authorization failed'));
      } catch (err) {
        reject(err);
      }
    };

    setTimeout(poll, intervalMs);
  });
}

async function fetchGitHubUser(token) {
  const resp = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  if (!resp.ok) throw new Error(`Failed to fetch user: ${resp.status}`);
  return resp.json();
}

// ===== Message Handler =====

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_LOGIN') {
    handleLogin(sendResponse);
    return true;
  }

  if (msg.type === 'LOGOUT') {
    chrome.storage.local.remove(['gh_token', 'username'], () => sendResponse({ ok: true }));
    return true;
  }
});

async function handleLogin(sendResponse) {
  let deviceData;
  try {
    deviceData = await startDeviceFlow();
  } catch (err) {
    sendResponse({ ok: false, error: err.message || 'Failed to start login' });
    return;
  }

  // Return user_code to popup immediately so user knows what to enter
  sendResponse({
    ok: true,
    user_code: deviceData.user_code,
    verification_uri: deviceData.verification_uri,
  });

  // Open GitHub device activation page
  chrome.tabs.create({ url: `${deviceData.verification_uri}?user_code=${deviceData.user_code}` });

  // Poll for token in background; write to storage when done
  try {
    const token = await pollForToken(deviceData.device_code, deviceData.interval);
    const user = await fetchGitHubUser(token);
    await new Promise(resolve => chrome.storage.local.set({ gh_token: token, username: user.login }, resolve));
    // Actively notify popup in case storage.onChanged doesn't fire (side panel may be suspended)
    chrome.runtime.sendMessage({ type: 'LOGIN_SUCCESS', username: user.login }).catch(() => {});
  } catch (err) {
    const errMsg = err.message || 'Authorization failed';
    chrome.storage.local.set({ gh_login_error: errMsg });
    chrome.runtime.sendMessage({ type: 'LOGIN_ERROR', error: errMsg }).catch(() => {});
  }
}

const API_BASE = 'https://api.twitter.com/2';
const RATE_LIMIT_DELAY = 3000;
const DM_DELAY = 5000;

const CLIENT_ID = 'c0Y3UGY0cy1TcE10T19wd2QtNHc6MTpjaQ';
const CLIENT_SECRET = 'cyhVrKKL4gVWp-sS5PLy8iLultuxQwkmvfaIWzzEYZoEm7VTcz';
const SCOPES = 'tweet.read users.read like.read dm.write offline.access';

async function authorize() {
  const REDIRECT_URI = chrome.identity.getRedirectURL();
  const state = Math.random().toString(36).substring(2, 15);
  const codeVerifier = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  
  const authUrl = new URL('https://twitter.com/i/oauth2/authorize');
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('client_id', CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('scope', SCOPES);
  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('code_challenge', codeVerifier);
  authUrl.searchParams.append('code_challenge_method', 'plain');

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({
      url: authUrl.toString(),
      interactive: true
    }, async (redirectUrl) => {
      if (chrome.runtime.lastError || !redirectUrl) {
        return reject(chrome.runtime.lastError?.message || 'Authentication failed');
      }

      const url = new URL(redirectUrl);
      const code = url.searchParams.get('code');
      const returnedState = url.searchParams.get('state');

      if (state !== returnedState) {
        return reject('State mismatch');
      }

      const basicAuth = btoa(CLIENT_ID + ':' + CLIENT_SECRET);
      
      const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${basicAuth}`
        },
        body: new URLSearchParams({
          code: code,
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          redirect_uri: REDIRECT_URI,
          code_verifier: codeVerifier
        })
      });

      const tokenData = await tokenRes.json();
      if (tokenData.access_token) {
        await chrome.storage.local.set({ accessToken: tokenData.access_token });
        resolve(tokenData.access_token);
      } else {
        reject('Failed to get token');
      }
    });
  });
}

async function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['accessToken', 'dmTemplate'], resolve);
  });
}

async function apiFetch(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (res.status === 429) {
    const retry = res.headers.get('x-rate-limit-reset');
    const wait = retry ? (parseInt(retry) * 1000 - Date.now() + 1000) : RATE_LIMIT_DELAY;
    await sleep(wait);
    return apiFetch(url, token, options);
  }
  return res;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchLikersAPI(tweetId, token) {
  let users = [];
  let nextToken = null;
  do {
    let url = `${API_BASE}/tweets/${tweetId}/liking_users?max_results=100&user.fields=name,username,profile_image_url`;
    if (nextToken) url += `&pagination_token=${nextToken}`;
    const res = await apiFetch(url, token);
    if (!res.ok) return { error: `API error ${res.status}: ${await res.text()}` };
    const data = await res.json();
    if (data.data) {
      users = users.concat(data.data.map(u => ({
        username: u.username,
        displayName: u.name,
        profileUrl: `https://x.com/${u.username}`,
        userId: u.id
      })));
    }
    nextToken = data.meta?.next_token;
  } while (nextToken);
  return { users };
}

async function getUserId(username, token) {
  const res = await apiFetch(`${API_BASE}/users/by/username/${username}?user.fields=id`, token);
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.id;
}

async function sendDM(recipientId, message, token) {
  const meRes = await apiFetch(`${API_BASE}/users/me`, token);
  if (!meRes.ok) return { error: 'Cannot get authenticated user' };
  const me = await meRes.json();
  const senderId = me.data?.id;
  if (!senderId) return { error: 'No sender ID' };

  const res = await apiFetch(`${API_BASE}/dm_conversations/with/${recipientId}/messages`, token, {
    method: 'POST',
    body: JSON.stringify({ text: message })
  });
  if (!res.ok) {
    const txt = await res.text();
    return { error: `DM failed ${res.status}: ${txt}` };
  }
  return { success: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'login') {
    authorize()
      .then(token => sendResponse({ token }))
      .catch(error => sendResponse({ error }));
    return true;
  }

  if (msg.action === 'fetchLikersAPI') {
    (async () => {
      const { accessToken } = await getSettings();
      if (!accessToken) return sendResponse({ error: 'Please login with Twitter first.' });
      const result = await fetchLikersAPI(msg.tweetId, accessToken);
      if (result.users) {
        const existing = await new Promise(r => chrome.storage.local.get(['likers'], r));
        const map = new Map((existing.likers || []).map(u => [u.username, u]));
        result.users.forEach(u => map.set(u.username, u));
        const merged = Array.from(map.values());
        await new Promise(r => chrome.storage.local.set({ likers: merged }, r));
        sendResponse({ count: merged.length });
      } else {
        sendResponse(result);
      }
    })();
    return true;
  }

  if (msg.action === 'sendDMs') {
    (async () => {
      const { accessToken, dmTemplate } = await getSettings();
      if (!accessToken) return sendResponse({ error: 'Please login with Twitter first.' });
      if (!dmTemplate) return sendResponse({ error: 'No DM template set.' });
      const { likers } = await new Promise(r => chrome.storage.local.get(['likers'], r));
      if (!likers?.length) return sendResponse({ error: 'No likers collected.' });

      let sent = 0, failed = 0, errors = [];
      for (const user of likers) {
        const recipientId = user.userId || await getUserId(user.username, accessToken);
        if (!recipientId) { failed++; continue; }
        const message = dmTemplate.replace('{username}', user.username).replace('{name}', user.displayName);
        const result = await sendDM(recipientId, message, accessToken);
        if (result.success) sent++;
        else { failed++; errors.push(`@${user.username}: ${result.error}`); }
        await sleep(DM_DELAY);
      }
      sendResponse({ sent, failed, errors });
    })();
    return true;
  }

  if (msg.action === 'storeLikers') {
    (async () => {
      const existing = await new Promise(r => chrome.storage.local.get(['likers'], r));
      const map = new Map((existing.likers || []).map(u => [u.username, u]));
      (msg.likers || []).forEach(u => map.set(u.username, u));
      const merged = Array.from(map.values());
      await new Promise(r => chrome.storage.local.set({ likers: merged }, r));
      sendResponse({ count: merged.length });
    })();
    return true;
  }

  if (msg.action === 'clearLikers') {
    chrome.storage.local.set({ likers: [] }, () => sendResponse({ ok: true }));
    return true;
  }
});

let method = 'api';
let currentTweetId = null;

const countEl = document.getElementById('count');
const statusEl = document.getElementById('status');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const tweetIdDisplay = document.getElementById('tweetIdDisplay');
const btnFetch = document.getElementById('btnFetch');
const btnExport = document.getElementById('btnExport');
const btnDM = document.getElementById('btnDM');
const btnClear = document.getElementById('btnClear');

function setStatus(msg, type = '') {
  statusEl.className = 'status-bar' + (type ? ' ' + type : '');
  statusDot.className = 'dot' + (type ? ' ' + type : '');
  statusText.textContent = msg;
}

function setLoading(loading) {
  btnFetch.disabled = loading;
  btnDM.disabled = loading;
  progressBar.className = 'progress-bar' + (loading ? ' active' : '');
}

function updateCount(n) {
  countEl.textContent = n;
}

async function getCount() {
  return new Promise(resolve => {
    chrome.storage.local.get(['likers'], d => resolve((d.likers || []).length));
  });
}

async function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]));
  });
}

async function init() {
  const count = await getCount();
  updateCount(count);
  const tab = await getActiveTab();
  if (tab && (tab.url.includes('twitter.com') || tab.url.includes('x.com'))) {
    chrome.tabs.sendMessage(tab.id, { action: 'getTweetId' }, res => {
      if (chrome.runtime.lastError) return;
      if (res?.tweetId) {
        currentTweetId = res.tweetId;
        tweetIdDisplay.textContent = `tweet: ${res.tweetId.slice(0, 12)}...`;
        setStatus('Tweet detected — ready to fetch', '');
      } else {
        setStatus('Navigate to a tweet page', '');
      }
    });
  } else {
    setStatus('Open X/Twitter first', 'error');
  }
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    method = tab.dataset.method;
  });
});

btnFetch.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!tab) return setStatus('No active tab', 'error');

  setLoading(true);

  if (method === 'api') {
    if (!currentTweetId) {
      setStatus('No tweet ID found on this page', 'error');
      return setLoading(false);
    }
    setStatus('Fetching via Twitter API v2...', 'loading');
    chrome.runtime.sendMessage({ action: 'fetchLikersAPI', tweetId: currentTweetId }, res => {
      setLoading(false);
      if (res?.error) return setStatus(res.error, 'error');
      updateCount(res.count);
      setStatus(`✓ ${res.count} users collected via API`, 'success');
    });
  } else {
    setStatus('DOM scraping... scroll will begin', 'loading');
    chrome.tabs.sendMessage(tab.id, { action: 'scrapeDOM' }, res => {
      setLoading(false);
      if (chrome.runtime.lastError) {
        return setStatus('Content script error — reload the page', 'error');
      }
      if (res?.error) return setStatus(res.error, 'error');
      updateCount(res.count);
      setStatus(`✓ ${res.count} users collected via DOM`, 'success');
    });
  }
});

btnExport.addEventListener('click', async () => {
  chrome.storage.local.get(['likers'], ({ likers }) => {
    if (!likers?.length) return setStatus('No data to export', 'error');
    const rows = [['Username', 'Display Name', 'Profile URL', 'User ID']];
    likers.forEach(u => rows.push([u.username, u.displayName, u.profileUrl, u.userId || '']));
    const csv = rows.map(r => r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `likes_${currentTweetId || 'export'}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus(`↓ Exported ${likers.length} rows`, 'success');
  });
});

btnDM.addEventListener('click', async () => {
  const { accessToken, dmTemplate } = await new Promise(r =>
    chrome.storage.local.get(['accessToken', 'dmTemplate'], r)
  );
  if (!accessToken) return setStatus('Login with Twitter in Settings first', 'error');
  if (!dmTemplate) return setStatus('Set DM template in Settings first', 'error');

  const count = await getCount();
  if (!count) return setStatus('No users collected yet', 'error');

  if (!confirm(`Send DMs to ${count} users? This will take ~${Math.ceil(count * 5 / 60)} min.`)) return;

  setLoading(true);
  setStatus(`Sending DMs to ${count} users...`, 'loading');

  chrome.runtime.sendMessage({ action: 'sendDMs' }, res => {
    setLoading(false);
    if (res?.error) return setStatus(res.error, 'error');
    setStatus(`✓ Sent: ${res.sent} | Failed: ${res.failed}`, res.failed ? '' : 'success');
  });
});

btnClear.addEventListener('click', () => {
  if (!confirm('Clear all collected users?')) return;
  chrome.runtime.sendMessage({ action: 'clearLikers' }, () => {
    updateCount(0);
    setStatus('Cleared all data', '');
  });
});

document.getElementById('openSettings').addEventListener('click', () => {
  if (chrome.runtime.openOptionsPage) {
    chrome.runtime.openOptionsPage();
  } else {
    window.open(chrome.runtime.getURL('options.html'));
  }
});

init();

const btnAuth = document.getElementById('btnAuth');
const authStatus = document.getElementById('authStatus');
const dmInput = document.getElementById('dmTemplate');
const statusMsg = document.getElementById('statusMsg');

function showStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className = 'status-msg show ' + type;
  setTimeout(() => statusMsg.className = 'status-msg', 3000);
}

chrome.storage.local.get(['accessToken', 'dmTemplate'], ({ accessToken, dmTemplate }) => {
  if (accessToken) authStatus.textContent = '✓ Connected to Twitter';
  if (dmTemplate) dmInput.value = dmTemplate;
});

btnAuth.addEventListener('click', () => {
  authStatus.textContent = 'Connecting...';
  chrome.runtime.sendMessage({ action: 'login' }, res => {
    if (res?.error) {
      authStatus.textContent = 'Error: ' + res.error;
      showStatus('Login failed', 'error');
    } else {
      authStatus.textContent = '✓ Connected to Twitter';
      showStatus('✓ Login success', 'success');
    }
  });
});

document.getElementById('btnSave').addEventListener('click', () => {
  const template = dmInput.value.trim();
  chrome.storage.local.set({ dmTemplate: template }, () => {
    showStatus('✓ Settings saved', 'success');
  });
});

document.getElementById('btnReset').addEventListener('click', () => {
  if (!confirm('Clear all settings and disconnect from Twitter?')) return;
  authStatus.textContent = '';
  dmInput.value = '';
  chrome.storage.local.clear(() => {
    showStatus('Settings cleared', 'success');
  });
});

document.getElementById('closeSettings')?.addEventListener('click', () => {
  window.close();
});

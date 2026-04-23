(() => {
  function extractTweetId() {
    const m = location.pathname.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }

  function parseLikerCards() {
    const users = [];
    const cells = document.querySelectorAll('[data-testid="UserCell"]');
    cells.forEach(cell => {
      const link = cell.querySelector('a[href^="/"]');
      if (!link) return;
      const href = link.getAttribute('href');
      const username = href.replace('/', '').split('/')[0];
      if (!username || username.length === 0) return;
      const nameEl = cell.querySelector('[data-testid="User-Name"] span span');
      const displayName = nameEl ? nameEl.textContent.trim() : username;
      users.push({
        username,
        displayName,
        profileUrl: `https://x.com/${username}`
      });
    });
    return users;
  }

  async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function scrollAndCollect(onProgress) {
    const seen = new Set();
    const all = [];
    let noNewCount = 0;

    while (noNewCount < 5) {
      const batch = parseLikerCards();
      let added = 0;
      batch.forEach(u => {
        if (!seen.has(u.username)) {
          seen.add(u.username);
          all.push(u);
          added++;
        }
      });
      if (added === 0) noNewCount++;
      else noNewCount = 0;
      if (onProgress) onProgress(all.length);
      window.scrollBy(0, 800);
      await sleep(800);
    }
    return all;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'getTweetId') {
      sendResponse({ tweetId: extractTweetId() });
    }

    if (msg.action === 'scrapeDOM') {
      (async () => {
        const isLikesPage = location.pathname.includes('/likes');
        if (!isLikesPage) {
          sendResponse({ error: 'Navigate to the /likes page of the tweet first.' });
          return;
        }
        const likers = await scrollAndCollect();
        chrome.runtime.sendMessage({ action: 'storeLikers', likers }, (res) => {
          sendResponse({ count: res?.count || likers.length });
        });
      })();
      return true;
    }
  });
})();

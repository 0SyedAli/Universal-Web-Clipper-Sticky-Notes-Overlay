/**
 * ClipSync Pro - sidepanel.js
 * Reliably tracks active tab URL across tab switches, window changes, and navigation
 */
let currentUrl = '';
let currentTabId = null;

// Query the active tab in the browser window
async function getActiveWebTab() {
  try {
    // 1. Try lastFocusedWindow first (since sidepanel itself is a distinct window in some views)
    let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tabs || tabs.length === 0 || !tabs[0].url) {
      // Fallback: try currentWindow
      tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    }
    return tabs && tabs.length > 0 ? tabs[0] : null;
  } catch (err) {
    console.warn('Tab query error:', err);
    return null;
  }
}

// Update the side panel display and reload notes for the active URL
async function updateActiveTab() {
  const tab = await getActiveWebTab();
  const urlDisplay = document.getElementById('pageUrlDisplay');
  const quickAddBtn = document.getElementById('btnQuickAdd');

  if (!tab) {
    if (urlDisplay) urlDisplay.textContent = 'No active tab found';
    return;
  }

  currentTabId = tab.id;

  // Check if URL is present (requires "tabs" permission in manifest)
  if (!tab.url) {
    if (urlDisplay) urlDisplay.textContent = 'Restricted page (No URL)';
    currentUrl = '';
    loadUrlData();
    return;
  }

  // Handle browser system / internal pages where content scripts cannot run
  if (
    tab.url.startsWith('chrome://') ||
    tab.url.startsWith('edge://') ||
    tab.url.startsWith('chrome-extension://') ||
    tab.url.startsWith('devtools://') ||
    tab.url.startsWith('about:') ||
    tab.url.startsWith('view-source:')
  ) {
    if (urlDisplay) {
      urlDisplay.textContent = 'System Page (Notes Disabled)';
      urlDisplay.title = tab.url;
    }
    if (quickAddBtn) quickAddBtn.disabled = true;
    currentUrl = '';
    renderStickies([]);
    return;
  }

  if (quickAddBtn) quickAddBtn.disabled = false;
  currentUrl = tab.url;

  // Display human-friendly URL format
  if (urlDisplay) {
    try {
      const parsed = new URL(tab.url);
      const displayPath = parsed.pathname !== '/' ? parsed.pathname : '';
      urlDisplay.textContent = parsed.hostname + displayPath;
      urlDisplay.title = tab.url;
    } catch (e) {
      urlDisplay.textContent = tab.url;
    }
  }

  loadUrlData();
}

async function initSidePanel() {
  // Initial tab detection
  await updateActiveTab();

  // 1. Trigger when the user clicks or switches to another tab
  chrome.tabs.onActivated.addListener(() => {
    updateActiveTab();
  });

  // 2. Trigger when the current tab finishes loading, redirects, or navigates
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tabId === currentTabId && (changeInfo.url || changeInfo.status === 'complete')) {
      updateActiveTab();
    }
  });

  // 3. Trigger when switching between different browser windows
  if (chrome.windows && chrome.windows.onFocusChanged) {
    chrome.windows.onFocusChanged.addListener((windowId) => {
      if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        updateActiveTab();
      }
    });
  }

  // 4. Listen to updates dispatched from content.js or background.js
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'CLIPSYNC_UPDATED') {
      if (!msg.url || msg.url === currentUrl) {
        loadUrlData();
      }
    }
  });

  // Action Buttons
  const quickAdd = document.getElementById('btnQuickAdd');
  if (quickAdd) {
    quickAdd.addEventListener('click', () => {
      if (currentTabId && currentUrl) {
        chrome.tabs.sendMessage(currentTabId, { type: 'ADD_STICKY_AT_VIEWPORT' }).catch((err) => {
          console.warn('Could not inject into tab, injecting directly:', err);
        });
      }
    });
  }

  const scratchpad = document.getElementById('pageScratchpad');
  if (scratchpad) {
    scratchpad.addEventListener('input', (e) => {
      saveScratchpad(e.target.value);
    });
  }

  // Tab switching
  document.getElementById('btnTabStickies').addEventListener('click', () => switchTab('stickies'));
  document.getElementById('btnTabVault').addEventListener('click', () => switchTab('vault'));

  document.getElementById('btnExportMd').addEventListener('click', exportToMarkdown);
  document.getElementById('btnExportJson').addEventListener('click', exportToJson);
}

function loadUrlData() {
  if (!currentUrl) {
    renderStickies([]);
    return;
  }

  chrome.storage.local.get(['clipsync_db'], (result) => {
    const db = result.clipsync_db || {};
    const page = db[currentUrl] || { stickies: [], clips: [], scratchpad: '' };

    const pad = document.getElementById('pageScratchpad');
    if (pad) pad.value = page.scratchpad || '';
    renderStickies(page.stickies || []);
    renderVault(db);
  });
}

function renderStickies(stickies) {
  const container = document.getElementById('stickiesList');
  if (!container) return;
  container.innerHTML = '';

  if (!stickies || stickies.length === 0) {
    container.innerHTML = '<div style="color:#64748b; font-size:11px;">No sticky notes pinned on this URL yet.</div>';
    return;
  }

  stickies.forEach(s => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div style="font-weight:600; font-size:11px; margin-bottom:4px; color:#fbbf24;">📌 Sticky Note</div>
      <div style="font-size:12px; color:#e2e8f0; white-space:pre-wrap;">${escapeHtml(s.text || 'Empty note')}</div>
    `;
    container.appendChild(card);
  });
}

function renderVault(db) {
  const container = document.getElementById('vaultList');
  if (!container) return;
  container.innerHTML = '';
  const urls = Object.keys(db || {});

  if (urls.length === 0) {
    container.innerHTML = '<div style="color:#64748b; font-size:11px;">Vault is empty.</div>';
    return;
  }

  urls.forEach(urlKey => {
    const item = db[urlKey];
    const card = document.createElement('div');
    card.className = 'card';
    card.style.cursor = 'pointer';
    card.innerHTML = `
      <div style="font-weight:600; font-size:12px; color:#818cf8;">${escapeHtml(item.title || item.domain || urlKey)}</div>
      <div style="font-size:10px; color:#64748b; font-family:monospace; margin-top:2px; word-break:break-all;">${escapeHtml(urlKey)}</div>
      <div style="font-size:11px; color:#94a3b8; margin-top:6px;">
        ${(item.stickies || []).length} stickies &bull; ${(item.clips || []).length} clips
      </div>
    `;
    card.addEventListener('click', () => {
      chrome.tabs.create({ url: urlKey });
    });
    container.appendChild(card);
  });
}

function saveScratchpad(text) {
  if (!currentUrl) return;
  chrome.storage.local.get(['clipsync_db'], (result) => {
    const db = result.clipsync_db || {};
    if (!db[currentUrl]) {
      db[currentUrl] = { url: currentUrl, stickies: [], clips: [] };
    }
    db[currentUrl].scratchpad = text;
    chrome.storage.local.set({ clipsync_db: db });
  });
}

function switchTab(tab) {
  if (tab === 'stickies') {
    document.getElementById('stickiesView').style.display = 'block';
    document.getElementById('vaultView').style.display = 'none';
    document.getElementById('btnTabStickies').className = 'active';
    document.getElementById('btnTabVault').className = '';
  } else {
    document.getElementById('stickiesView').style.display = 'none';
    document.getElementById('vaultView').style.display = 'block';
    document.getElementById('btnTabStickies').className = '';
    document.getElementById('btnTabVault').className = 'active';
  }
}

function exportToMarkdown() {
  chrome.storage.local.get(['clipsync_db'], (res) => {
    const db = res.clipsync_db || {};
    let md = '# ClipSync Pro Export\n\n';
    Object.values(db).forEach(p => {
      md += `## [${p.title || p.url}](${p.url})\n`;
      if (p.scratchpad) md += `### Scratchpad\n${p.scratchpad}\n\n`;
      if (p.stickies && p.stickies.length) {
        md += '### Sticky Notes\n';
        p.stickies.forEach((s, i) => md += `${i+1}. ${s.text}\n`);
        md += '\n';
      }
      md += '---\n\n';
    });
    downloadFile(md, 'clipsync-export.md', 'text/markdown');
  });
}

function exportToJson() {
  chrome.storage.local.get(['clipsync_db'], (res) => {
    const json = JSON.stringify(res.clipsync_db || {}, null, 2);
    downloadFile(json, 'clipsync-backup.json', 'application/json');
  });
}

function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', initSidePanel);
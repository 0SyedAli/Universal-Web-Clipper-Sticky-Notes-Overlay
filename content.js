/**
 * ClipSync Pro - content.js (Production Manifest V3)
 * Injects isolated draggable sticky notes overlay keyed uniquely to window.location.href
 */

// Normalizes the current page link so query params / paths are preserved while removing transient hashes
function getNormalizedPageKey() {
  return window.location.origin + window.location.pathname + window.location.search;
}

let overlayContainer = null;
let currentNotes = [];

function initClipSync() {
  if (document.getElementById('clipsync-root-container')) return;

  // Create isolated container on host page
  overlayContainer = document.createElement('div');
  overlayContainer.id = 'clipsync-root-container';
  overlayContainer.className = 'clipsync-overlay-layer';
  document.body.appendChild(overlayContainer);

  loadNotesForCurrentUrl();
  listenToShortcutsAndMessages();
}

// Load notes saved specifically for THIS URL from chrome.storage.local
function loadNotesForCurrentUrl() {
  const urlKey = getNormalizedPageKey();
  chrome.storage.local.get(['clipsync_db'], (result) => {
    const db = result.clipsync_db || {};
    const pageData = db[urlKey] || { stickies: [], clips: [] };
    currentNotes = pageData.stickies || [];
    renderAllStickies();
  });
}

// Save current page stickies back into storage for this specific URL
function saveCurrentNotes() {
  const urlKey = getNormalizedPageKey();
  chrome.storage.local.get(['clipsync_db'], (result) => {
    const db = result.clipsync_db || {};
    if (!db[urlKey]) {
      db[urlKey] = {
        url: urlKey,
        title: document.title || urlKey,
        domain: window.location.hostname,
        updatedAt: Date.now(),
        stickies: [],
        clips: []
      };
    }
    db[urlKey].stickies = currentNotes;
    db[urlKey].updatedAt = Date.now();
    chrome.storage.local.set({ clipsync_db: db }, () => {
      // Notify extension sidepanel if open
      chrome.runtime.sendMessage({ type: 'CLIPSYNC_UPDATED', url: urlKey }).catch(() => {});
    });
  });
}

function renderAllStickies() {
  if (!overlayContainer) return;
  overlayContainer.innerHTML = '';

  currentNotes.forEach(note => {
    const noteEl = document.createElement('div');
    noteEl.id = 'clipsync-note-' + note.id;
    noteEl.className = `clipsync-note clipsync-theme-${note.color || 'yellow'} ${note.collapsed ? 'clipsync-collapsed' : ''}`;
    noteEl.style.left = `${note.x}px`;
    noteEl.style.top = `${note.y}px`;

    noteEl.innerHTML = `
      <div class="clipsync-handle">
        <div class="clipsync-title">
          <span>📌</span>
          <span class="clipsync-label">Sticky Note</span>
        </div>
        <div class="clipsync-actions">
          <button class="clipsync-btn-color" title="Cycle Color">🎨</button>
          <button class="clipsync-btn-fold" title="Collapse / Expand">${note.collapsed ? '➕' : '➖'}</button>
          <button class="clipsync-btn-del" title="Delete">✕</button>
        </div>
      </div>
      <div class="clipsync-body">
        <textarea class="clipsync-textarea" placeholder="Note on this webpage...">${note.text || ''}</textarea>
      </div>
    `;

    // Events
    const textarea = noteEl.querySelector('.clipsync-textarea');
    textarea.addEventListener('input', (e) => {
      note.text = e.target.value;
      debounceSave();
    });

    noteEl.querySelector('.clipsync-btn-del').addEventListener('click', (e) => {
      e.stopPropagation();
      currentNotes = currentNotes.filter(n => n.id !== note.id);
      saveCurrentNotes();
      renderAllStickies();
    });

    noteEl.querySelector('.clipsync-btn-fold').addEventListener('click', (e) => {
      e.stopPropagation();
      note.collapsed = !note.collapsed;
      saveCurrentNotes();
      renderAllStickies();
    });

    noteEl.querySelector('.clipsync-btn-color').addEventListener('click', (e) => {
      e.stopPropagation();
      const colors = ['yellow', 'mint', 'lavender', 'coral'];
      const nextIdx = (colors.indexOf(note.color) + 1) % colors.length;
      note.color = colors[nextIdx];
      saveCurrentNotes();
      renderAllStickies();
    });

    makeDraggable(noteEl, note);
    overlayContainer.appendChild(noteEl);
  });
}

function makeDraggable(element, note) {
  const handle = element.querySelector('.clipsync-handle');
  let isDragging = false;
  let startX, startY, origLeft, origTop;

  handle.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    origLeft = note.x;
    origTop = note.y;
    element.style.zIndex = '2147483647';

    function onMouseMove(moveEvent) {
      if (!isDragging) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const newX = Math.max(10, origLeft + dx);
      const newY = Math.max(10, origTop + dy);

      element.style.left = newX + 'px';
      element.style.top = newY + 'px';
      note.x = newX;
      note.y = newY;
    }

    function onMouseUp() {
      if (isDragging) {
        isDragging = false;
        element.style.zIndex = '2147483640';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        saveCurrentNotes();
      }
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });
}

let saveTimeout = null;
function debounceSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveCurrentNotes, 400);
}

function addNewSticky(x, y, initialText = '') {
  const scrollY = window.scrollY || document.documentElement.scrollTop;
  const newSticky = {
    id: 's-' + Date.now(),
    x: x || Math.round(window.innerWidth / 3),
    y: (y || 120) + scrollY,
    color: 'yellow',
    text: initialText || 'New note on this website...',
    collapsed: false
  };
  currentNotes.push(newSticky);
  saveCurrentNotes();
  renderAllStickies();
}

function listenToShortcutsAndMessages() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'ADD_STICKY_AT_VIEWPORT') {
      addNewSticky();
      sendResponse({ status: 'ok' });
    } else if (message.type === 'RELOAD_STICKIES') {
      loadNotesForCurrentUrl();
      sendResponse({ status: 'ok' });
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'n' || e.key === 'N')) {
      e.preventDefault();
      addNewSticky();
    }
  });
}

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initClipSync);
} else {
  initClipSync();
}
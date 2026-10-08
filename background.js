/**
 * ClipSync Pro - background.js (Service Worker)
 * Coordinates Side Panel opening, context menus, and storage
 */

chrome.runtime.onInstalled.addListener(() => {
  // Context menu to add sticky note at mouse position
  chrome.contextMenus.create({
    id: "clipsync-add-note",
    title: "📝 Add Sticky Note on this URL",
    contexts: ["page"]
  });

  chrome.contextMenus.create({
    id: "clipsync-clip-selection",
    title: "📌 Clip Highlight to URL Notes",
    contexts: ["selection"]
  });
});

// Configure side panel to open on action button click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.log("SidePanel error:", err));

// Context Menu Click Listener
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || !tab.id) return;

  if (info.menuItemId === "clipsync-add-note") {
    chrome.tabs.sendMessage(tab.id, { type: "ADD_STICKY_AT_VIEWPORT" }).catch(() => {});
  } else if (info.menuItemId === "clipsync-clip-selection") {
    const url = tab.url;
    chrome.storage.local.get(["clipsync_db"], (res) => {
      const db = res.clipsync_db || {};
      if (!db[url]) {
        db[url] = { url, title: tab.title, domain: new URL(url).hostname, stickies: [], clips: [] };
      }
      db[url].clips.push({
        id: "c-" + Date.now(),
        quote: info.selectionText,
        timestamp: new Date().toLocaleTimeString(),
        comment: ""
      });
      chrome.storage.local.set({ clipsync_db: db }, () => {
        chrome.runtime.sendMessage({ type: "CLIPSYNC_UPDATED", url }).catch(() => {});
      });
    });
  }
});

// Command listener (Alt+N)
chrome.commands.onCommand.addListener((command) => {
  if (command === "add-sticky-note") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, { type: "ADD_STICKY_AT_VIEWPORT" }).catch(() => {});
      }
    });
  }
});
/**
 * Pocket Hub - iOS & Offline PWA Core Logic with Cloud Sync
 * Features: Service Worker, Offline Caching, Firebase Realtime Sync, PIN Management
 */

// --- 1. Service Worker & Update Manager ---
let newWorker = null;

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((registration) => {
          console.log('[PWA] ServiceWorker registered with scope:', registration.scope);

          // Check for pending updates
          registration.addEventListener('updatefound', () => {
            newWorker = registration.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateToast();
              }
            });
          });
        })
        .catch((err) => {
          console.error('[PWA] ServiceWorker registration failed:', err);
        });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          window.location.reload();
        }
      });
    });
  }
}

function showUpdateToast() {
  const toast = document.getElementById('updateToast');
  if (toast) toast.classList.add('active');
}

function applyUpdate() {
  if (newWorker) {
    newWorker.postMessage({ type: 'SKIP_WAITING' });
  } else {
    window.location.reload();
  }
}

// --- 2. Online / Offline Status Monitoring ---
function setupNetworkMonitoring() {
  const badge = document.getElementById('networkBadge');
  const badgeText = document.getElementById('networkText');
  const offlineBanner = document.getElementById('offlineBanner');

  function updateStatus() {
    const isOnline = navigator.onLine;

    if (isOnline) {
      badge.className = 'network-badge online';
      badgeText.textContent = 'Çevrimiçi';
      offlineBanner.classList.remove('active');
      // When connection is restored, trigger automatic cloud synchronization!
      syncWithCloud();
    } else {
      badge.className = 'network-badge offline';
      badgeText.textContent = 'Çevrimdışı';
      offlineBanner.classList.add('active');
      updateSyncBadge('offline');
    }
    updateStats();
  }

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
  updateStatus(); // Initial check
}

// --- 3. iOS Detection & Standalone Mode Check ---
function setupIosInstallBanner() {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent.toLowerCase());
  const isStandalone = ('standalone' in window.navigator && window.navigator.standalone) ||
                       window.matchMedia('(display-mode: standalone)').matches;

  const banner = document.getElementById('iosInstallBanner');
  const closeBtn = document.getElementById('closeInstallBanner');
  const dismissed = localStorage.getItem('ios_install_dismissed') === 'true';

  if (isIos && !isStandalone && !dismissed) {
    banner.classList.add('active');
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      banner.classList.remove('active');
      localStorage.setItem('ios_install_dismissed', 'true');
    });
  }
}

// --- 4. Cloud Sync Engine (Firebase Realtime Database) ---
const FIREBASE_DB_URL = 'https://leb1919-default-rtdb.firebaseio.com';
const STORAGE_KEY = 'pockethub_items_v1';
const PIN_KEY = 'pockethub_sync_pin_v1';
const DEFAULT_PIN = 'leb1919';

let isSyncing = false;
let syncDebounceTimer = null;

function getSyncPin() {
  return (localStorage.getItem(PIN_KEY) || DEFAULT_PIN).trim();
}

function setSyncPin(newPin) {
  const cleanPin = (newPin || DEFAULT_PIN).trim();
  localStorage.setItem(PIN_KEY, cleanPin);
  updatePinUI();
  // Immediately pull data for new PIN
  syncWithCloud(true);
}

function updatePinUI() {
  const pinEl = document.getElementById('currentPinText');
  if (pinEl) pinEl.textContent = getSyncPin();
}

function updateSyncBadge(status) {
  const indicator = document.getElementById('syncStatusIndicator');
  const icon = document.getElementById('syncStatusIcon');
  const text = document.getElementById('syncStatusText');

  if (!indicator || !icon || !text) return;

  indicator.className = `sync-status-indicator ${status}`;

  if (status === 'syncing') {
    icon.className = 'sync-spin-icon';
    icon.textContent = '🔄';
    text.textContent = 'Eşitleniyor...';
  } else if (status === 'synced') {
    icon.className = '';
    icon.textContent = '☁️';
    text.textContent = 'Bulutla Eşitlendi';
  } else if (status === 'offline') {
    icon.className = '';
    icon.textContent = '📶';
    text.textContent = 'Çevrimdışı (Beklemede)';
  } else if (status === 'error') {
    icon.className = '';
    icon.textContent = '⚠️';
    text.textContent = 'Bağlantı Hatası';
  }
}

/**
 * Perform bi-directional smart sync with Firebase:
 * 1. Read cloud data
 * 2. Merge local + cloud based on updatedAt timestamps
 * 3. Save merged result to local storage
 * 4. Push final merged result back to cloud
 */
async function syncWithCloud(forcePull = false) {
  if (!navigator.onLine) {
    updateSyncBadge('offline');
    return;
  }

  if (isSyncing) return;
  isSyncing = true;
  updateSyncBadge('syncing');

  const pin = encodeURIComponent(getSyncPin());
  const endpoint = `${FIREBASE_DB_URL}/vaults/${pin}.json`;

  try {
    // 1. Fetch remote vault
    const response = await fetch(endpoint, { cache: 'no-store' });
    let remoteVault = null;
    if (response.ok) {
      remoteVault = await response.json();
    }

    const localItems = getStoredItems(true); // Include soft-deleted items for sync
    let mergedItems = [];

    if (!remoteVault || !Array.isArray(remoteVault.items)) {
      // First time initialization on cloud
      mergedItems = localItems;
    } else {
      // Merge local and remote items
      const itemMap = new Map();

      // Put remote items in map
      remoteVault.items.forEach(item => {
        if (item && item.id) itemMap.set(item.id, item);
      });

      // Overlay local items
      localItems.forEach(localItem => {
        if (!itemMap.has(localItem.id)) {
          itemMap.set(localItem.id, localItem);
        } else {
          const remoteItem = itemMap.get(localItem.id);
          const localTime = localItem.updatedAt || 0;
          const remoteTime = remoteItem.updatedAt || 0;

          // Later update wins
          if (localTime >= remoteTime) {
            itemMap.set(localItem.id, localItem);
          }
        }
      });

      mergedItems = Array.from(itemMap.values());
    }

    // Sort by createdAt descending
    mergedItems.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Save to local storage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedItems));

    // 2. Push final state back to Firebase
    await fetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: mergedItems,
        lastSync: Date.now(),
        updatedBy: navigator.userAgent
      })
    });

    renderItems();
    updateStats();
    updateSyncBadge('synced');
  } catch (err) {
    console.warn('[Sync] Network error during sync:', err);
    updateSyncBadge('error');
  } finally {
    isSyncing = false;
  }
}

function triggerDelayedSync() {
  if (!navigator.onLine) {
    updateSyncBadge('offline');
    return;
  }
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    syncWithCloud();
  }, 400);
}

// --- 5. Storage & Item Operations ---
const DEFAULT_ITEMS = [
  {
    id: 'demo-1',
    title: 'iPhone Ana Ekranına Ekle (Paylaş > Ana Ekrana Ekle)',
    type: 'todo',
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'demo-2',
    title: 'Uçak modunda internetsiz not ekle, internet gelince otomatik eşitlensin! ✈️',
    type: 'todo',
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'demo-3',
    title: 'PIN ile tüm cihazlarınız (iPhone, PC, tablet) canlı senkronize olur.',
    type: 'note',
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  }
];

function getStoredItems(includeDeleted = false) {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_ITEMS));
      return DEFAULT_ITEMS;
    }
    const parsed = JSON.parse(data);
    if (includeDeleted) return parsed;
    return parsed.filter(i => !i.deleted);
  } catch (e) {
    console.error('[Storage] Read error:', e);
    return [];
  }
}

function saveItemsLocally(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    updateStats();
  } catch (e) {
    console.error('[Storage] Save error:', e);
  }
}

let activeFilter = 'all';

function renderItems() {
  const items = getStoredItems(false);
  const listContainer = document.getElementById('itemsList');
  const emptyState = document.getElementById('emptyState');

  const filtered = items.filter(item => {
    if (activeFilter === 'all') return true;
    return item.type === activeFilter;
  });

  listContainer.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  filtered.forEach(item => {
    const card = document.createElement('div');
    card.className = `item-card ${item.completed ? 'completed' : ''}`;

    const typeLabels = {
      note: 'Not',
      todo: 'Görev',
      idea: 'Fikir'
    };

    const dateStr = new Date(item.createdAt).toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });

    card.innerHTML = `
      <button class="item-checkbox ${item.completed ? 'checked' : ''}" data-id="${item.id}" aria-label="Tamamla">
        <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
      </button>
      <div class="item-content">
        <div class="item-title">${escapeHtml(item.title)}</div>
        <div class="item-meta">
          <span class="item-badge ${item.type}">${typeLabels[item.type] || item.type}</span>
          <span>${dateStr}</span>
        </div>
      </div>
      <button class="item-delete-btn" data-delete-id="${item.id}" aria-label="Sil">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      </button>
    `;

    // Event listeners
    const checkbox = card.querySelector('.item-checkbox');
    checkbox.addEventListener('click', () => toggleItem(item.id));

    const deleteBtn = card.querySelector('.item-delete-btn');
    deleteBtn.addEventListener('click', () => deleteItem(item.id));

    listContainer.appendChild(card);
  });
}

function addItem(title, type) {
  if (!title.trim()) return;

  const allItems = getStoredItems(true);
  const newItem = {
    id: 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    title: title.trim(),
    type: type || 'note',
    completed: false,
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  };

  allItems.unshift(newItem);
  saveItemsLocally(allItems);
  renderItems();
  triggerDelayedSync();
}

function toggleItem(id) {
  const allItems = getStoredItems(true);
  const target = allItems.find(it => it.id === id);
  if (target) {
    target.completed = !target.completed;
    target.updatedAt = Date.now();
    saveItemsLocally(allItems);
    renderItems();
    triggerDelayedSync();
  }
}

function deleteItem(id) {
  const allItems = getStoredItems(true);
  const target = allItems.find(it => it.id === id);
  if (target) {
    // Soft delete with timestamp so deletion propagates to cloud & other devices
    target.deleted = true;
    target.updatedAt = Date.now();
    saveItemsLocally(allItems);
    renderItems();
    triggerDelayedSync();
  }
}

function updateStats() {
  const activeItems = getStoredItems(false);
  const totalCountEl = document.getElementById('statTotal');
  const pendingCountEl = document.getElementById('statPending');
  const cacheStatusEl = document.getElementById('statCache');

  if (totalCountEl) totalCountEl.textContent = activeItems.length;
  if (pendingCountEl) {
    const pending = activeItems.filter(i => i.type === 'todo' && !i.completed).length;
    pendingCountEl.textContent = pending;
  }
  if (cacheStatusEl) {
    cacheStatusEl.textContent = 'Aktif (SW)';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- 6. PIN Settings Modal Setup ---
function setupPinModal() {
  const modal = document.getElementById('pinModal');
  const openBtn = document.getElementById('openPinModalBtn');
  const closeBtn = document.getElementById('closePinModal');
  const cancelBtn = document.getElementById('cancelPinBtn');
  const saveBtn = document.getElementById('savePinBtn');
  const pinInput = document.getElementById('pinInput');

  function openModal() {
    pinInput.value = getSyncPin();
    modal.classList.add('active');
    pinInput.focus();
  }

  function closeModal() {
    modal.classList.remove('active');
  }

  function handleSave() {
    const val = pinInput.value.trim();
    if (val) {
      setSyncPin(val);
      closeModal();
    }
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  if (saveBtn) saveBtn.addEventListener('click', handleSave);

  if (pinInput) {
    pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSave();
      if (e.key === 'Escape') closeModal();
    });
  }

  // Click outside to close
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }
}

// --- 7. DOM Ready & Event Wiring ---
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupNetworkMonitoring();
  setupIosInstallBanner();
  setupPinModal();
  updatePinUI();
  renderItems();
  updateStats();

  // Initial cloud sync on load
  if (navigator.onLine) {
    syncWithCloud();
  }

  // Manual Sync button
  const manualSyncBtn = document.getElementById('manualSyncBtn');
  if (manualSyncBtn) {
    manualSyncBtn.addEventListener('click', () => {
      syncWithCloud(true);
    });
  }

  // Auto-sync when returning to app (Tab focus / iPhone unlock)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      syncWithCloud();
    }
  });

  // Periodic background check every 25 seconds if online
  setInterval(() => {
    if (navigator.onLine && document.visibilityState === 'visible') {
      syncWithCloud();
    }
  }, 25000);

  // Add Item form submit
  const addBtn = document.getElementById('addItemBtn');
  const inputTitle = document.getElementById('itemTitleInput');
  const selectType = document.getElementById('itemTypeSelect');

  function handleAdd() {
    const text = inputTitle.value;
    const type = selectType.value;
    if (text.trim()) {
      addItem(text, type);
      inputTitle.value = '';
      inputTitle.focus();
    }
  }

  addBtn.addEventListener('click', handleAdd);
  inputTitle.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      handleAdd();
    }
  });

  // Category filter tabs
  const filterTabs = document.querySelectorAll('.filter-tab');
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      renderItems();
    });
  });

  // Update Toast Button
  const updateBtn = document.getElementById('btnUpdateApp');
  if (updateBtn) {
    updateBtn.addEventListener('click', applyUpdate);
  }

  // Info Modal Toggle
  const infoBtn = document.getElementById('infoBtn');
  if (infoBtn) {
    infoBtn.addEventListener('click', () => {
      const banner = document.getElementById('iosInstallBanner');
      banner.classList.toggle('active');
    });
  }
});

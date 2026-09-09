/**
 * Leb - iOS & Offline PWA with Silent Realtime Cloud Sync
 * Features: Service Worker v2.1.0, Silent Firebase Sync, PIN Management, Leblebi UI
 */

// --- 1. Service Worker & Update Manager ---
let newWorker = null;

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((registration) => {
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
          console.error('[Leb] ServiceWorker registration error:', err);
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
      if (badge) badge.className = 'network-dot online';
      if (badgeText) badgeText.textContent = 'Çevrimiçi';
      if (offlineBanner) offlineBanner.classList.remove('active');
      // When connection is restored, silently sync
      syncWithCloud({ isManual: false });
    } else {
      if (badge) badge.className = 'network-dot offline';
      if (badgeText) badgeText.textContent = 'Çevrimdışı';
      if (offlineBanner) offlineBanner.classList.add('active');
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
  const dismissed = localStorage.getItem('leb_install_dismissed') === 'true';

  if (isIos && !isStandalone && !dismissed && banner) {
    banner.classList.add('active');
  }

  if (closeBtn && banner) {
    closeBtn.addEventListener('click', () => {
      banner.classList.remove('active');
      localStorage.setItem('leb_install_dismissed', 'true');
    });
  }
}

// --- 4. Cloud Sync Engine (Firebase Realtime Database) ---
const FIREBASE_DB_URL = 'https://leb1919-default-rtdb.firebaseio.com';
const STORAGE_KEY = 'leb_items_v2';
const PIN_KEY = 'leb_sync_pin_v2';
const DEFAULT_PIN = 'leb1919';

let isSyncing = false;
let syncQueued = false;

function getSyncPin() {
  return (localStorage.getItem(PIN_KEY) || DEFAULT_PIN).trim();
}

function setSyncPin(newPin) {
  const cleanPin = (newPin || DEFAULT_PIN).trim();
  localStorage.setItem(PIN_KEY, cleanPin);
  updatePinUI();
  syncWithCloud({ isManual: true });
}

function updatePinUI() {
  const pinEl = document.getElementById('currentPinText');
  if (pinEl) pinEl.textContent = getSyncPin();
}

/**
 * Calm, peaceful sync status update (No distracting animations)
 */
function updateSyncBadge(status) {
  const indicator = document.getElementById('syncStatusIndicator');
  const icon = document.getElementById('syncStatusIcon');
  const text = document.getElementById('syncStatusText');

  if (!indicator || !icon || !text) return;

  indicator.className = `sync-pill ${status}`;

  if (status === 'synced') {
    icon.className = '';
    icon.textContent = '☁️';
    text.textContent = 'Eşitlendi';
  } else if (status === 'offline') {
    icon.className = '';
    icon.textContent = '📶';
    text.textContent = 'Çevrimdışı';
  } else if (status === 'error') {
    icon.className = '';
    icon.textContent = '⚠️';
    text.textContent = 'Bağlantı Hatası';
  }
}

/**
 * Smart Bi-directional Silent Sync with Firebase
 */
async function syncWithCloud(options = {}) {
  const { isManual = false } = options;

  if (!navigator.onLine) {
    updateSyncBadge('offline');
    return;
  }

  if (isSyncing) {
    syncQueued = true;
    return;
  }

  isSyncing = true;

  // Spin the manual sync button only if user explicitly tapped it
  const manualBtn = document.getElementById('manualSyncBtn');
  if (isManual && manualBtn) {
    manualBtn.classList.add('sync-spin-icon');
  }

  const pin = encodeURIComponent(getSyncPin());
  const endpoint = `${FIREBASE_DB_URL}/vaults/${pin}.json`;

  try {
    // 1. Fetch remote data from Firebase
    const response = await fetch(endpoint, { cache: 'no-store' });
    let remoteVault = null;
    if (response.ok) {
      remoteVault = await response.json();
    }

    const localItems = getStoredItems(true); // Include soft-deleted items
    let mergedMap = new Map();

    // Add remote items to map
    if (remoteVault && Array.isArray(remoteVault.items)) {
      remoteVault.items.forEach(item => {
        if (item && item.id) {
          mergedMap.set(item.id, item);
        }
      });
    }

    // Merge local items
    localItems.forEach(localItem => {
      if (!mergedMap.has(localItem.id)) {
        mergedMap.set(localItem.id, localItem);
      } else {
        const remoteItem = mergedMap.get(localItem.id);
        const localTime = localItem.updatedAt || 0;
        const remoteTime = remoteItem.updatedAt || 0;
        if (localTime >= remoteTime) {
          mergedMap.set(localItem.id, localItem);
        }
      }
    });

    let mergedItems = Array.from(mergedMap.values());
    mergedItems.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Save locally
    localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedItems));

    // 2. Push unified state back to Firebase
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
    console.warn('[Leb Sync] Warning:', err);
    updateSyncBadge('error');
  } finally {
    isSyncing = false;
    if (isManual && manualBtn) {
      setTimeout(() => manualBtn.classList.remove('sync-spin-icon'), 500);
    }
    if (syncQueued) {
      syncQueued = false;
      setTimeout(() => syncWithCloud(), 300);
    }
  }
}

// --- 5. Storage & Item Management ---
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
    title: 'PIN ile tüm cihazlarınız (iPhone, PC, tablet) canlı senkronize olur. 🥜',
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

  if (!listContainer) return;

  const filtered = items.filter(item => {
    if (activeFilter === 'all') return true;
    return item.type === activeFilter;
  });

  listContainer.innerHTML = '';

  if (filtered.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

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

  // Instant silent cloud sync
  syncWithCloud();
}

function toggleItem(id) {
  const allItems = getStoredItems(true);
  const target = allItems.find(it => it.id === id);
  if (target) {
    target.completed = !target.completed;
    target.updatedAt = Date.now();
    saveItemsLocally(allItems);
    renderItems();
    syncWithCloud();
  }
}

function deleteItem(id) {
  const allItems = getStoredItems(true);
  const target = allItems.find(it => it.id === id);
  if (target) {
    target.deleted = true;
    target.updatedAt = Date.now();
    saveItemsLocally(allItems);
    renderItems();
    syncWithCloud();
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
    cacheStatusEl.textContent = 'OK';
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// --- 6. PIN Settings Modal ---
function setupPinModal() {
  const modal = document.getElementById('pinModal');
  const openBtn = document.getElementById('openPinModalBtn');
  const closeBtn = document.getElementById('closePinModal');
  const cancelBtn = document.getElementById('cancelPinBtn');
  const saveBtn = document.getElementById('savePinBtn');
  const pinInput = document.getElementById('pinInput');

  function openModal() {
    if (pinInput) pinInput.value = getSyncPin();
    if (modal) modal.classList.add('active');
    if (pinInput) pinInput.focus();
  }

  function closeModal() {
    if (modal) modal.classList.remove('active');
  }

  function handleSave() {
    if (pinInput) {
      const val = pinInput.value.trim();
      if (val) {
        setSyncPin(val);
        closeModal();
      }
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

  // Initial silent cloud sync
  if (navigator.onLine) {
    syncWithCloud();
  }

  // Manual "Eşitle" button
  const manualSyncBtn = document.getElementById('manualSyncBtn');
  if (manualSyncBtn) {
    manualSyncBtn.addEventListener('click', () => {
      syncWithCloud({ isManual: true });
    });
  }

  // Auto-sync on Tab Focus / iPhone unlock (Silent)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      syncWithCloud({ isManual: false });
    }
  });

  // Real-time silent live polling every 5 seconds when active
  setInterval(() => {
    if (navigator.onLine && document.visibilityState === 'visible') {
      syncWithCloud({ isManual: false });
    }
  }, 5000);

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

  if (addBtn) addBtn.addEventListener('click', handleAdd);
  if (inputTitle) {
    inputTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleAdd();
      }
    });
  }

  // Category filter capsules
  const filterTabs = document.querySelectorAll('.filter-pill');
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
      if (banner) banner.classList.toggle('active');
    });
  }
});

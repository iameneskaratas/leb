/**
 * Pocket Hub - iOS & Offline PWA Core Logic
 * Handles Service Worker, Network Events, Local Storage & iOS Installation
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
                // New update available
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
    } else {
      badge.className = 'network-badge offline';
      badgeText.textContent = 'Çevrimdışı';
      offlineBanner.classList.add('active');
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

  // Show banner only if iOS and not currently in standalone PWA mode
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

// --- 4. Offline Storage & Item Management ---
const STORAGE_KEY = 'pockethub_items_v1';

const DEFAULT_ITEMS = [
  {
    id: 'demo-1',
    title: 'iPhone Ana Ekranına Ekle (Paylaş > Ana Ekrana Ekle)',
    type: 'todo',
    completed: false,
    createdAt: new Date().toISOString()
  },
  {
    id: 'demo-2',
    title: 'Uçak modunu açıp bu uygulamayı internetsiz test et ✈️',
    type: 'todo',
    completed: false,
    createdAt: new Date().toISOString()
  },
  {
    id: 'demo-3',
    title: 'Bu veri tamamen cihazınızda (LocalStorage / Cache) saklanır, internete ihtiyaç duymaz.',
    type: 'note',
    completed: false,
    createdAt: new Date().toISOString()
  }
];

function getStoredItems() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_ITEMS));
      return DEFAULT_ITEMS;
    }
    return JSON.parse(data);
  } catch (e) {
    console.error('[Storage] Read error:', e);
    return [];
  }
}

function saveItems(items) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    updateStats();
  } catch (e) {
    console.error('[Storage] Save error:', e);
  }
}

let activeFilter = 'all';

function renderItems() {
  const items = getStoredItems();
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

  const items = getStoredItems();
  const newItem = {
    id: 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    title: title.trim(),
    type: type || 'note',
    completed: false,
    createdAt: new Date().toISOString()
  };

  items.unshift(newItem);
  saveItems(items);
  renderItems();
}

function toggleItem(id) {
  const items = getStoredItems();
  const target = items.find(it => it.id === id);
  if (target) {
    target.completed = !target.completed;
    saveItems(items);
    renderItems();
  }
}

function deleteItem(id) {
  const items = getStoredItems();
  const remaining = items.filter(it => it.id !== id);
  saveItems(remaining);
  renderItems();
}

function updateStats() {
  const items = getStoredItems();
  const totalCountEl = document.getElementById('statTotal');
  const pendingCountEl = document.getElementById('statPending');
  const cacheStatusEl = document.getElementById('statCache');

  if (totalCountEl) totalCountEl.textContent = items.length;
  if (pendingCountEl) {
    const pending = items.filter(i => i.type === 'todo' && !i.completed).length;
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

// --- 5. DOM Ready & Event Wiring ---
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupNetworkMonitoring();
  setupIosInstallBanner();
  renderItems();
  updateStats();

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

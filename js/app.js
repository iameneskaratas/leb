/**
 * Leb - Fleet & Driver Compliance Engine (v3.7.1)
 * Calm Palette, Zero Eye Strain, Deduplicated Cloud Sync,
 * Centered Custom Themed Calendar Modal
 */

// --- 1. Service Worker & Update Manager ---
let newWorker = null;

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js?v=3.7.1')
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
          console.error('[Leb] ServiceWorker error:', err);
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

// --- 2. Online / Offline Monitoring ---
function setupNetworkMonitoring() {
  function updateStatus() {
    const isOnline = navigator.onLine;
    updateSyncBadge(isOnline ? 'synced' : 'offline');
    if (isOnline) {
      syncWithCloud({ isManual: false });
    }
  }

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
}

// --- 3. Strict Mobile Detection ---
function isMobileDevice() {
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod|android/i.test(ua) || window.innerWidth <= 768;
}

// --- 4. Push & Local Notifications ---
function setupNotifications() {
  const banner = document.getElementById('mobileNotifBanner');
  const enableBtn = document.getElementById('btnEnableNotif');

  if (!('Notification' in window) || !isMobileDevice()) {
    if (banner) banner.style.display = 'none';
    return;
  }

  if (Notification.permission === 'default' && banner) {
    banner.style.display = 'flex';
  }

  if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
      try {
        const perm = await Notification.requestPermission();
        if (perm === 'granted') {
          if (banner) banner.style.display = 'none';
          triggerNotificationCheck(true);
        }
      } catch (e) {
        console.warn('[Notification] Error:', e);
      }
    });
  }
}

function triggerNotificationCheck(force = false) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const lastNotif = parseInt(localStorage.getItem('leb_last_notif_ts') || '0', 10);
  const now = Date.now();
  if (!force && (now - lastNotif < 6 * 3600 * 1000)) return;

  const records = getStoredRecords(false);
  const urgent = [];

  records.forEach(rec => {
    const urgency = calculateRecordUrgency(rec);
    if (urgency.minDays <= 15) {
      urgent.push({
        title: rec.title,
        label: urgency.label,
        text: urgency.text
      });
    }
  });

  if (urgent.length > 0) {
    localStorage.setItem('leb_last_notif_ts', String(now));
    const first = urgent[0];
    const notifTitle = `Leb: ${urgent.length} Kayıt Uyarı Veriyor!`;
    const notifBody = `${first.title} (${first.label}): ${first.text}` +
      (urgent.length > 1 ? ` ve ${urgent.length - 1} kayıt daha.` : '');

    try {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          title: notifTitle,
          body: notifBody
        });
      } else {
        new Notification(notifTitle, {
          body: notifBody,
          icon: 'icons/apple-touch-icon-180.png?v=3.3.0',
          badge: 'icons/favicon.png?v=3.3.0'
        });
      }
    } catch (e) {}
  }
}

// --- 5. Quiet Bottom Sync Engine with Robust Deduplication ---
const CLOUD_ENDPOINT = 'https://leb1919-default-rtdb.firebaseio.com/leb_store.json';
const STORAGE_KEY = 'leb_fleet_store_v3';

let isSyncing = false;
let syncQueued = false;
let lastRenderedHash = '';

function updateSyncBadge(status) {
  const dot = document.getElementById('syncStatusDot');
  const text = document.getElementById('syncStatusText');
  if (!dot || !text) return;

  dot.className = 'sync-dot';
  if (status === 'synced') {
    text.textContent = 'Bulutla Eşitlendi';
  } else if (status === 'offline') {
    dot.classList.add('offline');
    text.textContent = 'Çevrimdışı (Yerel)';
  } else if (status === 'error') {
    dot.classList.add('error');
    text.textContent = 'Bağlantı Uyarısı';
  }
}

/**
 * Deduplicate items by composite key (type + normalized title)
 */
function deduplicateItems(items) {
  if (!Array.isArray(items)) return [];
  const map = new Map();

  items.forEach(it => {
    if (!it || !it.title) return;
    const cleanKey = `${it.type}_${it.title.trim().toUpperCase()}`;
    const existing = map.get(cleanKey);
    if (!existing) {
      map.set(cleanKey, it);
    } else {
      // Keep the one with latest update or not deleted
      const exTime = existing.updatedAt || 0;
      const itTime = it.updatedAt || 0;
      if (itTime >= exTime) {
        map.set(cleanKey, it);
      }
    }
  });

  return Array.from(map.values());
}

function areItemListsEqual(listA, listB) {
  if (!Array.isArray(listA) || !Array.isArray(listB)) return false;
  if (listA.length !== listB.length) return false;

  const mapB = new Map();
  for (let i = 0; i < listB.length; i++) {
    const it = listB[i];
    if (it && it.id) mapB.set(it.id, it);
  }

  if (mapB.size !== listA.length) return false;

  for (let i = 0; i < listA.length; i++) {
    const a = listA[i];
    if (!a || !a.id) return false;
    const b = mapB.get(a.id);
    if (!b) return false;

    if (
      a.title !== b.title ||
      a.type !== b.type ||
      a.subType !== b.subType ||
      Boolean(a.deleted) !== Boolean(b.deleted) ||
      (a.updatedAt || 0) !== (b.updatedAt || 0) ||
      a.inspectionDate !== b.inspectionDate ||
      a.visaDate !== b.visaDate ||
      a.insuranceDate !== b.insuranceDate ||
      a.licenseDate !== b.licenseDate ||
      a.greenCardDate !== b.greenCardDate
    ) {
      return false;
    }
  }
  return true;
}

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

  const manualBtn = document.getElementById('manualSyncBtn');
  if (isManual && manualBtn) {
    manualBtn.classList.add('sync-spin-icon');
  }

  try {
    const response = await fetch(CLOUD_ENDPOINT, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });

    let remoteData = null;
    if (response.ok) {
      remoteData = await response.json();
    }

    const remoteRaw = (remoteData && Array.isArray(remoteData.items)) ? remoteData.items : [];
    const localRaw = getStoredRecords(true);

    // Merge and deduplicate by type + title
    const allCombined = [...remoteRaw, ...localRaw];
    const deduplicated = deduplicateItems(allCombined);

    const remoteNeedsUpdate = !areItemListsEqual(remoteRaw, deduplicated);

    if (remoteNeedsUpdate && !isMobileDevice()) {
      const payload = {
        items: deduplicated,
        lastSync: Date.now(),
        updatedBy: 'Leb v3.7.1 Clean'
      };

      await fetch(CLOUD_ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const localNeedsUpdate = !areItemListsEqual(localRaw, deduplicated);
    if (localNeedsUpdate) {
      saveRecordsLocally(deduplicated);
      renderCurrentView();
    }

    updateSyncBadge('synced');
  } catch (err) {
    console.warn('[Sync] Note:', err);
    updateSyncBadge('offline');
  } finally {
    isSyncing = false;
    if (manualBtn) {
      setTimeout(() => manualBtn.classList.remove('sync-spin-icon'), 300);
    }
    if (syncQueued) {
      syncQueued = false;
      syncWithCloud({ isManual: false });
    }
  }
}

// Periodic Background Sync (Every 30 seconds if active)
setInterval(() => {
  if (document.visibilityState === 'visible' && navigator.onLine) {
    syncWithCloud({ isManual: false });
  }
}, 30000);

// --- 6. Initial Clean Seed Data ---
function getFutureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const SEED_RECORDS = [
  {
    id: 'veh_1',
    type: 'vehicle',
    title: '34 LEB 1919',
    subType: 'Çekici',
    inspectionDate: getFutureDate(4),
    insuranceDate: getFutureDate(120),
    greenCardDate: getFutureDate(30),
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'veh_2',
    type: 'vehicle',
    title: '34 LEB 2023',
    subType: 'Dorse',
    inspectionDate: getFutureDate(18),
    insuranceDate: getFutureDate(200),
    greenCardDate: getFutureDate(18),
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'veh_3',
    type: 'vehicle',
    title: '34 TR 5500',
    subType: 'Otomobil',
    inspectionDate: getFutureDate(150),
    insuranceDate: getFutureDate(90),
    greenCardDate: null,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'drv_1',
    type: 'driver',
    title: 'Ahmet Yılmaz',
    subType: 'Kaptan Şoför',
    visaDate: getFutureDate(7),
    licenseDate: getFutureDate(260),
    passport: 'U14589210',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'drv_2',
    type: 'driver',
    title: 'Mehmet Kaya',
    subType: 'Kaptan Şoför',
    visaDate: getFutureDate(-2),
    licenseDate: getFutureDate(50),
    passport: 'U88231019',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'drv_3',
    type: 'driver',
    title: 'Ali Demir',
    subType: 'Kaptan Şoför',
    visaDate: getFutureDate(120),
    licenseDate: getFutureDate(310),
    passport: 'U99421102',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  }
];

// --- 7. Local Storage Operations ---
function getStoredRecords(includeDeleted = false) {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_RECORDS));
      return includeDeleted ? SEED_RECORDS : SEED_RECORDS.filter(r => !r.deleted);
    }
    let parsed = JSON.parse(data);
    parsed = deduplicateItems(parsed);
    if (includeDeleted) return parsed;
    return parsed.filter(r => !r.deleted);
  } catch (e) {
    console.error('[Storage] Read error:', e);
    return [];
  }
}

function saveRecordsLocally(records) {
  try {
    const deduped = deduplicateItems(records);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));
    updateStats();
  } catch (e) {
    console.error('[Storage] Save error:', e);
  }
}

// --- 8. Days Calculation & Urgency Engine ---
function getDaysRemaining(dateStr) {
  if (!dateStr) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const target = new Date(dateStr + 'T00:00:00');
  const diffTime = target.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 3600 * 24));
}

function calculateRecordUrgency(rec) {
  const dates = [];
  if (rec.type === 'vehicle') {
    if (rec.inspectionDate) dates.push({ label: 'Muayene', date: rec.inspectionDate });
    if (rec.insuranceDate) dates.push({ label: 'Sigorta', date: rec.insuranceDate });
    if (rec.greenCardDate) dates.push({ label: 'Yeşil Kart', date: rec.greenCardDate });
  } else {
    if (rec.visaDate) dates.push({ label: 'Vize', date: rec.visaDate });
    if (rec.licenseDate) dates.push({ label: 'Ehliyet', date: rec.licenseDate });
  }

  let minDays = Infinity;
  let mostUrgentLabel = '';

  dates.forEach(d => {
    const days = getDaysRemaining(d.date);
    if (days !== null && days < minDays) {
      minDays = days;
      mostUrgentLabel = d.label;
    }
  });

  if (minDays === Infinity) {
    return { status: 'safe', text: 'Tarih Yok', minDays: 999, label: '' };
  }

  if (minDays < 0) {
    return {
      status: 'critical',
      text: `${Math.abs(minDays)}G önce doldu`,
      minDays,
      label: mostUrgentLabel
    };
  }
  if (minDays === 0) {
    return {
      status: 'critical',
      text: 'Bugün Son Gün',
      minDays: 0,
      label: mostUrgentLabel
    };
  }
  if (minDays <= 7) {
    return {
      status: 'critical',
      text: `${minDays} gün kaldı`,
      minDays,
      label: mostUrgentLabel
    };
  }
  if (minDays <= 30) {
    return {
      status: 'warning',
      text: `${minDays} gün kaldı`,
      minDays,
      label: mostUrgentLabel
    };
  }
  return {
    status: 'safe',
    text: `${minDays} gün var`,
    minDays,
    label: mostUrgentLabel
  };
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const [year, month, day] = dateStr.split('-');
    const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    const mIdx = parseInt(month, 10) - 1;
    return `${parseInt(day, 10)} ${months[mIdx] || month} ${year}`;
  } catch (e) {
    return dateStr;
  }
}

// --- 9. App State & Filter Management ---
let currentSection = 'vehicles'; // 'vehicles' | 'drivers'
let currentStatFilter = 'all';    // 'all' | 'critical' | 'warning' | 'safe'
let currentSubFilter = 'all';     // 'all' | 'Çekici' | 'Dorse' | 'Otomobil'
let currentSearchQuery = '';

function setupSectionTabs() {
  const tabVehicles = document.getElementById('tabVehicles');
  const tabDrivers = document.getElementById('tabDrivers');
  const addBtnLabel = document.getElementById('addBtnLabel');
  const listContainer = document.getElementById('recordsList');

  function switchSection(target) {
    if (currentSection === target) return;
    currentSection = target;

    if (listContainer) {
      listContainer.classList.add('switching');
    }

    if (target === 'vehicles') {
      tabVehicles.classList.add('active');
      tabVehicles.setAttribute('aria-selected', 'true');
      tabDrivers.classList.remove('active');
      tabDrivers.setAttribute('aria-selected', 'false');
      if (addBtnLabel) addBtnLabel.textContent = 'Yeni Araç Ekle';
    } else {
      tabDrivers.classList.add('active');
      tabDrivers.setAttribute('aria-selected', 'true');
      tabVehicles.classList.remove('active');
      tabVehicles.setAttribute('aria-selected', 'false');
      if (addBtnLabel) addBtnLabel.textContent = 'Yeni Sürücü Ekle';
    }

    currentSubFilter = 'all';
    renderSubFilterPills();

    setTimeout(() => {
      renderCurrentView();
      if (listContainer) {
        requestAnimationFrame(() => {
          listContainer.classList.remove('switching');
        });
      }
    }, 120);
  }

  if (tabVehicles && tabDrivers) {
    tabVehicles.addEventListener('click', () => switchSection('vehicles'));
    tabDrivers.addEventListener('click', () => switchSection('drivers'));
  }
}

function renderSubFilterPills() {
  const container = document.getElementById('subFiltersTrack');
  if (!container) return;

  container.innerHTML = '';

  if (currentSection === 'vehicles') {
    container.style.display = 'flex';
    const pills = [
      { id: 'all', label: 'Tümü' },
      { id: 'Çekici', label: 'Çekici' },
      { id: 'Dorse', label: 'Dorse' },
      { id: 'Otomobil', label: 'Otomobil' }
    ];

    pills.forEach(pill => {
      const btn = document.createElement('button');
      btn.className = `filter-pill ${currentSubFilter === pill.id ? 'active' : ''}`;
      btn.textContent = pill.label;
      btn.dataset.sub = pill.id;
      btn.addEventListener('click', () => {
        currentSubFilter = pill.id;
        renderSubFilterPills();
        renderCurrentView();
      });
      container.appendChild(btn);
    });
  } else {
    // Sürücülerde alt kategoriye gerek yok
    container.style.display = 'none';
  }
}

function setupStatFilters() {
  const statCards = document.querySelectorAll('.leb-stat-card');
  statCards.forEach(card => {
    card.addEventListener('click', () => {
      const filter = card.dataset.filter;
      if (currentStatFilter === filter) {
        currentStatFilter = 'all';
      } else {
        currentStatFilter = filter;
      }
      statCards.forEach(c => {
        c.classList.toggle('active-stat', c.dataset.filter === currentStatFilter);
      });
      renderCurrentView();
    });
  });
}

function setupSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.trim().toLowerCase();
      if (clearBtn) clearBtn.style.display = currentSearchQuery ? 'block' : 'none';
      renderCurrentView();
    });
  }

  if (clearBtn && searchInput) {
    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      currentSearchQuery = '';
      clearBtn.style.display = 'none';
      searchInput.focus();
      renderCurrentView();
    });
  }

  const resetBtn = document.getElementById('btnResetFilters');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      currentStatFilter = 'all';
      currentSubFilter = 'all';
      currentSearchQuery = '';
      if (searchInput) searchInput.value = '';
      if (clearBtn) clearBtn.style.display = 'none';
      document.querySelectorAll('.leb-stat-card').forEach(c => {
        c.classList.toggle('active-stat', c.dataset.filter === 'all');
      });
      renderSubFilterPills();
      renderCurrentView();
    });
  }
}

// --- 10. Update Stats Summary Counters ---
function updateStats() {
  const records = getStoredRecords(false);

  const vehicleRecords = records.filter(r => r.type === 'vehicle');
  const driverRecords = records.filter(r => r.type === 'driver');

  const bVehicles = document.getElementById('badgeVehiclesCount');
  const bDrivers = document.getElementById('badgeDriversCount');
  if (bVehicles) bVehicles.textContent = String(vehicleRecords.length);
  if (bDrivers) bDrivers.textContent = String(driverRecords.length);

  const activeRecords = currentSection === 'vehicles' ? vehicleRecords : driverRecords;

  let total = activeRecords.length;
  let critical = 0;
  let warning = 0;
  let safe = 0;

  activeRecords.forEach(rec => {
    const urgency = calculateRecordUrgency(rec);
    if (urgency.status === 'critical') critical++;
    else if (urgency.status === 'warning') warning++;
    else safe++;
  });

  const elTotal = document.getElementById('statTotal');
  const elCrit = document.getElementById('statCritical');
  const elWarn = document.getElementById('statWarning');
  const elSafe = document.getElementById('statSafe');

  if (elTotal) elTotal.textContent = String(total);
  if (elCrit) elCrit.textContent = String(critical);
  if (elWarn) elWarn.textContent = String(warning);
  if (elSafe) elSafe.textContent = String(safe);
}

// --- 11. Render Clean Vertical Stacked List ---
function renderCurrentView() {
  updateStats();

  const container = document.getElementById('recordsList');
  const emptyState = document.getElementById('emptyState');
  if (!container) return;

  const records = getStoredRecords(false);

  // 1. Filter by Section (Araçlar vs Sürücüler)
  let list = records.filter(r => r.type === (currentSection === 'vehicles' ? 'vehicle' : 'driver'));

  // 2. Filter by SubType (Çekici, Dorse, Otomobil)
  if (currentSubFilter !== 'all') {
    list = list.filter(r => (r.subType || '') === currentSubFilter);
  }

  // 3. Filter by Stat (Critical, Warning, Safe)
  if (currentStatFilter !== 'all') {
    list = list.filter(r => {
      const u = calculateRecordUrgency(r);
      return u.status === currentStatFilter;
    });
  }

  // 4. Filter by Search Query
  if (currentSearchQuery) {
    list = list.filter(r => {
      const matchTitle = (r.title || '').toLowerCase().includes(currentSearchQuery);
      const matchType = (r.subType || '').toLowerCase().includes(currentSearchQuery);
      const matchNotes = (r.notes || '').toLowerCase().includes(currentSearchQuery);
      const matchPassport = (r.passport || '').toLowerCase().includes(currentSearchQuery);
      return matchTitle || matchType || matchNotes || matchPassport;
    });
  }

  // 5. Sort by Urgency (Most critical first)
  list.sort((a, b) => {
    const uA = calculateRecordUrgency(a).minDays;
    const uB = calculateRecordUrgency(b).minDays;
    return uA - uB;
  });

  // Layout hash to prevent unnecessary DOM redraws
  const renderSignature = JSON.stringify(list.map(r => ({
    id: r.id,
    title: r.title,
    subType: r.subType,
    updatedAt: r.updatedAt,
    u: calculateRecordUrgency(r).text
  })));

  if (renderSignature === lastRenderedHash && container.children.length === list.length) {
    return;
  }
  lastRenderedHash = renderSignature;

  container.innerHTML = '';

  if (list.length === 0) {
    if (emptyState) emptyState.style.display = 'block';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  const isMobile = isMobileDevice();

  list.forEach(rec => {
    const urgency = calculateRecordUrgency(rec);
    const row = document.createElement('div');
    row.className = 'leb-row-card';
    row.dataset.id = rec.id;

    let datesItems = [];
    if (rec.type === 'vehicle') {
      if (rec.inspectionDate) {
        datesItems.push(`
          <span class="date-item">
            <span class="date-name">Muayene:</span>
            <span class="date-val">${formatDisplayDate(rec.inspectionDate)}</span>
          </span>
        `);
      }
      if (rec.insuranceDate) {
        datesItems.push(`
          <span class="date-item">
            <span class="date-name">Sigorta:</span>
            <span class="date-val">${formatDisplayDate(rec.insuranceDate)}</span>
          </span>
        `);
      }
      if (rec.greenCardDate) {
        datesItems.push(`
          <span class="date-item">
            <span class="date-name">Yeşil Kart:</span>
            <span class="date-val">${formatDisplayDate(rec.greenCardDate)}</span>
          </span>
        `);
      }
    } else {
      if (rec.visaDate) {
        datesItems.push(`
          <span class="date-item">
            <span class="date-name">Vize:</span>
            <span class="date-val">${formatDisplayDate(rec.visaDate)}</span>
          </span>
        `);
      }
      if (rec.licenseDate) {
        datesItems.push(`
          <span class="date-item">
            <span class="date-name">Ehliyet:</span>
            <span class="date-val">${formatDisplayDate(rec.licenseDate)}</span>
          </span>
        `);
      }
      if (rec.passport) {
        datesItems.push(`
          <span class="date-item">
            <span class="date-name">Pasaport:</span>
            <span class="date-val">${escapeHtml(rec.passport)}</span>
          </span>
        `);
      }
    }

    const datesHtml = datesItems.join('<span class="date-bullet">•</span>');

    const actionButtonsHtml = isMobile ? '' : `
      <div class="card-actions">
        <button type="button" class="action-btn btn-quick-date" data-id="${rec.id}">
          Güncelle
        </button>
        <button type="button" class="action-btn action-btn-del btn-delete" data-id="${rec.id}" title="Sil">
          Sil
        </button>
      </div>
    `;

    const typePillHtml = rec.type === 'vehicle'
      ? `<span class="row-type-pill">${escapeHtml(rec.subType || 'Çekici')}</span>`
      : '';

    row.innerHTML = `
      <div class="row-top-mobile">
        <div class="row-identity">
          <span class="row-title">${escapeHtml(rec.title)}</span>
          ${typePillHtml}
        </div>
        <div class="row-right">
          <span class="urgency-badge badge-${urgency.status}">
            ${urgency.text}
          </span>
          ${actionButtonsHtml}
        </div>
      </div>
      <div class="row-dates">
        ${datesHtml}
      </div>
    `;

    container.appendChild(row);
  });

  // Attach event listeners to desktop actions
  if (!isMobile) {
    container.querySelectorAll('.btn-quick-date').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openQuickModal(btn.dataset.id);
      });
    });

    container.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteRecord(btn.dataset.id);
      });
    });
  }
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

// --- 12. Custom Themed Calendar Engine (Replaces Native Datepickers) ---
let activeCalFieldId = null;
let activeCalTriggerEl = null;
let calCurrentYear = new Date().getFullYear();
let calCurrentMonth = new Date().getMonth(); // 0-11
let isCalJumpMode = false;

const CAL_MONTHS_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
];

const CAL_MONTHS_SHORT_TR = [
  'Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz',
  'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'
];

function setCustomDate(fieldId, dateStr, fireChange = true) {
  const input = document.getElementById(fieldId);
  const display = document.getElementById('display_' + fieldId);
  const trigger = document.getElementById('trigger_' + fieldId);

  if (input) {
    input.value = dateStr || '';
    if (fireChange) {
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  if (display) {
    if (dateStr) {
      display.textContent = formatDisplayDate(dateStr);
      display.classList.remove('is-placeholder');
    } else {
      display.textContent = 'Tarih seçin...';
      display.classList.add('is-placeholder');
    }
  }

  if (trigger) {
    trigger.classList.remove('is-error');
  }
}

function openCalendarFor(fieldId, triggerEl) {
  activeCalFieldId = fieldId;
  activeCalTriggerEl = triggerEl;

  const input = document.getElementById(fieldId);
  const currentVal = input ? input.value : '';

  if (currentVal && /^\d{4}-\d{2}-\d{2}$/.test(currentVal)) {
    const [y, m] = currentVal.split('-').map(Number);
    calCurrentYear = y;
    calCurrentMonth = m - 1;
  } else {
    const today = new Date();
    calCurrentYear = today.getFullYear();
    calCurrentMonth = today.getMonth();
  }

  isCalJumpMode = false;
  const jumpView = document.getElementById('calJumpView');
  const daysView = document.getElementById('calDaysView');
  if (jumpView) jumpView.style.display = 'none';
  if (daysView) daysView.style.display = 'block';

  renderCalendarGrid();

  const popover = document.getElementById('lebCalendarPopover');
  const backdrop = document.getElementById('calBackdrop');
  if (!popover || !backdrop) return;

  popover.style.left = '';
  popover.style.top = '';
  backdrop.style.display = 'block';
  popover.style.display = 'block';
  if (triggerEl) triggerEl.classList.add('is-open');
}

function closeCalendar() {
  const popover = document.getElementById('lebCalendarPopover');
  const backdrop = document.getElementById('calBackdrop');
  if (popover) popover.style.display = 'none';
  if (backdrop) backdrop.style.display = 'none';

  if (activeCalTriggerEl) {
    activeCalTriggerEl.classList.remove('is-open');
  }
  activeCalFieldId = null;
  activeCalTriggerEl = null;
}

function renderCalendarGrid() {
  const titleBtn = document.getElementById('calMonthYearTitle');
  const grid = document.getElementById('calDaysGrid');
  if (!titleBtn || !grid) return;

  titleBtn.textContent = `${CAL_MONTHS_TR[calCurrentMonth]} ${calCurrentYear}`;
  grid.innerHTML = '';

  const input = activeCalFieldId ? document.getElementById(activeCalFieldId) : null;
  const selectedDateStr = input ? input.value : '';

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const daysInMonth = new Date(calCurrentYear, calCurrentMonth + 1, 0).getDate();
  const firstDay = new Date(calCurrentYear, calCurrentMonth, 1).getDay();
  const startDayIndex = (firstDay + 6) % 7;

  // Previous month days
  const prevMonthDays = new Date(calCurrentYear, calCurrentMonth, 0).getDate();
  for (let i = startDayIndex - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-day-cell is-other-month';
    cell.textContent = String(dayNum);
    cell.tabIndex = -1;
    cell.addEventListener('click', () => {
      calCurrentMonth--;
      if (calCurrentMonth < 0) {
        calCurrentMonth = 11;
        calCurrentYear--;
      }
      renderCalendarGrid();
    });
    grid.appendChild(cell);
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-day-cell';
    cell.textContent = String(day);

    const mStr = String(calCurrentMonth + 1).padStart(2, '0');
    const dStr = String(day).padStart(2, '0');
    const fullDateStr = `${calCurrentYear}-${mStr}-${dStr}`;

    if (fullDateStr === selectedDateStr) {
      cell.classList.add('is-selected');
    }
    if (fullDateStr === todayStr) {
      cell.classList.add('is-today');
    }

    cell.addEventListener('click', () => {
      if (activeCalFieldId) {
        setCustomDate(activeCalFieldId, fullDateStr);
      }
      closeCalendar();
    });

    grid.appendChild(cell);
  }

  // Next month days to fill grid
  const totalCells = grid.children.length;
  const remainingCells = totalCells > 35 ? (42 - totalCells) : (35 - totalCells);
  for (let nextDay = 1; nextDay <= remainingCells; nextDay++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-day-cell is-other-month';
    cell.textContent = String(nextDay);
    cell.tabIndex = -1;
    cell.addEventListener('click', () => {
      calCurrentMonth++;
      if (calCurrentMonth > 11) {
        calCurrentMonth = 0;
        calCurrentYear++;
      }
      renderCalendarGrid();
    });
    grid.appendChild(cell);
  }
}

function setupCalendarPopoverEvents() {
  const prevMonthBtn = document.getElementById('calPrevMonth');
  const nextMonthBtn = document.getElementById('calNextMonth');
  const prevYearBtn = document.getElementById('calPrevYear');
  const nextYearBtn = document.getElementById('calNextYear');
  const titleBtn = document.getElementById('calMonthYearTitle');
  const clearBtn = document.getElementById('calBtnClear');
  const todayBtn = document.getElementById('calBtnToday');
  const doneBtn = document.getElementById('calBtnDone');
  const backdrop = document.getElementById('calBackdrop');
  const jumpView = document.getElementById('calJumpView');
  const daysView = document.getElementById('calDaysView');

  if (prevMonthBtn) {
    prevMonthBtn.addEventListener('click', () => {
      calCurrentMonth--;
      if (calCurrentMonth < 0) {
        calCurrentMonth = 11;
        calCurrentYear--;
      }
      renderCalendarGrid();
    });
  }

  if (nextMonthBtn) {
    nextMonthBtn.addEventListener('click', () => {
      calCurrentMonth++;
      if (calCurrentMonth > 11) {
        calCurrentMonth = 0;
        calCurrentYear++;
      }
      renderCalendarGrid();
    });
  }

  if (prevYearBtn) {
    prevYearBtn.addEventListener('click', () => {
      calCurrentYear--;
      renderCalendarGrid();
      if (isCalJumpMode) renderJumpView();
    });
  }

  if (nextYearBtn) {
    nextYearBtn.addEventListener('click', () => {
      calCurrentYear++;
      renderCalendarGrid();
      if (isCalJumpMode) renderJumpView();
    });
  }

  if (titleBtn) {
    titleBtn.addEventListener('click', () => {
      isCalJumpMode = !isCalJumpMode;
      if (jumpView && daysView) {
        jumpView.style.display = isCalJumpMode ? 'flex' : 'none';
        daysView.style.display = isCalJumpMode ? 'none' : 'block';
      }
      if (isCalJumpMode) renderJumpView();
    });
  }

  function renderJumpView() {
    const monthsContainer = document.getElementById('calJumpMonths');
    const yearsContainer = document.getElementById('calJumpYears');
    if (!monthsContainer || !yearsContainer) return;

    monthsContainer.innerHTML = '';
    CAL_MONTHS_SHORT_TR.forEach((mName, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `jump-cell ${idx === calCurrentMonth ? 'active' : ''}`;
      btn.textContent = mName;
      btn.addEventListener('click', () => {
        calCurrentMonth = idx;
        isCalJumpMode = false;
        if (jumpView) jumpView.style.display = 'none';
        if (daysView) daysView.style.display = 'block';
        renderCalendarGrid();
      });
      monthsContainer.appendChild(btn);
    });

    yearsContainer.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let yr = currentYear - 2; yr <= currentYear + 8; yr++) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `jump-cell ${yr === calCurrentYear ? 'active' : ''}`;
      btn.textContent = String(yr);
      btn.addEventListener('click', () => {
        calCurrentYear = yr;
        isCalJumpMode = false;
        if (jumpView) jumpView.style.display = 'none';
        if (daysView) daysView.style.display = 'block';
        renderCalendarGrid();
      });
      yearsContainer.appendChild(btn);
    }
  }

  // Presets inside calendar popover
  document.querySelectorAll('.cal-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!activeCalFieldId) return;
      const preset = btn.dataset.preset;
      const d = new Date();
      if (preset === '6m') d.setMonth(d.getMonth() + 6);
      else if (preset === '1y') d.setFullYear(d.getFullYear() + 1);
      else if (preset === '2y') d.setFullYear(d.getFullYear() + 2);
      setCustomDate(activeCalFieldId, d.toISOString().split('T')[0]);
      closeCalendar();
    });
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (activeCalFieldId) setCustomDate(activeCalFieldId, '');
      closeCalendar();
    });
  }

  if (todayBtn) {
    todayBtn.addEventListener('click', () => {
      if (activeCalFieldId) {
        setCustomDate(activeCalFieldId, new Date().toISOString().split('T')[0]);
      }
      closeCalendar();
    });
  }

  if (doneBtn) doneBtn.addEventListener('click', closeCalendar);
  if (backdrop) backdrop.addEventListener('click', closeCalendar);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCalendar();
  });
}

function initCustomDatePickers() {
  document.querySelectorAll('.leb-date-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const fieldId = trigger.dataset.field;
      if (fieldId) openCalendarFor(fieldId, trigger);
    });
  });

  setupCalendarPopoverEvents();
}

// --- 13. Desktop Modals & Quick Date Handlers ---
let activeQuickRecordId = null;

function setupQuickPresetChips() {
  // Preset chips in Add Modal
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const targetId = chip.dataset.target;
      const months = parseInt(chip.dataset.months, 10);
      if (targetId && months) {
        const d = new Date();
        d.setMonth(d.getMonth() + months);
        setCustomDate(targetId, d.toISOString().split('T')[0]);
      }
    });
  });
}

function setupModals() {
  const openAddBtn = document.getElementById('openAddModalBtn');
  const addModal = document.getElementById('addModal');
  const closeAddBtn = document.getElementById('closeAddModalBtn');
  const cancelVehicleBtn = document.getElementById('cancelVehicleBtn');
  const cancelDriverBtn = document.getElementById('cancelDriverBtn');

  const switchVehicle = document.getElementById('modalSwitchVehicle');
  const switchDriver = document.getElementById('modalSwitchDriver');
  const vehicleForm = document.getElementById('vehicleForm');
  const driverForm = document.getElementById('driverForm');

  // Themed Segmented Buttons for Vehicle Type
  const vTypeBtns = document.querySelectorAll('#vehicleTypeTrack .type-segment-btn');
  const selectVType = document.getElementById('selectVehicleType');
  vTypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      vTypeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (selectVType) selectVType.value = btn.dataset.val;
    });
  });

  if (isMobileDevice()) {
    if (openAddBtn) openAddBtn.style.display = 'none';
    return;
  }

  function openAddModal() {
    if (addModal) {
      addModal.classList.add('active');
      if (currentSection === 'vehicles') {
        activateModalTab('vehicle');
      } else {
        activateModalTab('driver');
      }
    }
  }

  function closeAddModal() {
    if (addModal) {
      addModal.classList.remove('active');
      if (vehicleForm) vehicleForm.reset();
      if (driverForm) driverForm.reset();
      if (selectVType) selectVType.value = 'Çekici';
      vTypeBtns.forEach((b, idx) => b.classList.toggle('active', idx === 0));

      setCustomDate('inputInspectionDate', '');
      setCustomDate('inputInsuranceDate', '');
      setCustomDate('inputGreenCardDate', '');
      setCustomDate('inputVisaDate', '');
      setCustomDate('inputLicenseDate', '');
      closeCalendar();
    }
  }

  function activateModalTab(type) {
    if (type === 'vehicle') {
      if (switchVehicle) switchVehicle.classList.add('active');
      if (switchDriver) switchDriver.classList.remove('active');
      if (vehicleForm) vehicleForm.style.display = 'flex';
      if (driverForm) driverForm.style.display = 'none';
    } else {
      if (switchDriver) switchDriver.classList.add('active');
      if (switchVehicle) switchVehicle.classList.remove('active');
      if (driverForm) driverForm.style.display = 'flex';
      if (vehicleForm) vehicleForm.style.display = 'none';
    }
  }

  if (openAddBtn) openAddBtn.addEventListener('click', openAddModal);
  if (closeAddBtn) closeAddBtn.addEventListener('click', closeAddModal);
  if (cancelVehicleBtn) cancelVehicleBtn.addEventListener('click', closeAddModal);
  if (cancelDriverBtn) cancelDriverBtn.addEventListener('click', closeAddModal);

  if (switchVehicle) switchVehicle.addEventListener('click', () => activateModalTab('vehicle'));
  if (switchDriver) switchDriver.addEventListener('click', () => activateModalTab('driver'));

  // Vehicle Form Submit
  if (vehicleForm) {
    vehicleForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const plate = document.getElementById('inputPlate').value.trim().toUpperCase();
      const vType = (selectVType && selectVType.value) || 'Çekici';
      const inspDate = document.getElementById('inputInspectionDate').value;
      const insDate = document.getElementById('inputInsuranceDate').value || null;
      const greenDate = document.getElementById('inputGreenCardDate').value || null;

      if (!plate) {
        document.getElementById('inputPlate').focus();
        return;
      }

      if (!inspDate) {
        const trig = document.getElementById('trigger_inputInspectionDate');
        if (trig) {
          trig.classList.add('is-error');
          trig.focus();
        }
        return;
      }

      const newRec = {
        id: 'veh_' + Date.now(),
        type: 'vehicle',
        title: plate,
        subType: vType,
        inspectionDate: inspDate,
        insuranceDate: insDate,
        greenCardDate: greenDate,
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        deleted: false
      };

      const records = getStoredRecords(true);
      records.unshift(newRec);
      saveRecordsLocally(records);
      closeAddModal();
      renderCurrentView();
      syncWithCloud({ isManual: false });
    });
  }

  // Driver Form Submit
  if (driverForm) {
    driverForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('inputDriverName').value.trim();
      const visaDate = document.getElementById('inputVisaDate').value;
      const licDate = document.getElementById('inputLicenseDate').value || null;
      const passport = document.getElementById('inputPassport').value.trim();

      if (!name) {
        document.getElementById('inputDriverName').focus();
        return;
      }

      if (!visaDate) {
        const trig = document.getElementById('trigger_inputVisaDate');
        if (trig) {
          trig.classList.add('is-error');
          trig.focus();
        }
        return;
      }

      const newRec = {
        id: 'drv_' + Date.now(),
        type: 'driver',
        title: name,
        subType: 'Kaptan Şoför',
        visaDate: visaDate,
        licenseDate: licDate,
        passport: passport || '',
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        deleted: false
      };

      const records = getStoredRecords(true);
      records.unshift(newRec);
      saveRecordsLocally(records);
      closeAddModal();
      renderCurrentView();
      syncWithCloud({ isManual: false });
    });
  }

  // Quick Modal Controls
  const quickModal = document.getElementById('quickModal');
  const closeQuickBtn = document.getElementById('closeQuickModalBtn');
  const cancelQuickBtn = document.getElementById('cancelQuickBtn');
  const saveQuickBtn = document.getElementById('saveQuickBtn');
  const quickDateInput = document.getElementById('quickDateInput');
  const quickDatePreview = document.getElementById('quickDatePreview');

  function closeQuickModal() {
    if (quickModal) quickModal.classList.remove('active');
    activeQuickRecordId = null;
    closeCalendar();
  }

  if (closeQuickBtn) closeQuickBtn.addEventListener('click', closeQuickModal);
  if (cancelQuickBtn) cancelQuickBtn.addEventListener('click', closeQuickModal);

  function updateQuickPreview() {
    if (quickDatePreview && quickDateInput && quickDateInput.value) {
      quickDatePreview.textContent = `Yeni Tarih: ${formatDisplayDate(quickDateInput.value)}`;
    }
  }

  if (quickDateInput) {
    quickDateInput.addEventListener('input', updateQuickPreview);
  }

  // Quick Modal Preset buttons
  const presets = document.querySelectorAll('.preset-pill');
  presets.forEach(p => {
    p.addEventListener('click', () => {
      presets.forEach(x => x.classList.remove('active'));
      p.classList.add('active');
      const months = parseInt(p.dataset.months, 10);
      const d = new Date();
      d.setMonth(d.getMonth() + months);
      setCustomDate('quickDateInput', d.toISOString().split('T')[0]);
      updateQuickPreview();
    });
  });

  if (saveQuickBtn) {
    saveQuickBtn.addEventListener('click', () => {
      if (!activeQuickRecordId) return;
      const field = document.getElementById('quickFieldSelect').value;
      const dateVal = document.getElementById('quickDateInput').value;

      if (!dateVal) {
        const trig = document.getElementById('trigger_quickDateInput');
        if (trig) {
          trig.classList.add('is-error');
          trig.focus();
        }
        return;
      }

      const records = getStoredRecords(true);
      const rec = records.find(r => r.id === activeQuickRecordId);
      if (rec) {
        rec[field] = dateVal;
        rec.updatedAt = Date.now();
        saveRecordsLocally(records);
        closeQuickModal();
        renderCurrentView();
        syncWithCloud({ isManual: false });
      }
    });
  }
}

function openQuickModal(id) {
  if (isMobileDevice()) return;

  const records = getStoredRecords(false);
  const rec = records.find(r => r.id === id);
  if (!rec) return;

  activeQuickRecordId = id;
  const quickModal = document.getElementById('quickModal');
  const titleEl = document.getElementById('quickRecordTitle');
  const trackEl = document.getElementById('quickDocTypeTrack');
  const hiddenFieldInput = document.getElementById('quickFieldSelect');
  const dateInput = document.getElementById('quickDateInput');
  const previewEl = document.getElementById('quickDatePreview');

  if (titleEl) {
    titleEl.textContent = `${rec.title}${rec.type === 'vehicle' && rec.subType ? ' • ' + rec.subType : ''}`;
  }

  // Options according to type
  let docOptions = [];
  if (rec.type === 'vehicle') {
    docOptions = [
      { field: 'inspectionDate', label: 'Muayene' },
      { field: 'insuranceDate', label: 'Sigorta' },
      { field: 'greenCardDate', label: 'Yeşil Sigorta' }
    ];
  } else {
    docOptions = [
      { field: 'visaDate', label: 'Vize' },
      { field: 'licenseDate', label: 'Ehliyet / SRC' }
    ];
  }

  function setQuickField(field) {
    if (hiddenFieldInput) hiddenFieldInput.value = field;
    if (trackEl) {
      trackEl.querySelectorAll('.type-segment-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.field === field);
      });
    }
    if (rec[field]) {
      setCustomDate('quickDateInput', rec[field]);
      if (previewEl) previewEl.textContent = `Mevcut: ${formatDisplayDate(rec[field])}`;
    } else {
      const defaultDate = new Date();
      defaultDate.setFullYear(defaultDate.getFullYear() + 1);
      const defStr = defaultDate.toISOString().split('T')[0];
      setCustomDate('quickDateInput', defStr);
      if (previewEl) previewEl.textContent = `Yeni Tarih: ${formatDisplayDate(defStr)}`;
    }
  }

  if (trackEl) {
    trackEl.innerHTML = '';
    docOptions.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `type-segment-btn ${idx === 0 ? 'active' : ''}`;
      btn.dataset.field = opt.field;
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        setQuickField(opt.field);
      });
      trackEl.appendChild(btn);
    });
  }

  const initialField = docOptions[0].field;
  setQuickField(initialField);

  if (quickModal) quickModal.classList.add('active');
}

function deleteRecord(id) {
  if (isMobileDevice()) return;
  const records = getStoredRecords(true);
  const rec = records.find(r => r.id === id);
  if (!rec) return;

  if (confirm(`"${rec.title}" kaydını silmek istediğinize emin misiniz?`)) {
    rec.deleted = true;
    rec.updatedAt = Date.now();
    saveRecordsLocally(records);
    renderCurrentView();
    syncWithCloud({ isManual: false });
  }
}

// Dynamic Header Scroll Blur (Only blurs when scrolled, completely clear at top)
function setupHeaderScroll() {
  const header = document.querySelector('.leb-header');
  if (!header) return;

  const handleScroll = () => {
    if (window.scrollY > 8) {
      header.classList.add('is-scrolled');
    } else {
      header.classList.remove('is-scrolled');
    }
  };

  window.addEventListener('scroll', handleScroll, { passive: true });
  handleScroll();
}

// --- 13. Initialization Lifecycle ---
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupNetworkMonitoring();
  setupNotifications();
  setupHeaderScroll();
  setupSectionTabs();
  renderSubFilterPills();
  setupStatFilters();
  setupSearch();
  setupModals();
  setupQuickPresetChips();
  initCustomDatePickers();

  // Initial local render
  renderCurrentView();

  // Manual sync button
  const manualBtn = document.getElementById('manualSyncBtn');
  if (manualBtn) {
    manualBtn.addEventListener('click', () => syncWithCloud({ isManual: true }));
  }

  // Update app toast button
  const updateBtn = document.getElementById('btnUpdateApp');
  if (updateBtn) {
    updateBtn.addEventListener('click', applyUpdate);
  }

  // Fetch remote clean data
  syncWithCloud({ isManual: false });

  // Mobile notification check
  setTimeout(() => triggerNotificationCheck(false), 2000);
});

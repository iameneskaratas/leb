/**
 * Leb - Fleet & Driver Compliance Engine (v4.8.0)
 * Calm Palette, Zero Eye Strain, Instant Hard Delete,
 * Realtime SSE Cloud Sync, Mobile Deletion Mirroring, Mobile Pull-to-Refresh,
 * Scheduled Compliance Notifications (15-Day Milestone & 7-Day 10 AM Daily)
 */

// --- 1. Service Worker & Update Manager ---
let newWorker = null;

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js?v=4.9.6')
        .catch((err) => {
          console.warn('[Leb] ServiceWorker register note:', err);
        });

      let refreshing = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
          refreshing = true;
          const baseUrl = window.location.href.split('?')[0].split('#')[0];
          window.location.replace(`${baseUrl}?v=${Date.now()}`);
        }
      });
    });
  }
}

// --- 2. Online / Offline Monitoring ---
function setupNetworkMonitoring() {
  // Managed by setupLifecycleSync
}

// --- 3. Strict Mobile Detection ---
function isMobileDevice() {
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod|android/i.test(ua) || window.innerWidth <= 768;
}

// --- 5. Realtime Cloud Sync Engine (Firebase RTDB + SSE + Instant Deletion Mirror) ---
const CLOUD_ENDPOINT = 'https://leb1919-default-rtdb.firebaseio.com/leb_store.json';
const STORAGE_KEY = 'leb_fleet_store_v8';
const DELETED_IDS_KEY = 'leb_deleted_ids_permanent';

// Migrate all past deleted IDs into permanent registry so deleted records NEVER return!
try {
  const legacyKeys = ['leb_deleted_ids', 'leb_deleted_ids_v7', 'leb_deleted_ids_v8'];
  let permanent = JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || '[]');
  legacyKeys.forEach(k => {
    try {
      const arr = JSON.parse(localStorage.getItem(k) || '[]');
      if (Array.isArray(arr) && arr.length > 0) {
        permanent = Array.from(new Set([...permanent, ...arr]));
      }
    } catch (e) {}
  });
  localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(permanent.slice(-1000)));
} catch (e) {}

let isSyncing = false;
let syncQueued = false;
let lastRenderedHash = '';
let sseSource = null;

// --- Global & Local Deleted Registry ---
function markRecordDeletedLocally(id) {
  if (!id) return;
  try {
    const deletedIds = JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || '[]');
    if (!deletedIds.includes(id)) {
      deletedIds.push(id);
      localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(deletedIds.slice(-1000)));
    }
  } catch (e) {}
}

function getDeletedIdsSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || '[]'));
  } catch (e) {
    return new Set();
  }
}

// --- Turkish Character Normalization & Collation Helpers ---
function toTurkishUpper(str) {
  if (!str) return '';
  return str.toString().toLocaleUpperCase('tr-TR');
}

function toTurkishLower(str) {
  if (!str) return '';
  return str.toString().toLocaleLowerCase('tr-TR');
}

function compareTurkish(a, b) {
  return (a || '').localeCompare(b || '', 'tr-TR', { sensitivity: 'base' });
}

function normalizeTurkishSearch(text) {
  if (!text) return '';
  return text
    .toString()
    .toLocaleLowerCase('tr-TR')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
}

function showToast() {
  // Silent - all toast popups completely suppressed for calm clean UX
}

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
 * Auto-clean records:
 * 1. Removes corrupt entries (empty titles)
 * 2. Filters out deleted items and blacklisted IDs
 */
function cleanGarbageRecords(items) {
  if (!Array.isArray(items)) return [];
  const deletedIds = getDeletedIdsSet();

  return items.filter(it => {
    if (!it || typeof it !== 'object') return false;
    if (!it.id || !it.title || !it.title.trim()) return false;
    if (it.deleted === true) return false;
    if (deletedIds.has(it.id)) return false;
    return true;
  });
}

/**
 * Deduplicate items by type and title
 */
function deduplicateItems(items) {
  if (!Array.isArray(items)) return [];
  const map = new Map();

  items.forEach(it => {
    if (!it || !it.title) return;
    if (it.deleted === true) return;
    const cleanKey = `${it.type}_${toTurkishUpper(it.title.trim())}`;
    const existing = map.get(cleanKey);
    if (!existing) {
      map.set(cleanKey, it);
    } else {
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
      a.greenCardDate !== b.greenCardDate ||
      a.roderDate !== b.roderDate ||
      a.takoTuvDate !== b.takoTuvDate ||
      a.passportDate !== b.passportDate ||
      a.passport !== b.passport ||
      (a.notes || '') !== (b.notes || '') ||
      Boolean(a.appointmentTaken) !== Boolean(b.appointmentTaken)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Pushes clean state to Firebase RTDB (used on PC by Admin)
 */
async function pushToCloud(records) {
  if (!navigator.onLine) {
    updateSyncBadge('offline');
    return;
  }
  try {
    const cleanList = cleanGarbageRecords(deduplicateItems(records));
    const deletedList = Array.from(getDeletedIdsSet());
    const payload = {
      items: cleanList,
      deletedIds: deletedList,
      lastSync: Date.now(),
      updatedBy: 'Leb v4.4.0 Realtime Engine'
    };
    await fetch(CLOUD_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    updateSyncBadge('synced');
  } catch (e) {
    console.warn('[PushToCloud] Error:', e);
    updateSyncBadge('offline');
  }
}

/**
 * Processes incoming payload from Firebase RTDB (via GET or EventSource SSE)
 */
function handleRemoteDataPayload(remoteData) {
  if (!remoteData || typeof remoteData !== 'object') return;

  const remoteRaw = Array.isArray(remoteData.items)
    ? remoteData.items
    : (remoteData.items && typeof remoteData.items === 'object')
      ? Object.values(remoteData.items)
      : [];
  const remoteDeletedIds = Array.isArray(remoteData.deletedIds)
    ? remoteData.deletedIds
    : (remoteData.deletedIds && typeof remoteData.deletedIds === 'object')
      ? Object.values(remoteData.deletedIds)
      : [];

  // Ingest deleted IDs from cloud into local permanent registry
  if (remoteDeletedIds.length > 0) {
    try {
      const localDeleted = JSON.parse(localStorage.getItem(DELETED_IDS_KEY) || '[]');
      const combined = Array.from(new Set([...localDeleted, ...remoteDeletedIds])).slice(-1000);
      localStorage.setItem(DELETED_IDS_KEY, JSON.stringify(combined));
    } catch (e) {}
  }

  const cleanRemote = cleanGarbageRecords(remoteRaw);

  if (isMobileDevice()) {
    // MOBILE: Pure viewer! Always mirrors cloud state directly
    saveRecordsLocally(cleanRemote);
    lastRenderedHash = '';
    renderCurrentView();
  } else {
    // DESKTOP: Check if there are newly added items offline that are not yet in cloud and not deleted
    const localRaw = getStoredRecords(true);
    const remoteIdSet = new Set(cleanRemote.map(r => r.id));
    const deletedSet = getDeletedIdsSet();
    const locallyAdded = localRaw.filter(r => !remoteIdSet.has(r.id) && !deletedSet.has(r.id));

    if (locallyAdded.length > 0) {
      const merged = cleanGarbageRecords(deduplicateItems([...cleanRemote, ...locallyAdded]));
      saveRecordsLocally(merged);
      lastRenderedHash = '';
      renderCurrentView();
      pushToCloud(merged);
    } else {
      saveRecordsLocally(cleanRemote);
      lastRenderedHash = '';
      renderCurrentView();
    }
  }

  updateSyncBadge('synced');
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
  if (manualBtn) {
    manualBtn.classList.add('sync-spin-icon');
  }

  try {
    const response = await fetch(CLOUD_ENDPOINT, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
    });

    if (response.ok) {
      const remoteData = await response.json();
      if (remoteData) {
        handleRemoteDataPayload(remoteData);
      }
    }
    updateSyncBadge('synced');
  } catch (err) {
    console.warn('[Sync] Note:', err);
    updateSyncBadge('offline');
  } finally {
    isSyncing = false;
    if (manualBtn) {
      setTimeout(() => manualBtn.classList.remove('sync-spin-icon'), 350);
    }
    if (syncQueued) {
      syncQueued = false;
      syncWithCloud({ isManual: false });
    }
  }
}

/**
 * Realtime EventSource (SSE) listener:
 * When PC updates or deletes a record, Firebase sends an instant push event
 * to all open mobile apps in < 200ms without needing manual refresh.
 */
function setupRealtimeSync() {
  if (!window.EventSource) return;

  if (sseSource) {
    try { sseSource.close(); } catch(e) {}
    sseSource = null;
  }

  try {
    sseSource = new EventSource(CLOUD_ENDPOINT);

    sseSource.addEventListener('put', (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (!msg) return;
        if (msg.path === '/' && msg.data) {
          handleRemoteDataPayload(msg.data);
        } else if (msg.path === '/items' && Array.isArray(msg.data)) {
          handleRemoteDataPayload({ items: msg.data });
        } else {
          syncWithCloud({ isManual: false });
        }
      } catch (err) {
        console.warn('[SSE] Parse err:', err);
      }
    });

    sseSource.addEventListener('patch', () => {
      syncWithCloud({ isManual: false });
    });

    sseSource.onerror = () => {
      // EventSource auto-reconnects
    };
  } catch (err) {
    console.warn('[SSE] Init err:', err);
  }
}

/**
 * Lifecycle triggers:
 * Screen unlock, switching back to PWA/browser, tab focus, online events
 */
function setupLifecycleSync() {
  function onResume() {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      if (!sseSource || sseSource.readyState === 2) {
        setupRealtimeSync();
      }
      lastRenderedHash = '';
      syncWithCloud({ isManual: false });
    }
  }

  document.addEventListener('visibilitychange', onResume);
  window.addEventListener('focus', onResume);
  window.addEventListener('pageshow', onResume);
  window.addEventListener('online', () => {
    updateSyncBadge('synced');
    setupRealtimeSync();
    lastRenderedHash = '';
    syncWithCloud({ isManual: false });
  });
  window.addEventListener('offline', () => {
    updateSyncBadge('offline');
  });

  // Regular safety poll every 5 seconds when tab is active
  setInterval(onResume, 5000);
}

/**
 * Wallpaper Theme Engine (Desert Night & Glassmorphism)
 * Persisted preference in localStorage, mobile & desktop optimized
 */
const THEME_STORAGE_KEY = 'leb_wallpaper_theme';

function applyTheme(themeMode) {
  const isWallpaper = themeMode === 'wallpaper';
  document.documentElement.classList.toggle('theme-wallpaper', isWallpaper);
  document.body.classList.toggle('theme-wallpaper', isWallpaper);

  const toggleBtn = document.getElementById('btnThemeToggle');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', isWallpaper);
    toggleBtn.title = isWallpaper
      ? 'Klasik Sade Görünüme Geç'
      : 'Duvar Kağıdı Görünümüne Geç';
  }

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isWallpaper ? '#0B0F19' : '#F8F9FA');
  }
}

function setupThemeToggle() {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'default';
  applyTheme(savedTheme);

  const toggleBtn = document.getElementById('btnThemeToggle');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const isCurrentlyWallpaper = document.body.classList.contains('theme-wallpaper');
    const newTheme = isCurrentlyWallpaper ? 'default' : 'wallpaper';
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch (e) {}
    applyTheme(newTheme);
  });
}

// --- 5.2 Ultra-Smooth Stationary Pull-to-Refresh for Mobile ---
function setupPullToRefresh() {
  const ptrEl = document.getElementById('lebPullToRefresh');
  if (!ptrEl) return;

  const iconEl = ptrEl.querySelector('.ptr-icon');
  let startY = 0;
  let currentY = 0;
  let isTracking = false;
  let isRefreshing = false;
  const PULL_THRESHOLD = 45; // effective downward threshold in px
  const RESISTANCE = 0.38;

  function resetIndicator() {
    ptrEl.classList.remove('is-pulling');
    ptrEl.style.opacity = '0';
    ptrEl.style.transform = 'translateX(-50%) translateY(0)';
    if (iconEl) iconEl.style.transform = '';
  }

  window.addEventListener('touchstart', (e) => {
    if (isRefreshing) return;
    if (window.scrollY <= 1) {
      startY = e.touches[0].clientY;
      currentY = startY;
      isTracking = true;
    } else {
      isTracking = false;
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isTracking || isRefreshing) return;

    if (window.scrollY > 1) {
      isTracking = false;
      resetIndicator();
      return;
    }

    currentY = e.touches[0].clientY;
    const diff = currentY - startY;

    if (diff > 8) {
      // Prevent browser default elastic bounce so page stays completely stationary
      if (e.cancelable) {
        e.preventDefault();
      }

      const pull = Math.min(diff * RESISTANCE, 75);
      ptrEl.classList.add('is-pulling');
      ptrEl.style.opacity = String(Math.min(pull / 28, 1));
      ptrEl.style.transform = `translateX(-50%) translateY(${pull + 62}px)`;

      if (iconEl) {
        iconEl.style.transform = `rotate(${pull * 6}deg)`;
      }
    } else {
      resetIndicator();
    }
  }, { passive: false });

  const handleTouchEnd = async () => {
    if (!isTracking || isRefreshing) return;
    isTracking = false;
    ptrEl.classList.remove('is-pulling');

    const diff = currentY - startY;
    const pull = diff * RESISTANCE;

    if (pull >= PULL_THRESHOLD) {
      isRefreshing = true;
      ptrEl.classList.add('is-refreshing');
      if (iconEl) iconEl.style.transform = '';

      if (navigator.vibrate) {
        try { navigator.vibrate(12); } catch (err) {}
      }

      const syncPromise = syncWithCloud({ isManual: true });
      const minDelay = new Promise((resolve) => setTimeout(resolve, 650));

      try {
        await Promise.all([syncPromise, minDelay]);
      } catch (err) {
        console.warn('PTR sync warning:', err);
      } finally {
        ptrEl.style.opacity = '0';
        ptrEl.style.transform = 'translateX(-50%) translateY(0)';
        setTimeout(() => {
          ptrEl.classList.remove('is-refreshing');
          isRefreshing = false;
          resetIndicator();
        }, 220);
      }
    } else {
      resetIndicator();
    }
  };

  window.addEventListener('touchend', handleTouchEnd, { passive: true });
  window.addEventListener('touchcancel', resetIndicator, { passive: true });
}

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
    roderDate: getFutureDate(60),
    takoTuvDate: getFutureDate(90),
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
    roderDate: getFutureDate(45),
    takoTuvDate: null,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'veh_3',
    type: 'vehicle',
    title: '34 LEB 2024',
    subType: 'Dorse',
    inspectionDate: getFutureDate(150),
    insuranceDate: getFutureDate(180),
    greenCardDate: getFutureDate(60),
    roderDate: getFutureDate(120),
    takoTuvDate: null,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'veh_4',
    type: 'vehicle',
    title: '34 TR 5500',
    subType: 'Otomobil',
    inspectionDate: getFutureDate(150),
    insuranceDate: getFutureDate(90),
    greenCardDate: null,
    roderDate: null,
    takoTuvDate: null,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'drv_1',
    type: 'driver',
    title: 'Ahmet Yılmaz',
    subType: 'Sürücü',
    visaDate: getFutureDate(7),
    licenseDate: getFutureDate(260),
    passport: 'U14589210',
    passportDate: getFutureDate(180),
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'drv_2',
    type: 'driver',
    title: 'Mehmet Kaya',
    subType: 'Sürücü',
    visaDate: getFutureDate(-2),
    licenseDate: getFutureDate(50),
    passport: 'U88231019',
    passportDate: getFutureDate(25),
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'drv_3',
    type: 'driver',
    title: 'Ali Demir',
    subType: 'Sürücü',
    visaDate: getFutureDate(120),
    licenseDate: getFutureDate(310),
    passport: 'U99421102',
    passportDate: getFutureDate(400),
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
      return [];
    }
    let parsed = JSON.parse(data);
    parsed = cleanGarbageRecords(deduplicateItems(parsed));
    if (includeDeleted) return parsed;
    return parsed.filter(r => !r.deleted);
  } catch (e) {
    console.error('[Storage] Read error:', e);
    return [];
  }
}

function saveRecordsLocally(records) {
  try {
    const deduped = cleanGarbageRecords(deduplicateItems(records));
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
    if (rec.greenCardDate) dates.push({ label: 'Yeşil Sigorta', date: rec.greenCardDate });
    if (rec.roderDate) dates.push({ label: 'Roder', date: rec.roderDate });
    if (rec.takoTuvDate) dates.push({ label: 'Tako Tüv', date: rec.takoTuvDate });
  } else {
    if (rec.visaDate) dates.push({ label: 'Vize', date: rec.visaDate });
    if (rec.licenseDate) dates.push({ label: 'Ehliyet', date: rec.licenseDate });
    if (rec.passportDate) dates.push({ label: 'Pasaport', date: rec.passportDate });
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
      text: `${Math.abs(minDays)} gün geçti`,
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

// --- 8.5. Scheduled Compliance Notifications (15-Day Milestone & 7-Day 10 AM Daily) ---
const NOTIF_15D_KEY = 'leb_notif_15d_history_v1';
const NOTIF_DAILY_DATE_KEY = 'leb_notif_last_10am_date';

function isAppointmentNoted(rec) {
  if (!rec) return false;
  if (rec.appointmentTaken === true || rec.appointmentTaken === 'true') return true;
  const notes = rec.notes || '';
  if (!notes) return false;
  const lower = toTurkishLower(notes);
  return (
    lower.includes('alındı') ||
    lower.includes('alindi') ||
    lower.includes('randevu') ||
    lower.includes('yapıldı') ||
    lower.includes('yapildi') ||
    lower.includes('tamam') ||
    lower.includes('ödendi') ||
    lower.includes('odendi')
  );
}

function getRecordDocumentDates(rec) {
  if (!rec) return [];
  const list = [];
  if (rec.type === 'vehicle') {
    if (rec.inspectionDate) list.push({ key: 'inspectionDate', label: 'Muayene', dateStr: rec.inspectionDate });
    if (rec.insuranceDate) list.push({ key: 'insuranceDate', label: 'Sigorta', dateStr: rec.insuranceDate });
    if (rec.greenCardDate) list.push({ key: 'greenCardDate', label: 'Yeşil Sigorta', dateStr: rec.greenCardDate });
    const subType = rec.subType || '';
    if (subType === 'Çekici' || subType === 'Dorse') {
      if (rec.roderDate) list.push({ key: 'roderDate', label: 'Roder', dateStr: rec.roderDate });
    }
    if (subType === 'Çekici') {
      if (rec.takoTuvDate) list.push({ key: 'takoTuvDate', label: 'Tako Tüv', dateStr: rec.takoTuvDate });
    }
  } else {
    if (rec.visaDate) list.push({ key: 'visaDate', label: 'Vize', dateStr: rec.visaDate });
    if (rec.licenseDate) list.push({ key: 'licenseDate', label: 'Ehliyet / SRC', dateStr: rec.licenseDate });
    if (rec.passportDate) list.push({ key: 'passportDate', label: 'Pasaport', dateStr: rec.passportDate });
  }
  return list;
}

async function sendSystemNotification(title, body, tag) {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, {
          body,
          tag: tag || 'leb-compliance',
          icon: 'icons/apple-touch-icon-180.png?v=3.6.0',
          badge: 'icons/favicon.png?v=3.9.0',
          vibrate: [200, 100, 200],
          data: { url: './' }
        });
        return;
      }
    }
  } catch (e) {
    console.warn('[Notification SW Note]:', e);
  }

  // Fallback to desktop Notification constructor
  try {
    new Notification(title, {
      body,
      tag: tag || 'leb-compliance',
      icon: 'icons/apple-touch-icon-180.png?v=3.6.0'
    });
  } catch (err) {
    console.warn('[Notification API Note]:', err);
  }
}

function checkAndDispatchComplianceAlerts() {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const records = getStoredRecords(false);
  if (!records || records.length === 0) return;

  // 1. 15-Day Milestone Rule: Sent ONCE per document expiration date cycle
  let history15d = {};
  try {
    history15d = JSON.parse(localStorage.getItem(NOTIF_15D_KEY) || '{}');
  } catch (e) {
    history15d = {};
  }
  let historyChanged = false;

  records.forEach(rec => {
    const docs = getRecordDocumentDates(rec);
    docs.forEach(doc => {
      const days = getDaysRemaining(doc.dateStr);
      if (days !== null && days <= 15 && days > 7) {
        const cycleKey = `${rec.id}_${doc.key}_${doc.dateStr}`;
        if (!history15d[cycleKey]) {
          const title = `${rec.title} • ${doc.label}`;
          const body = `15 gün kaldı (${formatDisplayDate(doc.dateStr)})`;
          sendSystemNotification(title, body, `15d-${rec.id}-${doc.key}`);
          history15d[cycleKey] = Date.now();
          historyChanged = true;
        }
      }
    });
  });

  if (historyChanged) {
    try {
      localStorage.setItem(NOTIF_15D_KEY, JSON.stringify(history15d));
    } catch (e) {}
  }

  // 2. 7-Day Milestone Rule: Every day at 10:00 AM unless "muayene / randevu alındı"
  const now = new Date();
  const currentHour = now.getHours();
  const todayDateStr = getTodayDateStr();
  const lastDailySentDate = localStorage.getItem(NOTIF_DAILY_DATE_KEY);

  // If it is 10:00 AM or later and today's alert hasn't run yet
  if (currentHour >= 10 && lastDailySentDate !== todayDateStr) {
    const urgentItems = [];

    records.forEach(rec => {
      // If user marked appointment taken or notes indicate appointment taken, SKIP!
      if (isAppointmentNoted(rec)) return;

      const docs = getRecordDocumentDates(rec);
      docs.forEach(doc => {
        const days = getDaysRemaining(doc.dateStr);
        if (days !== null && days <= 7 && days >= -30) {
          urgentItems.push({
            recTitle: rec.title,
            docLabel: doc.label,
            days,
            dateStr: doc.dateStr
          });
        }
      });
    });

    if (urgentItems.length > 0) {
      if (urgentItems.length === 1) {
        const item = urgentItems[0];
        const statusText = item.days <= 0 ? 'Süresi doldu!' : `${item.days} gün kaldı`;
        sendSystemNotification(
          `${item.recTitle} • ${item.docLabel}`,
          `${statusText} • Randevu henüz alınmadı`,
          `daily-7d-${todayDateStr}`
        );
      } else {
        const sample = urgentItems.slice(0, 3).map(u => `${u.recTitle} (${u.docLabel})`).join(', ');
        const extra = urgentItems.length > 3 ? ` ve ${urgentItems.length - 3} diğer` : '';
        sendSystemNotification(
          `${urgentItems.length} Evrak İçin Randevu Alınmadı`,
          `${sample}${extra} • Lütfen randevu durumunu kontrol edin`,
          `daily-7d-${todayDateStr}`
        );
      }
    }

    // Mark as sent for today
    try {
      localStorage.setItem(NOTIF_DAILY_DATE_KEY, todayDateStr);
    } catch (e) {}
  }
}

let timer10AmId = null;
function scheduleNext10AmTimer() {
  if (timer10AmId) {
    clearTimeout(timer10AmId);
    timer10AmId = null;
  }

  const now = new Date();
  const target10Am = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 10, 0, 0, 0);

  if (now.getTime() >= target10Am.getTime()) {
    // If it's already past 10 AM today, schedule for tomorrow at 10 AM
    target10Am.setDate(target10Am.getDate() + 1);
  }

  const msUntil10Am = target10Am.getTime() - now.getTime();
  timer10AmId = setTimeout(() => {
    checkAndDispatchComplianceAlerts();
    scheduleNext10AmTimer();
  }, msUntil10Am);
}

// --- Web Push Subscription Sync Engine (For alerts when app/phone is closed) ---
const VAPID_PUBLIC_KEY = 'BOyB7XaqE9ZE3MsO8FgV3MPvAkaWgwVyilbPasuaDN1eSW-rZ53v1tyIYGFacwncjX6ojzGNciKuBZfIUH1xkpM';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function syncPushSubscriptionToCloud() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }
    if (sub) {
      const subJson = sub.toJSON();
      const endpoint = subJson.endpoint || '';
      if (!endpoint) return;
      const endpointKey = btoa(endpoint).replace(/[/+=]/g, '').slice(-32);
      await fetch(`https://leb1919-default-rtdb.firebaseio.com/leb_subscriptions/${endpointKey}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sub: subJson,
          updatedAt: Date.now(),
          platform: navigator.platform || '',
          userAgent: navigator.userAgent || ''
        })
      });
    }
  } catch (e) {
    console.warn('[WebPush Sync Note]:', e);
  }
}

function updateNotificationButtonUI() {
  const btn = document.getElementById('btnNotifToggle');
  if (!btn) return;

  if (!('Notification' in window)) {
    btn.style.display = 'none';
    return;
  }

  const perm = Notification.permission;
  btn.classList.remove('granted', 'needs-perm', 'denied');

  if (perm === 'granted') {
    btn.classList.add('granted');
    btn.title = "Bildirimler Aktif (15 gün ve 7 gün kala her sabah 10:00'da uyarı)";
  } else if (perm === 'denied') {
    btn.classList.add('denied');
    btn.title = "Bildirimler Tarayıcıda Engellendi (Kilit ikonuna basıp izin verin)";
  } else {
    btn.classList.add('needs-perm');
    btn.title = "Bildirimleri Aç (15 gün ve 7 gün kala sabah 10:00 uyarıları)";
  }
}

function setupNotificationButton() {
  const btn = document.getElementById('btnNotifToggle');
  if (!btn) return;

  updateNotificationButtonUI();

  btn.addEventListener('click', async () => {
    // 1. Device support check
    if (!('Notification' in window)) {
      alert('Cihazınız veya tarayıcınız web bildirimlerini desteklemiyor.');
      return;
    }

    // 2. iOS Safari PWA check
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent.toLowerCase());
    const isStandalone = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !isStandalone) {
      alert("iPhone'da bildirim alabilmek için Safari Paylaş (kare içinden yukarı ok çıkan) butonuna basıp 'Ana Ekrana Ekle' yapmalı ve uygulamayı ana ekrandan açmalısınız.");
      return;
    }

    // 3. Permission handling & Instant Test Notification
    if (Notification.permission === 'default') {
      try {
        const result = await Notification.requestPermission();
        updateNotificationButtonUI();
        if (result === 'granted') {
          await syncPushSubscriptionToCloud();
          await sendSystemNotification(
            'Bildirim Testi',
            'Bildirimler aktif • 15 gün kala ve 7 gün kala 10:00 uyarıları çalışıyor',
            'leb-welcome-test'
          );
          checkAndDispatchComplianceAlerts();
        }
      } catch (e) {
        console.warn('Perm request note:', e);
      }
    } else if (Notification.permission === 'denied') {
      alert("Bildirimler tarayıcınızda engellenmiş. Adres çubuğundaki kilit simgesine (veya telefon ayarları > bildirimler) basıp izin verin.");
    } else if (Notification.permission === 'granted') {
      await syncPushSubscriptionToCloud();
      await sendSystemNotification(
        'Bildirim Testi',
        'Bildirimler aktif • 15 gün kala ve 7 gün kala 10:00 uyarıları çalışıyor',
        'leb-manual-test-' + Date.now()
      );
      checkAndDispatchComplianceAlerts();
    }
  });
}

// --- 9. App State & Filter Management ---
let currentSection = 'vehicles'; // 'vehicles' | 'drivers'
let currentStatFilter = 'all';    // 'all' | 'critical' | 'warning' | 'safe'
let currentSubFilter = 'all';     // 'all' | 'Çekici' | 'Dorse' | 'Otomobil'
let currentSearchQuery = '';

function triggerSmoothRender() {
  lastRenderedHash = '';
  renderCurrentView();
}

function setupSectionTabs() {
  const tabVehicles = document.getElementById('tabVehicles');
  const tabDrivers = document.getElementById('tabDrivers');
  const addBtnLabel = document.getElementById('addBtnLabel');

  function switchSection(target) {
    if (currentSection === target) return;
    currentSection = target;

    if (target === 'vehicles') {
      if (tabVehicles) {
        tabVehicles.classList.add('active');
        tabVehicles.setAttribute('aria-selected', 'true');
      }
      if (tabDrivers) {
        tabDrivers.classList.remove('active');
        tabDrivers.setAttribute('aria-selected', 'false');
      }
      if (addBtnLabel) addBtnLabel.textContent = 'Yeni Araç Ekle';
    } else {
      if (tabDrivers) {
        tabDrivers.classList.add('active');
        tabDrivers.setAttribute('aria-selected', 'true');
      }
      if (tabVehicles) {
        tabVehicles.classList.remove('active');
        tabVehicles.setAttribute('aria-selected', 'false');
      }
      if (addBtnLabel) addBtnLabel.textContent = 'Yeni Sürücü Ekle';
    }

    // Reset filters on tab switch so vehicles and drivers NEVER clash or hide!
    currentSubFilter = 'all';
    currentStatFilter = 'all';
    currentSearchQuery = '';

    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearchBtn');
    if (searchInput) searchInput.value = '';
    if (clearBtn) clearBtn.style.display = 'none';

    document.querySelectorAll('.leb-stat-card').forEach(c => {
      c.classList.toggle('active-stat', c.dataset.filter === 'all');
    });

    renderSubFilterPills();

    // Instant redraw, zero timeout delay
    lastRenderedHash = '';
    renderCurrentView();
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
        if (currentSubFilter === pill.id) return;
        currentSubFilter = pill.id;
        renderSubFilterPills();
        triggerSmoothRender();
      });
      container.appendChild(btn);
    });
  } else {
    // Sürücülerde alt kategori hapları gösterilmez (yalnızca araçlarda alt filtre hapları olur)
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
      triggerSmoothRender();
    });
  });
}

function setupSearch() {
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('clearSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearchQuery = e.target.value.trim();
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
      triggerSmoothRender();
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
      triggerSmoothRender();
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

  // 2. Filter by SubType (Yalnızca Araçlar sekmesinde alt filtre çalışır)
  if (currentSection === 'vehicles' && currentSubFilter !== 'all') {
    list = list.filter(r => (r.subType || '') === currentSubFilter);
  }

  // 3. Filter by Stat (Critical, Warning, Safe)
  if (currentStatFilter !== 'all') {
    list = list.filter(r => {
      const u = calculateRecordUrgency(r);
      return u.status === currentStatFilter;
    });
  }

  // 4. Filter by Search Query (Turkish Diacritic & Case Insensitive)
  if (currentSearchQuery) {
    const q = normalizeTurkishSearch(currentSearchQuery);
    list = list.filter(r => {
      const matchTitle = normalizeTurkishSearch(r.title).includes(q);
      const matchType = normalizeTurkishSearch(r.subType).includes(q);
      const matchNotes = normalizeTurkishSearch(r.notes).includes(q);
      const matchPassport = normalizeTurkishSearch(r.passport).includes(q);
      return matchTitle || matchType || matchNotes || matchPassport;
    });
  }

  // 5. Sort by Urgency (Most critical first, then Turkish alphabetical collation)
  list.sort((a, b) => {
    const uA = calculateRecordUrgency(a).minDays;
    const uB = calculateRecordUrgency(b).minDays;
    if (uA !== uB) return uA - uB;
    return compareTurkish(a.title, b.title);
  });

  // Layout signature to prevent unnecessary DOM redraws while guaranteeing updates on any state change
  const renderSignature = `${currentSection}_${currentStatFilter}_${currentSubFilter}_${currentSearchQuery}_${list.length}_${list.map(r => 
    `${r.id}_${r.title}_${r.subType}_${r.updatedAt}_${r.inspectionDate}_${r.insuranceDate}_${r.greenCardDate}_${r.roderDate}_${r.takoTuvDate}_${r.visaDate}_${r.licenseDate}_${r.passportDate}_${r.notes || ''}_${r.appointmentTaken || false}`
  ).join('|')}`;

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
            <span class="date-name">Yeşil Sigorta:</span>
            <span class="date-val">${formatDisplayDate(rec.greenCardDate)}</span>
          </span>
        `);
      }
      if (rec.roderDate) {
        datesItems.push(`
          <span class="date-item">
            <span class="date-name">Roder:</span>
            <span class="date-val">${formatDisplayDate(rec.roderDate)}</span>
          </span>
        `);
      }
      if (rec.takoTuvDate) {
        datesItems.push(`
          <span class="date-item">
            <span class="date-name">Tako Tüv:</span>
            <span class="date-val">${formatDisplayDate(rec.takoTuvDate)}</span>
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
      if (rec.passportDate || rec.passport) {
        const passDateStr = rec.passportDate ? formatDisplayDate(rec.passportDate) : '';
        const passNoStr = rec.passport ? ` (${escapeHtml(rec.passport)})` : '';
        datesItems.push(`
          <span class="date-item">
            <span class="date-name">Pasaport:</span>
            <span class="date-val">${passDateStr || 'Kayıtlı'}${passNoStr}</span>
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

    const isAppt = isAppointmentNoted(rec);
    const appointmentBadgeHtml = isAppt
      ? `<span class="badge-appointment-noted" title="Muayene / Randevu Alındı">✓ Randevu Alındı</span>`
      : '';

    const notesTagHtml = rec.notes
      ? `<span class="row-notes-tag" title="Not: ${escapeHtml(rec.notes)}">📝 ${escapeHtml(rec.notes)}</span>`
      : '';

    row.innerHTML = `
      <div class="row-top-mobile">
        <div class="row-identity">
          <span class="row-title">${escapeHtml(rec.title)}</span>
          ${typePillHtml}
          ${appointmentBadgeHtml}
          ${notesTagHtml}
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

  // Attach event listeners to card actions
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

function addMonthsSafely(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() !== day) {
    d.setDate(0);
  }
  return d;
}

function setupQuickPresetChips() {
  // Preset chips in Add Modal
  document.querySelectorAll('.preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const targetId = chip.dataset.target;
      const months = parseInt(chip.dataset.months, 10);
      if (targetId && months) {
        const d = addMonthsSafely(new Date(), months);
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
  const rowHeavyDocs = document.getElementById('rowVehicleHeavyDocs');
  const groupRoder = document.getElementById('groupRoderDate');
  const groupTakoTuv = document.getElementById('groupTakoTuvDate');

  function updateVehicleTypeVisibility(vType) {
    if (vType === 'Çekici') {
      if (rowHeavyDocs) rowHeavyDocs.style.display = 'flex';
      if (groupRoder) groupRoder.style.display = 'block';
      if (groupTakoTuv) groupTakoTuv.style.display = 'block';
    } else if (vType === 'Dorse') {
      if (rowHeavyDocs) rowHeavyDocs.style.display = 'flex';
      if (groupRoder) groupRoder.style.display = 'block';
      if (groupTakoTuv) groupTakoTuv.style.display = 'none';
      setCustomDate('inputTakoTuvDate', '');
    } else { // Otomobil
      if (rowHeavyDocs) rowHeavyDocs.style.display = 'none';
      setCustomDate('inputRoderDate', '');
      setCustomDate('inputTakoTuvDate', '');
    }
  }

  vTypeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      vTypeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.dataset.val;
      if (selectVType) selectVType.value = val;
      updateVehicleTypeVisibility(val);
    });
  });

  function openAddModal() {
    if (addModal) {
      addModal.classList.add('active');
      if (currentSection === 'vehicles') {
        activateModalTab('vehicle');
      } else {
        activateModalTab('driver');
      }

      // Automatically prefill sensible default dates (+1 Yıl) so user is never blocked by an empty date!
      const defaultOneYear = getFutureDate(365);
      const currentInsp = document.getElementById('inputInspectionDate').value;
      if (!currentInsp) {
        setCustomDate('inputInspectionDate', defaultOneYear);
      }
      const currentVisa = document.getElementById('inputVisaDate').value;
      if (!currentVisa) {
        setCustomDate('inputVisaDate', defaultOneYear);
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
      setCustomDate('inputRoderDate', '');
      setCustomDate('inputTakoTuvDate', '');
      setCustomDate('inputVisaDate', '');
      setCustomDate('inputLicenseDate', '');
      setCustomDate('inputPassportDate', '');
      updateVehicleTypeVisibility('Çekici');
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
  if (addModal) {
    addModal.addEventListener('click', (e) => {
      if (e.target === addModal) closeAddModal();
    });
  }

  if (switchVehicle) switchVehicle.addEventListener('click', () => activateModalTab('vehicle'));
  if (switchDriver) switchDriver.addEventListener('click', () => activateModalTab('driver'));

  // Vehicle Form Submit
  if (vehicleForm) {
    vehicleForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const plateInput = document.getElementById('inputPlate');
      const plate = (plateInput ? plateInput.value : '').trim().toUpperCase();
      const vType = (selectVType && selectVType.value) || 'Çekici';
      const inspDate = document.getElementById('inputInspectionDate').value;
      const insDate = document.getElementById('inputInsuranceDate').value || null;
      const greenDate = document.getElementById('inputGreenCardDate').value || null;
      const roderDate = (vType === 'Çekici' || vType === 'Dorse') ? (document.getElementById('inputRoderDate').value || null) : null;
      const takoTuvDate = (vType === 'Çekici') ? (document.getElementById('inputTakoTuvDate').value || null) : null;

      if (!plate) {
        if (plateInput) {
          plateInput.classList.add('is-error');
          plateInput.focus();
        }
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

      const vNotesInput = document.getElementById('inputVehicleNotes');
      const vNotes = vNotesInput ? vNotesInput.value.trim() : '';

      const newRec = {
        id: 'veh_' + Date.now(),
        type: 'vehicle',
        title: plate,
        subType: vType,
        inspectionDate: inspDate,
        insuranceDate: insDate,
        greenCardDate: greenDate,
        roderDate: roderDate,
        takoTuvDate: takoTuvDate,
        notes: vNotes,
        appointmentTaken: isAppointmentNoted({ notes: vNotes }),
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        deleted: false
      };

      const records = getStoredRecords(true);
      records.unshift(newRec);
      saveRecordsLocally(records);
      closeAddModal();

      // Reset view filters and switch to vehicles so newly saved record is prominently shown!
      currentSection = 'vehicles';
      currentStatFilter = 'all';
      currentSubFilter = 'all';
      currentSearchQuery = '';

      const tabVehicles = document.getElementById('tabVehicles');
      const tabDrivers = document.getElementById('tabDrivers');
      if (tabVehicles && tabDrivers) {
        tabVehicles.classList.add('active');
        tabDrivers.classList.remove('active');
        tabVehicles.setAttribute('aria-selected', 'true');
        tabDrivers.setAttribute('aria-selected', 'false');
      }

      document.querySelectorAll('.leb-stat-card').forEach(c => {
        c.classList.toggle('active-stat', c.dataset.filter === 'all');
      });

      renderSubFilterPills();
      lastRenderedHash = '';
      renderCurrentView();

      pushToCloud(records);
      checkAndDispatchComplianceAlerts();
    });
  }

  // Driver Form Submit
  if (driverForm) {
    driverForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('inputDriverName');
      const name = (nameInput ? nameInput.value : '').trim();
      const visaDate = document.getElementById('inputVisaDate').value;
      const licDate = document.getElementById('inputLicenseDate').value || null;
      const passport = document.getElementById('inputPassport').value.trim();
      const passportDate = document.getElementById('inputPassportDate') ? document.getElementById('inputPassportDate').value : null;
      const dNotesInput = document.getElementById('inputDriverNotes');
      const dNotes = dNotesInput ? dNotesInput.value.trim() : '';

      if (!name) {
        if (nameInput) {
          nameInput.classList.add('is-error');
          nameInput.focus();
        }
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
        subType: 'Sürücü',
        visaDate: visaDate,
        licenseDate: licDate,
        passport: passport || '',
        passportDate: passportDate || null,
        notes: dNotes,
        appointmentTaken: isAppointmentNoted({ notes: dNotes }),
        createdAt: new Date().toISOString(),
        updatedAt: Date.now(),
        deleted: false
      };

      const records = getStoredRecords(true);
      records.unshift(newRec);
      saveRecordsLocally(records);
      closeAddModal();

      // Reset view filters and switch to drivers
      currentSection = 'drivers';
      currentStatFilter = 'all';
      currentSubFilter = 'all';
      currentSearchQuery = '';

      const tabVehicles = document.getElementById('tabVehicles');
      const tabDrivers = document.getElementById('tabDrivers');
      if (tabVehicles && tabDrivers) {
        tabDrivers.classList.add('active');
        tabVehicles.classList.remove('active');
        tabDrivers.setAttribute('aria-selected', 'true');
        tabVehicles.setAttribute('aria-selected', 'false');
      }

      document.querySelectorAll('.leb-stat-card').forEach(c => {
        c.classList.toggle('active-stat', c.dataset.filter === 'all');
      });

      renderSubFilterPills();
      lastRenderedHash = '';
      renderCurrentView();

      pushToCloud(records);
      checkAndDispatchComplianceAlerts();
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
  if (quickModal) {
    quickModal.addEventListener('click', (e) => {
      if (e.target === quickModal) closeQuickModal();
    });
  }

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
      const d = addMonthsSafely(new Date(), months);
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
        const btnToggleAppt = document.getElementById('btnToggleAppointment');
        const quickNotesInput = document.getElementById('quickNotesInput');
        if (btnToggleAppt) {
          rec.appointmentTaken = btnToggleAppt.classList.contains('active');
        }
        if (quickNotesInput) {
          rec.notes = quickNotesInput.value.trim();
        }
        rec.updatedAt = Date.now();
        saveRecordsLocally(records);
        closeQuickModal();
        lastRenderedHash = '';
        renderCurrentView();
        pushToCloud(records);
        checkAndDispatchComplianceAlerts();
      }
    });
  }
}

function openQuickModal(id) {
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

  // Bind appointment status toggle and notes
  const btnToggleAppt = document.getElementById('btnToggleAppointment');
  const quickNotesInput = document.getElementById('quickNotesInput');
  let currentApptStatus = isAppointmentNoted(rec);
  if (btnToggleAppt) {
    btnToggleAppt.classList.toggle('active', currentApptStatus);
    btnToggleAppt.onclick = (e) => {
      e.preventDefault();
      currentApptStatus = !currentApptStatus;
      btnToggleAppt.classList.toggle('active', currentApptStatus);
    };
  }
  if (quickNotesInput) {
    quickNotesInput.value = rec.notes || '';
  }

  // Options according to type
  let docOptions = [];
  if (rec.type === 'vehicle') {
    if (rec.subType === 'Çekici') {
      docOptions = [
        { field: 'inspectionDate', label: 'Muayene' },
        { field: 'insuranceDate', label: 'Sigorta' },
        { field: 'greenCardDate', label: 'Yeşil Sigorta' },
        { field: 'roderDate', label: 'Roder' },
        { field: 'takoTuvDate', label: 'Tako Tüv' }
      ];
    } else if (rec.subType === 'Dorse') {
      docOptions = [
        { field: 'inspectionDate', label: 'Muayene' },
        { field: 'insuranceDate', label: 'Sigorta' },
        { field: 'greenCardDate', label: 'Yeşil Sigorta' },
        { field: 'roderDate', label: 'Roder' }
      ];
    } else {
      docOptions = [
        { field: 'inspectionDate', label: 'Muayene' },
        { field: 'insuranceDate', label: 'Sigorta' },
        { field: 'greenCardDate', label: 'Yeşil Sigorta' }
      ];
    }
  } else {
    docOptions = [
      { field: 'visaDate', label: 'Vize' },
      { field: 'licenseDate', label: 'Ehliyet' },
      { field: 'passportDate', label: 'Pasaport' }
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

async function deleteRecord(id) {
  // 1. Blacklist immediately to permanently block resurrection across all devices
  markRecordDeletedLocally(id);

  // 2. Direct hard delete from local array - NO ALERT, NO CONFIRMATION POPUP, NO TOAST!
  let records = getStoredRecords(true);
  records = records.filter(r => r.id !== id);
  saveRecordsLocally(records);

  // 3. Immediately redraw current view
  lastRenderedHash = '';
  renderCurrentView();

  // 4. Send updated list directly to Firebase RTDB so cloud is purged immediately
  await pushToCloud(records);
}

// --- 13. Desktop Excel (CSV) Export Engine (Clean, Categorized, Separate Tables) ---
function getTodayDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatExcelDate(dateStr) {
  if (!dateStr) return '';
  try {
    const [year, month, day] = dateStr.split('-');
    return `${day}.${month}.${year}`;
  } catch (e) {
    return dateStr;
  }
}

function getSingleDateStatus(dateStr) {
  if (!dateStr) return { text: 'Belirtilmedi', days: '' };
  const days = getDaysRemaining(dateStr);
  if (days < 0) return { text: `${Math.abs(days)} gün geçti`, days };
  if (days === 0) return { text: 'Bugün Son Gün', days: 0 };
  if (days <= 7) return { text: `${days} gün kaldı`, days };
  if (days <= 30) return { text: `${days} gün kaldı`, days };
  return { text: 'Sorunsuz', days };
}

function escapeCsvCell(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

function downloadCsvFile(filename, csvContent) {
  // UTF-8 BOM (\uFEFF) ensures Microsoft Excel displays Turkish characters flawlessly
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function exportVehiclesCsv() {
  const records = getStoredRecords(false);
  const vehicles = records
    .filter(r => r.type === 'vehicle')
    .sort((a, b) => {
      // 1. Sort by subType: Çekici, Dorse, Otomobil
      const order = { 'Çekici': 1, 'Dorse': 2, 'Otomobil': 3 };
      const rankA = order[a.subType] || 4;
      const rankB = order[b.subType] || 4;
      if (rankA !== rankB) return rankA - rankB;
      // 2. Sort by plate
      return compareTurkish(a.title, b.title);
    });

  if (vehicles.length === 0) {
    alert('Dışa aktarılacak araç kaydı bulunamadı.');
    return;
  }

  const rows = [];

  // Row 1: Direct Column Headers (No Column1, Column2 auto-filter bug in Excel)
  rows.push([
    escapeCsvCell('Ana Kategori'),
    escapeCsvCell('Alt Kategori'),
    escapeCsvCell('Plaka'),
    escapeCsvCell('Genel Durum'),
    escapeCsvCell('En Acil Durum'),
    escapeCsvCell('Muayene Bitiş ve Durumu'),
    escapeCsvCell('Sigorta / Kasko Bitiş ve Durumu'),
    escapeCsvCell('Yeşil Sigorta Bitiş ve Durumu'),
    escapeCsvCell('Roder Bitiş ve Durumu'),
    escapeCsvCell('Tako Tüv Bitiş ve Durumu'),
    escapeCsvCell('Notlar')
  ]);

  vehicles.forEach(v => {
    const muayene = getSingleDateStatus(v.inspectionDate);
    const sigorta = getSingleDateStatus(v.insuranceDate);
    const yesilKart = getSingleDateStatus(v.greenCardDate);
    const roder = getSingleDateStatus(v.roderDate);
    const takoTuv = getSingleDateStatus(v.takoTuvDate);
    const urgency = calculateRecordUrgency(v);
    const statusText = urgency.status === 'critical' ? 'KRİTİK' : urgency.status === 'warning' ? 'YAKLAŞAN' : 'SORUNSUZ';

    const muayeneCell = v.inspectionDate ? `${formatExcelDate(v.inspectionDate)} (${muayene.text})` : '—';
    const sigortaCell = v.insuranceDate ? `${formatExcelDate(v.insuranceDate)} (${sigorta.text})` : '—';
    const yesilKartCell = v.greenCardDate ? `${formatExcelDate(v.greenCardDate)} (${yesilKart.text})` : (v.subType === 'Otomobil' ? 'Muaf' : '—');
    const roderCell = (v.subType === 'Çekici' || v.subType === 'Dorse')
      ? (v.roderDate ? `${formatExcelDate(v.roderDate)} (${roder.text})` : '—')
      : 'Muaf';
    const takoTuvCell = (v.subType === 'Çekici')
      ? (v.takoTuvDate ? `${formatExcelDate(v.takoTuvDate)} (${takoTuv.text})` : 'Muaf')
      : 'Muaf';

    rows.push([
      escapeCsvCell('Araç'),
      escapeCsvCell(v.subType || 'Araç'),
      escapeCsvCell(v.title || ''),
      escapeCsvCell(statusText),
      escapeCsvCell(urgency.text),
      escapeCsvCell(muayeneCell),
      escapeCsvCell(sigortaCell),
      escapeCsvCell(yesilKartCell),
      escapeCsvCell(roderCell),
      escapeCsvCell(takoTuvCell),
      escapeCsvCell(v.notes || '')
    ]);
  });

  const csvContent = rows.map(r => r.join(';')).join('\r\n');
  downloadCsvFile(`leb_araclar_${getTodayDateStr()}.csv`, csvContent);
}

function exportDriversCsv() {
  const records = getStoredRecords(false);
  const drivers = records
    .filter(r => r.type === 'driver')
    .sort((a, b) => compareTurkish(a.title, b.title));

  if (drivers.length === 0) {
    alert('Dışa aktarılacak şoför kaydı bulunamadı.');
    return;
  }

  const rows = [];

  // Row 1: Direct Column Headers
  rows.push([
    escapeCsvCell('Ana Kategori'),
    escapeCsvCell('Alt Kategori'),
    escapeCsvCell('Ad Soyad'),
    escapeCsvCell('Pasaport No'),
    escapeCsvCell('Pasaport Bitiş ve Durumu'),
    escapeCsvCell('Genel Durum'),
    escapeCsvCell('En Acil Durum'),
    escapeCsvCell('Vize Bitiş ve Durumu'),
    escapeCsvCell('Ehliyet / SRC Bitiş ve Durumu'),
    escapeCsvCell('Notlar')
  ]);

  drivers.forEach(d => {
    const vize = getSingleDateStatus(d.visaDate);
    const ehliyet = getSingleDateStatus(d.licenseDate);
    const pasaport = getSingleDateStatus(d.passportDate);
    const urgency = calculateRecordUrgency(d);
    const statusText = urgency.status === 'critical' ? 'KRİTİK' : urgency.status === 'warning' ? 'YAKLAŞAN' : 'SORUNSUZ';

    const pasaportCell = d.passportDate ? `${formatExcelDate(d.passportDate)} (${pasaport.text})` : (d.passport ? 'Tarih Belirtilmedi' : '—');
    const vizeCell = d.visaDate ? `${formatExcelDate(d.visaDate)} (${vize.text})` : '—';
    const ehliyetCell = d.licenseDate ? `${formatExcelDate(d.licenseDate)} (${ehliyet.text})` : '—';

    rows.push([
      escapeCsvCell('Sürücü'),
      escapeCsvCell(d.subType || 'Şoför'),
      escapeCsvCell(d.title || ''),
      escapeCsvCell(d.passport || '—'),
      escapeCsvCell(pasaportCell),
      escapeCsvCell(statusText),
      escapeCsvCell(urgency.text),
      escapeCsvCell(vizeCell),
      escapeCsvCell(ehliyetCell),
      escapeCsvCell(d.notes || '')
    ]);
  });

  const csvContent = rows.map(r => r.join(';')).join('\r\n');
  downloadCsvFile(`leb_soforler_${getTodayDateStr()}.csv`, csvContent);
}

function exportAllUnifiedCsv() {
  const records = getStoredRecords(false);
  if (records.length === 0) {
    alert('Dışa aktarılacak kayıt bulunamadı.');
    return;
  }

  const vehicles = records
    .filter(r => r.type === 'vehicle')
    .sort((a, b) => {
      const order = { 'Çekici': 1, 'Dorse': 2, 'Otomobil': 3 };
      const rankA = order[a.subType] || 4;
      const rankB = order[b.subType] || 4;
      if (rankA !== rankB) return rankA - rankB;
      return compareTurkish(a.title, b.title);
    });

  const drivers = records
    .filter(r => r.type === 'driver')
    .sort((a, b) => compareTurkish(a.title, b.title));

  const rows = [];

  // Row 1: Direct Column Headers (Aligned for both vehicles and drivers)
  rows.push([
    escapeCsvCell('Ana Kategori'),
    escapeCsvCell('Alt Kategori'),
    escapeCsvCell('Tanım (Plaka / İsim)'),
    escapeCsvCell('Pasaport No'),
    escapeCsvCell('Genel Durum'),
    escapeCsvCell('En Acil Durum'),
    escapeCsvCell('Muayene / Vize Durumu'),
    escapeCsvCell('Sigorta / Ehliyet Durumu'),
    escapeCsvCell('Yeşil Sigorta / Pasaport Durumu'),
    escapeCsvCell('Roder Durumu'),
    escapeCsvCell('Tako Tüv Durumu'),
    escapeCsvCell('Notlar')
  ]);

  // Vehicles
  vehicles.forEach(v => {
    const muayene = getSingleDateStatus(v.inspectionDate);
    const sigorta = getSingleDateStatus(v.insuranceDate);
    const yesilKart = getSingleDateStatus(v.greenCardDate);
    const roder = getSingleDateStatus(v.roderDate);
    const takoTuv = getSingleDateStatus(v.takoTuvDate);
    const urgency = calculateRecordUrgency(v);
    const statusText = urgency.status === 'critical' ? 'KRİTİK' : urgency.status === 'warning' ? 'YAKLAŞAN' : 'SORUNSUZ';

    const muayeneCell = v.inspectionDate ? `Muayene: ${formatExcelDate(v.inspectionDate)} (${muayene.text})` : '—';
    const sigortaCell = v.insuranceDate ? `Sigorta: ${formatExcelDate(v.insuranceDate)} (${sigorta.text})` : '—';
    const yesilKartCell = v.greenCardDate ? `Yeşil Sigorta: ${formatExcelDate(v.greenCardDate)} (${yesilKart.text})` : (v.subType === 'Otomobil' ? 'Muaf' : '—');
    const roderCell = (v.subType === 'Çekici' || v.subType === 'Dorse')
      ? (v.roderDate ? `Roder: ${formatExcelDate(v.roderDate)} (${roder.text})` : '—')
      : 'Muaf';
    const takoTuvCell = (v.subType === 'Çekici')
      ? (v.takoTuvDate ? `Tako Tüv: ${formatExcelDate(v.takoTuvDate)} (${takoTuv.text})` : '—')
      : 'Muaf';

    rows.push([
      escapeCsvCell('Araç'),
      escapeCsvCell(v.subType || 'Araç'),
      escapeCsvCell(v.title || ''),
      escapeCsvCell('—'),
      escapeCsvCell(statusText),
      escapeCsvCell(urgency.text),
      escapeCsvCell(muayeneCell),
      escapeCsvCell(sigortaCell),
      escapeCsvCell(yesilKartCell),
      escapeCsvCell(roderCell),
      escapeCsvCell(takoTuvCell),
      escapeCsvCell(v.notes || '')
    ]);
  });

  // Drivers
  drivers.forEach(d => {
    const vize = getSingleDateStatus(d.visaDate);
    const ehliyet = getSingleDateStatus(d.licenseDate);
    const pasaport = getSingleDateStatus(d.passportDate);
    const urgency = calculateRecordUrgency(d);
    const statusText = urgency.status === 'critical' ? 'KRİTİK' : urgency.status === 'warning' ? 'YAKLAŞAN' : 'SORUNSUZ';

    const vizeCell = d.visaDate ? `Vize: ${formatExcelDate(d.visaDate)} (${vize.text})` : '—';
    const ehliyetCell = d.licenseDate ? `Ehliyet: ${formatExcelDate(d.licenseDate)} (${ehliyet.text})` : '—';
    const pasaportCell = d.passportDate ? `Pasaport: ${formatExcelDate(d.passportDate)} (${pasaport.text})` : (d.passport ? 'Pasaport: Kayıtlı' : '—');

    rows.push([
      escapeCsvCell('Sürücü'),
      escapeCsvCell(d.subType || 'Şoför'),
      escapeCsvCell(d.title || ''),
      escapeCsvCell(d.passport || '—'),
      escapeCsvCell(statusText),
      escapeCsvCell(urgency.text),
      escapeCsvCell(vizeCell),
      escapeCsvCell(ehliyetCell),
      escapeCsvCell(pasaportCell),
      escapeCsvCell('—'),
      escapeCsvCell('—'),
      escapeCsvCell(d.notes || '')
    ]);
  });

  const csvContent = rows.map(r => r.join(';')).join('\r\n');
  downloadCsvFile(`leb_tum_filo_${getTodayDateStr()}.csv`, csvContent);
}

// Modal Controls for Export
function openExportModal() {
  const records = getStoredRecords(false);
  const vehiclesCount = records.filter(r => r.type === 'vehicle').length;
  const driversCount = records.filter(r => r.type === 'driver').length;

  const bVeh = document.getElementById('badgeExportVehicles');
  const bDrv = document.getElementById('badgeExportDrivers');
  if (bVeh) bVeh.textContent = `${vehiclesCount} Araç`;
  if (bDrv) bDrv.textContent = `${driversCount} Şoför`;

  const modal = document.getElementById('exportModal');
  if (modal) {
    modal.classList.add('active');
  }
}

function closeExportModal() {
  const modal = document.getElementById('exportModal');
  if (modal) {
    modal.classList.remove('active');
  }
}

function setupExportModal() {
  const btnExport = document.getElementById('btnExportExcel');
  const closeBtn = document.getElementById('closeExportModalBtn');
  const cancelBtn = document.getElementById('cancelExportBtn');
  const overlay = document.getElementById('exportModal');

  const btnVehicles = document.getElementById('btnExportVehicles');
  const btnDrivers = document.getElementById('btnExportDrivers');
  const btnAll = document.getElementById('btnExportAll');

  if (btnExport) {
    btnExport.addEventListener('click', openExportModal);
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', closeExportModal);
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeExportModal);
  }
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeExportModal();
    });
  }

  if (btnVehicles) {
    btnVehicles.addEventListener('click', () => {
      exportVehiclesCsv();
      closeExportModal();
    });
  }
  if (btnDrivers) {
    btnDrivers.addEventListener('click', () => {
      exportDriversCsv();
      closeExportModal();
    });
  }
  if (btnAll) {
    btnAll.addEventListener('click', () => {
      exportAllUnifiedCsv();
      closeExportModal();
    });
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

// --- 13.5 Global ESC Key Dismissal (Modals, Calendars, Dialogs) ---
function setupGlobalEscapeListener() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      // 1. If calendar popover is currently open, close it first
      const calPopover = document.getElementById('lebCalendarPopover');
      if (calPopover && calPopover.style.display !== 'none') {
        if (typeof closeCalendar === 'function') closeCalendar();
        return;
      }
      // 2. If quickModal is active, close it
      const quickModal = document.getElementById('quickModal');
      if (quickModal && quickModal.classList.contains('active')) {
        const closeQuickBtn = document.getElementById('closeQuickModalBtn');
        if (closeQuickBtn) {
          closeQuickBtn.click();
        } else {
          quickModal.classList.remove('active');
        }
        return;
      }
      // 3. If addModal is active, close it
      const addModal = document.getElementById('addModal');
      if (addModal && addModal.classList.contains('active')) {
        const closeAddBtn = document.getElementById('closeAddModalBtn');
        if (closeAddBtn) {
          closeAddBtn.click();
        } else {
          addModal.classList.remove('active');
        }
        return;
      }
      // 4. If exportModal is active, close it
      const exportModal = document.getElementById('exportModal');
      if (exportModal && exportModal.classList.contains('active')) {
        if (typeof closeExportModal === 'function') {
          closeExportModal();
        } else {
          exportModal.classList.remove('active');
        }
        return;
      }
    }
  });
}

// --- 14. Initialization Lifecycle ---
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupNetworkMonitoring();
  setupHeaderScroll();
  setupGlobalEscapeListener();
  setupSectionTabs();
  renderSubFilterPills();
  setupStatFilters();
  setupSearch();
  setupModals();
  setupQuickPresetChips();
  initCustomDatePickers();

  // Initial local render
  renderCurrentView();

  // Desktop Excel Export modal
  setupExportModal();

  // Manual sync button
  const manualBtn = document.getElementById('manualSyncBtn');
  if (manualBtn) {
    manualBtn.addEventListener('click', () => {
      lastRenderedHash = '';
      syncWithCloud({ isManual: true });
    });
  }

  // Fetch remote clean data
  syncWithCloud({ isManual: false });

  // Realtime Cloud Sync via EventSource (SSE) & Lifecycle Listeners
  setupRealtimeSync();
  setupLifecycleSync();
  setupThemeToggle();
  setupPullToRefresh();

  // Scheduled Compliance Notifications (15-Day Milestone & 7-Day 10 AM Daily)
  setupNotificationButton();
  scheduleNext10AmTimer();
  checkAndDispatchComplianceAlerts();
  syncPushSubscriptionToCloud();

  // App focus listener to dispatch 10 AM daily alerts when opening the app
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkAndDispatchComplianceAlerts();
      syncPushSubscriptionToCloud();
    }
  });
});

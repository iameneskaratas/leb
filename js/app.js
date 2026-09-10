/**
 * Leb Lojistik - Neumorphism (Soft UI) Fleet & Driver Compliance Engine (v3.1.0)
 * High Performance Web App, Strict Mobile Read-Only Gate,
 * Separated Vehicles & Drivers, Quiet Bottom Sync
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

// --- 3. Strict Mobile Detection (Mobilden Asla Yönetim Paneline Ulaşılmasın!) ---
function isMobileDevice() {
  const ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod|android/i.test(ua) || window.innerWidth <= 768;
}

// --- 4. Push & Local Notifications (Mobile Alerts) ---
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
    const notifTitle = `Leb Lojistik: ${urgent.length} Kayıt Uyarı Veriyor!`;
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
          icon: 'icons/apple-touch-icon-180.png',
          badge: 'icons/favicon.png'
        });
      }
    } catch (e) {}
  }
}

// --- 5. Quiet Bottom Sync Engine (Firebase Realtime DB) ---
const CLOUD_ENDPOINT = 'https://leb1919-default-rtdb.firebaseio.com/leb_store.json';
const STORAGE_KEY = 'leb_logistics_fleet_v2';

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

    const remoteItems = (remoteData && Array.isArray(remoteData.items)) ? remoteData.items : [];
    const localItems = getStoredRecords(true);

    const mergedMap = new Map();

    // Ingest remote
    remoteItems.forEach(it => {
      if (it && it.id) mergedMap.set(it.id, it);
    });

    // Overlay local with Last-Write-Wins
    localItems.forEach(localIt => {
      if (!localIt || !localIt.id) return;
      if (!mergedMap.has(localIt.id)) {
        mergedMap.set(localIt.id, localIt);
      } else {
        const remoteIt = mergedMap.get(localIt.id);
        const lTime = localIt.updatedAt || 0;
        const rTime = remoteIt.updatedAt || 0;
        if (lTime >= rTime) {
          mergedMap.set(localIt.id, localIt);
        }
      }
    });

    const mergedItems = Array.from(mergedMap.values());
    mergedItems.sort((a, b) => calculateRecordUrgency(a).minDays - calculateRecordUrgency(b).minDays);

    // Update local storage
    const localNeedsUpdate = !areItemListsEqual(localItems, mergedItems);
    if (localNeedsUpdate) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedItems));
      renderRecords();
      updateStats();
      triggerNotificationCheck();
    }

    // Push remote
    const remoteNeedsUpdate = !areItemListsEqual(remoteItems, mergedItems);
    if (remoteNeedsUpdate) {
      const payload = JSON.stringify({
        items: mergedItems,
        lastSync: Date.now(),
        updatedBy: navigator.userAgent
      });

      await fetch(CLOUD_ENDPOINT, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: payload
      });
    }

    updateSyncBadge('synced');
  } catch (err) {
    console.warn('[Leb Sync] Warning:', err);
    updateSyncBadge('error');
  } finally {
    isSyncing = false;
    if (isManual && manualBtn) {
      setTimeout(() => manualBtn.classList.remove('sync-spin-icon'), 400);
    }
    if (syncQueued) {
      syncQueued = false;
      setTimeout(() => syncWithCloud(), 300);
    }
  }
}

// --- 6. Initial Fleet Data (Araçlar: Çekici, Dorse, Otomobil) ---
function getFutureDate(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

const SEED_RECORDS = [
  // Araç 1: Çekici (Kritik - 4 gün)
  {
    id: 'veh_1',
    type: 'vehicle',
    title: '34 LEB 1919',
    subType: 'Çekici',
    inspectionDate: getFutureDate(4),
    insuranceDate: getFutureDate(110),
    greenCardDate: getFutureDate(24),
    notes: 'Avrupa hattı ana çekici',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  // Araç 2: Dorse (Yaklaşan - 18 gün)
  {
    id: 'veh_2',
    type: 'vehicle',
    title: '34 LEB 2023',
    subType: 'Dorse',
    inspectionDate: getFutureDate(18),
    insuranceDate: getFutureDate(200),
    greenCardDate: getFutureDate(18),
    notes: 'Krone Frigo Dorse',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  // Araç 3: Otomobil (Güvenli - 150 gün)
  {
    id: 'veh_3',
    type: 'vehicle',
    title: '34 TR 5500',
    subType: 'Otomobil',
    inspectionDate: getFutureDate(150),
    insuranceDate: getFutureDate(90),
    greenCardDate: null,
    notes: 'Şirket binek aracı',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  // Sürücü 1: Vize Yaklaşan (7 gün)
  {
    id: 'drv_1',
    type: 'driver',
    title: 'Ahmet Yılmaz',
    subType: 'Kaptan Şoför',
    visaDate: getFutureDate(7),
    licenseDate: getFutureDate(260),
    passport: 'U14589210',
    notes: 'Almanya Schengen vizesi',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  // Sürücü 2: Vize Süresi Dolmuş (-2 gün)
  {
    id: 'drv_2',
    type: 'driver',
    title: 'Mehmet Kaya',
    subType: 'Kaptan Şoför',
    visaDate: getFutureDate(-2),
    licenseDate: getFutureDate(50),
    passport: 'U88231019',
    notes: 'Konsolosluk vize randevusu bekliyor',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  // Sürücü 3: Güvenli
  {
    id: 'drv_3',
    type: 'driver',
    title: 'Ali Demir',
    subType: 'Kaptan Şoför',
    visaDate: getFutureDate(120),
    licenseDate: getFutureDate(310),
    passport: 'U99421102',
    notes: 'Yurtiçi ve Gürcistan hattı',
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
    const parsed = JSON.parse(data);
    if (includeDeleted) return parsed;
    return parsed.filter(r => !r.deleted);
  } catch (e) {
    console.error('[Storage] Read error:', e);
    return [];
  }
}

function saveRecordsLocally(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
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
    if (rec.inspectionDate) dates.push({ label: 'TÜVTÜRK Muayene', date: rec.inspectionDate });
    if (rec.insuranceDate) dates.push({ label: 'Sigorta', date: rec.insuranceDate });
    if (rec.greenCardDate) dates.push({ label: 'Yeşil Kart', date: rec.greenCardDate });
  } else {
    if (rec.visaDate) dates.push({ label: 'Vize Bitiş', date: rec.visaDate });
    if (rec.licenseDate) dates.push({ label: 'Ehliyet / SRC', date: rec.licenseDate });
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
    return { status: 'safe', text: 'Tarih Girilmedi', minDays: 999, label: '' };
  }

  if (minDays < 0) {
    return {
      status: 'critical',
      text: `${Math.abs(minDays)} gün önce doldu! ⚠️`,
      minDays,
      label: mostUrgentLabel
    };
  }
  if (minDays === 0) {
    return {
      status: 'critical',
      text: 'Bugün Son Gün! 🚨',
      minDays: 0,
      label: mostUrgentLabel
    };
  }
  if (minDays <= 7) {
    return {
      status: 'critical',
      text: `${minDays} gün kaldı! 🔴`,
      minDays,
      label: mostUrgentLabel
    };
  }
  if (minDays <= 30) {
    return {
      status: 'warning',
      text: `${minDays} gün kaldı 🟡`,
      minDays,
      label: mostUrgentLabel
    };
  }
  return {
    status: 'safe',
    text: `${minDays} gün var 🟢`,
    minDays,
    label: mostUrgentLabel
  };
}

function formatDateTurkish(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// --- 9. Section Management (Araçlar vs Sürücüler) ---
let activeSection = 'vehicles'; // 'vehicles' or 'drivers'
let activeFilter = 'all';
let currentSearch = '';

function setupSectionTabs() {
  const btnVehicles = document.getElementById('tabVehicles');
  const btnDrivers = document.getElementById('tabDrivers');
  const addBtnLabel = document.getElementById('addBtnLabel');

  function switchSection(section) {
    activeSection = section;
    activeFilter = 'all';

    if (btnVehicles && btnDrivers) {
      if (section === 'vehicles') {
        btnVehicles.classList.add('active');
        btnVehicles.setAttribute('aria-selected', 'true');
        btnDrivers.classList.remove('active');
        btnDrivers.setAttribute('aria-selected', 'false');
        if (addBtnLabel) addBtnLabel.textContent = 'Yeni Araç Ekle';
      } else {
        btnDrivers.classList.add('active');
        btnDrivers.setAttribute('aria-selected', 'true');
        btnVehicles.classList.remove('active');
        btnVehicles.setAttribute('aria-selected', 'false');
        if (addBtnLabel) addBtnLabel.textContent = 'Yeni Sürücü Ekle';
      }
    }

    renderSubFilters();
    renderRecords(true);
    updateStats();
  }

  if (btnVehicles) btnVehicles.addEventListener('click', () => switchSection('vehicles'));
  if (btnDrivers) btnDrivers.addEventListener('click', () => switchSection('drivers'));
}

function renderSubFilters() {
  const track = document.getElementById('subFiltersTrack');
  if (!track) return;

  track.innerHTML = '';

  let pills = [];
  if (activeSection === 'vehicles') {
    pills = [
      { id: 'all', label: 'Tümü' },
      { id: 'Çekici', label: '🚚 Çekici' },
      { id: 'Dorse', label: '🚛 Dorse' },
      { id: 'Otomobil', label: '🚗 Otomobil' },
      { id: 'critical', label: '🔴 Kritik Muayene' },
      { id: 'warning', label: '🟡 Yaklaşan' }
    ];
  } else {
    pills = [
      { id: 'all', label: 'Tümü' },
      { id: 'critical', label: '🔴 Kritik Vize' },
      { id: 'warning', label: '🟡 Yaklaşan' },
      { id: 'safe', label: '🟢 Sorunsuz' }
    ];
  }

  pills.forEach(p => {
    const btn = document.createElement('button');
    btn.className = `neu-pill ${activeFilter === p.id ? 'active' : ''}`;
    btn.textContent = p.label;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.neu-pill').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = p.id;
      renderRecords();
    });
    track.appendChild(btn);
  });
}

// --- 10. DOM Rendering (Strictly No Edit on Mobile) ---
function renderRecords(force = false) {
  const grid = document.getElementById('recordsGrid');
  const emptyState = document.getElementById('emptyState');
  if (!grid) return;

  const allRecords = getStoredRecords(false);
  const isMobile = isMobileDevice();

  // 1. Filter by Active Section (Strict Separation!)
  const targetType = activeSection === 'vehicles' ? 'vehicle' : 'driver';
  let sectionRecords = allRecords.filter(r => r.type === targetType);

  // 2. Filter by Search Query
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    sectionRecords = sectionRecords.filter(r => {
      const matchTitle = (r.title || '').toLowerCase().includes(q);
      const matchSub = (r.subType || '').toLowerCase().includes(q);
      const matchNotes = (r.notes || '').toLowerCase().includes(q);
      return matchTitle || matchSub || matchNotes;
    });
  }

  // 3. Filter by Sub-filter Pill
  if (activeFilter !== 'all') {
    sectionRecords = sectionRecords.filter(r => {
      const urgency = calculateRecordUrgency(r);
      if (activeFilter === 'critical') return urgency.status === 'critical';
      if (activeFilter === 'warning') return urgency.status === 'warning';
      if (activeFilter === 'safe') return urgency.status === 'safe';
      // Specific vehicle type filters (Çekici, Dorse, Otomobil)
      return r.subType === activeFilter;
    });
  }

  // 4. Sort by Urgency (Most urgent first)
  sectionRecords.sort((a, b) => calculateRecordUrgency(a).minDays - calculateRecordUrgency(b).minDays);

  // Smart Hash Check for Zero Jitter
  const stateHash = JSON.stringify({
    sec: activeSection,
    flt: activeFilter,
    q: currentSearch,
    mob: isMobile,
    data: sectionRecords
  });

  if (!force && stateHash === lastRenderedHash) {
    return;
  }
  lastRenderedHash = stateHash;

  grid.innerHTML = '';

  if (sectionRecords.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  sectionRecords.forEach(rec => {
    const urgency = calculateRecordUrgency(rec);
    const card = document.createElement('article');
    card.className = 'neu-card';

    const isVeh = rec.type === 'vehicle';
    let avatar = '🚗';
    if (isVeh) {
      if (rec.subType === 'Çekici') avatar = '🚚';
      else if (rec.subType === 'Dorse') avatar = '🚛';
      else avatar = '🚗';
    } else {
      avatar = '👤';
    }

    // Build Compliance Rows
    let rowsHtml = '';
    if (isVeh) {
      rowsHtml += buildRowHtml('🛠️', 'TÜVTÜRK Muayene', rec.inspectionDate);
      if (rec.insuranceDate) rowsHtml += buildRowHtml('📄', 'Sigorta / Kasko', rec.insuranceDate);
      if (rec.greenCardDate) rowsHtml += buildRowHtml('🌐', 'Yeşil Sigorta', rec.greenCardDate);
    } else {
      rowsHtml += buildRowHtml('🛂', 'Vize Bitiş (Schengen)', rec.visaDate);
      if (rec.licenseDate) rowsHtml += buildRowHtml('🪪', 'Ehliyet / SRC', rec.licenseDate);
      if (rec.passport) {
        rowsHtml += `
          <div class="neu-row">
            <div class="row-left"><span>📘</span><span>Pasaport</span></div>
            <div class="row-right"><span class="row-date">${escapeHtml(rec.passport)}</span></div>
          </div>
        `;
      }
    }

    // DESKTOP-ONLY ACTIONS: On Mobile, NEVER render edit/delete buttons!
    let actionsHtml = '';
    if (!isMobile) {
      actionsHtml = `
        <div class="card-actions">
          <button class="neu-action-btn btn-renew" data-id="${rec.id}">
            <span>📅 Tarih Güncelle</span>
          </button>
          <button class="neu-action-btn btn-danger btn-delete" data-id="${rec.id}" title="Kaydı Sil">
            <span>🗑️ Sil</span>
          </button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="card-head">
        <div class="head-identity">
          <div class="avatar-badge">${avatar}</div>
          <div class="head-texts">
            <span class="${isVeh ? 'plate-text' : 'driver-text'}">${escapeHtml(rec.title)}</span>
            <span class="type-tag">${escapeHtml(rec.subType || '')}</span>
          </div>
        </div>
        <div class="card-urgency-badge ${urgency.status}">
          <span>${urgency.text}</span>
        </div>
      </div>

      <div class="card-rows">
        ${rowsHtml}
      </div>

      ${rec.notes ? `<div class="card-notes">📝 ${escapeHtml(rec.notes)}</div>` : ''}

      ${actionsHtml}
    `;

    // Wire desktop actions
    if (!isMobile) {
      const renewBtn = card.querySelector('.btn-renew');
      if (renewBtn) {
        renewBtn.addEventListener('click', () => openQuickModal(rec.id));
      }

      const deleteBtn = card.querySelector('.btn-delete');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => deleteRecord(rec.id));
      }
    }

    grid.appendChild(card);
  });
}

function buildRowHtml(icon, label, dateStr) {
  if (!dateStr) return '';
  const days = getDaysRemaining(dateStr);
  let statusClass = 'safe';
  let tagText = `${days} gün`;

  if (days < 0) {
    statusClass = 'critical';
    tagText = `${Math.abs(days)}g geçti!`;
  } else if (days === 0) {
    statusClass = 'critical';
    tagText = 'Bugün!';
  } else if (days <= 7) {
    statusClass = 'critical';
    tagText = `${days} gün!`;
  } else if (days <= 30) {
    statusClass = 'warning';
    tagText = `${days} gün`;
  }

  return `
    <div class="neu-row">
      <div class="row-left">
        <span>${icon}</span>
        <span>${label}</span>
      </div>
      <div class="row-right">
        <span class="row-date">${formatDateTurkish(dateStr)}</span>
        <span class="row-tag ${statusClass}">${tagText}</span>
      </div>
    </div>
  `;
}

function updateStats() {
  const allRecords = getStoredRecords(false);

  // 1. Badge counters on the main segmented buttons
  const vehCount = allRecords.filter(r => r.type === 'vehicle').length;
  const drvCount = allRecords.filter(r => r.type === 'driver').length;

  const bVeh = document.getElementById('badgeVehiclesCount');
  const bDrv = document.getElementById('badgeDriversCount');
  if (bVeh) bVeh.textContent = vehCount;
  if (bDrv) bDrv.textContent = drvCount;

  // 2. Summary stats for the active section only
  const targetType = activeSection === 'vehicles' ? 'vehicle' : 'driver';
  const records = allRecords.filter(r => r.type === targetType);

  let crit = 0;
  let warn = 0;
  let safe = 0;

  records.forEach(r => {
    const u = calculateRecordUrgency(r);
    if (u.status === 'critical') crit++;
    else if (u.status === 'warning') warn++;
    else safe++;
  });

  const elTotal = document.getElementById('statTotal');
  const elCrit = document.getElementById('statCritical');
  const elWarn = document.getElementById('statWarning');
  const elSafe = document.getElementById('statSafe');

  if (elTotal) elTotal.textContent = records.length;
  if (elCrit) elCrit.textContent = crit;
  if (elWarn) elWarn.textContent = warn;
  if (elSafe) elSafe.textContent = safe;
}

// --- 11. Desktop Management: Add Record Modal ---
function setupAddModal() {
  const modal = document.getElementById('addModal');
  const openBtn = document.getElementById('openAddModalBtn');
  const closeBtn = document.getElementById('closeAddModalBtn');
  const cancelVeh = document.getElementById('cancelVehicleBtn');
  const cancelDrv = document.getElementById('cancelDriverBtn');

  const swVeh = document.getElementById('modalSwitchVehicle');
  const swDrv = document.getElementById('modalSwitchDriver');
  const fVeh = document.getElementById('vehicleForm');
  const fDrv = document.getElementById('driverForm');

  // Hide open button completely on mobile!
  if (isMobileDevice() && openBtn) {
    openBtn.style.display = 'none';
  }

  function openModal() {
    if (isMobileDevice()) return; // Strict guard!
    if (modal) modal.classList.add('active');

    // Auto-switch modal form to match current section
    if (activeSection === 'vehicles') {
      if (swVeh && swDrv && fVeh && fDrv) {
        swVeh.classList.add('active');
        swDrv.classList.remove('active');
        fVeh.style.display = 'flex';
        fDrv.style.display = 'none';
      }
    } else {
      if (swVeh && swDrv && fVeh && fDrv) {
        swDrv.classList.add('active');
        swVeh.classList.remove('active');
        fDrv.style.display = 'flex';
        fVeh.style.display = 'none';
      }
    }
  }

  function closeModal() {
    if (modal) modal.classList.remove('active');
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelVeh) cancelVeh.addEventListener('click', closeModal);
  if (cancelDrv) cancelDrv.addEventListener('click', closeModal);

  if (swVeh && swDrv && fVeh && fDrv) {
    swVeh.addEventListener('click', () => {
      swVeh.classList.add('active');
      swDrv.classList.remove('active');
      fVeh.style.display = 'flex';
      fDrv.style.display = 'none';
    });

    swDrv.addEventListener('click', () => {
      swDrv.classList.add('active');
      swVeh.classList.remove('active');
      fDrv.style.display = 'flex';
      fVeh.style.display = 'none';
    });
  }

  // Vehicle Submit
  if (fVeh) {
    fVeh.addEventListener('submit', (e) => {
      e.preventDefault();
      const plate = document.getElementById('inputPlate').value.trim().toUpperCase();
      const type = document.getElementById('selectVehicleType').value;
      const inspectionDate = document.getElementById('inputInspectionDate').value;
      const insuranceDate = document.getElementById('inputInsuranceDate').value;
      const greenCardDate = document.getElementById('inputGreenCardDate').value;
      const notes = document.getElementById('inputVehicleNotes').value.trim();

      if (!plate || !inspectionDate) {
        alert('Lütfen plaka ve muayene bitiş tarihini girin.');
        return;
      }

      addRecord({
        type: 'vehicle',
        title: plate,
        subType: type, // Çekici, Dorse, Otomobil
        inspectionDate,
        insuranceDate: insuranceDate || null,
        greenCardDate: greenCardDate || null,
        notes
      });

      fVeh.reset();
      closeModal();
    });
  }

  // Driver Submit
  if (fDrv) {
    fDrv.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('inputDriverName').value.trim();
      const visaDate = document.getElementById('inputVisaDate').value;
      const licenseDate = document.getElementById('inputLicenseDate').value;
      const passport = document.getElementById('inputPassport').value.trim();
      const notes = document.getElementById('inputDriverNotes').value.trim();

      if (!name || !visaDate) {
        alert('Lütfen sürücü adı ve vize bitiş tarihini girin.');
        return;
      }

      addRecord({
        type: 'driver',
        title: name,
        subType: 'Kaptan Şoför',
        visaDate,
        licenseDate: licenseDate || null,
        passport: passport || null,
        notes
      });

      fDrv.reset();
      closeModal();
    });
  }
}

// --- 12. Desktop Management: Quick Renewal Modal ---
let activeRenewalId = null;

function openQuickModal(id) {
  if (isMobileDevice()) return; // Strict guard!

  const records = getStoredRecords(false);
  const rec = records.find(r => r.id === id);
  if (!rec) return;

  activeRenewalId = id;

  const modal = document.getElementById('quickModal');
  const titleEl = document.getElementById('quickRecordTitle');
  const selectEl = document.getElementById('quickFieldSelect');
  const dateInput = document.getElementById('quickDateInput');

  if (titleEl) titleEl.textContent = `${rec.title} (${rec.subType || ''})`;

  if (selectEl) {
    selectEl.innerHTML = '';
    if (rec.type === 'vehicle') {
      selectEl.innerHTML = `
        <option value="inspectionDate">🛠️ TÜVTÜRK Muayene Bitiş (${formatDateTurkish(rec.inspectionDate)})</option>
        <option value="insuranceDate">📄 Sigorta / Kasko Bitiş (${formatDateTurkish(rec.insuranceDate)})</option>
        <option value="greenCardDate">🌐 Yeşil Sigorta (${formatDateTurkish(rec.greenCardDate)})</option>
      `;
    } else {
      selectEl.innerHTML = `
        <option value="visaDate">🛂 Vize Bitiş Tarihi (${formatDateTurkish(rec.visaDate)})</option>
        <option value="licenseDate">🪪 Ehliyet / SRC (${formatDateTurkish(rec.licenseDate)})</option>
      `;
    }
  }

  // Pre-fill +1 year
  if (dateInput) {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    dateInput.value = d.toISOString().split('T')[0];
  }

  if (modal) modal.classList.add('active');
}

function closeQuickModal() {
  const modal = document.getElementById('quickModal');
  if (modal) modal.classList.remove('active');
  activeRenewalId = null;
}

function saveQuickRenewal() {
  if (!activeRenewalId || isMobileDevice()) return;

  const selectEl = document.getElementById('quickFieldSelect');
  const dateInput = document.getElementById('quickDateInput');
  if (!selectEl || !dateInput || !dateInput.value) return;

  const field = selectEl.value;
  const newDate = dateInput.value;

  const all = getStoredRecords(true);
  const target = all.find(r => r.id === activeRenewalId);
  if (target) {
    target[field] = newDate;
    target.updatedAt = Date.now();
    saveRecordsLocally(all);
    renderRecords(true);
    closeQuickModal();
    syncWithCloud({ isManual: false });
  }
}

// --- 13. Record Mutations ---
function addRecord(data) {
  const all = getStoredRecords(true);
  const newRec = {
    id: 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false,
    ...data
  };

  all.unshift(newRec);
  saveRecordsLocally(all);
  renderRecords(true);
  syncWithCloud({ isManual: false });
}

function deleteRecord(id) {
  if (isMobileDevice()) return; // Strict guard!

  const all = getStoredRecords(true);
  const target = all.find(r => r.id === id);
  if (target) {
    if (confirm(`"${target.title}" kaydını silmek istediğinize emin misiniz?`)) {
      target.deleted = true;
      target.updatedAt = Date.now();
      saveRecordsLocally(all);
      renderRecords(true);
      syncWithCloud({ isManual: false });
    }
  }
}

// --- 14. Event Wiring & Startup ---
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupNetworkMonitoring();
  setupNotifications();
  setupSectionTabs();
  setupAddModal();
  renderSubFilters();
  renderRecords(true);
  updateStats();

  // Initial Sync
  if (navigator.onLine) {
    syncWithCloud({ isManual: false });
  }

  // Bottom Manual Sync Button
  const syncBtn = document.getElementById('manualSyncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      syncWithCloud({ isManual: true });
    });
  }

  // Search Input
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      currentSearch = e.target.value.trim();
      if (clearSearchBtn) {
        clearSearchBtn.style.display = currentSearch ? 'block' : 'none';
      }
      renderRecords();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      currentSearch = '';
      clearSearchBtn.style.display = 'none';
      renderRecords();
    });
  }

  // Summary Stat Cards as Quick Filter
  document.querySelectorAll('.neu-stat-card').forEach(card => {
    card.addEventListener('click', () => {
      const f = card.dataset.filter;
      if (f) {
        activeFilter = f;
        document.querySelectorAll('.neu-pill').forEach(p => {
          if (p.dataset.filter === f) p.classList.add('active');
          else p.classList.remove('active');
        });
        renderRecords();
      }
    });
  });

  // Quick Renewal Modal Actions
  const closeQuickBtn = document.getElementById('closeQuickModalBtn');
  const cancelQuickBtn = document.getElementById('cancelQuickBtn');
  const saveQuickBtn = document.getElementById('saveQuickBtn');

  if (closeQuickBtn) closeQuickBtn.addEventListener('click', closeQuickModal);
  if (cancelQuickBtn) cancelQuickBtn.addEventListener('click', closeQuickModal);
  if (saveQuickBtn) saveQuickBtn.addEventListener('click', saveQuickRenewal);

  // Date Preset Pills (+6 Ay, +1 Yıl, +2 Yıl)
  document.querySelectorAll('.preset-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.preset-pill').forEach(b => b.classList.remove('active'));
      pill.classList.add('active');
      const months = parseInt(pill.dataset.months || '12', 10);
      const input = document.getElementById('quickDateInput');
      if (input) {
        const d = new Date();
        d.setMonth(d.getMonth() + months);
        input.value = d.toISOString().split('T')[0];
      }
    });
  });

  // Reset Filters Button in Empty State
  const btnReset = document.getElementById('btnResetFilters');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      activeFilter = 'all';
      currentSearch = '';
      if (searchInput) searchInput.value = '';
      if (clearSearchBtn) clearSearchBtn.style.display = 'none';
      renderSubFilters();
      renderRecords();
    });
  }

  // Toast Button
  const updateBtn = document.getElementById('btnUpdateApp');
  if (updateBtn) {
    updateBtn.addEventListener('click', applyUpdate);
  }

  // Auto-sync on Tab Focus, Window Focus, or Phone Unlock
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      syncWithCloud({ isManual: false });
      triggerNotificationCheck();
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(reg => reg.update()).catch(() => {});
      }
    }
  });

  window.addEventListener('focus', () => {
    if (navigator.onLine) {
      syncWithCloud({ isManual: false });
      triggerNotificationCheck();
    }
  });

  // Background silent polling every 3.5 seconds
  setInterval(() => {
    if (navigator.onLine && document.visibilityState === 'visible') {
      syncWithCloud({ isManual: false });
    }
  }, 3500);
});

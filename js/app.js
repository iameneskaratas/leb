/**
 * Leb Lojistik - Apple Spatial UI (visionOS) Compliance & Fleet Engine (v3.0.0)
 * Features: Vehicle Inspection & Visa Tracking, Urgency Countdown,
 * Role Differentiation (Desktop Management vs Mobile Monitoring),
 * Web Notifications API, and Zero-Jitter Bi-Directional Cloud Sync
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
    if (isOnline) {
      updateSyncBadge('synced');
      syncWithCloud({ isManual: false });
    } else {
      updateSyncBadge('offline');
    }
  }

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);
}

// --- 3. Device Mode Detection (Desktop Management vs Mobile Viewing) ---
let isMobileDevice = false;
let mobileAdminUnlocked = false;

function detectDeviceMode() {
  const ua = navigator.userAgent.toLowerCase();
  isMobileDevice = /iphone|ipad|ipod|android/i.test(ua) || window.innerWidth <= 768;

  const modeBadge = document.getElementById('deviceModeBadge');
  const modeIcon = document.getElementById('deviceModeIcon');
  const modeText = document.getElementById('deviceModeText');
  const desktopWrap = document.querySelector('.desktop-action-wrap');

  if (isMobileDevice) {
    if (modeBadge) modeBadge.className = 'mode-pill mobile-mode';
    if (modeIcon) modeIcon.textContent = '📱';
    if (modeText) modeText.textContent = mobileAdminUnlocked ? 'Yönetici (Açık)' : 'Canlı İzleme';
    
    if (desktopWrap) {
      if (mobileAdminUnlocked) {
        desktopWrap.classList.add('admin-active');
      } else {
        desktopWrap.classList.remove('admin-active');
      }
    }
  } else {
    if (modeBadge) modeBadge.className = 'mode-pill';
    if (modeIcon) modeIcon.textContent = '🖥️';
    if (modeText) modeText.textContent = 'Yönetim Modu';
    if (desktopWrap) desktopWrap.classList.add('admin-active');
  }
}

// --- 4. Push & Local Web Notifications Engine ---
function setupNotifications() {
  const banner = document.getElementById('notificationBanner');
  const enableBtn = document.getElementById('btnEnableNotifications');

  if (!('Notification' in window)) {
    if (banner) banner.style.display = 'none';
    return;
  }

  if (Notification.permission === 'default' && isMobileDevice && banner) {
    banner.style.display = 'flex';
  }

  if (enableBtn) {
    enableBtn.addEventListener('click', async () => {
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
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
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  const lastNotif = parseInt(localStorage.getItem('leb_last_notif_ts') || '0', 10);
  const now = Date.now();
  // Check at most once every 6 hours unless forced
  if (!force && (now - lastNotif < 6 * 3600 * 1000)) {
    return;
  }

  const records = getStoredRecords(false);
  const urgentItems = [];

  records.forEach(rec => {
    const urgency = calculateRecordUrgency(rec);
    if (urgency.minDays <= 15) {
      urgentItems.push({
        title: rec.title,
        type: rec.type === 'vehicle' ? 'Muayene' : 'Vize',
        text: urgency.text,
        days: urgency.minDays
      });
    }
  });

  if (urgentItems.length > 0) {
    localStorage.setItem('leb_last_notif_ts', String(now));
    const first = urgentItems[0];
    const notifTitle = `Leb Lojistik: ${urgentItems.length} Kayıt Dikkat İstiyor!`;
    const notifBody = `${first.title} (${first.type}): ${first.text}` + 
      (urgentItems.length > 1 ? ` ve ${urgentItems.length - 1} kayıt daha.` : '');

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
    } catch (err) {
      console.warn('[Notification] Send error:', err);
    }
  }
}

// --- 5. Unified Cloud Sync Engine (Firebase Realtime DB) ---
const CLOUD_ENDPOINT = 'https://leb1919-default-rtdb.firebaseio.com/leb_store.json';
const STORAGE_KEY = 'leb_logistics_fleet_v1';

let isSyncing = false;
let syncQueued = false;
let lastRenderedHash = '';

function updateSyncBadge(status) {
  const indicator = document.getElementById('syncStatusIndicator');
  const icon = document.getElementById('syncStatusIcon');
  const text = document.getElementById('syncStatusText');

  if (!indicator || !icon || !text) return;

  indicator.className = `sync-pill ${status}`;

  if (status === 'synced') {
    icon.textContent = '☁️';
    text.textContent = 'Eşitlendi';
  } else if (status === 'offline') {
    icon.textContent = '📶';
    text.textContent = 'Çevrimdışı';
  } else if (status === 'error') {
    icon.textContent = '⚠️';
    text.textContent = 'Bağlantı Hatası';
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

    // Ingest remote items
    remoteItems.forEach(it => {
      if (it && it.id) mergedMap.set(it.id, it);
    });

    // Merge local items with Last-Write-Wins
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
    mergedItems.sort((a, b) => {
      // Sort primarily by urgency (least days left first)
      const uA = calculateRecordUrgency(a).minDays;
      const uB = calculateRecordUrgency(b).minDays;
      return uA - uB;
    });

    // Local update
    const localNeedsUpdate = !areItemListsEqual(localItems, mergedItems);
    if (localNeedsUpdate) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mergedItems));
      renderRecords();
      updateAnalytics();
      triggerNotificationCheck();
    }

    // Remote push
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

// --- 6. Initial Seed Logistics Data ---
const SEED_LOGISTICS_RECORDS = [
  {
    id: 'rec_veh_1',
    type: 'vehicle',
    title: '34 LEB 1919',
    subType: 'Çekici (Scania R500)',
    inspectionDate: getFutureDateStr(4), // 4 days left (🔴 Critical)
    insuranceDate: getFutureDateStr(105),
    greenCardDate: getFutureDateStr(24), // 24 days left (🟡 Warning)
    notes: 'Avrupa hattı aktif araç',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'rec_drv_1',
    type: 'driver',
    title: 'Ahmet Yılmaz',
    subType: 'Kaptan Şoför (Balkanlar / AB)',
    visaDate: getFutureDateStr(7), // 7 days left (🔴 Critical)
    licenseDate: getFutureDateStr(240),
    passport: 'U14589210 (2028)',
    notes: 'Almanya Schengen vizesi yenileme sürecinde',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'rec_veh_2',
    type: 'vehicle',
    title: '34 LEB 2023',
    subType: 'Dorse / Römork (Krone Frigo)',
    inspectionDate: getFutureDateStr(18), // 18 days left (🟡 Warning)
    insuranceDate: getFutureDateStr(180),
    greenCardDate: getFutureDateStr(18),
    notes: 'Frigo soğutucu bakımı tamamlandı',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'rec_drv_2',
    type: 'driver',
    title: 'Mehmet Kaya',
    subType: 'Kaptan Şoför (Yurtiçi & İtalya)',
    visaDate: getFutureDateStr(-2), // 2 days ago expired (🔴 Expired)
    licenseDate: getFutureDateStr(45),
    passport: 'U88231019 (2027)',
    notes: 'Vize randevusu alındı, konsolosluk bekleniyor',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  },
  {
    id: 'rec_veh_3',
    type: 'vehicle',
    title: '34 TR 5500',
    subType: 'Kamyon (Mercedes Actros)',
    inspectionDate: getFutureDateStr(140), // 140 days (🟢 Safe)
    insuranceDate: getFutureDateStr(95),
    greenCardDate: getFutureDateStr(140),
    notes: 'Yedek araç',
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false
  }
];

function getFutureDateStr(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

// --- 7. Local Storage Operations ---
function getStoredRecords(includeDeleted = false) {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_LOGISTICS_RECORDS));
      return includeDeleted ? SEED_LOGISTICS_RECORDS : SEED_LOGISTICS_RECORDS.filter(r => !r.deleted);
    }
    const parsed = JSON.parse(data);
    if (includeDeleted) return parsed;
    return parsed.filter(r => !r.deleted);
  } catch (e) {
    console.error('[Storage] Error:', e);
    return [];
  }
}

function saveRecordsLocally(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
    updateAnalytics();
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
    return { status: 'safe', text: 'Tarih Girilmedi', minDays: 999 };
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

// --- 9. Spatial DOM Rendering ---
let currentFilter = 'all';
let currentSearch = '';

function renderRecords(force = false) {
  const listContainer = document.getElementById('recordsList');
  const emptyState = document.getElementById('emptyState');
  if (!listContainer) return;

  const records = getStoredRecords(false);

  // Filter & Search
  const filtered = records.filter(rec => {
    if (currentSearch) {
      const q = currentSearch.toLowerCase();
      const matchTitle = (rec.title || '').toLowerCase().includes(q);
      const matchSub = (rec.subType || '').toLowerCase().includes(q);
      const matchNotes = (rec.notes || '').toLowerCase().includes(q);
      if (!matchTitle && !matchSub && !matchNotes) return false;
    }

    const urgency = calculateRecordUrgency(rec);

    if (currentFilter === 'all') return true;
    if (currentFilter === 'critical') return urgency.status === 'critical';
    if (currentFilter === 'warning') return urgency.status === 'warning';
    if (currentFilter === 'safe') return urgency.status === 'safe';
    if (currentFilter === 'vehicle') return rec.type === 'vehicle';
    if (currentFilter === 'driver') return rec.type === 'driver';
    return true;
  });

  filtered.sort((a, b) => {
    const uA = calculateRecordUrgency(a).minDays;
    const uB = calculateRecordUrgency(b).minDays;
    return uA - uB;
  });

  const stateHash = JSON.stringify({
    items: filtered,
    filter: currentFilter,
    search: currentSearch,
    isMobile: isMobileDevice,
    adminUnlocked: mobileAdminUnlocked
  });

  if (!force && stateHash === lastRenderedHash) {
    return;
  }
  lastRenderedHash = stateHash;

  listContainer.innerHTML = '';

  if (filtered.length === 0) {
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }
  if (emptyState) emptyState.style.display = 'none';

  filtered.forEach(rec => {
    const urgency = calculateRecordUrgency(rec);
    const card = document.createElement('article');
    card.className = 'spatial-record-card';

    const isVeh = rec.type === 'vehicle';
    const avatarIcon = isVeh ? (rec.subType && rec.subType.includes('Dorse') ? '🚛' : '🚚') : '👤';

    let rowsHtml = '';
    if (isVeh) {
      rowsHtml += buildComplianceRowHtml('🛠️', 'TÜVTÜRK Muayene', rec.inspectionDate);
      if (rec.insuranceDate) rowsHtml += buildComplianceRowHtml('📄', 'Trafik Sigortası', rec.insuranceDate);
      if (rec.greenCardDate) rowsHtml += buildComplianceRowHtml('🌐', 'Yeşil Sigorta (Yurtdışı)', rec.greenCardDate);
    } else {
      rowsHtml += buildComplianceRowHtml('🛂', 'Vize Bitiş (Schengen vb.)', rec.visaDate);
      if (rec.licenseDate) rowsHtml += buildComplianceRowHtml('🪪', 'Ehliyet / SRC / Psikoteknik', rec.licenseDate);
      if (rec.passport) {
        rowsHtml += `
          <div class="compliance-row">
            <div class="compliance-info">
              <span class="compliance-icon">📘</span>
              <span class="compliance-name">Pasaport</span>
            </div>
            <div class="compliance-dates">
              <span class="date-text">${escapeHtml(rec.passport)}</span>
            </div>
          </div>
        `;
      }
    }

    const canEdit = !isMobileDevice || mobileAdminUnlocked;
    let actionsHtml = '';
    if (canEdit) {
      actionsHtml = `
        <div class="card-actions-footer">
          <button class="action-btn-pill btn-quick-renew" data-id="${rec.id}">
            <span>📅</span>
            <span>Tarih Güncelle</span>
          </button>
          <button class="action-btn-pill danger btn-delete-rec" data-id="${rec.id}" title="Kaydı Sil">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      `;
    }

    card.innerHTML = `
      <div class="record-card-header">
        <div class="record-identity">
          <div class="record-avatar">${avatarIcon}</div>
          <div class="record-titles">
            ${isVeh 
              ? `<span class="plate-badge">${escapeHtml(rec.title)}</span>`
              : `<span class="driver-name">${escapeHtml(rec.title)}</span>`}
            <span class="record-sub-type">${escapeHtml(rec.subType || '')}</span>
          </div>
        </div>
        <div class="urgency-pill ${urgency.status}">
          <span>${urgency.text}</span>
        </div>
      </div>

      <div class="compliance-items-list">
        ${rowsHtml}
      </div>

      ${rec.notes ? `<div style="font-size: 11px; color: var(--text-dim); margin-bottom: 8px;">📝 ${escapeHtml(rec.notes)}</div>` : ''}

      ${actionsHtml}
    `;

    if (canEdit) {
      const renewBtn = card.querySelector('.btn-quick-renew');
      if (renewBtn) {
        renewBtn.addEventListener('click', () => openQuickRenewalModal(rec.id));
      }

      const deleteBtn = card.querySelector('.btn-delete-rec');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => deleteRecord(rec.id));
      }
    }

    listContainer.appendChild(card);
  });
}

function buildComplianceRowHtml(icon, label, dateStr) {
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
    <div class="compliance-row">
      <div class="compliance-info">
        <span class="compliance-icon">${icon}</span>
        <span class="compliance-name">${label}</span>
      </div>
      <div class="compliance-dates">
        <span class="date-text">${formatDateTurkish(dateStr)}</span>
        <span class="remaining-tag ${statusClass}">${tagText}</span>
      </div>
    </div>
  `;
}

function updateAnalytics() {
  const records = getStoredRecords(false);
  let criticalCount = 0;
  let warningCount = 0;
  let safeCount = 0;

  records.forEach(rec => {
    const urgency = calculateRecordUrgency(rec);
    if (urgency.status === 'critical') criticalCount++;
    else if (urgency.status === 'warning') warningCount++;
    else safeCount++;
  });

  const totalEl = document.getElementById('statTotal');
  const critEl = document.getElementById('statCritical');
  const warnEl = document.getElementById('statWarning');
  const safeEl = document.getElementById('statSafe');

  if (totalEl) totalEl.textContent = records.length;
  if (critEl) critEl.textContent = criticalCount;
  if (warnEl) warnEl.textContent = warningCount;
  if (safeEl) safeEl.textContent = safeCount;
}

// --- 10. Record Mutations ---
function addRecord(recordData) {
  const all = getStoredRecords(true);
  const newRec = {
    id: 'rec_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    createdAt: new Date().toISOString(),
    updatedAt: Date.now(),
    deleted: false,
    ...recordData
  };

  all.unshift(newRec);
  saveRecordsLocally(all);
  renderRecords(true);
  syncWithCloud({ isManual: false });
}

function deleteRecord(id) {
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

// --- 11. Quick Renewal Modal ---
let activeRenewalRecordId = null;

function openQuickRenewalModal(recordId) {
  const records = getStoredRecords(false);
  const rec = records.find(r => r.id === recordId);
  if (!rec) return;

  activeRenewalRecordId = recordId;

  const modal = document.getElementById('quickUpdateModal');
  const titleEl = document.getElementById('quickUpdateItemTitle');
  const selectEl = document.getElementById('quickDateFieldSelect');
  const dateInput = document.getElementById('quickNewDateInput');

  if (titleEl) titleEl.textContent = `${rec.title} (${rec.subType || ''})`;

  if (selectEl) {
    selectEl.innerHTML = '';
    if (rec.type === 'vehicle') {
      selectEl.innerHTML = `
        <option value="inspectionDate">🛠️ TÜVTÜRK Muayene Bitiş (${formatDateTurkish(rec.inspectionDate)})</option>
        <option value="insuranceDate">📄 Trafik Sigortası Bitiş (${formatDateTurkish(rec.insuranceDate)})</option>
        <option value="greenCardDate">🌐 Yeşil Sigorta (${formatDateTurkish(rec.greenCardDate)})</option>
      `;
    } else {
      selectEl.innerHTML = `
        <option value="visaDate">🛂 Vize Bitiş Tarihi (${formatDateTurkish(rec.visaDate)})</option>
        <option value="licenseDate">🪪 Ehliyet / SRC / Psikoteknik (${formatDateTurkish(rec.licenseDate)})</option>
      `;
    }
  }

  if (dateInput) {
    dateInput.value = getFutureDateStr(365);
  }

  if (modal) modal.classList.add('active');
}

function closeQuickRenewalModal() {
  const modal = document.getElementById('quickUpdateModal');
  if (modal) modal.classList.remove('active');
  activeRenewalRecordId = null;
}

function saveQuickRenewal() {
  if (!activeRenewalRecordId) return;
  const selectEl = document.getElementById('quickDateFieldSelect');
  const dateInput = document.getElementById('quickNewDateInput');
  if (!selectEl || !dateInput || !dateInput.value) return;

  const field = selectEl.value;
  const newDate = dateInput.value;

  const all = getStoredRecords(true);
  const target = all.find(r => r.id === activeRenewalRecordId);
  if (target) {
    target[field] = newDate;
    target.updatedAt = Date.now();
    saveRecordsLocally(all);
    renderRecords(true);
    closeQuickRenewalModal();
    syncWithCloud({ isManual: false });
  }
}

// --- 12. Add Record Modal Management ---
function setupAddRecordModal() {
  const modal = document.getElementById('addRecordModal');
  const openBtn = document.getElementById('openAddRecordModalBtn');
  const closeBtn = document.getElementById('closeAddRecordModal');
  const cancelVeh = document.getElementById('btnCancelVehicle');
  const cancelDrv = document.getElementById('btnCancelDriver');

  const switchVeh = document.getElementById('switchTypeVehicle');
  const switchDrv = document.getElementById('switchTypeDriver');
  const vehForm = document.getElementById('vehicleForm');
  const drvForm = document.getElementById('driverForm');

  function openModal() {
    if (modal) modal.classList.add('active');
  }

  function closeModal() {
    if (modal) modal.classList.remove('active');
  }

  if (openBtn) openBtn.addEventListener('click', openModal);
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (cancelVeh) cancelVeh.addEventListener('click', closeModal);
  if (cancelDrv) cancelDrv.addEventListener('click', closeModal);

  if (switchVeh && switchDrv && vehForm && drvForm) {
    switchVeh.addEventListener('click', () => {
      switchVeh.classList.add('active');
      switchDrv.classList.remove('active');
      vehForm.style.display = 'flex';
      drvForm.style.display = 'none';
    });

    switchDrv.addEventListener('click', () => {
      switchDrv.classList.add('active');
      switchVeh.classList.remove('active');
      drvForm.style.display = 'flex';
      vehForm.style.display = 'none';
    });
  }

  if (vehForm) {
    vehForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const plate = document.getElementById('vehiclePlate').value.trim().toUpperCase();
      const type = document.getElementById('vehicleType').value;
      const inspectionDate = document.getElementById('vehicleInspectionDate').value;
      const insuranceDate = document.getElementById('vehicleInsuranceDate').value;
      const greenCardDate = document.getElementById('vehicleGreenCardDate').value;
      const notes = document.getElementById('vehicleNotes').value.trim();

      if (!plate || !inspectionDate) {
        alert('Lütfen plaka ve muayene bitiş tarihini girin.');
        return;
      }

      addRecord({
        type: 'vehicle',
        title: plate,
        subType: type,
        inspectionDate,
        insuranceDate: insuranceDate || null,
        greenCardDate: greenCardDate || null,
        notes
      });

      vehForm.reset();
      closeModal();
    });
  }

  if (drvForm) {
    drvForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('driverName').value.trim();
      const visaDate = document.getElementById('driverVisaDate').value;
      const licenseDate = document.getElementById('driverLicenseDate').value;
      const passport = document.getElementById('driverPassport').value.trim();
      const notes = document.getElementById('driverNotes').value.trim();

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

      drvForm.reset();
      closeModal();
    });
  }
}

// --- 13. DOM Ready & Event Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  setupNetworkMonitoring();
  detectDeviceMode();
  setupNotifications();
  setupAddRecordModal();
  renderRecords(true);
  updateAnalytics();

  if (navigator.onLine) {
    syncWithCloud({ isManual: false });
  }

  const syncBtn = document.getElementById('manualSyncBtn');
  if (syncBtn) {
    syncBtn.addEventListener('click', () => {
      syncWithCloud({ isManual: true });
    });
  }

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

  const filterPills = document.querySelectorAll('.spatial-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.filter || 'all';
      renderRecords();
    });
  });

  const metricCards = document.querySelectorAll('.spatial-metric-card');
  metricCards.forEach(card => {
    card.addEventListener('click', () => {
      const f = card.dataset.filter;
      if (f) {
        currentFilter = f;
        filterPills.forEach(p => {
          if (p.dataset.filter === f) p.classList.add('active');
          else p.classList.remove('active');
        });
        renderRecords();
      }
    });
  });

  const closeRenewBtn = document.getElementById('closeQuickUpdateModal');
  const cancelRenewBtn = document.getElementById('btnCancelQuickUpdate');
  const saveRenewBtn = document.getElementById('btnSaveQuickUpdate');

  if (closeRenewBtn) closeRenewBtn.addEventListener('click', closeQuickRenewalModal);
  if (cancelRenewBtn) cancelRenewBtn.addEventListener('click', closeQuickRenewalModal);
  if (saveRenewBtn) saveRenewBtn.addEventListener('click', saveQuickRenewal);

  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const months = parseInt(btn.dataset.addMonths || '12', 10);
      const dateInput = document.getElementById('quickNewDateInput');
      if (dateInput) {
        const d = new Date();
        d.setMonth(d.getMonth() + months);
        dateInput.value = d.toISOString().split('T')[0];
      }
    });
  });

  const btnEmptyReset = document.getElementById('btnEmptyReset');
  if (btnEmptyReset) {
    btnEmptyReset.addEventListener('click', () => {
      currentFilter = 'all';
      currentSearch = '';
      if (searchInput) searchInput.value = '';
      if (clearSearchBtn) clearSearchBtn.style.display = 'none';
      filterPills.forEach(p => {
        if (p.dataset.filter === 'all') p.classList.add('active');
        else p.classList.remove('active');
      });
      renderRecords();
    });
  }

  const mobileToggleBtn = document.getElementById('mobileAdminToggleBtn');
  if (mobileToggleBtn) {
    mobileToggleBtn.addEventListener('click', () => {
      if (!mobileAdminUnlocked) {
        const pin = prompt('Yönetici Modu için PIN Girin (Varsayılan: 1919):');
        if (pin === '1919' || pin === 'admin') {
          mobileAdminUnlocked = true;
          document.getElementById('mobileAdminBtnText').textContent = 'Kitle';
          detectDeviceMode();
          renderRecords(true);
        } else if (pin !== null) {
          alert('Hatalı PIN!');
        }
      } else {
        mobileAdminUnlocked = false;
        document.getElementById('mobileAdminBtnText').textContent = 'Yönetici Girişi';
        detectDeviceMode();
        renderRecords(true);
      }
    });
  }

  const updateBtn = document.getElementById('btnUpdateApp');
  if (updateBtn) {
    updateBtn.addEventListener('click', applyUpdate);
  }

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

  setInterval(() => {
    if (navigator.onLine && document.visibilityState === 'visible') {
      syncWithCloud({ isManual: false });
    }
  }, 3500);
});

const webPush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BOyB7XaqE9ZE3MsO8FgV3MPvAkaWgwVyilbPasuaDN1eSW-rZ53v1tyIYGFacwncjX6ojzGNciKuBZfIUH1xkpM';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'XZWucmkzNGhRz7gyweqbgbS8cBjQHkSCJtiS-uaA5zI';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:leb@leb-fleet.com';

webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const FIREBASE_BASE = 'https://leb1919-default-rtdb.firebaseio.com';

function getDaysRemaining(dateStr) {
  if (!dateStr) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  const diffTime = target.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 3600 * 24));
}

function formatDisplayDate(dateStr) {
  if (!dateStr) return '';
  try {
    const [year, month, day] = dateStr.split('-');
    const months = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
    const mIdx = parseInt(month, 10) - 1;
    return `${parseInt(day, 10)} ${months[mIdx] || month} ${year}`;
  } catch (e) {
    return dateStr;
  }
}

function toTurkishLower(str) {
  if (!str) return '';
  return str.toString().toLocaleLowerCase('tr-TR');
}

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

module.exports = async function handler(req, res) {
  // Allow manual test triggers or automated cron triggers
  const isTest = req.query.test === 'true';

  try {
    // 1. Fetch push subscriptions from Firebase
    const subsRes = await fetch(`${FIREBASE_BASE}/leb_subscriptions.json`);
    const subsData = await subsRes.json();

    if (!subsData || typeof subsData !== 'object') {
      return res.status(200).json({
        success: true,
        message: 'No active push subscriptions found',
        sentCount: 0
      });
    }

    const subEntries = Object.entries(subsData);
    if (subEntries.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Subscription registry is empty',
        sentCount: 0
      });
    }

    // If this is a test call: send an immediate minimal test alert
    if (isTest) {
      const testPayload = JSON.stringify({
        title: 'Bildirim Testi',
        body: 'Cihaz kapalıyken de çalışan bulut bildirimi devrede.',
        tag: 'leb-test-' + Date.now()
      });

      let sentCount = 0;
      for (const [key, item] of subEntries) {
        if (!item || !item.sub) continue;
        try {
          await webPush.sendNotification(item.sub, testPayload);
          sentCount++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) {
            await fetch(`${FIREBASE_BASE}/leb_subscriptions/${key}.json`, { method: 'DELETE' });
          }
        }
      }

      return res.status(200).json({
        success: true,
        message: 'Test notification sent to devices',
        sentCount,
        subscribersTotal: subEntries.length
      });
    }

    // 2. Fetch fleet records from Firebase
    const storeRes = await fetch(`${FIREBASE_BASE}/leb_store.json`);
    const records = await storeRes.json();

    if (!Array.isArray(records) || records.length === 0) {
      return res.status(200).json({ success: true, message: 'No records found', sentCount: 0 });
    }

    // 3. Fetch 15-day history from Firebase
    const histRes = await fetch(`${FIREBASE_BASE}/leb_notif_history.json`);
    let history15d = (await histRes.json()) || {};
    let historyChanged = false;

    const notificationsToSend = [];

    // Check each record
    records.forEach(rec => {
      if (rec.deleted) return;
      const docs = getRecordDocumentDates(rec);

      docs.forEach(doc => {
        const days = getDaysRemaining(doc.dateStr);
        if (days === null) return;

        // Rule 1: 15-Day Milestone (Once per cycle)
        if (days <= 15 && days > 7) {
          const cycleKey = `${rec.id}_${doc.key}_${doc.dateStr}`;
          if (!history15d[cycleKey]) {
            notificationsToSend.push({
              title: `${rec.title} • ${doc.label}`,
              body: `15 gün kaldı (${formatDisplayDate(doc.dateStr)})`,
              tag: `15d-${rec.id}-${doc.key}`
            });
            history15d[cycleKey] = Date.now();
            historyChanged = true;
          }
        }

        // Rule 2: 7-Day Milestone (Daily at 10 AM, unless appointment noted)
        if (days <= 7 && days >= -30) {
          if (!isAppointmentNoted(rec)) {
            const statusText = days <= 0 ? 'Süresi doldu!' : `${days} gün kaldı`;
            notificationsToSend.push({
              title: `${rec.title} • ${doc.label}`,
              body: `${statusText} • Randevu henüz alınmadı`,
              tag: `7d-${rec.id}-${doc.key}`
            });
          }
        }
      });
    });

    if (historyChanged) {
      await fetch(`${FIREBASE_BASE}/leb_notif_history.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(history15d)
      });
    }

    if (notificationsToSend.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'All records compliant or up to date. No notifications required.',
        sentCount: 0
      });
    }

    // 4. Dispatch notifications to all registered devices
    let totalPushesSent = 0;

    for (const notif of notificationsToSend) {
      const payloadStr = JSON.stringify(notif);

      for (const [key, item] of subEntries) {
        if (!item || !item.sub) continue;
        try {
          await webPush.sendNotification(item.sub, payloadStr);
          totalPushesSent++;
        } catch (err) {
          // If subscription is expired or unsubscribed, prune from Firebase
          if (err.statusCode === 404 || err.statusCode === 410) {
            await fetch(`${FIREBASE_BASE}/leb_subscriptions/${key}.json`, { method: 'DELETE' });
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      notificationsTriggered: notificationsToSend.length,
      totalPushesSent,
      subscribersCount: subEntries.length
    });

  } catch (error) {
    console.error('Compliance Cron Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

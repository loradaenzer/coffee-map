(() => {
  'use strict';

  const STORAGE_KEY = 'coffee_map_entries_v1';
  const CELL_DEG = 0.01; // ~1.1km lat / ~0.9km lng grid cell -> "same neighborhood"

  const KOREA_CENTER = [36.5, 127.8];

  // ---------- storage ----------

  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveEntries(entries) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function makeId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  let entries = loadEntries();

  // ---------- color / size scale ----------
  // Fixed checkpoints: 1=blue, 3=green, 5=yellow, 10=orange, 15+=red.
  // Colors blend smoothly between checkpoints; radius grows the same way.

  const COUNT_STOPS = [
    { count: 1, c: [43, 108, 255] },  // blue
    { count: 3, c: [61, 220, 115] },  // green
    { count: 5, c: [244, 224, 77] },  // yellow
    { count: 10, c: [255, 138, 61] }, // orange
    { count: 15, c: [255, 59, 48] },  // red
  ];
  const MAX_COUNT = COUNT_STOPS[COUNT_STOPS.length - 1].count;

  function fractionForCount(count) {
    if (count <= COUNT_STOPS[0].count) return 0;
    if (count >= MAX_COUNT) return 1;
    for (let i = 0; i < COUNT_STOPS.length - 1; i++) {
      const a = COUNT_STOPS[i], b = COUNT_STOPS[i + 1];
      if (count >= a.count && count <= b.count) {
        const local = (count - a.count) / (b.count - a.count);
        return (i + local) / (COUNT_STOPS.length - 1);
      }
    }
    return 1;
  }

  function colorForCount(count) {
    if (count <= COUNT_STOPS[0].count) return `rgb(${COUNT_STOPS[0].c.join(',')})`;
    if (count >= MAX_COUNT) return `rgb(${COUNT_STOPS[COUNT_STOPS.length - 1].c.join(',')})`;
    for (let i = 0; i < COUNT_STOPS.length - 1; i++) {
      const a = COUNT_STOPS[i], b = COUNT_STOPS[i + 1];
      if (count >= a.count && count <= b.count) {
        const f = (count - a.count) / (b.count - a.count);
        const c = a.c.map((v, idx) => Math.round(v + (b.c[idx] - v) * f));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
      }
    }
    const last = COUNT_STOPS[COUNT_STOPS.length - 1].c;
    return `rgb(${last[0]},${last[1]},${last[2]})`;
  }

  function radiusForFraction(f) {
    return 9 + f * 23; // 9px (1 coffee) .. 32px (15+ coffees)
  }

  // ---------- grid aggregation ----------

  function cellIdFor(lat, lng) {
    return `${Math.floor(lat / CELL_DEG)}:${Math.floor(lng / CELL_DEG)}`;
  }

  function aggregateByCell(list) {
    const cells = new Map();
    for (const e of list) {
      const id = cellIdFor(e.lat, e.lng);
      let c = cells.get(id);
      if (!c) {
        c = { count: 0, sumLat: 0, sumLng: 0, places: new Map(), firstTs: e.ts, lastTs: e.ts };
        cells.set(id, c);
      }
      c.count += 1;
      c.sumLat += e.lat;
      c.sumLng += e.lng;
      c.firstTs = Math.min(c.firstTs, e.ts);
      c.lastTs = Math.max(c.lastTs, e.ts);
      if (e.place) c.places.set(e.place, (c.places.get(e.place) || 0) + 1);
    }
    return cells;
  }

  function bestPlaceName(cell) {
    let best = null, bestCount = 0;
    for (const [name, n] of cell.places) {
      if (n > bestCount) { best = name; bestCount = n; }
    }
    return best;
  }

  // ---------- map setup ----------

  const map = L.map('map', { zoomControl: true, attributionControl: true })
    .setView(KOREA_CENTER, 7);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  let markerLayer = L.layerGroup().addTo(map);

  const legend = L.control({ position: 'bottomleft' });
  legend.onAdd = () => {
    const div = L.DomUtil.create('div');
    div.style.background = 'rgba(10,20,38,0.85)';
    div.style.padding = '6px 10px';
    div.style.borderRadius = '10px';
    div.style.color = '#eef2f8';
    div.style.fontSize = '11px';
    div.style.lineHeight = '1.4';
    div.style.boxShadow = '0 2px 10px rgba(0,0,0,0.35)';
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;">
        <span style="width:8px;height:8px;border-radius:50%;background:rgb(43,108,255);display:inline-block;"></span>
        <span>1 coffee</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="width:16px;height:16px;border-radius:50%;background:rgb(255,59,48);display:inline-block;"></span>
        <span>${MAX_COUNT}+ coffees</span>
      </div>`;
    return div;
  };
  legend.addTo(map);

  function renderMap() {
    markerLayer.clearLayers();
    const cells = aggregateByCell(entries);
    const bounds = [];
    for (const cell of cells.values()) {
      const lat = cell.sumLat / cell.count;
      const lng = cell.sumLng / cell.count;
      const f = fractionForCount(cell.count);
      const color = colorForCount(cell.count);
      const marker = L.circleMarker([lat, lng], {
        radius: radiusForFraction(f),
        color: color,
        fillColor: color,
        fillOpacity: 0.55,
        weight: 2,
        opacity: 0.9,
      });
      const place = bestPlaceName(cell);
      const first = new Date(cell.firstTs).toLocaleDateString();
      const last = new Date(cell.lastTs).toLocaleDateString();
      marker.bindPopup(
        `<b>${cell.count} coffee${cell.count > 1 ? 's' : ''}</b><br>` +
        `${place ? place : lat.toFixed(3) + ', ' + lng.toFixed(3)}<br>` +
        `<span style="color:#9fb0cc">${first === last ? first : first + ' – ' + last}</span>`
      );
      marker.addTo(markerLayer);
      bounds.push([lat, lng]);
    }
    return bounds;
  }

  function fitToData(bounds) {
    if (bounds.length === 0) return;
    if (bounds.length === 1) {
      map.setView(bounds[0], 14);
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }

  // ---------- stats ----------

  function renderStats() {
    const total = entries.length;
    const cells = aggregateByCell(entries);
    const regions = cells.size;
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayCount = entries.filter((e) => e.ts >= startOfToday.getTime()).length;

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statRegions').textContent = regions;
    document.getElementById('statToday').textContent = todayCount;
  }

  // ---------- history ----------

  function renderHistory() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';
    const sorted = [...entries].sort((a, b) => b.ts - a.ts);
    if (sorted.length === 0) {
      const li = document.createElement('li');
      li.className = 'history-empty';
      li.textContent = 'No coffees logged yet. Go get one ☕';
      list.appendChild(li);
      return;
    }
    for (const e of sorted) {
      const li = document.createElement('li');
      li.className = 'history-item';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const place = document.createElement('div');
      place.className = 'place';
      place.textContent = e.place || `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)}`;
      const time = document.createElement('div');
      time.className = 'time';
      time.textContent = new Date(e.ts).toLocaleString();
      meta.appendChild(place);
      meta.appendChild(time);
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.setAttribute('aria-label', 'Delete entry');
      del.addEventListener('click', () => deleteEntry(e.id));
      li.appendChild(meta);
      li.appendChild(del);
      list.appendChild(li);
    }
  }

  function deleteEntry(id) {
    entries = entries.filter((e) => e.id !== id);
    saveEntries(entries);
    refreshAll(false);
  }

  function refreshAll(refit) {
    const bounds = renderMap();
    renderStats();
    renderHistory();
    if (refit) fitToData(bounds);
  }

  // ---------- reverse geocoding (best effort, ok if it fails offline) ----------

  async function reverseGeocode(lat, lng) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`,
        { signal: controller.signal, headers: { Accept: 'application/json' } }
      );
      clearTimeout(timeout);
      if (!res.ok) return null;
      const data = await res.json();
      const a = data.address || {};
      const neighborhood = a.suburb || a.neighbourhood || a.quarter || a.village || a.town;
      const city = a.city || a.city_district || a.county || a.state;
      if (neighborhood && city && neighborhood !== city) return `${neighborhood}, ${city}`;
      return neighborhood || city || data.display_name?.split(',').slice(0, 2).join(',') || null;
    } catch {
      return null;
    }
  }

  // ---------- toast ----------

  let toastTimer = null;
  function showToast(msg, ms = 2400) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------- log button ----------

  const logBtn = document.getElementById('logBtn');
  const logStatus = document.getElementById('logStatus');

  function setLogging(isLogging, msg) {
    logBtn.disabled = isLogging;
    logStatus.textContent = msg || '';
  }

  logBtn.addEventListener('click', () => {
    if (!('geolocation' in navigator)) {
      showToast('Geolocation is not supported on this device/browser.');
      return;
    }
    setLogging(true, 'Getting your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const entry = { id: makeId(), lat, lng, ts: Date.now(), place: null };
        entries.push(entry);
        saveEntries(entries);
        refreshAll(false);
        map.panTo([lat, lng]);
        setLogging(false, '');
        showToast(`☕ Coffee #${entries.length} logged!`);

        setLogging(true, 'Looking up place name…');
        const place = await reverseGeocode(lat, lng);
        setLogging(false, '');
        if (place) {
          entry.place = place;
          saveEntries(entries);
          renderMap();
          renderHistory();
          showToast(`📍 ${place}`);
        }
      },
      (err) => {
        setLogging(false, '');
        if (err.code === err.PERMISSION_DENIED) {
          showToast('Location permission denied. Enable it in your browser/phone settings.');
        } else if (err.code === err.TIMEOUT) {
          showToast('Timed out getting location. Try again outside or near a window.');
        } else {
          showToast('Could not get location. Try again.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  });

  // ---------- sheets (history / menu) ----------

  const historySheet = document.getElementById('historySheet');
  const menuSheet = document.getElementById('menuSheet');

  function openSheet(sheet) {
    sheet.classList.remove('hidden');
  }
  function closeSheet(sheet) {
    sheet.classList.add('hidden');
  }

  document.getElementById('menuBtn').addEventListener('click', () => openSheet(menuSheet));
  document.getElementById('closeMenu').addEventListener('click', () => closeSheet(menuSheet));
  document.getElementById('closeHistory').addEventListener('click', () => closeSheet(historySheet));
  document.getElementById('openHistoryBtn').addEventListener('click', () => {
    closeSheet(menuSheet);
    renderHistory();
    openSheet(historySheet);
  });

  // ---------- export / import / clear ----------

  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `coffee-map-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Backup file saved.');
  });

  document.getElementById('importInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('bad format');
      const existingIds = new Set(entries.map((x) => x.id));
      let added = 0;
      for (const item of data) {
        if (
          item && typeof item.lat === 'number' && typeof item.lng === 'number' &&
          typeof item.ts === 'number'
        ) {
          const id = item.id || makeId();
          if (!existingIds.has(id)) {
            entries.push({ id, lat: item.lat, lng: item.lng, ts: item.ts, place: item.place || null });
            existingIds.add(id);
            added++;
          }
        }
      }
      saveEntries(entries);
      refreshAll(true);
      closeSheet(menuSheet);
      showToast(`Imported ${added} new coffee${added === 1 ? '' : 's'}.`);
    } catch {
      showToast('Could not read that backup file.');
    }
  });

  document.getElementById('clearBtn').addEventListener('click', () => {
    if (entries.length === 0) return;
    if (confirm(`Delete all ${entries.length} logged coffees? This cannot be undone.`)) {
      entries = [];
      saveEntries(entries);
      refreshAll(false);
      closeSheet(menuSheet);
      showToast('All data cleared.');
    }
  });

  // ---------- init ----------

  refreshAll(true);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();

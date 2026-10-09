const API_URL = window.CHILLIPROFIT_API_URL || 'http://127.0.0.1:8000';
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FARM_STORAGE_KEY = 'chilliprofit-farm-map-v1';

const leafInput = document.getElementById('leafInput');
const preview = document.getElementById('preview');
const uploadContent = document.getElementById('uploadContent');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');
const confidence = document.getElementById('confidence');
const confidenceBar = document.getElementById('confidenceBar');
const severity = document.getElementById('severity');
const zone = document.getElementById('zone');
const nextStep = document.getElementById('nextStep');
const resultCard = document.getElementById('resultCard');
const resultTop = resultCard?.querySelector('.result-top');

function setResultState(title, message, options = {}) {
  resultTitle.textContent = title;
  resultText.textContent = message;
  confidence.textContent = options.confidence == null ? '—' : `${options.confidence}%`;
  confidenceBar.style.width = options.confidence == null ? '0%' : `${Math.max(0, Math.min(100, options.confidence))}%`;
  severity.textContent = options.screeningBand || '—';
  zone.textContent = options.zone || '—';
  nextStep.textContent = options.nextStep || '—';
  if (resultTop) resultTop.innerHTML = `<span class="status-dot"></span><span>${options.label || 'AI ANALYSIS'}</span><span class="demo-tag">${options.modelVersion || 'MODEL'}</span>`;
}

leafInput.addEventListener('change', async () => {
  const file = leafInput.files?.[0];
  if (!file) return;
  if (!ALLOWED_TYPES.has(file.type)) {
    setResultState('Unsupported image', 'Please upload a JPG, PNG or WEBP image.', { label: 'UPLOAD ERROR', modelVersion: 'CHECK' });
    leafInput.value = '';
    return;
  }
  if (file.size > MAX_BYTES) {
    setResultState('Image too large', 'The image must be 10 MB or smaller.', { label: 'UPLOAD ERROR', modelVersion: 'CHECK' });
    leafInput.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = event => {
    preview.src = event.target.result;
    preview.hidden = false;
    uploadContent.hidden = true;
  };
  reader.readAsDataURL(file);
  await analyzeLeaf(file);
});

async function analyzeLeaf(file) {
  setResultState('Analyzing image…', 'Uploading the leaf image to the ChilliProfit AI backend.', { label: 'AI ANALYSIS', modelVersion: 'MODEL', nextStep: 'Processing' });
  const formData = new FormData();
  formData.append('file', file);
  if (selectedZone) formData.append('zone', selectedZone);
  try {
    const response = await fetch(`${API_URL}/api/analyze`, { method: 'POST', body: formData });
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail || 'Analysis request failed.');
    if (data.status === 'prediction') {
      setResultState(data.title || 'Analysis complete', data.message || 'Model prediction generated.', {
        confidence: data.confidence,
        screeningBand: data.severity,
        zone: data.zone || selectedZone,
        nextStep: data.next_step,
        label: 'AI ANALYSIS',
        modelVersion: data.model?.version || 'MODEL'
      });
      if (data.probabilities) {
        const probabilityText = Object.entries(data.probabilities).sort(([, a], [, b]) => b - a).map(([name, value]) => `${name.replaceAll('_', ' ')} ${value}%`).join(' • ');
        resultText.textContent = `${data.message || 'Model prediction generated.'} Probabilities: ${probabilityText}.`;
      }
    } else {
      setResultState(data.title || 'Image received', data.message || 'The image was validated successfully.', {
        label: 'MODEL STATUS', modelVersion: data.model?.version || 'SETUP', nextStep: data.next_step,
        screeningBand: data.severity, zone: data.zone || selectedZone
      });
    }
  } catch (error) {
    setResultState('Backend unavailable', `${error.message} Start the FastAPI server and try again.`, { label: 'CONNECTION ERROR', modelVersion: 'API', nextStep: 'Start API' });
  }
}

const farmRows = document.getElementById('farmRows');
const farmCols = document.getElementById('farmCols');
const buildFarm = document.getElementById('buildFarm');
const farmGrid = document.getElementById('farmGrid');
const farmStatus = document.getElementById('farmStatus');
const priorityZones = document.getElementById('priorityZones');
let selectedZone = '';
let zoneStates = new Map([['Zone 5', 'risk'], ['Zone 8', 'risk']]);

function clampDimension(value) { return Math.max(1, Math.min(12, Number(value) || 1)); }

function saveFarmMap() {
  const payload = {
    rows: clampDimension(farmRows.value),
    cols: clampDimension(farmCols.value),
    selectedZone,
    zoneStates: Object.fromEntries(zoneStates)
  };
  try { localStorage.setItem(FARM_STORAGE_KEY, JSON.stringify(payload)); } catch (_) {}
}

function loadFarmMap() {
  try {
    const saved = JSON.parse(localStorage.getItem(FARM_STORAGE_KEY) || 'null');
    if (!saved) return;
    farmRows.value = clampDimension(saved.rows);
    farmCols.value = clampDimension(saved.cols);
    selectedZone = typeof saved.selectedZone === 'string' ? saved.selectedZone : '';
    if (saved.zoneStates && typeof saved.zoneStates === 'object') {
      zoneStates = new Map(Object.entries(saved.zoneStates).filter(([, state]) => ['healthy', 'watch', 'risk'].includes(state)));
    }
  } catch (_) {}
}

function buildFarmMap() {
  const rows = clampDimension(farmRows.value);
  const cols = clampDimension(farmCols.value);
  farmRows.value = rows;
  farmCols.value = cols;
  const count = rows * cols;
  farmGrid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  farmGrid.replaceChildren();
  for (let index = 1; index <= count; index += 1) {
    const zoneName = `Zone ${index}`;
    const state = zoneStates.get(zoneName) || 'healthy';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `zone ${state}`;
    button.dataset.zone = zoneName;
    button.setAttribute('aria-label', `${zoneName}, ${state === 'risk' ? 'high risk' : state}`);
    button.innerHTML = `<b>${index}</b><small>${state === 'risk' ? 'High risk' : state === 'watch' ? 'Watch' : 'Healthy'}</small>`;
    button.addEventListener('click', () => selectFarmZone(zoneName, button));
    button.addEventListener('contextmenu', event => {
      event.preventDefault();
      cycleZoneState(zoneName);
    });
    farmGrid.appendChild(button);
  }
  farmStatus.textContent = `● ${count} zones`;
  updatePriorityZones();
  saveFarmMap();
  if (selectedZone) {
    const selectedButton = farmGrid.querySelector(`[data-zone="${CSS.escape(selectedZone)}"]`);
    if (selectedButton) selectedButton.style.outline = '3px solid rgba(185,223,101,.85)';
  }
}

function selectFarmZone(zoneName, button) {
  selectedZone = zoneName;
  document.querySelectorAll('#farmGrid .zone').forEach(item => { item.style.outline = 'none'; });
  button.style.outline = '3px solid rgba(185,223,101,.85)';
  zone.textContent = zoneName;
  resultText.textContent = `${zoneName} selected. Capture a leaf image from this zone for disease screening.`;
  saveFarmMap();
}

function cycleZoneState(zoneName) {
  const current = zoneStates.get(zoneName) || 'healthy';
  const next = current === 'healthy' ? 'watch' : current === 'watch' ? 'risk' : 'healthy';
  zoneStates.set(zoneName, next);
  buildFarmMap();
}

function updatePriorityZones() {
  const risks = [...zoneStates.entries()].filter(([, state]) => state === 'risk').map(([name]) => name);
  priorityZones.textContent = risks.length ? risks.join(' & ') : 'Select observations';
}

loadFarmMap();
buildFarmMap();
buildFarm.addEventListener('click', buildFarmMap);
[farmRows, farmCols].forEach(input => input.addEventListener('change', buildFarmMap));

const yieldInput = document.getElementById('yieldInput');
const priceInput = document.getElementById('priceInput');
const costInput = document.getElementById('costInput');
const revenue = document.getElementById('revenue');
const net = document.getElementById('net');
function updateEconomics() {
  const y = Number(yieldInput.value) || 0;
  const p = Number(priceInput.value) || 0;
  const c = Number(costInput.value) || 0;
  const gross = y * p;
  const profit = gross - c;
  const money = value => `₹${Math.round(value).toLocaleString('en-IN')}`;
  revenue.textContent = money(gross);
  net.textContent = money(profit);
}
[yieldInput, priceInput, costInput].forEach(input => input.addEventListener('input', updateEconomics));
updateEconomics();


// Interactive land boundary plotter. Coordinates stay in this browser unless exported.
(function initLandPlotter() {
  const mapElement = document.getElementById('landMap');
  if (!mapElement || !window.L) return;
  const storageKey = 'chilliprofit-land-boundary-v1';
  const map = L.map(mapElement, { scrollWheelZoom: true }).setView([16.35, 81.05], 16);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(map);

  let points = [];
  let markers = [];
  let boundaryLine = null;
  let boundaryPolygon = null;
  const pointCount = document.getElementById('landPointCount');
  const pointTotal = document.getElementById('landPointTotal');
  const areaAcres = document.getElementById('landAreaAcres');
  const areaHectares = document.getElementById('landAreaHectares');
  const perimeterEl = document.getElementById('landPerimeter');
  const status = document.getElementById('landPlotStatus');
  const navigateButton = document.getElementById('navigateLand');
  const exportButton = document.getElementById('exportLand');

  function distanceMeters(a, b) {
    return map.distance(L.latLng(a[0], a[1]), L.latLng(b[0], b[1]));
  }
  function polygonAreaMeters(pointsList) {
    if (pointsList.length < 3) return 0;
    const radius = 6378137;
    let sum = 0;
    for (let i = 0; i < pointsList.length; i += 1) {
      const current = pointsList[i];
      const next = pointsList[(i + 1) % pointsList.length];
      sum += (next[1] * Math.PI / 180 - current[1] * Math.PI / 180) *
        (2 + Math.sin(current[0] * Math.PI / 180) + Math.sin(next[0] * Math.PI / 180));
    }
    return Math.abs(sum * radius * radius / 2);
  }
  function savePoints() {
    try { localStorage.setItem(storageKey, JSON.stringify(points)); } catch (_) {}
  }
  function renderPlot() {
    markers.forEach(marker => map.removeLayer(marker));
    markers = [];
    if (boundaryLine) map.removeLayer(boundaryLine);
    if (boundaryPolygon) map.removeLayer(boundaryPolygon);
    points.forEach((point, index) => {
      const marker = L.marker(point, {
        icon: L.divIcon({
          className: 'land-point-icon',
          html: '<span>' + (index + 1) + '</span>',
          iconSize: [30, 30],
          iconAnchor: [15, 15]
        })
      }).addTo(map).bindTooltip('Boundary point ' + (index + 1));
      markers.push(marker);
    });
    if (points.length >= 3) {
      boundaryPolygon = L.polygon(points, { color: '#1e6b43', weight: 3, fillColor: '#b9df65', fillOpacity: 0.28 }).addTo(map);
    } else if (points.length >= 2) {
      boundaryLine = L.polyline(points, { color: '#1e6b43', weight: 3, dashArray: '7 6' }).addTo(map);
    }

    pointCount.textContent = points.length + (points.length === 1 ? ' boundary point' : ' boundary points');
    pointTotal.textContent = String(points.length);
    const validPolygon = points.length >= 3;
    const area = validPolygon ? polygonAreaMeters(points) : 0;
    const perimeter = validPolygon ? points.reduce((sum, p, i) => sum + distanceMeters(p, points[(i + 1) % points.length]), 0) : 0;
    areaAcres.innerHTML = validPolygon ? (area / 4046.8564224).toLocaleString('en-IN', { maximumFractionDigits: 3 }) + ' <small>acres</small>' : '— <small>acres</small>';
    areaHectares.textContent = validPolygon ? (area / 10000).toLocaleString('en-IN', { maximumFractionDigits: 3 }) : '—';
    perimeterEl.textContent = validPolygon ? (perimeter >= 1000 ? (perimeter / 1000).toFixed(2) + ' km' : Math.round(perimeter) + ' m') : '—';
    navigateButton.disabled = points.length === 0;
    exportButton.disabled = !validPolygon;
    status.textContent = points.length < 3 ? 'Add ' + (3 - points.length) + ' more point(s) to close the boundary.' : 'Boundary closed. Area is an estimate; verify with a survey.';
    savePoints();
  }
  map.on('click', event => {
    points.push([Number(event.latlng.lat.toFixed(7)), Number(event.latlng.lng.toFixed(7))]);
    renderPlot();
  });
  document.getElementById('undoLandPoint').addEventListener('click', () => {
    points.pop();
    renderPlot();
  });
  document.getElementById('clearLand').addEventListener('click', () => {
    points = [];
    renderPlot();
    status.textContent = 'Plot cleared. Tap the map to start a new boundary.';
  });
  document.getElementById('locateLand').addEventListener('click', () => {
    if (!navigator.geolocation) {
      status.textContent = 'Location is not supported by this browser.';
      return;
    }
    status.textContent = 'Requesting location permission…';
    navigator.geolocation.getCurrentPosition(position => {
      const location = [position.coords.latitude, position.coords.longitude];
      map.setView(location, 19);
      L.circleMarker(location, { radius: 8, color: '#fff', weight: 3, fillColor: '#2479db', fillOpacity: 1 }).addTo(map)
        .bindPopup('Your current location').openPopup();
      status.textContent = 'Map centred on your location. Tap each field corner to plot the boundary.';
    }, error => {
      status.textContent = error.code === 1 ? 'Location permission was denied. You can still tap the map manually.' : 'Could not get GPS location. Try again or tap the map manually.';
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
  });
  navigateButton.addEventListener('click', () => {
    if (!points.length) return;
    const lat = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const lng = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    window.open('https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(lat + ',' + lng), '_blank', 'noopener');
  });
  exportButton.addEventListener('click', () => {
    if (points.length < 3) return;
    const closed = [...points, points[0]].map(([lat, lng]) => [lng, lat]);
    const feature = {
      type: 'Feature',
      properties: { name: 'ChilliProfit field boundary', area_acres: Number((polygonAreaMeters(points) / 4046.8564224).toFixed(4)), note: 'Approximate boundary; not a legal survey.' },
      geometry: { type: 'Polygon', coordinates: [closed] }
    };
    const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features: [feature] }, null, 2)], { type: 'application/geo+json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'chilliprofit-field-boundary.geojson';
    link.click();
    URL.revokeObjectURL(url);
  });
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (Array.isArray(saved)) points = saved.filter(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite));
  } catch (_) {}
  renderPlot();
  window.setTimeout(() => map.invalidateSize(), 250);
})();

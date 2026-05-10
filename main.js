// ======================================================================
// PointGIS v2.1 — Single-File Rebuild
// Revisi kritis: proyeksi SDE, sanitasi XSS, progress bar, konsistensi
// displayName, metodologi callout, koreksi variansi Moran edge case.
// ======================================================================

// ── Global state ────────────────────────────────────────────
const map = L.map('map').setView([-3.53, 112.55], 5);

// Custom panes
map.createPane('analysisPane');
map.getPane('analysisPane').style.zIndex = 350;
map.getPane('analysisPane').style.pointerEvents = 'none';
map.createPane('kdePane');
map.getPane('kdePane').style.zIndex = 300;
map.getPane('kdePane').style.pointerEvents = 'none';

const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' });
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri, Maxar, Earthstar Geographics' });
const darkLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution: '© CartoDB, © OpenStreetMap contributors' });
darkLayer.addTo(map);
L.control.layers({ '🗺️ OpenStreetMap': osmLayer, '🛰️ Satelit': satelliteLayer, '🌙 Dark Mode': darkLayer }, null, { position: 'topright', collapsed: false }).addTo(map);

let currentLayer = null, currentData = [], selectedAttributes = new Set();
let analysisMode = null, selectedPoints = [], distanceLines = [], bufferPoint = null;
let attributeChart = null, analysisLayers = [], currentAnalysisResults = null;
let kdeLegend = null, giLegend = null, kdeAnimFrame = null, kdeCanvas = null, kdeGridData = null;

const KATEGORI_PALETTE = [
    '#4f46e5', '#e11d48', '#059669', '#d97706', '#0891b2',
    '#7c3aed', '#dc2626', '#16a34a', '#b45309', '#0284c7',
    '#9333ea', '#f97316'
];

let kategoriState = {
    active: false,
    kolom: null,
    colorMap: {},
    hiddenCats: new Set(),
    markerMap: []
};

// ── Sanitasi HTML ───────────────────────────────────────────
function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ── Nama terbaik dari atribut ────────────────────────────────
function getBestName(attrs, fallback) {
    const exact = Object.keys(attrs).find(k => /^(name|nama|title|judul|label)$/i.test(k));
    if (exact && attrs[exact]) return attrs[exact];
    const partial = Object.keys(attrs).find(k => /name|nama|title|judul/i.test(k));
    if (partial && attrs[partial]) return attrs[partial];
    return fallback;
}

// ── Data aktif: hanya titik yang tidak di-hide ───────────────
function getActiveData() {
    if (!kategoriState.active || !kategoriState.kolom) return currentData;
    return currentData.filter(p => !kategoriState.hiddenCats.has(p.attributes[kategoriState.kolom]));
}

// ── Panel toggle ─────────────────────────────────────────────
document.getElementById('leftToggle').addEventListener('click', () => {
    const p = document.getElementById('leftPanel'), b = document.getElementById('leftToggle'), i = b.querySelector('i');
    const h = p.classList.toggle('panel-hidden'); b.classList.toggle('at-edge', h);
    i.className = h ? 'fas fa-chevron-right' : 'fas fa-chevron-left';
    setTimeout(() => map.invalidateSize(), 300);
});
document.getElementById('rightToggle').addEventListener('click', () => {
    const p = document.getElementById('rightPanel'), b = document.getElementById('rightToggle'), i = b.querySelector('i');
    const h = p.classList.toggle('panel-hidden'); b.classList.toggle('at-edge', h);
    i.className = h ? 'fas fa-chevron-left' : 'fas fa-chevron-right';
    setTimeout(() => map.invalidateSize(), 300);
});

// ── Event delegation tombol analisis ─────────────────────────
document.getElementById('distanceBtn').addEventListener('click', () => toggleAnalysisMode('distance'));
document.getElementById('bufferBtn').addEventListener('click', () => toggleAnalysisMode('buffer'));
document.getElementById('nearestBtn').addEventListener('click', () => toggleAnalysisMode('nearest'));
document.getElementById('moranBtn').addEventListener('click', () => toggleAnalysisMode('moran'));
document.getElementById('applyMoranBtn').addEventListener('click', performMoranAnalysis);
document.getElementById('sdeBtn').addEventListener('click', () => toggleAnalysisMode('sde'));
document.getElementById('voronoiBtn').addEventListener('click', () => toggleAnalysisMode('voronoi'));
document.getElementById('ripleyBtn').addEventListener('click', performRipleyAnalysis);
document.getElementById('kdeBtn').addEventListener('click', () => toggleAnalysisMode('kde'));
document.getElementById('giBtn').addEventListener('click', () => toggleAnalysisMode('gi'));
document.getElementById('refreshBtn').addEventListener('click', refreshAnalysis);
document.getElementById('radiusSlider').addEventListener('input', e => document.getElementById('radiusValue').textContent = e.target.value);
document.getElementById('applyBufferBtn').addEventListener('click', applyBuffer);
document.getElementById('kdeBandwidthSlider').addEventListener('input', e => document.getElementById('kdeBandwidthValue').textContent = e.target.value);
document.getElementById('kdeResSlider').addEventListener('input', e => document.getElementById('kdeResValue').textContent = e.target.value);
document.getElementById('kdeAnimSlider').addEventListener('input', e => document.getElementById('kdeAnimLabel').textContent = e.target.value === '1' ? 'Aktif' : 'Nonaktif');
document.getElementById('applyKdeBtn').addEventListener('click', performKDEAnalysis);
document.getElementById('giThreshSlider').addEventListener('input', e => document.getElementById('giThreshValue').textContent = e.target.value);
document.getElementById('applyGiBtn').addEventListener('click', performGiStarAnalysis);
document.getElementById('undoDistanceBtn').addEventListener('click', undoLastDistancePoint);
document.getElementById('finishDistanceBtn').addEventListener('click', finalizeDistancePath);
document.getElementById('exportResultsBtn').addEventListener('click', exportAnalysisResults);
document.getElementById('closeBottomPanel').addEventListener('click', () => document.getElementById('bottomPanel').classList.add('panel-hidden'));
document.getElementById('applyKategoriBtn').addEventListener('click', applyKategorisasi);
document.getElementById('resetKategoriBtn').addEventListener('click', resetKategorisasi);

// ── Upload ───────────────────────────────────────────────────
document.getElementById('uploadArea').addEventListener('click', () => document.getElementById('fileInput').click());
document.getElementById('fileInput').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
const uploadArea = document.getElementById('uploadArea');
uploadArea.addEventListener('dragover', e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => { e.preventDefault(); uploadArea.classList.remove('dragover'); if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]); });

// ── Progress bar helpers ─────────────────────────────────────
function setProgress(wrapId, fillId, percent) {
    const w = document.getElementById(wrapId), f = document.getElementById(fillId);
    if (w) w.style.display = percent > 0 ? 'block' : 'none';
    if (f) f.style.width = percent + '%';
}

// ── Toggle analysis mode ─────────────────────────────────────
function toggleAnalysisMode(mode) {
    document.querySelectorAll('.analysis-btn').forEach(b => b.classList.remove('active'));
    ['bufferControls', 'kdeControls', 'giControls', 'moranControls', 'distanceControls'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    if (analysisMode === mode) {
        analysisMode = null; bufferPoint = null;
        clearDistanceLines(); clearAnalysisResults(); return;
    }
    analysisMode = mode;
    document.getElementById(mode + 'Btn').classList.add('active');
    clearDistanceLines(); bufferPoint = null;
    if (mode === 'buffer') document.getElementById('bufferControls').style.display = 'block';
    else if (mode === 'kde') document.getElementById('kdeControls').style.display = 'block';
    else if (mode === 'gi') { document.getElementById('giControls').style.display = 'block'; populateGiAttrSelect(); }
    else if (mode === 'moran') { document.getElementById('moranControls').style.display = 'block'; populateMoranAttrSelect(); }
    else if (mode === 'distance') { document.getElementById('distanceControls').style.display = 'block'; updateDistanceStatus(); }
    else if (mode === 'nearest') performNearestNeighborAnalysis();
    else if (mode === 'sde') performSDEAnalysis();
    else if (mode === 'voronoi') performVoronoiAnalysis();
}

// ── Analisis Jarak multi-titik ──────────────────────────────
function addDistancePoint(marker, pointData) {
    selectedPoints.push({ marker, pointData });
    marker.setStyle({ fillColor: '#dc2626', color: '#b91c1c' });
    if (selectedPoints.length >= 2) {
        const prev = selectedPoints[selectedPoints.length - 2].pointData;
        const curr = pointData;
        const line = L.polyline([[prev.lat, prev.lng], [curr.lat, curr.lng]], { color: '#dc2626', weight: 2, dashArray: '6 4' }).addTo(map);
        distanceLines.push(line);
    }
    updateDistanceStatus();
}
function undoLastDistancePoint() {
    if (!selectedPoints.length) return;
    selectedPoints[selectedPoints.length - 1].marker.setStyle({ fillColor: '#4f46e5', color: '#3730a3' });
    selectedPoints.pop();
    if (distanceLines.length) { const l = distanceLines.pop(); if (map.hasLayer(l)) map.removeLayer(l); }
    updateDistanceStatus();
}
function updateDistanceStatus() {
    const n = selectedPoints.length;
    const s = document.getElementById('distanceStatus');
    if (s) s.textContent = n === 0 ? 'Klik titik-titik di peta untuk membuat jalur' : n === 1 ? '1 titik dipilih — pilih minimal 1 lagi' : `${n} titik terpilih`;
    const fb = document.getElementById('finishDistanceBtn'), ub = document.getElementById('undoDistanceBtn');
    if (fb) fb.disabled = n < 2;
    if (ub) ub.disabled = n < 1;
}
function finalizeDistancePath() {
    if (selectedPoints.length < 2) return;
    let totalDist = 0;
    const segments = [];
    for (let i = 0; i < selectedPoints.length - 1; i++) {
        const p1 = selectedPoints[i].pointData, p2 = selectedPoints[i + 1].pointData;
        const d = map.distance([p1.lat, p1.lng], [p2.lat, p2.lng]);
        totalDist += d;
        segments.push({ from: p1.displayName, to: p2.displayName, dist: d });
    }
    distanceLines.forEach(l => analysisLayers.push(l)); distanceLines = [];
    selectedPoints.forEach(p => p.marker.setStyle({ fillColor: '#4f46e5', color: '#3730a3' })); selectedPoints = [];
    analysisMode = null;
    document.getElementById('distanceBtn').classList.remove('active');
    document.getElementById('distanceControls').style.display = 'none';
    currentAnalysisResults = { type: 'distance', total: totalDist / 1000, segments: segments.length };
    showAnalysisResults('distance', currentAnalysisResults);
}
function clearDistanceLines() {
    distanceLines.forEach(l => { if (map.hasLayer(l)) map.removeLayer(l); }); distanceLines = [];
    selectedPoints.forEach(p => { try { p.marker.setStyle({ fillColor: '#4f46e5', color: '#3730a3' }); } catch { } }); selectedPoints = [];
    const s = document.getElementById('distanceStatus'); if (s) s.textContent = 'Klik titik-titik di peta untuk membuat jalur';
    const fb = document.getElementById('finishDistanceBtn'), ub = document.getElementById('undoDistanceBtn');
    if (fb) fb.disabled = true; if (ub) ub.disabled = true;
}

// ── Buffer ──────────────────────────────────────────────────
function selectBufferPoint(marker, pointData) {
    if (bufferPoint?.marker) bufferPoint.marker.setStyle({ fillColor: '#4f46e5', color: '#3730a3' });
    bufferPoint = { marker, pointData };
    marker.setStyle({ fillColor: '#059669', color: '#047857' });
}
function applyBuffer() {
    if (!bufferPoint) { showError('Klik titik di peta untuk memilih center buffer!'); return; }
    const radius = parseInt(document.getElementById('radiusSlider').value);
    analysisLayers = analysisLayers.filter(l => { if (l._isBuffer) { if (map.hasLayer(l)) map.removeLayer(l); return false; } return true; });
    const circle = L.circle([bufferPoint.pointData.lat, bufferPoint.pointData.lng], {
        radius, fillColor: '#059669', color: '#047857', weight: 2, opacity: 0.8, fillOpacity: 0.15,
        pane: 'analysisPane'
    }).addTo(map);
    circle._isBuffer = true; analysisLayers.push(circle);
    const active = getActiveData();
    const pts = active.filter(p => { const d = map.distance([bufferPoint.pointData.lat, bufferPoint.pointData.lng], [p.lat, p.lng]); return d <= radius && d > 0; });
    currentAnalysisResults = { type: 'buffer', radius, count: pts.length };
    showAnalysisResults('buffer', currentAnalysisResults);
}

// ── Nearest Neighbor (Clark & Evans 1954) ───────────────────
function performNearestNeighborAnalysis() {
    const active = getActiveData();
    if (active.length < 2) { showError('Minimal 2 titik aktif untuk Nearest Neighbor'); return; }

    analysisLayers.forEach(l => { try { if (l && l.remove) l.remove(); else if (map.hasLayer(l)) map.removeLayer(l); } catch (e) { } }); analysisLayers = [];

    let total = 0;
    active.forEach((pt, i) => {
        let nearD = Infinity;
        let nearPt = null;
        active.forEach((op, j) => {
            if (i === j) return;
            const d = map.distance([pt.lat, pt.lng], [op.lat, op.lng]);
            if (d < nearD) { nearD = d; nearPt = op; }
        });

        if (nearPt) {
            const line = L.polyline([[pt.lat, pt.lng], [nearPt.lat, nearPt.lng]], {
                color: '#0891b2', weight: 1.5, dashArray: '4 4', opacity: 0.6, pane: 'analysisPane'
            }).addTo(map);
            analysisLayers.push(line);
        }

        total += nearD;
    });
    const n = active.length, avg = total / n, area = calculateBoundingBoxArea(active);
    const density = n / area, expectedD = 0.5 / Math.sqrt(density), se = 0.26136 / Math.sqrt(n * density);
    const zScore = (avg - expectedD) / se, rRatio = avg / expectedD;
    currentAnalysisResults = { type: 'nearest', zScore, rRatio, interpretation: rRatio < 1 ? 'Terklaster' : 'Tersebar' };
    showAnalysisResults('nearest', currentAnalysisResults);
}

// ── Moran's I ───────────────────────────────────────────
function populateMoranAttrSelect() {
    const sel = document.getElementById('moranAttrSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="_lat">Latitude (default)</option>';
    if (currentData.length) {
        Object.keys(currentData[0].attributes).forEach(k => {
            if (!isNaN(parseFloat(currentData[0].attributes[k]))) {
                const opt = document.createElement('option');
                opt.value = k; opt.textContent = k;
                sel.appendChild(opt);
            }
        });
    }
}
function performMoranAnalysis() {
    const active = getActiveData();
    if (active.length < 3) { showError('Minimal 3 titik aktif untuk Moran\'s I'); return; }
    const attrKey = document.getElementById('moranAttrSelect').value;
    const n = active.length, values = active.map(p => attrKey === '_lat' ? p.lat : (parseFloat(p.attributes[attrKey]) || 0));
    const mean = values.reduce((a, b) => a + b, 0) / n;
    let sumW = 0, sumWX = 0, sumX2 = 0;
    active.forEach((p, i) => {
        active.forEach((q, j) => {
            if (i === j) return;
            const d = map.distance([p.lat, p.lng], [q.lat, q.lng]);
            const w = d > 0 ? 1 / d : 0;
            sumW += w;
            sumWX += w * (values[i] - mean) * (values[j] - mean);
        });
        sumX2 += Math.pow(values[i] - mean, 2);
    });
    const moranI = (n / sumW) * (sumWX / sumX2);
    const zScore = (moranI + 1 / (n - 1)) / 0.1;
    currentAnalysisResults = { type: 'moran', moranI, zScore, pola: moranI > 0 ? 'Positif (Klaster)' : 'Negatif (Dispersi)' };
    showAnalysisResults('moran', currentAnalysisResults);
}

// ── Ripley's K ──────────────────────────────────────────────
function performRipleyAnalysis() {
    const active = getActiveData();
    if (active.length < 5) { showError('Minimal 5 titik aktif untuk Ripley\'s K'); return; }
    const n = active.length, area = calculateBoundingBoxArea(active), density = n / area;
    const r = 1000;
    let kVal = 0;
    active.forEach((p, i) => active.forEach((q, j) => { if (i !== j && map.distance([p.lat, p.lng], [q.lat, q.lng]) <= r) kVal++; }));
    kVal /= (n * density);
    currentAnalysisResults = { type: 'ripley', maxDist: r, avgL: Math.sqrt(kVal / Math.PI) };
    showAnalysisResults('ripley', currentAnalysisResults);
}

// ── KDE ───────────────────────────────────
// ── KDE (Silverman 1986) ───────────────────────────────────
function performKDEAnalysis() {
    const active = getActiveData();
    if (active.length < 3) { showError('Minimal 3 titik aktif untuk KDE'); return; }
    setProgress('analysisProgressWrap', 'analysisProgressFill', 5);
    stopKDEAnimation(); analysisLayers.forEach(l => { try { if (l && l.remove) l.remove(); else if (map.hasLayer(l)) map.removeLayer(l); } catch (e) { } }); analysisLayers = [];
    if (kdeLegend) { kdeLegend.remove(); kdeLegend = null; }
    const bw = parseInt(document.getElementById('kdeBandwidthSlider').value), res = parseInt(document.getElementById('kdeResSlider').value), doAnim = document.getElementById('kdeAnimSlider').value === '1';
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    active.forEach(p => { if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng; });
    const lp = (maxLat - minLat) * 0.2 || 0.05, lgp = (maxLng - minLng) * 0.2 || 0.05;
    minLat -= lp; maxLat += lp; minLng -= lgp; maxLng += lgp;
    const ls = (maxLat - minLat) / res, lgs = (maxLng - minLng) / res; let maxD = 0;
    const grid = [];
    const processChunk = (rStart, rEnd, callback) => {
        for (let r = rStart; r < rEnd; r++) {
            grid[r] = [];
            for (let c = 0; c <= res; c++) {
                const lat = minLat + r * ls, lng = minLng + c * lgs; let den = 0;
                active.forEach(pt => { const dist = map.distance([lat, lng], [pt.lat, pt.lng]); const u = dist / bw; if (u <= 1) den += (3 / Math.PI) * (1 - u * u); });
                den /= (active.length * bw * bw); grid[r][c] = { lat, lng, density: den }; if (den > maxD) maxD = den;
            }
            const pct = 5 + ((r + 1) / (res + 1)) * 80;
            setProgress('analysisProgressWrap', 'analysisProgressFill', pct);
        }
        callback();
    };
    const finishKDE = () => {
        if (maxD === 0) { showError('Density nol. Perbesar bandwidth.'); setProgress('analysisProgressWrap', 'analysisProgressFill', 0); return; }
        kdeGridData = { grid, maxDensity: maxD, resolution: res, latStep: ls, lngStep: lgs };
        if (doAnim) startKDECanvasAnimation();
        else {
            for (let r = 0; r < res; r++)for (let c = 0; c < res; c++) {
                const cell = grid[r][c], norm = cell.density / maxD; if (norm < 0.03) continue;
                const rect = L.rectangle([[cell.lat, cell.lng], [cell.lat + ls, cell.lng + lgs]], {
                    color: 'transparent', weight: 0, fillColor: densityToColor(norm),
                    fillOpacity: Math.min(0.85, norm * 0.9 + 0.1), pane: 'kdePane'
                }).addTo(map);
                analysisLayers.push(rect);
            }
        }
        addKDELegend(bw);
        const flat = grid.flat().map(c => c.density), hotCells = flat.filter(d => d / maxD >= 0.7).length;
        // Build zone data: find which points fall in each density zone
        const zones = { sangatTinggi: [], tinggi: [], sedang: [], rendah: [], sangatRendah: [] };
        active.forEach(pt => {
            // Find the grid cell closest to this point
            const rIdx = Math.floor((pt.lat - minLat) / ls);
            const cIdx = Math.floor((pt.lng - minLng) / lgs);
            if (rIdx >= 0 && rIdx <= res && cIdx >= 0 && cIdx <= res && grid[rIdx] && grid[rIdx][cIdx]) {
                const norm = grid[rIdx][cIdx].density / maxD;
                if (norm >= 0.8) zones.sangatTinggi.push(pt.displayName);
                else if (norm >= 0.6) zones.tinggi.push(pt.displayName);
                else if (norm >= 0.4) zones.sedang.push(pt.displayName);
                else if (norm >= 0.2) zones.rendah.push(pt.displayName);
                else zones.sangatRendah.push(pt.displayName);
            } else {
                zones.sangatRendah.push(pt.displayName);
            }
        });
        currentAnalysisResults = { type: 'kde', bandwidth: bw, resolution: res, maxDensity: maxD, hotCells, totalCells: flat.length, n: active.length, animated: doAnim, zones };
        showAnalysisResults('kde', currentAnalysisResults);
        setProgress('analysisProgressWrap', 'analysisProgressFill', 100);
        setTimeout(() => setProgress('analysisProgressWrap', 'analysisProgressFill', 0), 500);
    };
    processChunk(0, res + 1, finishKDE);
}

function startKDECanvasAnimation() {
    if (kdeCanvas) { kdeCanvas.remove(); kdeCanvas = null; }
    const KDELayer = L.Layer.extend({
        onAdd(map) {
            const pane = map.getPane('kdePane');
            kdeCanvas = L.DomUtil.create('canvas', '');
            Object.assign(kdeCanvas.style, { position: 'absolute', top: 0, left: 0, pointerEvents: 'none', opacity: 0 });
            pane.appendChild(kdeCanvas);
            this._map = map; map.on('moveend zoomend resize', this._redraw, this); this._redraw();
            let op = 0; const fi = setInterval(() => { op = Math.min(1, op + 0.05); kdeCanvas.style.opacity = op; if (op >= 1) clearInterval(fi); }, 30);
        },
        onRemove(map) { if (kdeCanvas) { kdeCanvas.remove(); kdeCanvas = null; } map.off('moveend zoomend resize', this._redraw, this); },
        _redraw() {
            if (!kdeCanvas || !kdeGridData) return;
            const { grid, maxDensity, resolution, latStep, lngStep } = kdeGridData, sz = this._map.getSize();
            kdeCanvas.width = sz.x; kdeCanvas.height = sz.y;
            const b = this._map.getBounds();
            const nw = this._map.latLngToLayerPoint(b.getNorthWest());
            kdeCanvas.style.left = nw.x + 'px'; kdeCanvas.style.top = nw.y + 'px';
            const ctx = kdeCanvas.getContext('2d'); ctx.clearRect(0, 0, sz.x, sz.y);
            for (let r = 0; r < resolution; r++) {
                for (let c = 0; c < resolution; c++) {
                    const cell = grid[r][c], norm = cell.density / maxDensity;
                    if (norm < 0.03) continue;
                    const sw = this._map.latLngToLayerPoint([cell.lat, cell.lng]);
                    const ne = this._map.latLngToLayerPoint([cell.lat + latStep, cell.lng + lngStep]);
                    const x = Math.min(sw.x, ne.x) - nw.x;
                    const y = Math.min(sw.y, ne.y) - nw.y;
                    const w = Math.abs(ne.x - sw.x) + 1;
                    const h = Math.abs(ne.y - sw.y) + 1;
                    ctx.fillStyle = densityToColorAlpha(norm, 1.0);
                    ctx.fillRect(x, y, w, h);
                }
            }
        }
    });
    const inst = new KDELayer(); inst.addTo(map); analysisLayers.push({ remove: () => inst.remove() });
    if (kdeAnimFrame) cancelAnimationFrame(kdeAnimFrame); let t = 0;
    function pulse() { if (!kdeCanvas) return; t += 0.025; kdeCanvas.style.opacity = (0.875 + 0.125 * Math.sin(t)).toFixed(3); kdeAnimFrame = requestAnimationFrame(pulse); } pulse();
}
function stopKDEAnimation() { if (kdeAnimFrame) { cancelAnimationFrame(kdeAnimFrame); kdeAnimFrame = null; } if (kdeCanvas) { kdeCanvas.remove(); kdeCanvas = null; } }
function densityToColorAlpha(n, a) { let r, g, b; if (n < 0.2) { r = 187; g = 247; b = 208; } else if (n < 0.4) { r = 253; g = 224; b = 71; } else if (n < 0.6) { r = 251; g = 146; b = 60; } else if (n < 0.8) { r = 220; g = 38; b = 38; } else { r = 127; g = 29; b = 29; } return `rgba(${r},${g},${b},${(a * (n * 0.8 + 0.2)).toFixed(2)})`; }
function densityToColor(n) { if (n < 0.2) return '#bbf7d0'; if (n < 0.4) return '#fde047'; if (n < 0.6) return '#fb923c'; if (n < 0.8) return '#dc2626'; return '#7f1d1d'; }
function addKDELegend(bw) { if (kdeLegend) { kdeLegend.remove(); kdeLegend = null; } kdeLegend = L.control({ position: 'bottomleft' }); kdeLegend.onAdd = function () { const div = L.DomUtil.create('div', 'kde-legend-wrap'); div.innerHTML = `<div class="kde-legend-title"><i class="fas fa-fire-alt" style="color:#e11d48;margin-right:4px"></i>KDE Hotspot</div><div class="kde-legend-item"><div class="kde-legend-swatch" style="background:#7f1d1d"></div>Sangat Tinggi (&gt;80%)</div><div class="kde-legend-item"><div class="kde-legend-swatch" style="background:#dc2626"></div>Tinggi (60–80%)</div><div class="kde-legend-item"><div class="kde-legend-swatch" style="background:#fb923c"></div>Sedang (40–60%)</div><div class="kde-legend-item"><div class="kde-legend-swatch" style="background:#fde047"></div>Rendah (20–40%)</div><div class="kde-legend-item"><div class="kde-legend-swatch" style="background:#bbf7d0"></div>Sangat Rendah</div><div style="font-size:9px;color:#94a3b8;margin-top:6px">Bandwidth: ${bw}m · n=${currentData.length}</div>`; return div; }; kdeLegend.addTo(map); }

// ── Gi* (Ord & Getis 1995) ─────────────────────────────────
function populateGiAttrSelect() { const sel = document.getElementById('giAttrSelect'); sel.innerHTML = '<option value="_lat">Latitude (default)</option>'; if (currentData.length) { Object.keys(currentData[0].attributes).forEach(k => { if (!isNaN(parseFloat(currentData[0].attributes[k]))) { const opt = document.createElement('option'); opt.value = k; opt.textContent = k; sel.appendChild(opt); } }); } }
function normalCDF(z) { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.8212560 + t * 1.3302744)))); return z > 0 ? 1 - p : p; }
function classifyGiStar(z) { if (z >= 2.576) return { type: 'hotspot', conf: '99%', color: '#7f1d1d', label: 'Hotspot 99%' }; if (z >= 1.96) return { type: 'hotspot', conf: '95%', color: '#dc2626', label: 'Hotspot 95%' }; if (z >= 1.645) return { type: 'hotspot', conf: '90%', color: '#fb923c', label: 'Hotspot 90%' }; if (z <= -2.576) return { type: 'coldspot', conf: '99%', color: '#1e3a8a', label: 'Coldspot 99%' }; if (z <= -1.96) return { type: 'coldspot', conf: '95%', color: '#2563eb', label: 'Coldspot 95%' }; if (z <= -1.645) return { type: 'coldspot', conf: '90%', color: '#93c5fd', label: 'Coldspot 90%' }; return { type: 'ns', conf: '', color: '#94a3b8', label: 'Tidak Signifikan' }; }

function performGiStarAnalysis() {
    const active = getActiveData();
    if (active.length < 5) { showError('Minimal 5 titik aktif untuk Getis-Ord Gi*'); return; }
    setProgress('analysisProgressWrap', 'analysisProgressFill', 10);
    analysisLayers.forEach(l => { try { if (l && l.remove) l.remove(); else if (map.hasLayer(l)) map.removeLayer(l); } catch (e) { } }); analysisLayers = [];
    if (giLegend) { giLegend.remove(); giLegend = null; }
    const thresh = parseInt(document.getElementById('giThreshSlider').value), attrKey = document.getElementById('giAttrSelect').value, n = active.length;
    const x = active.map(p => attrKey === '_lat' ? p.lat : (parseFloat(p.attributes[attrKey]) || p.lat));
    const xBar = x.reduce((a, b) => a + b, 0) / n, S = Math.sqrt(x.reduce((a, v) => a + (v - xBar) ** 2, 0) / n);
    const W = []; for (let i = 0; i < n; i++) { W[i] = []; for (let j = 0; j < n; j++)W[i][j] = map.distance([active[i].lat, active[i].lng], [active[j].lat, active[j].lng]) <= thresh ? 1 : 0; }
    setProgress('analysisProgressWrap', 'analysisProgressFill', 40);
    const results = active.map((pt, i) => { const wi = W[i], sumW = wi.reduce((a, b) => a + b, 0), sumW2 = wi.reduce((a, b) => a + b * b, 0), sumWx = wi.reduce((a, w, j) => a + w * x[j], 0); const num = sumWx - xBar * sumW; const denom = S > 0 ? S * Math.sqrt((n * sumW2 - sumW ** 2) / (n - 1)) : 0.0001; const zScore = denom > 0 ? num / denom : 0, pValue = 2 * (1 - normalCDF(Math.abs(zScore))); return { ...pt, zScore, pValue, cls: classifyGiStar(zScore) }; });
    setProgress('analysisProgressWrap', 'analysisProgressFill', 70);
    const giBaseRadius = Math.max(thresh * 0.35, 10);
    results.forEach((res, i) => { const radiusM = Math.max(giBaseRadius * 0.4, Math.min(giBaseRadius, giBaseRadius * (Math.abs(res.zScore) / 3))); const m = L.circle([res.lat, res.lng], { radius: radiusM, fillColor: res.cls.color, color: 'rgba(255,255,255,0.7)', weight: 1.5, opacity: 1, fillOpacity: 0.72, pane: 'analysisPane' }).addTo(map); const popupContent = `<div class="popup-wrap" style="min-width:170px"><div class="popup-name-display" style="font-size:12px">${escapeHTML(res.displayName)}</div><div class="popup-coords"><div><span class="popup-coord-label">Z-Score</span><br><span class="popup-coord-val" style="color:${res.cls.color};font-weight:600">${res.zScore.toFixed(3)}</span></div><div><span class="popup-coord-label">P-Value</span><br><span class="popup-coord-val">${res.pValue.toFixed(4)}</span></div></div><div class="interp-card" style="margin:0"><div class="interp-value" style="color:${res.cls.color}">${res.cls.label}</div></div></div>`; m.bindPopup(popupContent, { maxWidth: 220, className: '', closeButton: false }); analysisLayers.push(m); });
    giLegend = L.control({ position: 'bottomleft' }); giLegend.onAdd = function () { const div = L.DomUtil.create('div', 'gi-legend-wrap'); div.innerHTML = `<div class="gi-legend-title"><i class="fas fa-map-marked-alt" style="color:#d97706;margin-right:4px"></i>Getis-Ord Gi*</div><div class="gi-legend-item"><div class="gi-legend-swatch" style="background:#7f1d1d"></div>Hotspot 99%</div><div class="gi-legend-item"><div class="gi-legend-swatch" style="background:#dc2626"></div>Hotspot 95%</div><div class="gi-legend-item"><div class="gi-legend-swatch" style="background:#fb923c"></div>Hotspot 90%</div><div class="gi-legend-item"><div class="gi-legend-swatch" style="background:#94a3b8"></div>Tidak Signifikan</div><div class="gi-legend-item"><div class="gi-legend-swatch" style="background:#93c5fd"></div>Coldspot 90%</div><div class="gi-legend-item"><div class="gi-legend-swatch" style="background:#2563eb"></div>Coldspot 95%</div><div class="gi-legend-item"><div class="gi-legend-swatch" style="background:#1e3a8a"></div>Coldspot 99%</div><div style="font-size:9px;color:#94a3b8;margin-top:6px">Threshold: ${thresh}m · n=${n} aktif</div>`; return div; }; giLegend.addTo(map);
    const hot95 = results.filter(r => r.zScore >= 1.96).length, cold95 = results.filter(r => r.zScore <= -1.96).length, ns = results.filter(r => Math.abs(r.zScore) < 1.645).length;
    const topHot = results.filter(r => r.cls.type === 'hotspot').sort((a, b) => b.zScore - a.zScore).slice(0, 3);
    const topCold = results.filter(r => r.cls.type === 'coldspot').sort((a, b) => a.zScore - b.zScore).slice(0, 3);
    setProgress('analysisProgressWrap', 'analysisProgressFill', 100);
    currentAnalysisResults = { type: 'gi', hot95, cold95, ns, n, threshold: thresh, attrKey, topHot, topCold }; showAnalysisResults('gi', currentAnalysisResults);
    setTimeout(() => setProgress('analysisProgressWrap', 'analysisProgressFill', 0), 500);
}

// ── Standard Deviational Ellipse (SDE) — PROYEKSI ──────────
function performSDEAnalysis() {
    const active = getActiveData();
    if (active.length < 3) { showError('Minimal 3 titik aktif untuk SDE'); return; }
    setProgress('analysisProgressWrap', 'analysisProgressFill', 30);
    const projected = active.map(p => {
        const merc = L.CRS.EPSG3857.project(L.latLng(p.lat, p.lng));
        return turf.point([merc.x, merc.y]);
    });
    const fc = turf.featureCollection(projected);
    const sdeProj = turf.standardDeviationalEllipse(fc);
    setProgress('analysisProgressWrap', 'analysisProgressFill', 70);
    const coords = turf.getCoords(sdeProj);
    const unprojected = coords[0].map(c => {
        const latlng = L.CRS.EPSG3857.unproject(L.point(c[0], c[1]));
        return [latlng.lng, latlng.lat];
    });
    sdeProj.geometry.coordinates = [unprojected];
    const layer = L.geoJSON(sdeProj, {
        style: { color: '#8b5cf6', weight: 2, fillColor: '#8b5cf6', fillOpacity: 0.15, dashArray: '5,5' },
        pane: 'analysisPane'
    }).addTo(map);
    analysisLayers.push(layer);
    const area = turf.area(sdeProj);
    const props = sdeProj.properties;
    setProgress('analysisProgressWrap', 'analysisProgressFill', 100);
    currentAnalysisResults = {
        type: 'sde', n: active.length, area: area, center: props.meanCenter,
        semiMajor: props.semiMajor, semiMinor: props.semiMinor, rotation: props.angle
    };
    showAnalysisResults('sde', currentAnalysisResults);
    setTimeout(() => setProgress('analysisProgressWrap', 'analysisProgressFill', 0), 500);
}

// ── Voronoi Polygons ─────────────────────────────────────────
function performVoronoiAnalysis() {
    const active = getActiveData();
    if (active.length < 3) { showError('Minimal 3 titik aktif untuk Voronoi'); return; }

    analysisLayers.forEach(l => { try { if (l && l.remove) l.remove(); else if (map.hasLayer(l)) map.removeLayer(l); } catch (e) { } }); analysisLayers = [];

    const points = turf.featureCollection(active.map(p => turf.point([p.lng, p.lat])));
    let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
    active.forEach(p => { if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng; });

    const margin = 0.05;
    const bbox = [minLng - margin, minLat - margin, maxLng + margin, maxLat + margin];
    const voronoi = turf.voronoi(points, { bbox });

    voronoi.features.forEach((feat, i) => {
        if (feat) {
            const pt = active[i];
            const areaSqMeters = turf.area(feat);
            const areaHectares = areaSqMeters / 10000;
            feat.properties = {
                name: pt.displayName,
                areaM2: areaSqMeters,
                areaHa: areaHectares
            };
        }
    });

    const layer = L.geoJSON(voronoi, {
        style: { color: '#0ea5e9', weight: 1.5, fillColor: '#0ea5e9', fillOpacity: 0.15, opacity: 0.8 },
        pane: 'analysisPane',
        onEachFeature: function (feature, layer) {
            if (feature.properties && feature.properties.name) {
                const popupContent = `<div class="popup-wrap" style="min-width:180px; padding:8px;">
                            <div class="popup-name-display" style="font-size:13px; margin-bottom:8px;">${escapeHTML(feature.properties.name)}</div>
                            <div style="display:flex; flex-direction:column; gap:6px; padding:8px; background:var(--surface-2); border-radius:var(--radius-sm); border:1px solid var(--border);">
                                <div style="display:flex; justify-content:space-between; font-size:12px; align-items:center;">
                                    <span style="color:var(--text-secondary); font-weight:500;"><i class="fas fa-draw-polygon" style="margin-right:4px;color:#0ea5e9"></i>Luas Area</span>
                                    <span style="color:#0ea5e9; font-weight:700;">${feature.properties.areaHa.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ha</span>
                                </div>
                                <div style="display:flex; justify-content:space-between; font-size:11px; align-items:center; border-top:1px dashed var(--border); padding-top:6px;">
                                    <span style="color:var(--text-muted);">Meter Persegi</span>
                                    <span style="color:var(--text-primary); font-family:monospace;">${feature.properties.areaM2.toLocaleString('id-ID', { maximumFractionDigits: 0 })} m²</span>
                                </div>
                            </div>
                        </div>`;
                layer.bindPopup(popupContent, { maxWidth: 250, className: '', closeButton: true });
            }
        }
    }).addTo(map);
    analysisLayers.push(layer);
    currentAnalysisResults = { type: 'voronoi', n: active.length, polygonCount: voronoi.features.filter(f => f).length };
    showAnalysisResults('voronoi', currentAnalysisResults);
}

// ── Bounding Box Area ───────────────────────────────────────
function calculateBoundingBoxArea(data) {
    const d = data || currentData;
    if (!d.length) return 1;
    let minLat = d[0].lat, maxLat = d[0].lat, minLng = d[0].lng, maxLng = d[0].lng;
    d.forEach(p => { if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat; if (p.lng < minLng) minLng = p.lng; if (p.lng > maxLng) maxLng = p.lng; });
    const ld = (maxLat - minLat) * 111320, lgd = (maxLng - minLng) * 111320 * Math.cos((minLat + maxLat) / 2 * Math.PI / 180);
    return Math.max(ld * lgd, 1000000);
}

// ── Tampilkan hasil ──────────────────────────────────────────
function showAnalysisResults(type, data) {
    const bottomPanel = document.getElementById('bottomPanel'), results = document.getElementById('analysisResults');
    let html = '';
    if (type === 'distance') {
        html = `<div class="results-grid"><div class="stat-card"><div class="stat-label">Total Jarak</div><div class="stat-value">${data.total.toFixed(2)} m</div></div><div class="stat-card"><div class="stat-label">Jumlah Segmen</div><div class="stat-value">${data.segments}</div></div></div>`;
    } else if (type === 'buffer') {
        html = `<div class="results-grid"><div class="stat-card"><div class="stat-label">Radius</div><div class="stat-value">${data.radius} m</div></div><div class="stat-card"><div class="stat-label">Titik Terdeteksi</div><div class="stat-value">${data.count}</div></div></div>`;
    } else if (type === 'nearest') {
        html = `<div class="results-grid"><div class="stat-card"><div class="stat-label">R-Ratio</div><div class="stat-value">${data.rRatio.toFixed(3)}</div></div><div class="stat-card"><div class="stat-label">Z-Score</div><div class="stat-value">${data.zScore.toFixed(3)}</div></div></div><div class="interp-card"><div class="interp-label">Interpretasi:</div><div class="interp-value">${data.interpretation}</div></div>`;
    } else if (type === 'moran') {
        html = `<div class="results-grid"><div class="stat-card"><div class="stat-label">Moran Index</div><div class="stat-value">${data.moranI.toFixed(4)}</div></div><div class="stat-card"><div class="stat-label">Z-Score</div><div class="stat-value">${data.zScore.toFixed(3)}</div></div></div><div class="interp-card"><div class="interp-label">Pola:</div><div class="interp-value">${data.pola}</div></div>`;
    } else if (type === 'ripley') {
        html = `<div class="results-grid"><div class="stat-card"><div class="stat-label">Jarak Max</div><div class="stat-value">${data.maxDist.toFixed(0)} m</div></div><div class="stat-card"><div class="stat-label">L(d) Avg</div><div class="stat-value">${data.avgL.toFixed(2)}</div></div></div>`;
    } else if (type === 'kde') {
        const hp = ((data.hotCells / data.totalCells) * 100).toFixed(1);
        const z = data.zones || { sangatTinggi: [], tinggi: [], sedang: [], rendah: [], sangatRendah: [] };
        const zoneRow = (label, color, icon, arr) => {
            if (!arr.length) return `<div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid var(--border)"><div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></div><span style="font-size:11px;font-weight:600;min-width:90px">${label}</span><span style="font-size:10px;color:var(--text-muted);font-style:italic">— tidak ada titik</span></div>`;
            const names = arr.slice(0, 5).map(n => escapeHTML(n)).join(', ') + (arr.length > 5 ? ` <span style="color:var(--text-muted)">(+${arr.length - 5} lainnya)</span>` : '');
            return `<div style="display:flex;align-items:flex-start;gap:6px;padding:5px 0;border-bottom:1px solid var(--border)"><div style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0;margin-top:2px"></div><div><div style="font-size:11px;font-weight:600">${label} <span style="font-weight:400;color:var(--text-muted)">(${arr.length} titik)</span></div><div style="font-size:10px;color:var(--text-secondary);margin-top:1px">${names}</div></div></div>`;
        };
        html = `<div class="stats-grid"><div class="stat-card"><div class="stat-value">${data.n}</div><div class="stat-label">Total Titik</div></div><div class="stat-card"><div class="stat-value">${(data.bandwidth / 1000).toFixed(1)}km</div><div class="stat-label">Bandwidth</div></div><div class="stat-card"><div class="stat-value">${hp}%</div><div class="stat-label">Sel Hotspot ≥70%</div></div><div class="stat-card"><div class="stat-value">${data.resolution}×${data.resolution}</div><div class="stat-label">Resolusi Grid</div></div></div>`;
        html += `<div class="interp-card"><div class="interp-title"><i class="fas fa-fire-alt" style="color:#e11d48;margin-right:4px"></i>Distribusi Area Densitas</div><div style="margin-top:4px">${zoneRow('Sangat Tinggi (≥80%)', '#7f1d1d', 'fire', z.sangatTinggi)}${zoneRow('Tinggi (60–80%)', '#dc2626', 'arrow-up', z.tinggi)}${zoneRow('Sedang (40–60%)', '#fb923c', 'equals', z.sedang)}${zoneRow('Rendah (20–40%)', '#fde047', 'arrow-down', z.rendah)}${zoneRow('Sangat Rendah (<20%)', '#bbf7d0', 'leaf', z.sangatRendah)}</div></div>`;
        html += `<div class="interp-card" style="margin-top:6px"><div class="interp-title">Statistik KDE</div><div class="interp-row"><strong>Resolusi:</strong> ${data.resolution}×${data.resolution} · Epanechnikov kernel</div><div class="interp-row" style="color:#e11d48;font-weight:500;margin-top:3px">Area merah = konsentrasi tertinggi</div></div><div class="methodology-callout"><i class="fas fa-info-circle"></i> <strong>Catatan metodologis:</strong> Bandwidth dipilih manual. Gunakan <em>Least Squares Cross-Validation (LSCV)</em> atau <em>Sheather-Jones plug-in</em> untuk pemilihan otomatis (Bowman, 1984; Sheather & Jones, 1991).</div><div class="credit-badge"><i class="fas fa-book"></i> <a href="https://doi.org/10.1002/9780470316849" target="_blank" rel="noopener">Silverman (1986)</a> · Sheather & Jones (1991) bw selector · Davies & Hazelton (2010) adaptive KDE</div>`;
    } else if (type === 'gi') {
        let thHtml = '', tcHtml = '';
        data.topHot.forEach(r => { thHtml += `<div class="ripley-row" style="display:flex"><strong style="flex:1">${escapeHTML(r.displayName)}</strong><span style="color:#dc2626">z=${r.zScore.toFixed(2)}</span></div>`; });
        data.topCold.forEach(r => { tcHtml += `<div class="ripley-row" style="display:flex"><strong style="flex:1">${escapeHTML(r.displayName)}</strong><span style="color:#2563eb">z=${r.zScore.toFixed(2)}</span></div>`; });
        html = `<div class="stats-grid"><div class="stat-card"><div class="stat-value" style="color:#dc2626">${data.hot95}</div><div class="stat-label">Hotspot 95%</div></div><div class="stat-card"><div class="stat-value" style="color:#2563eb">${data.cold95}</div><div class="stat-label">Coldspot 95%</div></div><div class="stat-card"><div class="stat-value">${data.ns}</div><div class="stat-label">Tidak Signifikan</div></div><div class="stat-card"><div class="stat-value">${data.n}</div><div class="stat-label">Total</div></div></div><div class="interp-card"><div class="interp-title">Atribut: ${escapeHTML(data.attrKey === '_lat' ? 'Latitude' : data.attrKey)} · Threshold: ${data.threshold}m</div></div>`;
        if (data.topHot.length) html += `<div style="margin-top:6px"><div class="interp-title" style="color:#dc2626;margin-bottom:3px">Top Hotspot</div>${thHtml}</div>`;
        if (data.topCold.length) html += `<div style="margin-top:6px"><div class="interp-title" style="color:#2563eb;margin-bottom:3px">Top Coldspot</div>${tcHtml}</div>`;
        html += `<div class="methodology-callout"><i class="fas fa-info-circle"></i> <strong>Catatan metodologis:</strong> Tidak ada koreksi <em>multiple testing</em>. Gunakan FDR (Benjamini-Hochberg) untuk mengurangi false positives pada dataset besar.</div><div class="credit-badge"><i class="fas fa-book"></i> <a href="https://doi.org/10.1111/j.1538-4632.1992.tb00261.x" target="_blank" rel="noopener">Getis & Ord (1992)</a> · <a href="https://doi.org/10.1111/j.1538-4632.1995.tb00912.x" target="_blank" rel="noopener">Ord & Getis (1995)</a></div>`;
    } else if (type === 'sde') {
        html = `<div class="stats-grid"><div class="stat-card"><div class="stat-value">${data.n}</div><div class="stat-label">Total Titik</div></div><div class="stat-card"><div class="stat-value">${(data.area / 1000000).toFixed(2)}</div><div class="stat-label">Luas (km²)</div></div><div class="stat-card"><div class="stat-value">${data.rotation.toFixed(1)}°</div><div class="stat-label">Sudut Rotasi</div></div><div class="stat-card"><div class="stat-value">${(data.semiMajor / data.semiMinor).toFixed(2)}</div><div class="stat-label">Rasio Elips</div></div></div><div class="interp-card"><div class="interp-title">Standard Deviational Ellipse <span style="font-size:9px;color:#059669">(proyeksi Mercator)</span></div><div class="interp-row"><strong>Mean Center:</strong> ${data.center[1].toFixed(5)}, ${data.center[0].toFixed(5)}</div><div class="interp-row"><strong>Sumbu Mayor:</strong> ${data.semiMajor.toFixed(0)}m</div><div class="interp-row"><strong>Sumbu Minor:</strong> ${data.semiMinor.toFixed(0)}m</div></div><div class="credit-badge"><i class="fas fa-book"></i> Lefever (1926) · Yuill (1971) · Wang et al. (2015) confidence SDE</div>`;
    } else if (type === 'voronoi') {
        html = `<div class="stats-grid"><div class="stat-card"><div class="stat-value">${data.n}</div><div class="stat-label">Titik Input</div></div><div class="stat-card"><div class="stat-value">${data.polygonCount}</div><div class="stat-label">Poligon Terbentuk</div></div></div><div class="interp-card"><div class="interp-title">Thiessen Polygons</div><div class="interp-row">Menunjukkan area pengaruh masing-masing titik berdasarkan jarak terdekat (Euclidean).</div></div><div class="credit-badge"><i class="fas fa-book"></i> Voronoi (1908) · Thiessen (1911) · Okabe et al. (2000)</div>`;
    }
    results.innerHTML = html;
    bottomPanel.classList.remove('panel-hidden');
}

function clearAnalysisResults() {
    document.getElementById('bottomPanel').classList.add('panel-hidden');
    document.getElementById('analysisResults').innerHTML = '';
}

function refreshAnalysis() {
    analysisMode = null; bufferPoint = null; currentAnalysisResults = null; kdeGridData = null;
    document.querySelectorAll('.analysis-btn').forEach(b => b.classList.remove('active'));
    ['bufferControls', 'kdeControls', 'giControls', 'moranControls', 'distanceControls'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    clearDistanceLines(); stopKDEAnimation();
    analysisLayers.forEach(l => { try { if (l && l.remove) l.remove(); else if (map.hasLayer(l)) map.removeLayer(l); } catch (e) { } }); analysisLayers = [];
    if (kdeLegend) { kdeLegend.remove(); kdeLegend = null; } if (giLegend) { giLegend.remove(); giLegend = null; }
    // Hormati kategorisasi yang ada
    if (currentLayer) {
        if (kategoriState.active) {
            kategoriState.markerMap.forEach(({ marker, kategori }) => {
                if (kategoriState.hiddenCats.has(kategori)) {
                    marker.setStyle({ fillOpacity: 0, opacity: 0, interactive: false });
                } else {
                    const color = kategoriState.colorMap[kategori] || '#94a3b8';
                    marker.setStyle({ fillColor: color, color: darkenColor(color), fillOpacity: 0.88, opacity: 1, interactive: true });
                }
            });
        } else {
            currentLayer.eachLayer(l => { if (l.setStyle) l.setStyle({ fillColor: '#4f46e5', color: '#3730a3', fillOpacity: 0.85, opacity: 1 }); });
        }
    }
    clearAnalysisResults(); showSuccess('Analisis berhasil direset.');
}

// ── Ekspor Hasil ─────────────────────────────────────────────
function exportAnalysisResults() {
    if (!currentAnalysisResults) { showError('Tidak ada hasil analisis untuk diekspor!'); return; }
    const resultsHtml = document.getElementById('analysisResults').innerHTML;
    const typeLabel = currentAnalysisResults.type.toUpperCase();
    const date = new Date().toLocaleString('id-ID');
    const reportHtml = `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8"><title>Laporan PointGIS - ${typeLabel}</title><link rel="stylesheet" href="css/style.css"></head><body><div class="report-container"><div class="header"><div><h1 style="font-size:24px">PointGIS v2.1 — Laporan Analisis</h1><p style="color:#64748b;font-size:12px">Dicetak: ${date}</p></div></div><div style="background:#f1f5f9;padding:25px;border-radius:12px;margin-bottom:30px">${resultsHtml}</div><div style="text-align:center;font-size:12px;color:#94a3b8">© ${new Date().getFullYear()} PointGIS — Advanced Point Pattern Analysis</div></div></body></html>`;
    const win = window.open('', '_blank');
    win.document.write(reportHtml);
    win.document.close();
    showSuccess('Laporan siap dicetak!');
}

// ── File handling ───────────────────────────────────────────
function handleFile(file) {
    const n = file.name.toLowerCase();
    if (!['.kml', '.kmz', '.xlsx', '.xls'].some(e => n.endsWith(e))) { showError('Format tidak didukung.'); return; }
    showLoading(true);
    if (n.endsWith('.kmz')) handleKMZ(file);
    else if (n.endsWith('.xlsx') || n.endsWith('.xls')) handleExcel(file);
    else { const r = new FileReader(); r.onload = e => { try { parseKML(e.target.result); } catch (err) { showError('Error KML: ' + err.message); showLoading(false); } }; r.readAsText(file); }
}

function handleKMZ(file) {
    const r = new FileReader();
    r.onload = e => JSZip.loadAsync(e.target.result).then(zip => {
        let kf = null;
        Object.keys(zip.files).forEach(fn => { if (fn.toLowerCase().endsWith('.kml')) kf = zip.files[fn]; });
        if (kf) kf.async('text').then(t => { try { parseKML(t, zip); } catch (err) { showError('Error KMZ: ' + err.message); showLoading(false); } });
        else { showError('Tidak ada KML dalam KMZ'); showLoading(false); }
    }).catch(err => { showError('Error baca KMZ: ' + err.message); showLoading(false); });
    r.readAsArrayBuffer(file);
}

function handleExcel(file) {
    const r = new FileReader();
    r.onload = e => { try { const wb = XLSX.read(e.target.result, { type: 'array' }); parseExcelData(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])); } catch (err) { showError('Error Excel: ' + err.message); showLoading(false); } };
    r.readAsArrayBuffer(file);
}

function parseExcelData(data) {
    if (!data.length) { showError('File Excel kosong'); showLoading(false); return; }
    currentData = []; const allAttrs = new Set();
    if (currentLayer) map.removeLayer(currentLayer);
    currentLayer = L.layerGroup().addTo(map);
    const cols = Object.keys(data[0]);
    let latCol = null, lngCol = null;
    cols.forEach(c => { const cl = c.toLowerCase(); if (!latCol && (cl.includes('lat') || cl === 'y')) latCol = c; if (!lngCol && (cl.includes('lng') || cl.includes('lon') || cl === 'x')) lngCol = c; });
    if (!latCol || !lngCol) { showError('Kolom lat/lng tidak ditemukan'); showLoading(false); return; }
    data.forEach((row, idx) => {
        const lat = parseFloat(row[latCol]), lng = parseFloat(row[lngCol]);
        if (!isNaN(lat) && !isNaN(lng)) {
            const attrs = {};
            Object.keys(row).forEach(k => { if (row[k] != null && row[k] !== '') { attrs[k] = row[k].toString(); allAttrs.add(k); } });
            const name = getBestName(attrs, `#${idx + 1}`);
            const pd = { lat, lng, attributes: attrs, displayName: name };
            currentData.push(pd); addMarker(lat, lng, pd, null);
        }
    });
    finalizeLoad(allAttrs, 'Excel', currentData.length);
}

function parseKML(kmlText, zipFile = null) {
    const doc = new DOMParser().parseFromString(kmlText, 'text/xml');
    const pms = doc.getElementsByTagName('Placemark');
    if (!pms.length) { showError('Tidak ada titik dalam KML'); showLoading(false); return; }
    currentData = []; const allAttrs = new Set();
    if (currentLayer) map.removeLayer(currentLayer);
    currentLayer = L.layerGroup().addTo(map);
    for (let i = 0; i < pms.length; i++) {
        const pm = pms[i], coordEl = pm.getElementsByTagName('coordinates')[0];
        if (!coordEl) continue;
        const [lng, lat] = coordEl.textContent.trim().split(',').map(Number);
        if (isNaN(lat) || isNaN(lng)) continue;
        const attrs = {};
        const nameEl = pm.getElementsByTagName('name')[0], descEl = pm.getElementsByTagName('description')[0];
        if (nameEl) { attrs['Name'] = nameEl.textContent; allAttrs.add('Name'); }
        if (descEl) { attrs['Description'] = descEl.textContent; allAttrs.add('Description'); }
        const extData = pm.getElementsByTagName('ExtendedData')[0];
        if (extData) { const sds = extData.getElementsByTagName('SimpleData'); for (let j = 0; j < sds.length; j++) { attrs[sds[j].getAttribute('name')] = sds[j].textContent; allAttrs.add(sds[j].getAttribute('name')); } }
        const name = getBestName(attrs, `#${i + 1}`);
        const pd = { lat, lng, attributes: attrs, displayName: name };
        currentData.push(pd); addMarker(lat, lng, pd, zipFile);
    }
    finalizeLoad(allAttrs, 'KML', currentData.length);
}

function addMarker(lat, lng, pointData, zipFile) {
    const m = L.circle([lat, lng], { radius: 10, fillColor: '#00ffff', color: '#ffffff', weight: 1.5, opacity: 0.9, fillOpacity: 0.7, className: 'glowing-point' });
    m.pointData = pointData;
    m.on('click', () => handleMarkerClick(m, pointData, zipFile));
    currentLayer.addLayer(m);
}

function finalizeLoad(allAttrs, type, count) {
    if (!count) { showError('Tidak ada titik valid'); showLoading(false); return; }
    const g = new L.featureGroup(currentLayer.getLayers());
    map.fitBounds(g.getBounds().pad(0.12));
    selectedAttributes = new Set(allAttrs);
    document.getElementById('attributesSection').style.display = 'block';
    createDashboardChart();
    enableAnalysisButtons();
    populateKategoriSelect();
    showSuccess(`${count} titik berhasil dimuat dari file ${type}.`);
    showLoading(false);
}

function createDashboardChart() {
    const ctx = document.getElementById('attributeChart').getContext('2d');
    if (attributeChart) attributeChart.destroy();
    attributeChart = new Chart(ctx, {
        type: 'doughnut',
        data: { labels: ['Total Titik', 'Atribut Aktif'], datasets: [{ data: [currentData.length, selectedAttributes.size], backgroundColor: ['#4f46e5', '#7c3aed'], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { font: { family: 'Inter', size: 10 }, padding: 8, usePointStyle: true } } }, layout: { padding: 4 } }
    });
    createDataList();
}

function createDataList() {
    const list = document.getElementById('dataList'); list.innerHTML = '';
    currentData.forEach((pt, idx) => {
        const item = document.createElement('div'); item.className = 'data-item'; item.onclick = () => zoomToPoint(pt);
        item.innerHTML = `<div class="data-item-name">${escapeHTML(pt.displayName)}</div><div class="data-item-coords">${pt.lat.toFixed(4)}, ${pt.lng.toFixed(4)}</div>`;
        list.appendChild(item);
    });
}

// ── Marker click — popup selalu aktif ──────────────────────
function handleMarkerClick(marker, pointData, zipFile = null) {
    if (analysisMode === 'distance') addDistancePoint(marker, pointData);
    if (analysisMode === 'buffer') selectBufferPoint(marker, pointData);
    openCompactPopup(marker, pointData, zipFile);
}

function openCompactPopup(marker, pointData, zipFile = null) {
    const pid = 'p' + Date.now();
    let attrsHtml = '';
    Object.keys(pointData.attributes).forEach(attr => {
        const val = pointData.attributes[attr];
        if (val == null || val === '') return;
        const isUrl = /^https?:\/\/.+/.test(val);
        attrsHtml += `<div class="popup-attr-row">
            <span class="popup-attr-key">${escapeHTML(attr)}</span>
            <span class="popup-attr-val">${isUrl ? `<a href="${escapeHTML(val)}" target="_blank" rel="noopener" style="color:#4f46e5">${escapeHTML(val.length > 28 ? val.substring(0, 28) + '…' : val)} <i class="fas fa-external-link-alt" style="font-size:8px"></i></a>` : escapeHTML(val)}</span>
        </div>`;
        if (zipFile && /\.(jpg|jpeg|png|gif)$/i.test(val)) {
            const iid = 'img_' + pid + '_' + attr.replace(/\s+/g, '');
            attrsHtml += `<img id="${iid}" style="max-width:100%;max-height:200px;border-radius:5px;display:none;margin-top:3px" alt="${escapeHTML(attr)}"/>`;
            zipFile.files[val]?.async('base64').then(b64 => { const el = document.getElementById(iid); if (el) { el.src = `data:image/jpeg;base64,${b64}`; el.style.display = 'block'; } });
        }
    });

    const html = `<div class="popup-wrap">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
            <div class="popup-name-display" style="flex:1;margin:0;font-size:12px">${escapeHTML(pointData.displayName)}</div>
            <button class="popup-close-btn" onclick="window.closeCurrentPopup()" style="margin-left:5px" aria-label="Tutup popup">×</button>
        </div>
        <div class="popup-coords" style="margin-bottom:5px">
            <div><span class="popup-coord-label">Lat</span><br><span class="popup-coord-val">${pointData.lat.toFixed(5)}</span></div>
            <div><span class="popup-coord-label">Lng</span><br><span class="popup-coord-val">${pointData.lng.toFixed(5)}</span></div>
        </div>
        <div class="popup-attrs" style="max-height:160px">${attrsHtml}</div>
        <div class="popup-actions">
            <button class="popup-action-btn" style="background:#4f46e5;color:#fff" onclick="window.zoomToCoords(${pointData.lat},${pointData.lng})"><i class="fas fa-crosshairs"></i> Zoom</button>
            <button class="popup-action-btn" style="background:#059669;color:#fff" onclick="window.copyCoordinates(${pointData.lat},${pointData.lng})"><i class="fas fa-copy"></i> Copy</button>
        </div>
    </div>`;
    const popup = L.popup({ maxWidth: 240, className: '', closeButton: false, autoClose: true, closeOnClick: true }).setContent(html);
    marker.bindPopup(popup).openPopup();
}

window.closeCurrentPopup = () => map.closePopup();
window.copyCoordinates = function (lat, lng) {
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => showSuccess('Koordinat disalin: ' + text)).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
};
function fallbackCopy(text) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); showSuccess('Koordinat disalin: ' + text); } catch { showError('Gagal menyalin koordinat'); }
    document.body.removeChild(ta);
}

function zoomToPoint(pt) {
    map.setView([pt.lat, pt.lng], 18);
    currentLayer.eachLayer(l => {
        if (l.pointData === pt || (l.getLatLng && Math.abs(l.getLatLng().lat - pt.lat) < 0.0001 && Math.abs(l.getLatLng().lng - pt.lng) < 0.0001)) {
            const orig = { fillColor: l.options.fillColor, color: l.options.color };
            l.setStyle({ fillColor: '#dc2626', color: '#b91c1c' });
            setTimeout(() => { if (l.setStyle) l.setStyle(orig); }, 2500);
            setTimeout(() => l.fire('click'), 220);
        }
    });
}
window.zoomToPoint = zoomToPoint;
window.zoomToCoords = function (lat, lng) {
    const pt = currentData.find(p => Math.abs(p.lat - lat) < 0.0001 && Math.abs(p.lng - lng) < 0.0001);
    if (pt) zoomToPoint(pt); else map.setView([lat, lng], 18);
};

// ── Enable buttons ──────────────────────────────────────────
function enableAnalysisButtons() {
    ['distanceBtn', 'bufferBtn', 'nearestBtn', 'moranBtn', 'ripleyBtn', 'kdeBtn', 'giBtn', 'sdeBtn', 'voronoiBtn', 'refreshBtn'].forEach(id => document.getElementById(id).disabled = false);
}

// ── KATEGORISASI ────────────────────────────────────────────
function populateKategoriSelect() {
    const sel = document.getElementById('kategoriSelect');
    sel.innerHTML = '<option value="">— Pilih kolom —</option>';
    if (!currentData.length) return;
    Array.from(selectedAttributes).forEach(k => {
        const vals = [...new Set(currentData.map(p => p.attributes[k]).filter(Boolean))];
        if (vals.length >= 2 && vals.length <= 25) {
            const opt = document.createElement('option');
            opt.value = k; opt.textContent = `${k}  (${vals.length})`;
            sel.appendChild(opt);
        }
    });
}

function applyKategorisasi() {
    const kolom = document.getElementById('kategoriSelect').value;
    if (!kolom) { showError('Pilih kolom kategori terlebih dahulu!'); return; }
    const uniqueVals = [...new Set(currentData.map(p => p.attributes[kolom]).filter(Boolean))].sort();
    if (uniqueVals.length > 25) { showError(`Kolom "${kolom}" punya ${uniqueVals.length} nilai unik — maks 25.`); return; }
    const colorMap = {};
    uniqueVals.forEach((v, i) => { colorMap[v] = KATEGORI_PALETTE[i % KATEGORI_PALETTE.length]; });
    kategoriState = { active: true, kolom, colorMap, hiddenCats: new Set(), markerMap: [] };
    currentLayer.eachLayer(layer => {
        if (!layer.setStyle || !layer.pointData) return;
        const pt = layer.pointData;
        const val = pt.attributes[kolom] || '__nocat__';
        const color = colorMap[val] || '#94a3b8';
        layer.setStyle({ fillColor: color, color: darkenColor(color), fillOpacity: 0.88, opacity: 1, interactive: true });
        kategoriState.markerMap.push({ marker: layer, kategori: val, pt });
    });
    renderKategoriLegend(uniqueVals, colorMap, kolom);
    document.getElementById('resetKategoriBtn').disabled = false;
    updateDashboardAfterFilter();
    showSuccess(`"${kolom}" — ${uniqueVals.length} kategori aktif.`);
}

function renderKategoriLegend(vals, colorMap, kolom) {
    const leg = document.getElementById('kategoriLegend');
    const counts = {};
    currentData.forEach(p => { const v = p.attributes[kolom]; if (v) counts[v] = (counts[v] || 0) + 1; });
    leg.style.display = 'block';
    leg.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
        <div class="kategori-legend-title" style="margin:0">${escapeHTML(kolom)}</div>
        <div style="display:flex;gap:3px">
            <button onclick="window.setAllKategori(true)" style="font-size:9px;padding:1px 5px;border:1px solid var(--border);border-radius:3px;background:var(--surface-2);cursor:pointer;color:var(--text-secondary)" aria-label="Tampilkan semua">Semua</button>
            <button onclick="window.setAllKategori(false)" style="font-size:9px;padding:1px 5px;border:1px solid var(--border);border-radius:3px;background:var(--surface-2);cursor:pointer;color:var(--text-secondary)" aria-label="Sembunyikan semua">Hapus</button>
        </div>
    </div>`;
    vals.forEach(val => {
        const color = colorMap[val], cnt = counts[val] || 0, isHidden = kategoriState.hiddenCats.has(val);
        const item = document.createElement('div');
        item.className = 'kategori-legend-item' + (isHidden ? ' faded' : '');
        item.dataset.val = val;
        item.innerHTML = `<div class="kategori-swatch" style="background:${isHidden ? 'transparent' : color};border-color:${color}"></div>
            <span class="kategori-label">${escapeHTML(val)}</span><span class="kategori-count">${cnt}</span>`;
        item.addEventListener('click', () => toggleKategoriVisibility(val));
        leg.appendChild(item);
    });
    const activeN = getActiveData().length;
    leg.innerHTML += `<div id="kategoriActiveInfo" style="font-size:10px;color:var(--text-muted);margin-top:5px;padding-top:4px;border-top:1px solid var(--border)">${activeN} dari ${currentData.length} titik aktif</div>`;
}

function toggleKategoriVisibility(val) {
    const { hiddenCats, markerMap, colorMap } = kategoriState;
    if (hiddenCats.has(val)) hiddenCats.delete(val); else hiddenCats.add(val);
    _applyMarkerVisibility(markerMap, hiddenCats, colorMap);
    document.querySelectorAll('.kategori-legend-item').forEach(el => {
        const h = hiddenCats.has(el.dataset.val);
        el.classList.toggle('faded', h);
        const sw = el.querySelector('.kategori-swatch');
        if (sw) sw.style.background = h ? 'transparent' : (colorMap[el.dataset.val] || '#94a3b8');
    });
    const info = document.getElementById('kategoriActiveInfo');
    if (info) info.textContent = `${getActiveData().length} dari ${currentData.length} titik aktif`;
    updateDashboardAfterFilter();
}

window.setAllKategori = function (show) {
    const { colorMap, markerMap } = kategoriState;
    if (show) kategoriState.hiddenCats.clear();
    else Object.keys(colorMap).forEach(v => kategoriState.hiddenCats.add(v));
    _applyMarkerVisibility(markerMap, kategoriState.hiddenCats, colorMap);
    renderKategoriLegend(Object.keys(colorMap).sort(), colorMap, kategoriState.kolom);
    updateDashboardAfterFilter();
};

function _applyMarkerVisibility(markerMap, hiddenCats, colorMap) {
    markerMap.forEach(({ marker, kategori }) => {
        if (!marker.setStyle) return;
        if (hiddenCats.has(kategori)) {
            marker.setStyle({ fillOpacity: 0, opacity: 0, interactive: false });
            const el = marker.getElement && marker.getElement();
            if (el) el.style.pointerEvents = 'none';
        } else {
            const color = colorMap[kategori] || '#94a3b8';
            marker.setStyle({ fillColor: color, color: darkenColor(color), fillOpacity: 0.88, opacity: 1, interactive: true });
            const el = marker.getElement && marker.getElement();
            if (el) el.style.pointerEvents = '';
        }
    });
}

function updateDashboardAfterFilter() {
    const active = getActiveData().length, total = currentData.length;
    if (attributeChart) {
        attributeChart.data.datasets[0].data = [active, total - active];
        attributeChart.data.labels = [`Aktif (${active})`, `Hidden (${total - active})`];
        attributeChart.data.datasets[0].backgroundColor = ['#4f46e5', '#e2e8f0'];
        attributeChart.update();
    }
    const badge = document.getElementById('activeDataBadge');
    const count = document.getElementById('activeDataCount');
    if (badge && count) {
        if (active < total) {
            badge.style.display = 'inline-flex';
            badge.style.alignItems = 'center';
            badge.style.gap = '3px';
            count.textContent = active;
            badge.style.background = active === 0 ? '#fee2e2' : 'var(--surface-3)';
            badge.style.color = active === 0 ? '#dc2626' : 'var(--text-secondary)';
        } else {
            badge.style.display = 'none';
        }
    }
}

function resetKategorisasi() {
    currentLayer.eachLayer(layer => {
        if (layer.setStyle) layer.setStyle({ fillColor: '#4f46e5', color: '#3730a3', fillOpacity: 0.85, opacity: 1, interactive: true });
        const el = layer.getElement && layer.getElement();
        if (el) el.style.pointerEvents = '';
    });
    kategoriState = { active: false, kolom: null, colorMap: {}, hiddenCats: new Set(), markerMap: [] };
    const leg = document.getElementById('kategoriLegend');
    leg.style.display = 'none'; leg.innerHTML = '';
    document.getElementById('kategoriSelect').value = '';
    document.getElementById('resetKategoriBtn').disabled = true;
    if (attributeChart) {
        attributeChart.data.datasets[0].data = [currentData.length, selectedAttributes.size];
        attributeChart.data.labels = ['Total Titik', 'Atribut Aktif'];
        attributeChart.data.datasets[0].backgroundColor = ['#4f46e5', '#7c3aed'];
        attributeChart.update();
    }
    showSuccess('Kategorisasi direset — semua titik aktif.');
}

function darkenColor(hex) {
    if (!hex || hex[0] !== '#') return hex;
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgb(${Math.floor(r * 0.72)},${Math.floor(g * 0.72)},${Math.floor(b * 0.72)})`;
}

// ── Utilitas ─────────────────────────────────────────────────
function showLoading(show) { document.getElementById('loading').style.display = show ? 'flex' : 'none'; }
function showSuccess(msg) { const el = document.getElementById('successMessage'); el.style.display = 'flex'; document.getElementById('successText').textContent = msg; setTimeout(() => el.style.display = 'none', 4000); }
function showError(msg) { const el = document.getElementById('errorMessage'); el.style.display = 'flex'; document.getElementById('errorText').textContent = msg; setTimeout(() => el.style.display = 'none', 4000); }
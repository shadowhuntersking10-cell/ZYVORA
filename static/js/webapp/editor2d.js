/* 2D Studio: canvas editor with layers, brush/eraser, undo/redo, import, PNG export, save. */
import { api, t, toast, confirmModal, escapeHtml } from './core.js';

export function mountEditor2D(root, project, ctx) {
  const setSaveState = ctx.setSaveState;
  let data = project.data && project.data.layers ? JSON.parse(JSON.stringify(project.data)) : { width: 1280, height: 720, layers: [{ name: 'Layer 1', visible: true, image: null }], active_layer: 0 };
  data.layers = data.layers && data.layers.length ? data.layers : [{ name: 'Layer 1', visible: true, image: null }];

  const W = data.width || 1280, H = data.height || 720;
  let zoom = 1, panX = 0, panY = 0;
  let tool = 'brush';
  let color = '#5ea2ff';
  let size = 8;
  let opacity = 1;
  let active = 0;
  let drawing = false;
  let last = null;
  const undoStack = [], redoStack = [];

  root.innerHTML = `
    <div class="studio">
      <div>
        <div class="card canvas-panel">
          <div class="row wrap mb-1">
            <button class="btn ghost sm" id="eBack">← ${t('dash.projects')}</button>
            <b class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(project.name)}</b>
            <button class="btn sm" id="eUndo" title="Ctrl+Z">↶</button>
            <button class="btn sm" id="eRedo" title="Ctrl+Y">↷</button>
            <button class="btn sm ghost" id="eImport">⬆</button>
            <button class="btn sm ghost" id="ePng">🖼 PNG</button>
            <input type="file" id="eFile" accept="image/png,image/jpeg,image/webp" style="display:none">
            <button class="btn sm primary" id="eSave">💾 ${t('common.save')}</button>
          </div>
          <div class="canvas-wrap"><canvas id="eCanvas"></canvas></div>
          <div class="tools">
            <div class="tool-group">
              <button class="btn sm icon active" data-tool="brush" title="${t('tools.brush')}">🖌</button>
              <button class="btn sm icon" data-tool="eraser" title="${t('tools.eraser')}">🧽</button>
            </div>
            <div class="tool-group">
              <span class="lbl">${t('tools.color')}</span><input type="color" id="eColor" value="${color}">
            </div>
            <div class="tool-group">
              <span class="lbl">${t('tools.size')}</span><input type="range" id="eSize" min="1" max="80" value="${size}">
              <span class="lbl" id="eSizeVal">${size}</span>
            </div>
            <div class="tool-group">
              <span class="lbl">${t('tools.opacity')}</span><input type="range" id="eOpacity" min="5" max="100" value="100">
            </div>
            <div class="tool-group">
              <button class="btn sm icon" id="eZoomOut">−</button>
              <span class="lbl" id="eZoomVal">100%</span>
              <button class="btn sm icon" id="eZoomIn">＋</button>
              <button class="btn sm icon" id="eZoomFit">⤢</button>
            </div>
            <div class="tool-group">
              <button class="btn sm danger" id="eClear">${t('tools.clear')}</button>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="row mb-1"><b>${t('tools.layers')}</b><div class="grow"></div>
            <button class="btn sm" id="eAddLayer">＋</button></div>
          <div id="eLayers"></div>
        </div>
        <div class="card inset mt-1 small muted">
          <span class="kbd">B</span> ${t('tools.brush')} · <span class="kbd">E</span> ${t('tools.eraser')} · <span class="kbd">Ctrl+Z</span> ${t('tools.undo')} · <span class="kbd">Ctrl+S</span> ${t('common.save')}
        </div>
      </div>
    </div>`;

  const canvas = root.querySelector('#eCanvas');
  const view = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  // layer bitmaps
  const layers = data.layers.map(l => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    return { canvas: c, ctx: c.getContext('2d'), name: l.name, visible: l.visible !== false, image: l.image || null, loaded: false };
  });

  function loadImages() {
    let pending = layers.filter(l => l.image).length;
    if (!pending) { fitZoom(); render(); paintLayerList(); return; }
    layers.forEach(l => {
      if (!l.image) return;
      const img = new Image();
      img.onload = () => { l.ctx.drawImage(img, 0, 0); l.loaded = true; if (--pending === 0) { fitZoom(); render(); paintLayerList(); } };
      img.onerror = () => { if (--pending === 0) { fitZoom(); render(); paintLayerList(); } };
      img.src = l.image;
    });
  }

  function fitZoom() {
    const wrap = canvas.parentElement;
    const zw = (wrap.clientWidth - 8) / W, zh = (wrap.clientHeight - 8) / H;
    zoom = Math.min(1, zw, zh);
    if (!isFinite(zoom) || zoom <= 0) zoom = 1;
    panX = 0; panY = 0;
    root.querySelector('#eZoomVal').textContent = Math.round(zoom * 100) + '%';
  }

  function render() {
    view.save();
    view.setTransform(1, 0, 0, 1, 0, 0);
    view.clearRect(0, 0, W, H);
    // checkerboard-ish backdrop
    view.fillStyle = '#0b1226';
    view.fillRect(0, 0, W, H);
    view.translate(panX, panY);
    view.scale(zoom, zoom);
    layers.forEach(l => {
      if (!l.visible) return;
      view.globalAlpha = opacity >= 0 && l === layers[active] ? 1 : 1;
      view.drawImage(l.canvas, 0, 0);
    });
    view.restore();
    // canvas element CSS size
    const wrap = canvas.parentElement;
    canvas.style.width = (W * zoom) + 'px';
    canvas.style.height = (H * zoom) + 'px';
    canvas.style.marginLeft = panX + 'px';
    canvas.style.marginTop = panY + 'px';
  }

  function snapshotForUndo() {
    const l = layers[active];
    return { layer: active, data: l.ctx.getImageData(0, 0, W, H) };
  }
  function pushUndo() {
    undoStack.push(snapshotForUndo());
    if (undoStack.length > 25) undoStack.shift();
    redoStack.length = 0;
  }
  function undo() {
    const snap = undoStack.pop();
    if (!snap) return;
    redoStack.push(snapshotForUndo());
    layers[snap.layer].ctx.putImageData(snap.data, 0, 0);
    render();
  }
  function redo() {
    const snap = redoStack.pop();
    if (!snap) return;
    undoStack.push(snapshotForUndo());
    layers[snap.layer].ctx.putImageData(snap.data, 0, 0);
    render();
  }

  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }

  function strokeTo(p) {
    const l = layers[active];
    const c = l.ctx;
    c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    c.globalAlpha = opacity;
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = size;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(last.x, last.y);
    c.lineTo(p.x, p.y);
    c.stroke();
    last = p;
    render();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || e.shiftKey) { // pan
      panning = { x: e.clientX - panX, y: e.clientY - panY };
      return;
    }
    const l = layers[active];
    if (!l.visible) { toast(t('tools.layers') + ': off', 'err'); return; }
    pushUndo();
    drawing = true;
    last = canvasPos(e);
    strokeTo({ x: last.x + 0.01, y: last.y });
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (panning) { panX = e.clientX - panning.x; panY = e.clientY - panning.y; render(); return; }
    if (drawing) strokeTo(canvasPos(e));
  });
  canvas.addEventListener('pointerup', () => { drawing = false; panning = null; });
  let panning = null;

  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    zoom = Math.max(0.1, Math.min(4, zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    root.querySelector('#eZoomVal').textContent = Math.round(zoom * 100) + '%';
    render();
  }, { passive: false });

  // toolbar events
  root.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-tool]').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    tool = b.dataset.tool;
  }));
  root.querySelector('#eColor').addEventListener('input', e => color = e.target.value);
  root.querySelector('#eSize').addEventListener('input', e => { size = +e.target.value; root.querySelector('#eSizeVal').textContent = size; });
  root.querySelector('#eOpacity').addEventListener('input', e => opacity = +e.target.value / 100);
  root.querySelector('#eUndo').addEventListener('click', undo);
  root.querySelector('#eRedo').addEventListener('click', redo);
  root.querySelector('#eZoomIn').addEventListener('click', () => { zoom = Math.min(4, zoom * 1.2); root.querySelector('#eZoomVal').textContent = Math.round(zoom * 100) + '%'; render(); });
  root.querySelector('#eZoomOut').addEventListener('click', () => { zoom = Math.max(0.1, zoom / 1.2); root.querySelector('#eZoomVal').textContent = Math.round(zoom * 100) + '%'; render(); });
  root.querySelector('#eZoomFit').addEventListener('click', () => { fitZoom(); render(); });

  root.querySelector('#eBack').addEventListener('click', () => { location.hash = '#/projects'; });

  root.querySelector('#eImport').addEventListener('click', () => root.querySelector('#eFile').click());
  root.querySelector('#eFile').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pushUndo();
      const img = new Image();
      img.onload = () => {
        const l = layers[active];
        const scale = Math.min(1, W / img.width, H / img.height);
        const w = img.width * scale, h = img.height * scale;
        l.ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
        render();
        toast(t('common.success'), 'ok');
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });

  root.querySelector('#eClear').addEventListener('click', async () => {
    if (!(await confirmModal(t('tools.clear') + '?'))) return;
    pushUndo();
    layers[active].ctx.clearRect(0, 0, W, H);
    render();
  });

  root.querySelector('#ePng').addEventListener('click', () => {
    const out = document.createElement('canvas');
    out.width = W; out.height = H;
    const o = out.getContext('2d');
    layers.forEach(l => { if (l.visible) o.drawImage(l.canvas, 0, 0); });
    const a = document.createElement('a');
    a.download = (project.name || 'zyvora') + '.png';
    a.href = out.toDataURL('image/png');
    a.click();
  });

  function serialize() {
    return {
      width: W, height: H,
      active_layer: active,
      layers: layers.map(l => ({ name: l.name, visible: l.visible, image: l.canvas.toDataURL('image/png') })),
    };
  }

  async function save(snapshot = false) {
    setSaveState('saving');
    try {
      await api(`/api/projects/${project.id}/data`, { method: 'PUT', body: { data: serialize(), snapshot } });
      setSaveState('saved');
    } catch (e) {
      setSaveState('unsaved');
      toast(e.message, 'err');
    }
  }
  root.querySelector('#eSave').addEventListener('click', () => save(true));

  // dirty tracking
  const origPush = pushUndo;
  let dirty = false;
  canvas.addEventListener('pointerdown', () => { dirty = true; setSaveState('unsaved'); });
  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // keyboard
  function onKey(e) {
    if (root.offsetParent === null) return; // not visible
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(true); }
    if (e.key.toLowerCase() === 'b') tool = 'brush';
    if (e.key.toLowerCase() === 'e') tool = 'eraser';
  }
  document.addEventListener('keydown', onKey);

  function paintLayerList() {
    const box = root.querySelector('#eLayers');
    box.innerHTML = layers.map((l, i) => `
      <div class="layer-row ${i === active ? 'active' : ''}" data-i="${i}">
        <button class="btn sm ghost" data-vis="${i}" style="padding:.2em .45em">${l.visible ? '👁' : '🚫'}</button>
        <span class="nm">${escapeHtml(l.name)}</span>
        <button class="btn sm ghost" data-up="${i}" style="padding:.2em .45em">↑</button>
        <button class="btn sm ghost" data-down="${i}" style="padding:.2em .45em">↓</button>
        ${layers.length > 1 ? `<button class="btn sm danger" data-del="${i}" style="padding:.2em .45em">✕</button>` : ''}
      </div>`).reverse().join('');
    box.querySelectorAll('[data-vis]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +b.dataset.vis;
      layers[i].visible = !layers[i].visible;
      render(); paintLayerList();
    }));
    box.querySelectorAll('[data-up]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +b.dataset.up;
      if (i < layers.length - 1) { [layers[i], layers[i + 1]] = [layers[i + 1], layers[i]]; render(); paintLayerList(); }
    }));
    box.querySelectorAll('[data-down]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +b.dataset.down;
      if (i > 0) { [layers[i], layers[i - 1]] = [layers[i - 1], layers[i]]; render(); paintLayerList(); }
    }));
    box.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = +b.dataset.del;
      layers.splice(i, 1);
      if (active >= layers.length) active = layers.length - 1;
      render(); paintLayerList();
    }));
    box.querySelectorAll('.layer-row').forEach(r => r.addEventListener('click', () => {
      active = +r.dataset.i;
      paintLayerList();
    }));
  }

  root.querySelector('#eAddLayer').addEventListener('click', () => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    layers.push({ canvas: c, ctx: c.getContext('2d'), name: `Layer ${layers.length + 1}`, visible: true, image: null });
    active = layers.length - 1;
    paintLayerList();
  });

  // autosave every 45s if dirty
  setInterval(() => { if (dirty && root.isConnected) { save(); dirty = false; } }, 45000);

  loadImages();
  paintLayerList();

  return { save };
}

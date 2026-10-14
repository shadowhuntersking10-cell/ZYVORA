/* Animation Studio: frame-by-frame 2D animation with playback, onion skin,
   FPS control, frame strip, PNG frame export and server persistence. */
import { api, t, toast, confirmModal, escapeHtml } from './core.js';

export function mountAnim(root, project, ctx) {
  const setSaveState = ctx.setSaveState;
  const data = project.data && project.data.frames ? JSON.parse(JSON.stringify(project.data)) : { width: 960, height: 540, fps: 8, frames: null, active_frame: 0 };
  data.width = data.width || 960; data.height = data.height || 540;
  data.fps = data.fps || 8;
  if (!data.frames || !data.frames.length) {
    data.frames = [{ layers: [{ name: 'Layer 1', visible: true, image: null }] }];
  }
  const W = data.width, H = data.height;
  let fi = data.active_frame || 0;
  let tool = 'brush', color = '#5ea2ff', size = 6, opacity = 1;
  let drawing = false, last = null, playing = false, playTimer = null, onion = false;
  const undoStack = [], redoStack = [];

  root.innerHTML = `
    <div class="studio">
      <div>
        <div class="card canvas-panel">
          <div class="row wrap mb-1">
            <button class="btn ghost sm" id="aBack">← ${t('dash.projects')}</button>
            <b class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(project.name)}</b>
            <button class="btn sm" id="aUndo">↶</button>
            <button class="btn sm" id="aRedo">↷</button>
            <button class="btn sm primary" id="aSave">💾 ${t('common.save')}</button>
          </div>
          <div class="canvas-wrap"><canvas id="aCanvas" style="background:#0b1226"></canvas></div>
          <div class="tools">
            <div class="tool-group">
              <button class="btn sm icon active" data-tool="brush">🖌</button>
              <button class="btn sm icon" data-tool="eraser">🧽</button>
            </div>
            <div class="tool-group"><input type="color" id="aColor" value="${color}"></div>
            <div class="tool-group"><span class="lbl">${t('tools.size')}</span><input type="range" id="aSize" min="1" max="60" value="${size}"></div>
            <div class="tool-group">
              <button class="btn sm icon" id="aPlay" title="${t('tools.play')}">▶</button>
              <button class="btn sm icon" id="aStop" title="${t('tools.stop')}">⏹</button>
            </div>
            <div class="tool-group"><span class="lbl">${t('tools.fps')}</span><input type="range" id="aFps" min="1" max="24" value="${data.fps}"><span class="lbl" id="aFpsVal">${data.fps}</span></div>
            <div class="tool-group"><button class="btn sm" id="aOnion">🧅 ${t('tools.onion')}</button></div>
          </div>
          <div class="timeline mt-1" id="aTimeline"></div>
        </div>
      </div>
      <div>
        <div class="card">
          <b>${t('tools.frame')} <span id="aFrameNum"></span></b>
          <div class="btn-row mt-1">
            <button class="btn sm" id="aAddFrame">＋ ${t('tools.add_frame')}</button>
            <button class="btn sm" id="aDupFrame">⧉ ${t('tools.dup_frame')}</button>
            <button class="btn sm danger" id="aDelFrame">🗑</button>
          </div>
          <div class="divider"></div>
          <button class="btn sm" id="aExport" style="width:100%">🖼 PNG ${t('common.export')}</button>
        </div>
        <div class="card inset mt-1 small muted">
          ${t('tools.frame')}: ${t('common.new')} ${t('tools.add_frame')} · ${t('tools.play')} ▶
        </div>
      </div>
    </div>`;

  const canvas = root.querySelector('#aCanvas');
  const view = canvas.getContext('2d');
  canvas.width = W; canvas.height = H;

  // frame bitmaps cache: {canvas, ctx, image}
  const frames = data.frames.map(f => makeFrame(f));
  function makeFrame(f) {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    return { canvas: c, ctx: c.getContext('2d'), image: (f.layers && f.layers[0] && f.layers[0].image) || null, loaded: false };
  }

  let pending = frames.filter(f => f.image).length;
  if (!pending) { fit(); render(); paintTimeline(); } else {
    frames.forEach(f => {
      if (!f.image) return;
      const img = new Image();
      img.onload = () => { f.ctx.drawImage(img, 0, 0); f.loaded = true; if (--pending === 0) { fit(); render(); paintTimeline(); } };
      img.onerror = () => { if (--pending === 0) { fit(); render(); paintTimeline(); } };
      img.src = f.image;
    });
  }

  function fit() {
    const wrap = canvas.parentElement;
    const s = Math.min((wrap.clientWidth - 8) / W, (wrap.clientHeight - 8) / H, 1);
    canvas.style.width = (W * s) + 'px';
    canvas.style.height = (H * s) + 'px';
  }

  function render() {
    view.setTransform(1, 0, 0, 1, 0, 0);
    view.clearRect(0, 0, W, H);
    view.fillStyle = '#0b1226';
    view.fillRect(0, 0, W, H);
    if (onion && fi > 0 && frames[fi - 1].loaded) {
      view.globalAlpha = 0.22;
      view.drawImage(frames[fi - 1].canvas, 0, 0);
      view.globalAlpha = 1;
    }
    view.drawImage(frames[fi].canvas, 0, 0);
    root.querySelector('#aFrameNum').textContent = `${fi + 1}/${frames.length}`;
    paintTimeline();
  }

  function paintTimeline() {
    const tl = root.querySelector('#aTimeline');
    tl.innerHTML = frames.map((f, i) => `
      <div class="frame-thumb ${i === fi ? 'active' : ''}" data-f="${i}">
        ${f.loaded || !f.image ? `<img src="${f.canvas.toDataURL('image/png')}">` : ''}
        <span class="fx">${i + 1}</span>
      </div>`).join('');
    tl.querySelectorAll('[data-f]').forEach(el => el.addEventListener('click', () => { fi = +el.dataset.f; render(); }));
    // scroll active into view
    const act = tl.querySelector('.active');
    if (act) act.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }

  function pushUndo() {
    undoStack.push({ frame: fi, data: frames[fi].ctx.getImageData(0, 0, W, H) });
    if (undoStack.length > 25) undoStack.shift();
    redoStack.length = 0;
  }
  root.querySelector('#aUndo').addEventListener('click', () => {
    const s = undoStack.pop(); if (!s) return;
    redoStack.push({ frame: fi, data: frames[fi].ctx.getImageData(0, 0, W, H) });
    frames[s.frame].ctx.putImageData(s.data, 0, 0); render();
  });
  root.querySelector('#aRedo').addEventListener('click', () => {
    const s = redoStack.pop(); if (!s) return;
    undoStack.push({ frame: fi, data: frames[fi].ctx.getImageData(0, 0, W, H) });
    frames[s.frame].ctx.putImageData(s.data, 0, 0); render();
  });

  function pos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
  }
  function strokeTo(p) {
    const c = frames[fi].ctx;
    c.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    c.globalAlpha = opacity;
    c.strokeStyle = color; c.fillStyle = color;
    c.lineWidth = size; c.lineCap = 'round'; c.lineJoin = 'round';
    c.beginPath(); c.moveTo(last.x, last.y); c.lineTo(p.x, p.y); c.stroke();
    last = p;
    render();
  }
  canvas.addEventListener('pointerdown', (e) => {
    pushUndo();
    drawing = true; last = pos(e);
    strokeTo({ x: last.x + 0.01, y: last.y });
    canvas.setPointerCapture(e.pointerId);
    setSaveState('unsaved');
  });
  canvas.addEventListener('pointermove', (e) => { if (drawing) strokeTo(pos(e)); });
  canvas.addEventListener('pointerup', () => { drawing = false; });

  root.querySelectorAll('[data-tool]').forEach(b => b.addEventListener('click', () => {
    root.querySelectorAll('[data-tool]').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); tool = b.dataset.tool;
  }));
  root.querySelector('#aColor').addEventListener('input', e => color = e.target.value);
  root.querySelector('#aSize').addEventListener('input', e => size = +e.target.value);
  root.querySelector('#aFps').addEventListener('input', e => { data.fps = +e.target.value; root.querySelector('#aFpsVal').textContent = data.fps; });
  root.querySelector('#aOnion').addEventListener('click', () => { onion = !onion; root.querySelector('#aOnion').classList.toggle('active', onion); render(); });

  root.querySelector('#aAddFrame').addEventListener('click', () => {
    frames.splice(fi + 1, 0, makeFrame({ layers: [{ name: 'L', visible: true, image: null }] }));
    fi++;
    render(); setSaveState('unsaved');
  });
  root.querySelector('#aDupFrame').addEventListener('click', () => {
    const src = frames[fi];
    const f = makeFrame({ layers: [{ name: 'L', visible: true, image: null }] });
    f.ctx.drawImage(src.canvas, 0, 0); f.loaded = true;
    frames.splice(fi + 1, 0, f);
    fi++;
    render(); setSaveState('unsaved');
  });
  root.querySelector('#aDelFrame').addEventListener('click', async () => {
    if (frames.length <= 1) { toast('min 1 frame', 'err'); return; }
    frames.splice(fi, 1);
    fi = Math.max(0, fi - 1);
    render(); setSaveState('unsaved');
  });

  function stopPlay() {
    playing = false;
    clearTimeout(playTimer);
    root.querySelector('#aPlay').textContent = '▶';
  }
  root.querySelector('#aPlay').addEventListener('click', () => {
    if (playing) { stopPlay(); return; }
    playing = true;
    root.querySelector('#aPlay').textContent = '⏸';
    const step = () => {
      if (!playing) return;
      fi = (fi + 1) % frames.length;
      render();
      playTimer = setTimeout(step, 1000 / data.fps);
    };
    step();
  });
  root.querySelector('#aStop').addEventListener('click', () => { stopPlay(); fi = 0; render(); });

  root.querySelector('#aExport').addEventListener('click', () => {
    frames.forEach((f, i) => {
      const a = document.createElement('a');
      a.download = `${project.name || 'anim'}_${String(i + 1).padStart(3, '0')}.png`;
      a.href = f.canvas.toDataURL('image/png');
      a.click();
    });
    toast(t('common.export') + ' PNG ✓', 'ok');
  });

  function serialize() {
    return {
      width: W, height: H, fps: data.fps, active_frame: fi,
      frames: frames.map(f => ({ layers: [{ name: 'Layer 1', visible: true, image: f.canvas.toDataURL('image/png') }] })),
    };
  }
  async function save() {
    setSaveState('saving');
    try {
      await api(`/api/projects/${project.id}/data`, { method: 'PUT', body: { data: serialize() } });
      setSaveState('saved');
    } catch (e) { setSaveState('unsaved'); toast(e.message, 'err'); }
  }
  root.querySelector('#aSave').addEventListener('click', save);
  root.querySelector('#aBack').addEventListener('click', () => { location.hash = '#/projects'; });
  setInterval(() => { if (root.isConnected) save(); }, 60000);
}

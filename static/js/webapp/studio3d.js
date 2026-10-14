/* 3D Studio: interactive Three.js scene — primitives, transforms, materials,
   hierarchy, save/load (server JSON), GLTF/OBJ export. The AI assistant can
   manipulate the same persisted scene state. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { api, t, toast, confirmModal, escapeHtml } from './core.js';

const GEOMS = {
  cube: () => new THREE.BoxGeometry(1, 1, 1),
  sphere: () => new THREE.SphereGeometry(0.6, 32, 24),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 32),
  plane: () => new THREE.PlaneGeometry(2, 2),
  torus: () => new THREE.TorusGeometry(0.5, 0.2, 16, 48),
  cone: () => new THREE.ConeGeometry(0.5, 1, 32),
};

export function mountStudio3D(root, project, ctx) {
  const setSaveState = ctx.setSaveState;
  const data = project.data && project.data.objects ? JSON.parse(JSON.stringify(project.data)) : { objects: [], environment: { background: '#0b1530', grid: true } };
  data.objects = data.objects || [];
  data.environment = data.environment || { background: '#0b1530', grid: true };

  root.innerHTML = `
    <div class="studio" style="grid-template-columns:1fr 280px">
      <div>
        <div class="card canvas-panel">
          <div class="row wrap mb-1">
            <button class="btn ghost sm" id="dBack">← ${t('dash.projects')}</button>
            <b class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(project.name)}</b>
            <button class="btn sm ghost" id="dGltf">GLTF</button>
            <button class="btn sm ghost" id="dObj">OBJ</button>
            <button class="btn sm primary" id="dSave">💾 ${t('common.save')}</button>
          </div>
          <div class="canvas-wrap" id="dWrap" style="height:520px"></div>
          <div class="tools">
            <div class="tool-group"><span class="lbl">${t('obj.create')}</span>
              ${['cube', 'sphere', 'cylinder', 'plane', 'torus', 'cone'].map(k => `<button class="btn sm" data-add="${k}">${t('obj.' + k)}</button>`).join('')}
            </div>
          </div>
        </div>
      </div>
      <div>
        <div class="card mb-1">
          <div class="row mb-1"><b>${t('scene.objects')}</b></div>
          <div id="dObjects"></div>
        </div>
        <div class="card" id="dProps" style="display:none">
          <b id="dPropName">—</b>
          <div class="vec3 mt-1"><span>${t('obj.position')}</span><input data-tr="position" data-i="0"><input data-tr="position" data-i="1"><input data-tr="position" data-i="2"></div>
          <div class="vec3"><span>${t('obj.rotation')}</span><input data-tr="rotation" data-i="0"><input data-tr="rotation" data-i="1"><input data-tr="rotation" data-i="2"></div>
          <div class="vec3"><span>${t('obj.scale')}</span><input data-tr="scale" data-i="0"><input data-tr="scale" data-i="1"><input data-tr="scale" data-i="2"></div>
          <div class="field"><label>${t('obj.material')}</label>
            <div class="row"><input type="color" id="dColor" value="#5ea2ff">
            <button class="btn sm danger grow" id="dDelete">🗑 ${t('obj.delete')}</button></div>
          </div>
        </div>
      </div>
    </div>`;

  const wrap = root.querySelector('#dWrap');
  const scene = new THREE.Scene();
  const bg = new THREE.Color(data.environment.background || '#0b1530');
  scene.background = bg;

  const camera = new THREE.PerspectiveCamera(55, 2, 0.1, 200);
  camera.position.set(4, 3.2, 5.5);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  wrap.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x0a1024, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(5, 8, 4);
  scene.add(sun);
  const grid = new THREE.GridHelper(20, 20, 0x3d8bfd, 0x1a2c5c);
  grid.material.opacity = 0.35; grid.material.transparent = true;
  scene.add(grid);
  grid.visible = data.environment.grid !== false;

  let selected = null; // mesh
  const meshes = []; // {mesh, obj}

  function makeMesh(obj) {
    const geo = (GEOMS[obj.type] || GEOMS.cube)();
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(obj.color || '#5ea2ff'), roughness: 0.55, metalness: 0.15 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.fromArray(obj.position || [0, 0.5, 0]);
    mesh.rotation.fromArray((obj.rotation || [0, 0, 0]).map((v, i) => (i === 1 ? v : v)));
    mesh.scale.fromArray(obj.scale && obj.scale.length === 3 ? obj.scale : [1, 1, 1]);
    mesh.userData.id = obj.id;
    if (obj.type === 'plane') mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    return mesh;
  }

  function syncToObj(mesh) {
    const rec = meshes.find(r => r.mesh === mesh);
    if (!rec) return;
    rec.obj.position = mesh.position.toArray().map(v => +v.toFixed(3));
    rec.obj.rotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map(v => +v.toFixed(3));
    rec.obj.scale = mesh.scale.toArray().map(v => +v.toFixed(3));
    rec.obj.color = '#' + mesh.material.color.getHexString();
  }

  function rebuildFromData() {
    meshes.forEach(r => { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); });
    meshes.length = 0;
    data.objects.forEach(obj => meshes.push({ mesh: makeMesh(obj), obj }));
    paintObjectList();
    select(null);
  }

  function select(mesh) {
    selected = mesh;
    root.querySelectorAll('.obj-row').forEach(r => r.classList.toggle('active', selected && +r.dataset.id === selected.userData.id));
    const props = root.querySelector('#dProps');
    if (!selected) { props.style.display = 'none'; return; }
    props.style.display = 'block';
    const rec = meshes.find(r => r.mesh === selected);
    root.querySelector('#dPropName').textContent = rec.obj.name;
    root.querySelector('#dColor').value = rec.obj.color || '#5ea2ff';
    ['position', 'rotation', 'scale'].forEach(tr => {
      root.querySelectorAll(`[data-tr="${tr}"]`).forEach((inp, i) => {
        inp.value = +(rec.obj[tr] ? rec.obj[tr][i] : 0);
      });
    });
  }

  function paintObjectList() {
    const box = root.querySelector('#dObjects');
    box.innerHTML = data.objects.length ? data.objects.map(o => `
      <div class="obj-row" data-id="${o.id}">
        <span class="obj-dot" style="background:${escapeHtml(o.color || '#5ea2ff')}"></span>
        <span class="grow" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(o.name)}</span>
        <span class="muted small">${o.type}</span>
      </div>`).join('') : `<div class="empty">${t('scene.objects')} — 0</div>`;
    box.querySelectorAll('.obj-row').forEach(r => r.addEventListener('click', () => {
      const rec = meshes.find(m => m.obj.id === +r.dataset.id);
      select(rec ? rec.mesh : null);
    }));
  }

  // picking
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  let downPos = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!downPos) return;
    const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
    downPos = null;
    if (moved > 5) return; // it was a camera drag
    const rect = renderer.domElement.getBoundingClientRect();
    ptr.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ptr.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(meshes.map(r => r.mesh));
    select(hits.length ? hits[0].object : null);
  });

  // add object
  root.querySelectorAll('[data-add]').forEach(b => b.addEventListener('click', () => {
    const type = b.dataset.add;
    const id = Math.max(0, ...data.objects.map(o => o.id)) + 1;
    const obj = {
      id, name: `${t('obj.' + type)} ${id}`, type,
      position: [0, type === 'plane' ? 0 : 0.5, 0],
      rotation: [0, 0, 0], scale: [1, 1, 1],
      color: ['#5ea2ff', '#8fc1ff', '#34c98e', '#f5b04d', '#ef5b73'][id % 5],
      visible: true,
    };
    data.objects.push(obj);
    meshes.push({ mesh: makeMesh(obj), obj });
    paintObjectList();
    select(meshes[meshes.length - 1].mesh);
    setSaveState('unsaved');
  }));

  // transform inputs
  root.querySelectorAll('[data-tr]').forEach(inp => inp.addEventListener('change', () => {
    if (!selected) return;
    const rec = meshes.find(r => r.mesh === selected);
    const tr = inp.dataset.tr, i = +inp.dataset.i;
    const arr = rec.obj[tr] || [0, 0, 0];
    arr[i] = parseFloat(inp.value) || 0;
    rec.obj[tr] = arr;
    if (tr === 'position') selected.position.fromArray(arr);
    if (tr === 'rotation') selected.rotation.set(arr[0], arr[1], arr[2]);
    if (tr === 'scale') selected.scale.fromArray(arr.map(v => v || 0.001));
  }));
  root.querySelector('#dColor').addEventListener('input', (e) => {
    if (!selected) return;
    selected.material.color.set(e.target.value);
    const rec = meshes.find(r => r.mesh === selected);
    rec.obj.color = e.target.value;
  });
  root.querySelector('#dDelete').addEventListener('click', async () => {
    if (!selected) return;
    if (!(await confirmModal(t('obj.delete') + '?'))) return;
    const rec = meshes.find(r => r.mesh === selected);
    scene.remove(selected);
    meshes.splice(meshes.indexOf(rec), 1);
    data.objects = data.objects.filter(o => o.id !== rec.obj.id);
    paintObjectList();
    select(null);
    setSaveState('unsaved');
  });

  // export
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  root.querySelector('#dGltf').addEventListener('click', () => {
    new GLTFExporter().parse(scene, (gltf) => {
      download((project.name || 'scene') + '.gltf', new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' }));
    }, (err) => toast(String(err), 'err'), { binary: false });
  });
  root.querySelector('#dObj').addEventListener('click', () => {
    const text = new OBJExporter().parse(scene);
    download((project.name || 'scene') + '.obj', new Blob([text], { type: 'text/plain' }));
  });

  // save / load
  function serialize() {
    return { objects: data.objects, environment: data.environment };
  }
  async function save() {
    setSaveState('saving');
    try {
      await api(`/api/projects/${project.id}/data`, { method: 'PUT', body: { data: serialize() } });
      setSaveState('saved');
    } catch (e) { setSaveState('unsaved'); toast(e.message, 'err'); }
  }
  root.querySelector('#dSave').addEventListener('click', save);
  root.querySelector('#dBack').addEventListener('click', () => { location.hash = '#/projects'; });

  // autosave
  const iv = setInterval(() => { if (root.isConnected) save(); }, 50000);

  // resize + loop
  function resize() {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  let alive = true;
  (function loop() {
    if (!alive || !root.isConnected) return;
    requestAnimationFrame(loop);
    controls.update();
    renderer.render(scene, camera);
  })();

  rebuildFromData();
  return { dispose: () => { alive = false; clearInterval(iv); renderer.dispose(); } };
}

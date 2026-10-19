import * as THREE from 'three';
import { roomPolygon, polygonBounds, currentRoom, radians, clamp, roomArea, pointInPolygon } from './plan.js';
import { localDateString } from './solar.js';

const START_TIME = 300;
const END_TIME = 1200;
const TIMELAPSE_SECONDS = 30;
const LABEL_SIZE = .055;
const FURNITURE_LABEL_SIZE = .036;
const FURNITURE_LABEL_HEIGHT = 1.32;
const MEASURE_RANGE = 4;
const MEASURE_GAP = .16;
const SVG_NS = 'http://www.w3.org/2000/svg';
const floorColors = { wood: '#e1d9c6', kitchen: '#d6d9cd', stone: '#cad4ce', balcony: '#d8ddce' };
const furnitureNames = {
  rug: '地毯', sofa: '沙发', coffeeTable: '茶几', tvConsole: '电视柜', armchair: '单人椅',
  plant: '绿植', diningTable: '餐桌', shoeCabinet: '鞋柜', bed: '床', wardrobe: '衣柜',
  bedside: '床头柜', baySeat: '飘窗座', sinkCounter: '水槽台', hobCounter: '灶台',
  fridge: '冰箱', shower: '淋浴', toilet: '马桶', vanity: '浴室柜', outdoorChair: '户外椅',
  roundTable: '圆桌',
};
const forwardVector = new THREE.Vector3();
const projectedLabel = new THREE.Vector3();
const cameraRight = new THREE.Vector3();
const cameraUp = new THREE.Vector3();
const measureProjected = new THREE.Vector3();
const measureCenter = new THREE.Vector3();
const measureDirection = new THREE.Vector3();
const measureForward = new THREE.Vector3();
const measureNdc = new THREE.Vector2();

const oneDecimal = value => (Math.round(value * 10) / 10).toFixed(1);
const furnitureName = type => furnitureNames[type] || type;
const furnitureSizeText = item => item.type === 'roundTable'
  ? `Ø${oneDecimal(item.w)} m`
  : `${oneDecimal(item.w)} × ${oneDecimal(item.d)} m`;

function furnitureWorldPoint(item, localX, localZ, height = .02) {
  const angle = radians(item.rotation || 0), cos = Math.cos(angle), sin = Math.sin(angle);
  return new THREE.Vector3(
    item.x + localX * cos + localZ * sin,
    height,
    -item.y - localX * sin + localZ * cos,
  );
}

function footprintLocalPoints(item) {
  if (item.type === 'roundTable') {
    const radius = item.w / 2;
    return Array.from({ length: 32 }, (_, index) => {
      const angle = index / 32 * Math.PI * 2;
      return [Math.cos(angle) * radius, Math.sin(angle) * radius];
    });
  }
  const halfW = item.w / 2, halfD = item.d / 2;
  return [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD], [-halfW, -halfD]];
}

function cameraLocalPosition(item, position) {
  const angle = radians(item.rotation || 0), cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = position.x - item.x, dz = position.z + item.y;
  return { x: dx * cos - dz * sin, z: dx * sin + dz * cos };
}

function roomModelInfo(room) {
  const polygon = roomPolygon(room);
  const bounds = polygonBounds(polygon);
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxY - bounds.minY;
  const area = roomArea(room);
  return { bounds, width, depth, area, lShape: area < width * depth - .05 };
}

export function roomSizeText(room) {
  const { width, depth, lShape } = roomModelInfo(room);
  return `${lShape ? 'L 形 · ' : ''}${oneDecimal(width)} × ${oneDecimal(depth)} m`;
}

export function roomLabelText(room) {
  return room.dimensionLabel || roomSizeText(room);
}

function roomCenter(room) {
  if (room.w !== undefined && room.h !== undefined) return { x: room.x + room.w / 2, z: -(room.y + room.h / 2) };
  const bounds = polygonBounds(room.polygon);
  return { x: (bounds.minX + bounds.maxX) / 2, z: -(bounds.minY + bounds.maxY) / 2 };
}

function createDimensionLabel(scene, room) {
  const info = roomModelInfo(room);
  const detail = `${roomSizeText(room)}${info.area >= 7.5 ? ` · 约 ${info.area.toFixed(1)}㎡` : ''}`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '60px "Microsoft YaHei", sans-serif'; const titleWidth = probe.measureText(room.name).width;
  probe.font = '40px "Microsoft YaHei", sans-serif'; const detailWidth = probe.measureText(detail).width;
  const canvas = document.createElement('canvas');
  const width = Math.min(512, Math.max(220, Math.ceil(Math.max(titleWidth, detailWidth) + 56)));
  canvas.width = width; canvas.height = 192;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(249, 248, 242, .93)'; context.fillRect(8, 8, width - 16, 176);
  context.strokeStyle = 'rgba(82, 107, 80, .28)'; context.lineWidth = 4; context.strokeRect(8, 8, width - 16, 176);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = '#2f3a31'; context.font = '60px "Microsoft YaHei", sans-serif'; context.fillText(room.name, width / 2, 61);
  let detailSize = 40;
  context.fillStyle = '#6f7869'; context.font = `${detailSize}px "Microsoft YaHei", sans-serif`;
  while (detailSize > 26 && context.measureText(detail).width > width - 40) {
    detailSize -= 2; context.font = `${detailSize}px "Microsoft YaHei", sans-serif`;
  }
  context.fillText(detail, width / 2, 133);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: true, depthWrite: false });
  const sprite = new THREE.Sprite(material); const center = roomCenter(room);
  sprite.position.set(center.x, 2.2, center.z); sprite.scale.set(1.2, .45, 1); sprite.visible = false;
  sprite.userData.area = info.area; sprite.userData.aspect = width / 192; sprite.userData.base = sprite.position.clone();
  scene.add(sprite); return sprite;
}

function createFurnitureLabel(scene, item) {
  const text = `${furnitureName(item.type)} ${furnitureSizeText(item)}`;
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = '500 50px "Microsoft YaHei", sans-serif';
  const canvas = document.createElement('canvas');
  const width = Math.min(640, Math.max(180, Math.ceil(probe.measureText(text).width + 58)));
  canvas.width = width; canvas.height = 96;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(249, 248, 242, .9)'; context.fillRect(5, 5, width - 10, 86);
  context.strokeStyle = 'rgba(82, 107, 80, .23)'; context.lineWidth = 3; context.strokeRect(5, 5, width - 10, 86);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = '#596852'; context.font = '500 50px "Microsoft YaHei", sans-serif';
  context.fillText(text, width / 2, 49);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(item.x, FURNITURE_LABEL_HEIGHT, -item.y);
  sprite.scale.set(1.2, .24, 1); sprite.visible = false; sprite.renderOrder = 1;
  sprite.userData.area = item.w * item.d; sprite.userData.aspect = width / 96;
  sprite.userData.isFurniture = true; sprite.userData.base = sprite.position.clone();
  scene.add(sprite); return sprite;
}

export function createInterface(plan, camera, mobile, scene, invalidate = () => {}) {
  const get = id => document.getElementById(id);
  const viewport = get('viewport');
  const measureOverlay = get('measure-overlay');
  const aimHint = get('aim-hint');
  const measureReadout = get('measure-readout');
  const crosshair = get('crosshair');
  const canvas = viewport.querySelector('canvas');
  const mapPanel = get('map-panel');
  const mapBackdrop = get('map-backdrop');
  const mapExpand = get('map-expand');
  const map = get('minimap'); const ctx = map.getContext('2d');
  const slider = get('time-slider'); const date = get('date-input');
  const play = get('play-button'); const roomSelect = get('room-select');
  const dimensionsToggle = get('dimensions-toggle');
  const roomTable = get('dimension-table'); const furnitureTable = get('furniture-table');
  const layerSwitch = get('dimension-layers'); const layerFurniture = get('layer-furniture'); const layerRooms = get('layer-rooms');
  const roomLabels = plan.rooms.map(room => createDimensionLabel(scene, room));
  const orderedRoomLabels = roomLabels.slice().sort((a, b) => b.userData.area - a.userData.area);
  let labelledFurniture = plan.furniture.filter(item => item.dimension);
  if (mobile) {
    const byRoom = new Map();
    for (const item of labelledFurniture) {
      const current = byRoom.get(item.room);
      if (!current || item.w * item.d > current.w * current.d) byRoom.set(item.room, item);
    }
    labelledFurniture = [...byRoom.values()];
  }
  const furnitureLabels = labelledFurniture.map(item => createFurnitureLabel(scene, item));
  const orderedFurnitureLabels = furnitureLabels.slice().sort((a, b) => b.userData.area - a.userData.area);
  const pickables = [], occluders = [];
  for (const item of plan.furniture) {
    const group = scene.getObjectByName(item.id);
    if (!group) continue;
    group.traverse(child => {
      if (!child.isMesh) return;
      child.userData.furnitureItem = item;
      pickables.push(child);
    });
  }
  scene.traverse(child => {
    if (child.isMesh && !child.userData.furnitureItem) occluders.push(child);
  });
  const measureRaycaster = new THREE.Raycaster();
  const measureTargets = pickables.concat(occluders);
  const settings = plan.settings;
  const defaultSettings = { ...settings };
  const settingsKey = 'virtual-home-sun-settings';
  try {
    const stored = JSON.parse(localStorage.getItem(settingsKey) || 'null');
    if (stored) {
      const restore = (key, min, max) => {
        const value = Number(stored[key]);
        if (Number.isFinite(value) && value >= min && value <= max) settings[key] = value;
      };
      restore('latitude', -89.9, 89.9); restore('longitude', -180, 180);
      restore('utcOffsetHours', -12, 14); restore('planUpAzimuthDeg', 0, 360);
    }
  } catch {}
  let movement, sunSystem, playing = false, dimensionsVisible = false, minutes = settings.initialTimeMinutes;
  let mapElapsed = 0, solarElapsed = 0, toastTimer, lastRoomId, hoverRoomId = null;
  let dimensionLayer = mobile ? 'furniture' : 'all';
  let measureItem = null, measureState = null, aimElapsed = 0, tapStart = null;
  let measureViewWidth = 0, measureViewHeight = 0, measureCameraKnown = false;
  let aimCameraKnown = false;
  const measureCameraMatrix = new THREE.Matrix4();
  const aimCameraMatrix = new THREE.Matrix4();
  date.value = localDateString(settings.utcOffsetHours); slider.value = minutes;
  get('latitude').value = settings.latitude; get('longitude').value = settings.longitude;
  get('utc-offset').value = settings.utcOffsetHours; get('orientation').value = settings.planUpAzimuthDeg;
  get('building-area').textContent = `建面 ${plan.metadata.buildingArea.toFixed(2)}㎡`;
  get('interior-area').textContent = `套内 ${plan.metadata.interiorBuildingArea.toFixed(2)}㎡`;
  if (mobile) {
    get('touch-controls').hidden = false; get('desktop-help').hidden = true;
    get('entry-instruction').textContent = '左侧摇杆行走 · 右侧拖动看四周';
    dimensionsToggle.setAttribute('aria-label', '打开尺寸标注平面');
    get('dimensions-text').textContent = '标注';
  }
  plan.rooms.forEach((room, index) => {
    const option = document.createElement('option'); option.value = room.id;
    option.textContent = `${index < 9 ? index + 1 + ' · ' : ''}${room.name} ${roomLabelText(room)}`; roomSelect.append(option);
  });
  plan.assumptions.forEach(note => { const li = document.createElement('li'); li.textContent = note; get('assumptions').append(li); });
  const dimensionRows = get('dimension-rows');
  plan.rooms.forEach((room, index) => {
    const tr = document.createElement('tr');
    const name = document.createElement('th'); name.scope = 'row';
    name.textContent = `${index < 9 ? index + 1 + ' · ' : ''}${room.name}`;
    const size = document.createElement('td'); size.textContent = roomSizeText(room);
    const area = document.createElement('td'); area.textContent = `约 ${oneDecimal(roomArea(room))}㎡`;
    const note = document.createElement('td'); note.textContent = room.dimensionLabel || '—';
    tr.append(name, size, area, note); dimensionRows.append(tr);
  });
  const furnitureRows = get('furniture-rows');
  const roomNames = new Map(plan.rooms.map(room => [room.id, room.name]));
  const roomOrder = new Map(plan.rooms.map((room, index) => [room.id, index]));
  const furniture = plan.furniture.slice().sort((a, b) =>
    (roomOrder.get(a.room) ?? 99) - (roomOrder.get(b.room) ?? 99));
  for (const item of furniture) {
    const tr = document.createElement('tr');
    const room = document.createElement('td'); room.textContent = roomNames.get(item.room) || item.room;
    const name = document.createElement('th'); name.scope = 'row'; name.textContent = furnitureName(item.type);
    const size = document.createElement('td'); size.textContent = furnitureSizeText(item);
    tr.append(room, name, size); furnitureRows.append(tr);
  }
  const mapBounds = polygonBounds(plan.rooms.flatMap(roomPolygon));
  const margin = 34;
  const scale = Math.min((map.width - margin * 2) / (mapBounds.maxX - mapBounds.minX), (map.height - 100) / (mapBounds.maxY - mapBounds.minY));
  const offsetX = (map.width - (mapBounds.maxX - mapBounds.minX) * scale) / 2;
  const offsetY = 55;
  const mapPoint = (x, y) => [offsetX + (x - mapBounds.minX) * scale, offsetY + (mapBounds.maxY - y) * scale];

  function createMeasureNode(tag, className) {
    const node = document.createElementNS(SVG_NS, tag);
    node.setAttribute('class', className);
    measureOverlay.append(node);
    return node;
  }
  function setMeasureOverlayVisible(visible) {
    if (visible) measureOverlay.removeAttribute('hidden');
    else measureOverlay.setAttribute('hidden', '');
  }
  function removeMeasureNodes() {
    measureOverlay.replaceChildren();
  }
  function buildMeasureState(item) {
    removeMeasureNodes();
    const round = item.type === 'roundTable';
    const lineCount = round ? 1 : 2;
    const state = { item, round, footprint: createMeasureNode('polyline', 'measure-footprint'), lines: [], ticks: [], extensions: [], labels: [] };
    for (let index = 0; index < lineCount; index++) state.lines.push(createMeasureNode('line', 'measure-line'));
    for (let index = 0; index < lineCount * 2; index++) state.ticks.push(createMeasureNode('line', 'measure-tick'));
    if (!round) for (let index = 0; index < 4; index++) state.extensions.push(createMeasureNode('line', 'measure-ext'));
    const widthLabel = createMeasureNode('text', 'measure-label');
    widthLabel.textContent = round
      ? `${furnitureName(item.type)} · Ø${oneDecimal(item.w)} m`
      : `${furnitureName(item.type)} · 宽 ${oneDecimal(item.w)} m`;
    state.labels.push(widthLabel);
    if (!round) {
      const depthLabel = createMeasureNode('text', 'measure-label');
      depthLabel.textContent = `深 ${oneDecimal(item.d)} m`;
      state.labels.push(depthLabel);
    }
    measureState = state;
  }

  function projectMeasure(point, width, height) {
    measureProjected.copy(point).project(camera);
    return {
      x: (measureProjected.x * .5 + .5) * width,
      y: (-measureProjected.y * .5 + .5) * height,
      visible: measureProjected.z >= -1 && measureProjected.z <= 1,
    };
  }
  function setProjectedLine(element, start, end, width, height) {
    const a = projectMeasure(start, width, height), b = projectMeasure(end, width, height);
    if (!a.visible || !b.visible) { element.style.display = 'none'; return null; }
    element.style.display = '';
    element.setAttribute('x1', a.x.toFixed(1)); element.setAttribute('y1', a.y.toFixed(1));
    element.setAttribute('x2', b.x.toFixed(1)); element.setAttribute('y2', b.y.toFixed(1));
    return { a, b };
  }
  function screenNormal(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy) || 1;
    return { x: -dy / length, y: dx / length, length };
  }
  function setMeasureTick(element, point, normal) {
    if (!point.visible) { element.style.display = 'none'; return; }
    element.style.display = '';
    element.setAttribute('x1', (point.x - normal.x * 5).toFixed(1)); element.setAttribute('y1', (point.y - normal.y * 5).toFixed(1));
    element.setAttribute('x2', (point.x + normal.x * 5).toFixed(1)); element.setAttribute('y2', (point.y + normal.y * 5).toFixed(1));
  }
  function labelIsSafe(x, y, width, height) {
    if (x < 48 || x > width - 48 || y < 20 || y > height - 200) return false;
    const hit = document.elementFromPoint(x, y);
    return !hit || hit === canvas || hit === viewport;
  }
  function setMeasureLabel(element, a, b, width, height, center, preferUp = false) {
    if (!a.visible || !b.visible) { element.style.display = 'none'; return; }
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 20) { element.style.display = 'none'; return; }
    let nx = -(b.y - a.y) / length, ny = (b.x - a.x) / length;
    if (preferUp) {
      if (ny > 0) { nx = -nx; ny = -ny; }
    } else {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (nx * (mx - center.x) + ny * (my - center.y) < 0) { nx = -nx; ny = -ny; }
    }
    let chosen = null;
    for (const stop of [.5, .3, .7, .15, .85, .05, .95]) {
      const px = a.x + (b.x - a.x) * stop, py = a.y + (b.y - a.y) * stop;
      for (const side of [1, -1]) {
        const x = px + nx * side * 14, y = py + ny * side * 14;
        if (!labelIsSafe(x, y, width, height)) continue;
        chosen = { x, y }; break;
      }
      if (chosen) break;
    }
    if (!chosen) { element.style.display = 'none'; return; }
    element.style.display = '';
    element.setAttribute('x', chosen.x.toFixed(1)); element.setAttribute('y', chosen.y.toFixed(1));
  }

  function clearMeasure() {
    const hadMeasure = !!measureItem || !measureOverlay.hasAttribute('hidden');
    measureItem = null; measureState = null; tapStart = null;
    removeMeasureNodes();
    setMeasureOverlayVisible(false);
    aimHint.hidden = true;
    measureReadout.hidden = true;
    crosshair.classList.remove('target');
    measureCameraKnown = false;
    aimCameraKnown = false;
    if (hadMeasure) invalidate();
  }
  function pickFurniture(x, y) {
    camera.updateMatrixWorld();
    measureNdc.set(x, y);
    measureRaycaster.setFromCamera(measureNdc, camera);
    measureRaycaster.far = MEASURE_RANGE;
    const hits = measureRaycaster.intersectObjects(measureTargets, false);
    for (const hit of hits) return hit.object.userData.furnitureItem || null;
    return null;
  }
  function setMeasure(item) {
    measureItem = item;
    buildMeasureState(item);
    measureReadout.textContent = `${furnitureName(item.type)} · ${furnitureSizeText(item)} · 再点取消`;
    setMeasureOverlayVisible(true);
    aimHint.hidden = true;
    measureReadout.hidden = false;
    crosshair.classList.remove('target');
    measureCameraKnown = false;
    updateMeasure();
    invalidate();
  }
  function toggleMeasure(x, y) {
    const item = pickFurniture(x, y);
    if (!item || item === measureItem) clearMeasure();
    else setMeasure(item);
  }
  function measureAtEvent(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    toggleMeasure(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  function updateRoundMeasure(state, item, center, width, height) {
    const radius = item.w / 2;
    const candidates = [
      [furnitureWorldPoint(item, -radius, 0), furnitureWorldPoint(item, radius, 0)],
      [furnitureWorldPoint(item, 0, -radius), furnitureWorldPoint(item, 0, radius)],
    ];
    let chosen = null;
    for (const [start, end] of candidates) {
      const a = projectMeasure(start, width, height), b = projectMeasure(end, width, height);
      if (!a.visible || !b.visible) continue;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!chosen || length > chosen.length) chosen = { a, b, length };
    }
    if (!chosen) {
      state.lines[0].style.display = 'none';
      state.ticks.forEach(tick => { tick.style.display = 'none'; });
      state.labels[0].style.display = 'none';
      return;
    }
    const line = state.lines[0];
    line.style.display = '';
    line.setAttribute('x1', chosen.a.x.toFixed(1)); line.setAttribute('y1', chosen.a.y.toFixed(1));
    line.setAttribute('x2', chosen.b.x.toFixed(1)); line.setAttribute('y2', chosen.b.y.toFixed(1));
    const normal = screenNormal(chosen.a, chosen.b);
    setMeasureTick(state.ticks[0], chosen.a, normal);
    setMeasureTick(state.ticks[1], chosen.b, normal);
    setMeasureLabel(state.labels[0], chosen.a, chosen.b, width, height, center, true);
  }

  function updateRectMeasure(state, item, center, width, height) {
    const halfW = item.w / 2, halfD = item.d / 2, gap = MEASURE_GAP;
    const local = cameraLocalPosition(item, camera.position);
    const sideX = local.x >= 0 ? 1 : -1, sideZ = local.z >= 0 ? 1 : -1;
    const widthZ = sideZ * (halfD + gap), depthX = sideX * (halfW + gap);
    const widthA = furnitureWorldPoint(item, -halfW, widthZ), widthB = furnitureWorldPoint(item, halfW, widthZ);
    const depthA = furnitureWorldPoint(item, depthX, -halfD), depthB = furnitureWorldPoint(item, depthX, halfD);
    const widthScreen = setProjectedLine(state.lines[0], widthA, widthB, width, height);
    const depthScreen = setProjectedLine(state.lines[1], depthA, depthB, width, height);
    const extensions = [
      [furnitureWorldPoint(item, -halfW, sideZ * halfD), furnitureWorldPoint(item, -halfW, widthZ + sideZ * .04)],
      [furnitureWorldPoint(item, halfW, sideZ * halfD), furnitureWorldPoint(item, halfW, widthZ + sideZ * .04)],
      [furnitureWorldPoint(item, sideX * halfW, -halfD), furnitureWorldPoint(item, depthX + sideX * .04, -halfD)],
      [furnitureWorldPoint(item, sideX * halfW, halfD), furnitureWorldPoint(item, depthX + sideX * .04, halfD)],
    ];
    extensions.forEach(([start, end], index) => setProjectedLine(state.extensions[index], start, end, width, height));
    for (const [screen, tickIndex] of [[widthScreen, 0], [depthScreen, 2]]) {
      if (!screen) { state.ticks[tickIndex].style.display = 'none'; state.ticks[tickIndex + 1].style.display = 'none'; continue; }
      const normal = screenNormal(screen.a, screen.b);
      setMeasureTick(state.ticks[tickIndex], screen.a, normal);
      setMeasureTick(state.ticks[tickIndex + 1], screen.b, normal);
    }
    if (widthScreen) setMeasureLabel(state.labels[0], widthScreen.a, widthScreen.b, width, height, center);
    else state.labels[0].style.display = 'none';
    if (depthScreen) setMeasureLabel(state.labels[1], depthScreen.a, depthScreen.b, width, height, center);
    else state.labels[1].style.display = 'none';
  }

  function updateMeasure() {
    if (!measureItem || !measureState || (movement && movement.overview)) {
      if (!measureOverlay.hasAttribute('hidden')) setMeasureOverlayVisible(false);
      measureReadout.hidden = true;
      return;
    }
    const width = viewport.clientWidth, height = viewport.clientHeight;
    if (!width || !height) { setMeasureOverlayVisible(false); measureReadout.hidden = true; return; }
    camera.updateMatrixWorld();
    const sizeChanged = measureViewWidth !== width || measureViewHeight !== height;
    if (measureCameraKnown && !sizeChanged && measureCameraMatrix.equals(camera.matrixWorld)) return;
    measureCameraKnown = true;
    measureCameraMatrix.copy(camera.matrixWorld);
    if (sizeChanged) {
      measureViewWidth = width; measureViewHeight = height;
      measureOverlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }
    measureCenter.copy(furnitureWorldPoint(measureItem, 0, 0, .5));
    measureDirection.copy(measureCenter).sub(camera.position);
    const distance = measureDirection.length();
    camera.getWorldDirection(measureForward);
    if (distance > MEASURE_RANGE || measureDirection.dot(measureForward) <= .01) {
      setMeasureOverlayVisible(false);
      measureReadout.hidden = true;
      return;
    }
    setMeasureOverlayVisible(true);
    measureReadout.hidden = false;
    const state = measureState;
    let points = '';
    for (const [localX, localZ] of footprintLocalPoints(measureItem)) {
      const projected = projectMeasure(furnitureWorldPoint(measureItem, localX, localZ), width, height);
      if (!projected.visible) { points = ''; break; }
      points += `${projected.x.toFixed(1)},${projected.y.toFixed(1)} `;
    }
    if (points) { state.footprint.style.display = ''; state.footprint.setAttribute('points', points.trim()); }
    else state.footprint.style.display = 'none';
    const center = projectMeasure(furnitureWorldPoint(measureItem, 0, 0), width, height);
    if (state.round) updateRoundMeasure(state, measureItem, center, width, height);
    else updateRectMeasure(state, measureItem, center, width, height);
  }

  function updateAim() {
    if (mobile || !movement?.active || movement.overview || measureItem) {
      aimHint.hidden = true;
      crosshair.classList.remove('target');
      return;
    }
    const item = pickFurniture(0, 0);
    if (item) {
      aimHint.textContent = `点击标注 · ${furnitureName(item.type)}`;
      aimHint.hidden = false;
      crosshair.classList.add('target');
    } else {
      aimHint.hidden = true;
      crosshair.classList.remove('target');
    }
  }

  function message(text) {
    clearTimeout(toastTimer); get('toast').textContent = text; get('toast').hidden = false;
    toastTimer = setTimeout(() => { get('toast').hidden = true; }, 2800);
  }
  function setPlaying(enabled) { playing = enabled; play.textContent = enabled ? 'Ⅱ' : '▶'; play.setAttribute('aria-label', enabled ? '暂停日照延时' : '播放一天日照'); }
  function togglePlayback() { if (minutes >= END_TIME) minutes = START_TIME; setPlaying(!playing); updateSun(); }
  function updateSun() {
    if (!date.value) { setPlaying(false); message('请先选择有效的日照日期'); return; }
    const position = sunSystem.update(date.value, minutes);
    invalidate();
    const displayMinutes = Math.floor(minutes / 5) * 5;
    get('time-display').textContent = `${String(Math.floor(displayMinutes / 60)).padStart(2, '0')}:${String(displayMinutes % 60).padStart(2, '0')}`;
    get('sun-status').textContent = position.altitudeDeg > 0 ? `高度 ${position.altitudeDeg.toFixed(1)}° · 方位 ${position.azimuthDeg.toFixed(0)}°` : '太阳在地平线下 · 室内灯开启';
    slider.value = displayMinutes;
    slider.style.setProperty('--progress', `${(minutes - START_TIME) / (END_TIME - START_TIME) * 100}%`);
    get('location-label').textContent = `当地时间 UTC${settings.utcOffsetHours >= 0 ? '+' : ''}${settings.utcOffsetHours} · 南向阳台`;
  }

  function mapRoomAt(event) {
    const rect = map.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const px = (event.clientX - rect.left) * (map.width / rect.width);
    const py = (event.clientY - rect.top) * (map.height / rect.height);
    const x = (px - offsetX) / scale + mapBounds.minX;
    const y = mapBounds.maxY - (py - offsetY) / scale;
    return plan.rooms.find(room => pointInPolygon(x, y, roomPolygon(room))) || null;
  }

  function updateMap() {
    if (mapPanel.classList.contains('collapsed')) return;
    ctx.clearRect(0, 0, map.width, map.height);
    const expanded = mapPanel.classList.contains('expanded');
    const mapCssWidth = map.getBoundingClientRect().width || map.width;
    const mapFontScale = map.width / mapCssWidth;
    const nameCss = expanded ? 13 : 10;
    const areaCss = expanded ? 11 : 9;
    for (const room of plan.rooms) {
      const polygon = roomPolygon(room);
      ctx.beginPath(); polygon.forEach(([x, y], i) => { const [px, py] = mapPoint(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath();
      ctx.fillStyle = floorColors[room.floor]; ctx.fill();
      if (room.id === hoverRoomId) {
        ctx.fillStyle = 'rgba(82, 107, 80, .13)'; ctx.fill();
        ctx.strokeStyle = '#6d8062'; ctx.lineWidth = 2; ctx.stroke();
      }
      const info = roomModelInfo(room); const bounds = info.bounds;
      const [x, y] = mapPoint((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
      const roomWidthCss = info.width * scale / mapFontScale;
      const roomHeightCss = info.depth * scale / mapFontScale;
      const label = room.mapName || room.name;
      const fitName = Math.max(8.5, (roomWidthCss - 6) / Math.max(1, label.length * 1.05));
      const nameSizeCss = Math.min(nameCss, fitName);
      const nameSize = nameSizeCss * mapFontScale;
      const showArea = expanded || (roomWidthCss >= 50 && roomHeightCss >= 34);
      const areaText = `约 ${oneDecimal(info.area)}㎡`;
      const fitArea = Math.max(8, (roomWidthCss - 6) / Math.max(1, areaText.length * .52));
      const areaSize = Math.min(areaCss, fitArea) * mapFontScale;
      const halfGap = Math.max(nameSize, areaSize) * .56;
      ctx.fillStyle = '#556053'; ctx.font = `${nameSize}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, x, showArea ? y - halfGap : y);
      if (showArea) {
        ctx.fillStyle = '#707a69'; ctx.font = `${areaSize}px "Microsoft YaHei", sans-serif`;
        ctx.fillText(areaText, x, y + halfGap);
      }
    }
    ctx.textBaseline = 'alphabetic';
    ctx.lineCap = 'square';
    for (const wall of plan.walls) {
      const start = mapPoint(wall.x1, wall.y1), end = mapPoint(wall.x2, wall.y2);
      ctx.strokeStyle = '#8c9783'; ctx.lineWidth = wall.railing ? 2 : wall.thickness * scale;
      ctx.beginPath(); ctx.moveTo(...start); ctx.lineTo(...end); ctx.stroke();
    }
    const wallMap = new Map(plan.walls.map(wall => [wall.id, wall]));
    for (const opening of [...plan.doors, ...plan.windows]) {
      const wall = wallMap.get(opening.wallId); const length = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
      const point = offset => mapPoint(wall.x1 + (wall.x2 - wall.x1) * offset / length, wall.y1 + (wall.y2 - wall.y1) * offset / length);
      ctx.lineWidth = wall.thickness * scale + 1;
      ctx.strokeStyle = opening.sillHeight !== undefined ? '#acbfbb' : '#f3f2e9';
      ctx.beginPath(); ctx.moveTo(...point(opening.offset)); ctx.lineTo(...point(opening.offset + opening.width)); ctx.stroke();
    }
    // 北向箭头绕同一朝向角旋转，不能只旋转太阳。
    const north = radians(-settings.planUpAzimuthDeg);
    const nx = 46, ny = 38;
    ctx.save(); ctx.translate(nx, ny); ctx.rotate(north); ctx.strokeStyle = '#6d8062'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 10); ctx.lineTo(0, -11); ctx.lineTo(-4, -4); ctx.moveTo(0, -11); ctx.lineTo(4, -4); ctx.stroke(); ctx.restore();
    ctx.font = `${10 * mapFontScale}px "Segoe UI"`; ctx.fillStyle = '#6d8062'; ctx.textAlign = 'left'; ctx.fillText('N', 60, 44);
    const position = movement.playerPosition; const [px, py] = mapPoint(position.x, -position.z);
    forwardVector.set(0, 0, -1).applyQuaternion(movement.playerQuaternion); const angle = Math.atan2(forwardVector.x, -forwardVector.z);
    ctx.save(); ctx.translate(px, py); ctx.rotate(angle);
    ctx.fillStyle = '#71856833'; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, 30, -Math.PI * .69, -Math.PI * .31); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#54714b'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#f7f7ec'; ctx.lineWidth = 2; ctx.stroke(); ctx.restore();
    if (sunSystem.current) {
      const sunAngle = radians(sunSystem.current.azimuthDeg - settings.planUpAzimuthDeg);
      const cx = map.width - 46, cy = 34;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(sunAngle);
      ctx.strokeStyle = '#bf9957'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 8); ctx.lineTo(0, -13); ctx.lineTo(-4, -7); ctx.moveTo(0, -13); ctx.lineTo(4, -7); ctx.stroke(); ctx.restore();
      ctx.fillStyle = '#bf9957'; ctx.font = '22px "Segoe UI"'; ctx.textAlign = 'center'; ctx.fillText('☀', cx + 22, cy + 6);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#7d8575'; ctx.font = `${10 * mapFontScale}px "Microsoft YaHei"`; ctx.fillText('南向阳台', map.width / 2, map.height - 14);
  }

  function setDimensionsVisible(visible) {
    dimensionsVisible = visible;
    roomLabels.forEach(label => { label.visible = visible; });
    furnitureLabels.forEach(label => { label.visible = visible; });
    layerSwitch.hidden = !(mobile && visible);
    const furnitureLayer = dimensionLayer === 'furniture';
    layerFurniture.setAttribute('aria-pressed', String(furnitureLayer));
    layerRooms.setAttribute('aria-pressed', String(!furnitureLayer));
    dimensionsToggle.setAttribute('aria-pressed', String(visible));
    dimensionsToggle.setAttribute('aria-label', mobile
      ? (visible ? '关闭尺寸标注平面' : '打开尺寸标注平面')
      : (visible ? '隐藏尺寸平面' : '显示尺寸平面'));
    invalidate();
  }
  function setDimensionLayer(layer) {
    dimensionLayer = layer;
    const furnitureLayer = layer === 'furniture';
    layerFurniture.setAttribute('aria-pressed', String(furnitureLayer));
    layerRooms.setAttribute('aria-pressed', String(!furnitureLayer));
    updateDimensions();
    invalidate();
  }

  function updateMapButtons() {
    const expanded = mapPanel.classList.contains('expanded');
    mapExpand.textContent = expanded ? '×' : '⤢';
    mapExpand.setAttribute('aria-expanded', String(expanded));
    mapExpand.setAttribute('aria-label', expanded ? '关闭放大的户型图' : '放大户型图与尺寸表');
  }
  function setMapCollapsed(collapsed) {
    mapPanel.classList.toggle('collapsed', collapsed);
    get('map-toggle').textContent = collapsed ? '+' : '−';
    get('map-toggle').setAttribute('aria-expanded', String(!collapsed));
    get('map-toggle').setAttribute('aria-label', collapsed ? '展开小地图' : '收起小地图');
    updateMap();
  }
  function setMapExpanded(expanded) {
    if (expanded === mapPanel.classList.contains('expanded')) return;
    if (expanded) {
      if (mapPanel.classList.contains('collapsed')) setMapCollapsed(false);
      mapPanel.classList.add('expanded'); mapBackdrop.hidden = false; roomTable.open = true; furnitureTable.open = false;
    } else {
      mapPanel.classList.remove('expanded'); mapBackdrop.hidden = true; roomTable.open = false; furnitureTable.open = false;
    }
    updateMapButtons();
    requestAnimationFrame(updateMap);
  }

  function syncSettingsInputs() {
    get('latitude').value = settings.latitude; get('longitude').value = settings.longitude;
    get('utc-offset').value = settings.utcOffsetHours; get('orientation').value = settings.planUpAzimuthDeg;
  }
  function saveSettings() {
    try {
      localStorage.setItem(settingsKey, JSON.stringify({
        latitude: settings.latitude, longitude: settings.longitude,
        utcOffsetHours: settings.utcOffsetHours, planUpAzimuthDeg: settings.planUpAzimuthDeg,
      }));
    } catch {}
  }
  function resetSettings() {
    Object.assign(settings, defaultSettings);
    syncSettingsInputs();
    try { localStorage.removeItem(settingsKey); } catch {}
    updateSun(); updateMap(); message('已恢复默认日照设置');
  }

  function bind(movementController, solarSystem) {
    movement = movementController; sunSystem = solarSystem;
    get('enter-button').addEventListener('click', () => { get('enter-button').blur(); movement.start(); });
    get('mode-button').addEventListener('click', () => {
      if (movement.plan) movement.setPlanView(false); else movement.setOverview(!movement.overview);
      get('mode-button').blur();
    });
    dimensionsToggle.addEventListener('click', () => {
      const next = !dimensionsVisible;
      if (next) {
        if (mobile) {
          setMapExpanded(false);
          setMapCollapsed(true);
        }
        movement.setPlanView(true);
        setDimensionsVisible(true);
        message(mobile ? '尺寸标注平面 · 双指缩放，点右上角 ⤢ 看尺寸表' : '已进入尺寸平面 · 大件家具显示尺寸，右上角可放大看房间/家具表');
      } else {
        setDimensionsVisible(false);
        movement.setPlanView(false);
      }
      dimensionsToggle.blur();
    });
    layerFurniture.addEventListener('click', () => { setDimensionLayer('furniture'); layerFurniture.blur(); });
    layerRooms.addEventListener('click', () => { setDimensionLayer('room'); layerRooms.blur(); });
    canvas.addEventListener('click', () => {
      if (mobile || !movement.active || movement.overview) return;
      toggleMeasure(0, 0);
    });
    canvas.addEventListener('pointerdown', event => {
      if (!mobile || event.pointerType === 'mouse' || movement.overview) return;
      tapStart = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
    });
    canvas.addEventListener('pointermove', event => {
      if (!tapStart || tapStart.id !== event.pointerId) return;
      if (Math.hypot(event.clientX - tapStart.x, event.clientY - tapStart.y) > 10) tapStart = null;
    });
    canvas.addEventListener('pointerup', event => {
      if (!tapStart || tapStart.id !== event.pointerId) return;
      const tap = tapStart; tapStart = null;
      if (performance.now() - tap.time > 450) return;
      if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > 10) return;
      if (!movement.active || movement.overview) return;
      measureAtEvent(event);
    });
    canvas.addEventListener('pointercancel', () => { tapStart = null; });
    canvas.addEventListener('lostpointercapture', () => { tapStart = null; });
    roomSelect.addEventListener('change', () => { if (roomSelect.value) { clearMeasure(); movement.teleport(roomSelect.value); roomSelect.value = ''; roomSelect.blur(); } });
    const settingsPanel = get('settings-panel');
    get('settings-button').addEventListener('click', () => { movement.pause(); settingsPanel.hidden = !settingsPanel.hidden; get('settings-button').setAttribute('aria-expanded', String(!settingsPanel.hidden)); });
    get('settings-close').addEventListener('click', () => { settingsPanel.hidden = true; get('settings-button').setAttribute('aria-expanded', 'false'); });
    get('settings-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!event.target.reportValidity()) return;
      settings.latitude = Number(get('latitude').value); settings.longitude = Number(get('longitude').value);
      settings.utcOffsetHours = Number(get('utc-offset').value); settings.planUpAzimuthDeg = Number(get('orientation').value) % 360;
      saveSettings(); updateSun(); updateMap(); message('日照设置已应用');
    });
    get('settings-reset').addEventListener('click', resetSettings);
    get('map-toggle').addEventListener('click', () => setMapCollapsed(!mapPanel.classList.contains('collapsed')));
    mapExpand.addEventListener('click', () => { setMapExpanded(!mapPanel.classList.contains('expanded')); mapExpand.blur(); });
    mapBackdrop.addEventListener('click', () => setMapExpanded(false));
    roomTable.addEventListener('toggle', () => { if (roomTable.open) furnitureTable.open = false; });
    furnitureTable.addEventListener('toggle', () => { if (furnitureTable.open) roomTable.open = false; });
    map.addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse') return;
      const room = mapRoomAt(event); const id = room?.id || null;
      if (id !== hoverRoomId) { hoverRoomId = id; map.style.cursor = id ? 'pointer' : ''; updateMap(); }
    });
    map.addEventListener('pointerleave', () => {
      if (hoverRoomId) { hoverRoomId = null; map.style.cursor = ''; updateMap(); }
    });
    map.addEventListener('click', event => {
      const room = mapRoomAt(event);
      if (!room) return;
      clearMeasure();
      movement.teleport(room.id);
      setMapExpanded(false);
    });
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && mapPanel.classList.contains('expanded')) setMapExpanded(false);
      if (event.target.closest('input,select,textarea,button')) return;
      if (/^Digit[1-9]$/.test(event.code) && !event.repeat) clearMeasure();
    });
    get('sun-toggle').addEventListener('click', () => {
      const collapsed = get('sun-panel').classList.toggle('collapsed');
      get('app').classList.toggle('sun-collapsed', collapsed); get('sun-controls').hidden = collapsed;
      get('sun-toggle').textContent = collapsed ? '+' : '−';
      get('sun-toggle').setAttribute('aria-expanded', String(!collapsed)); get('sun-toggle').setAttribute('aria-label', collapsed ? '展开日照面板' : '收起日照面板');
      get('sun-title-text').textContent = collapsed ? '日照' : '看见阳光的轨迹'; get('sun-toggle').blur();
    });
    slider.addEventListener('pointerdown', () => { movement.pause(); setPlaying(false); });
    slider.addEventListener('input', () => { minutes = Number(slider.value); setPlaying(false); updateSun(); updateMap(); });
    date.addEventListener('pointerdown', () => movement.pause());
    date.addEventListener('change', () => { if (!date.value) { date.setCustomValidity('请选择有效日期'); date.reportValidity(); return; } date.setCustomValidity(''); updateSun(); updateMap(); });
    play.addEventListener('click', () => { togglePlayback(); play.blur(); });
    for (const panel of document.querySelectorAll('.panel')) panel.addEventListener('pointerdown', event => { if (!movement.overview && event.target.closest('input,select,button')) movement.pause(); });
    updateMapButtons(); updateSun(); updateMap();
  }

  function onActive(active) {
    const walking = active && !movement?.overview;
    get('app').classList.toggle('walking', walking && !mobile);
    get('entry-prompt').hidden = active || !!movement?.overview; get('crosshair').hidden = !walking;
    if (!active) clearMeasure();
  }
  function onMode(overview, planMode = false) {
    clearMeasure();
    if (!overview && dimensionsVisible) setDimensionsVisible(false);
    get('app').classList.toggle('walking', !mobile && !overview && movement.active);
    get('mode-text').textContent = overview ? '回到房间' : '鸟瞰全屋';
    get('view-label').textContent = planMode ? '尺寸平面' : overview ? '鸟瞰全屋' : '自由行走';
    get('entry-prompt').hidden = overview || movement.active; get('crosshair').hidden = overview || !movement.active;
    get('touch-controls').hidden = !mobile || overview; get('desktop-help').hidden = mobile || overview; get('room-name').textContent = overview ? '整套房子' : '客厅'; lastRoomId = null;
  }
  function placeDimensionLabels(labels, placed, tanHalfFov, width, height) {
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
    cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
    for (const label of labels) {
      const base = label.userData.base || label.position;
      label.position.copy(base);
      const distance = camera.position.distanceTo(base);
      const furniture = label.userData.isFurniture;
      const worldHeight = clamp(
        2 * distance * tanHalfFov * (furniture ? FURNITURE_LABEL_SIZE : LABEL_SIZE),
        furniture ? .085 : .12,
        furniture ? 1.4 : 2.2,
      );
      const aspect = label.userData.aspect;
      const size = furniture ? FURNITURE_LABEL_SIZE : LABEL_SIZE;
      const minHeight = furniture ? .085 : .12;
      const maxHeight = furniture ? 1.4 : 2.2;
      const screenHeight = worldHeight / (2 * distance * tanHalfFov) * height;
      const screenWidth = screenHeight * aspect;
      const worldPerPixel = 2 * distance * tanHalfFov / height;
      const offsets = furniture
        ? [
          [0, 0], [0, screenHeight + 8], [0, -(screenHeight + 8)],
          [screenWidth * .6 + 8, 0], [-(screenWidth * .6 + 8), 0],
          [screenWidth * .6 + 8, screenHeight + 8], [-(screenWidth * .6 + 8), screenHeight + 8],
          [screenWidth * .6 + 8, -(screenHeight + 8)], [-(screenWidth * .6 + 8), -(screenHeight + 8)],
        ]
        : [[0, 0]];
      let chosen = null;
      for (const [dx, dy] of offsets) {
        label.position.copy(base)
          .addScaledVector(cameraRight, dx * worldPerPixel)
          .addScaledVector(cameraUp, dy * worldPerPixel);
        const candidateDistance = camera.position.distanceTo(label.position);
        const candidateHeight = clamp(2 * candidateDistance * tanHalfFov * size, minHeight, maxHeight);
        const candidateScreenHeight = candidateHeight / (2 * candidateDistance * tanHalfFov) * height;
        const candidateScreenWidth = candidateScreenHeight * aspect;
        projectedLabel.copy(label.position).project(camera);
        if (projectedLabel.z > 1 || projectedLabel.z < -1) continue;
        const cx = (projectedLabel.x * .5 + .5) * width, cy = (-projectedLabel.y * .5 + .5) * height;
        const left = cx - candidateScreenWidth / 2, right = cx + candidateScreenWidth / 2;
        const top = cy - candidateScreenHeight / 2, bottom = cy + candidateScreenHeight / 2;
        if (right < 0 || left > width || bottom < 0 || top > height) continue;
        if (furniture && (left < 8 || right > width - 8 || top < 8 || bottom > height - 8)) continue;
        if (placed.some(rect => left < rect.right + 2 && right > rect.left - 2 && top < rect.bottom + 2 && bottom > rect.top - 2)) continue;
        chosen = { height: candidateHeight, left, right, top, bottom }; break;
      }
      if (!chosen) { label.position.copy(base); label.visible = false; continue; }
      label.scale.set(chosen.height * aspect, chosen.height, 1);
      label.visible = true; placed.push({ left: chosen.left, right: chosen.right, top: chosen.top, bottom: chosen.bottom });
    }
  }
  function updateDimensions() {
    if (!dimensionsVisible) return;
    const tanHalfFov = Math.tan(radians(camera.fov / 2));
    const width = viewport.clientWidth, height = viewport.clientHeight;
    const placed = [];
    roomLabels.forEach(label => { label.visible = false; });
    furnitureLabels.forEach(label => { label.visible = false; });
    if (!mobile || dimensionLayer === 'room') {
      placeDimensionLabels(orderedRoomLabels, placed, tanHalfFov, width, height);
    }
    if (!mobile || dimensionLayer === 'furniture') {
      placeDimensionLabels(orderedFurnitureLabels, placed, tanHalfFov, width, height);
    }
  }
  function update(delta) {
    if (playing) {
      minutes = Math.min(END_TIME, minutes + delta * (END_TIME - START_TIME) / TIMELAPSE_SECONDS);
      solarElapsed += delta;
      if (solarElapsed >= .1 || minutes === END_TIME) { updateSun(); solarElapsed = 0; }
      if (minutes === END_TIME) setPlaying(false);
    }
    if (!movement.overview) {
      const position = movement.playerPosition; const room = currentRoom(plan, position.x, -position.z);
      if (room?.id !== lastRoomId) { get('room-name').textContent = room?.name || '过道'; lastRoomId = room?.id; }
    }
    if (!mobile) {
      aimElapsed += delta;
      if (aimElapsed >= .12) {
        aimElapsed = 0;
        if (!aimCameraKnown || !aimCameraMatrix.equals(camera.matrixWorld)) {
          aimCameraMatrix.copy(camera.matrixWorld);
          aimCameraKnown = true;
          updateAim();
        }
      }
    }
    updateMeasure();
    updateDimensions();
    mapElapsed += delta;
    if (mapElapsed >= .08) { updateMap(); mapElapsed = 0; }
  }
  return { bind, onActive, onMode, update, message, togglePlayback, get minutes() { return minutes; }, get date() { return date.value; } };
}

import * as THREE from 'three';
import { roomPolygon, polygonBounds, currentRoom, radians } from './plan.js';
import { localDateString } from './solar.js';

const START_TIME = 300;
const END_TIME = 1200;
const TIMELAPSE_SECONDS = 30;
const floorColors = { wood: '#e1d9c6', kitchen: '#d6d9cd', stone: '#cad4ce', balcony: '#d8ddce' };
const forwardVector = new THREE.Vector3();

export function roomSizeText(room) {
  if (room.w !== undefined && room.h !== undefined) return `${room.w}×${room.h}m`;
  const bounds = polygonBounds(room.polygon);
  return `${(bounds.maxX - bounds.minX).toFixed(1)}×${(bounds.maxY - bounds.minY).toFixed(1)}m`;
}

function roomCenter(room) {
  if (room.w !== undefined && room.h !== undefined) return { x: room.x + room.w / 2, z: -(room.y + room.h / 2) };
  const bounds = polygonBounds(room.polygon);
  return { x: (bounds.minX + bounds.maxX) / 2, z: -(bounds.minY + bounds.maxY) / 2 };
}

function createDimensionLabel(scene, room) {
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(249, 248, 242, .94)'; context.fillRect(8, 8, 496, 240);
  context.strokeStyle = 'rgba(82, 107, 80, .3)'; context.lineWidth = 4; context.strokeRect(8, 8, 496, 240);
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = '#354037'; context.font = '42px "Microsoft YaHei", sans-serif'; context.fillText(room.name, 256, 83);
  context.fillStyle = '#8a8f80'; context.font = '30px "Microsoft YaHei", sans-serif'; context.fillText(roomSizeText(room), 256, 169);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material); const center = roomCenter(room);
  sprite.position.set(center.x, 2.2, center.z); sprite.scale.set(1.6, .8, 1); sprite.visible = false; scene.add(sprite);
  return sprite;
}

export function createInterface(plan, camera, mobile, scene) {
  const get = id => document.getElementById(id);
  const map = get('minimap'); const ctx = map.getContext('2d');
  const slider = get('time-slider'); const date = get('date-input');
  const play = get('play-button'); const roomSelect = get('room-select');
  const dimensionsToggle = get('dimensions-toggle');
  const dimensionLabels = plan.rooms.map(room => createDimensionLabel(scene, room));
  const settings = plan.settings;
  let movement, sunSystem, playing = false, dimensionsVisible = false, minutes = settings.initialTimeMinutes;
  let mapElapsed = 0, solarElapsed = 0, toastTimer, lastRoomId;
  date.value = localDateString(settings.utcOffsetHours); slider.value = minutes;
  get('latitude').value = settings.latitude; get('longitude').value = settings.longitude;
  get('utc-offset').value = settings.utcOffsetHours; get('orientation').value = settings.planUpAzimuthDeg;
  get('building-area').textContent = `建面 ${plan.metadata.buildingArea.toFixed(2)}㎡`;
  get('interior-area').textContent = `套内建面 ${plan.metadata.interiorBuildingArea.toFixed(2)}㎡`;
  if (mobile) { get('touch-controls').hidden = false; get('desktop-help').hidden = true; get('entry-instruction').textContent = '左侧摇杆行走 · 右侧拖动看四周'; }
  plan.rooms.forEach((room, index) => {
    const option = document.createElement('option'); option.value = room.id;
    option.textContent = `${index < 9 ? index + 1 + ' · ' : ''}${room.name} ${roomSizeText(room)}`; roomSelect.append(option);
  });
  plan.assumptions.forEach(note => { const li = document.createElement('li'); li.textContent = note; get('assumptions').append(li); });
  const mapBounds = polygonBounds(plan.rooms.flatMap(roomPolygon));
  const margin = 34;
  const scale = Math.min((map.width - margin * 2) / (mapBounds.maxX - mapBounds.minX), (map.height - 100) / (mapBounds.maxY - mapBounds.minY));
  const offsetX = (map.width - (mapBounds.maxX - mapBounds.minX) * scale) / 2;
  const offsetY = 55;
  const mapPoint = (x, y) => [offsetX + (x - mapBounds.minX) * scale, offsetY + (mapBounds.maxY - y) * scale];

  function message(text) {
    clearTimeout(toastTimer); get('toast').textContent = text; get('toast').hidden = false;
    toastTimer = setTimeout(() => { get('toast').hidden = true; }, 2800);
  }
  function setPlaying(enabled) { playing = enabled; play.textContent = enabled ? 'Ⅱ' : '▶'; play.setAttribute('aria-label', enabled ? '暂停日照延时' : '播放一天日照'); }
  function togglePlayback() { if (minutes >= END_TIME) minutes = START_TIME; setPlaying(!playing); updateSun(); }
  function updateSun() {
    if (!date.value) { setPlaying(false); message('请先选择有效的日照日期'); return; }
    const position = sunSystem.update(date.value, minutes);
    const displayMinutes = Math.floor(minutes / 5) * 5;
    get('time-display').textContent = `${String(Math.floor(displayMinutes / 60)).padStart(2, '0')}:${String(displayMinutes % 60).padStart(2, '0')}`;
    get('sun-status').textContent = position.altitudeDeg > 0 ? `高度 ${position.altitudeDeg.toFixed(1)}° · 方位 ${position.azimuthDeg.toFixed(0)}°` : '太阳在地平线下 · 室内灯开启';
    slider.value = displayMinutes;
    slider.style.setProperty('--progress', `${(minutes - START_TIME) / (END_TIME - START_TIME) * 100}%`);
    get('location-label').textContent = `当地时间 UTC${settings.utcOffsetHours >= 0 ? '+' : ''}${settings.utcOffsetHours} · 南向阳台`;
  }

  function updateMap() {
    if (get('map-panel').classList.contains('collapsed')) return;
    ctx.clearRect(0, 0, map.width, map.height);
    for (const room of plan.rooms) {
      const polygon = roomPolygon(room);
      ctx.beginPath(); polygon.forEach(([x, y], i) => { const [px, py] = mapPoint(x, y); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.closePath();
      ctx.fillStyle = floorColors[room.floor]; ctx.fill();
      const bounds = polygonBounds(polygon); const [x, y] = mapPoint((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2);
      ctx.fillStyle = '#858b79'; ctx.font = '17px "Microsoft YaHei", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(room.name, x, y + 5);
      ctx.fillStyle = '#8a8f80'; ctx.font = '13px "Microsoft YaHei", sans-serif'; ctx.fillText(roomSizeText(room), x, y + 21);
    }
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
    ctx.font = '15px "Segoe UI"'; ctx.fillStyle = '#6d8062'; ctx.textAlign = 'left'; ctx.fillText('N', 58, 42);
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
      ctx.fillStyle = '#bf9957'; ctx.font = '18px "Segoe UI"'; ctx.textAlign = 'center'; ctx.fillText('☀', cx + 21, cy + 6);
    }
    ctx.textAlign = 'center'; ctx.fillStyle = '#a3a797'; ctx.font = '14px "Microsoft YaHei"'; ctx.fillText('南向阳台', map.width / 2, map.height - 14);
  }

  function setDimensionsVisible(visible) {
    dimensionsVisible = visible;
    dimensionLabels.forEach(label => { label.visible = visible; });
    dimensionsToggle.setAttribute('aria-pressed', String(visible));
    dimensionsToggle.setAttribute('aria-label', visible ? '隐藏尺寸标注' : '显示尺寸标注');
  }

  function bind(movementController, solarSystem) {
    movement = movementController; sunSystem = solarSystem;
    get('enter-button').addEventListener('click', () => { get('enter-button').blur(); movement.start(); });
    get('mode-button').addEventListener('click', () => { movement.setOverview(!movement.overview); get('mode-button').blur(); });
    dimensionsToggle.addEventListener('click', () => { setDimensionsVisible(!dimensionsVisible); dimensionsToggle.blur(); });
    roomSelect.addEventListener('change', () => { if (roomSelect.value) { movement.teleport(roomSelect.value); roomSelect.value = ''; roomSelect.blur(); } });
    const settingsPanel = get('settings-panel');
    get('settings-button').addEventListener('click', () => { movement.pause(); settingsPanel.hidden = !settingsPanel.hidden; get('settings-button').setAttribute('aria-expanded', String(!settingsPanel.hidden)); });
    get('settings-close').addEventListener('click', () => { settingsPanel.hidden = true; get('settings-button').setAttribute('aria-expanded', 'false'); });
    get('settings-form').addEventListener('submit', event => {
      event.preventDefault();
      if (!event.target.reportValidity()) return;
      settings.latitude = Number(get('latitude').value); settings.longitude = Number(get('longitude').value);
      settings.utcOffsetHours = Number(get('utc-offset').value); settings.planUpAzimuthDeg = Number(get('orientation').value) % 360;
      updateSun(); updateMap(); message('日照设置已应用');
    });
    get('map-toggle').addEventListener('click', () => {
      const collapsed = get('map-panel').classList.toggle('collapsed'); get('map-toggle').textContent = collapsed ? '+' : '−';
      get('map-toggle').setAttribute('aria-expanded', String(!collapsed)); get('map-toggle').setAttribute('aria-label', collapsed ? '展开小地图' : '收起小地图'); updateMap();
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
    updateSun(); updateMap();
  }

  function onActive(active) {
    const walking = active && !movement?.overview;
    get('app').classList.toggle('walking', walking && !mobile);
    get('entry-prompt').hidden = active || !!movement?.overview; get('crosshair').hidden = !walking;
  }
  function onMode(overview) {
    get('app').classList.toggle('walking', !mobile && !overview && movement.active);
    get('mode-text').textContent = overview ? '回到房间' : '鸟瞰全屋'; get('view-label').textContent = overview ? '鸟瞰全屋' : '自由行走';
    get('entry-prompt').hidden = overview || movement.active; get('crosshair').hidden = overview || !movement.active;
    get('touch-controls').hidden = !mobile || overview; get('desktop-help').hidden = mobile || overview; get('room-name').textContent = overview ? '整套房子' : '客厅'; lastRoomId = null;
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
    mapElapsed += delta;
    if (mapElapsed >= .08) { updateMap(); mapElapsed = 0; }
  }
  return { bind, onActive, onMode, update, message, togglePlayback, get minutes() { return minutes; }, get date() { return date.value; } };
}

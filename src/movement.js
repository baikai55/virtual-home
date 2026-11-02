import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { radians, clamp, canStand } from './plan.js';
import { createPathfinder } from './navigation.js';

const PLAYER_RADIUS = .2;
const WALK_SPEED = 1.8;
const SPRINT_SPEED = 3.5;
const TOUCH_LOOK_SPEED = .004;
const MOUSE_LOOK_SPEED = .0028;
const KEY_TURN_SPEED = 1.9;
const MAX_PITCH = Math.PI * .43;
const INITIAL_PITCH = -Math.PI / 36;
const FLIGHT_SECONDS = .9;
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = t => t < .5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2;
const wrapAngle = angle => Math.atan2(Math.sin(angle), Math.cos(angle));

export function createMovement(camera, renderer, plan, house, mobile, callbacks) {
  const canvas = renderer.domElement;
  const orbit = new OrbitControls(camera, canvas);
  orbit.enabled = false; orbit.enableDamping = true; orbit.dampingFactor = .09;
  orbit.minDistance = 7; orbit.maxDistance = 36;
  orbit.minPolarAngle = .06; orbit.maxPolarAngle = Math.PI * .44;
  const pathfinder = createPathfinder(plan, house.colliders, PLAYER_RADIUS);
  const keys = new Set();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  const poseEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const forward = new THREE.Vector3();
  const viewMatrix = new THREE.Matrix4();
  const joystick = document.getElementById('joystick');
  const knob = document.getElementById('joystick-knob');
  const sprint = document.getElementById('sprint-button');
  let joystickId = null, lookId = null, lookX = 0, lookY = 0;
  let stickX = 0, stickY = 0, sprinting = false;
  let active = false, overview = false, planMode = false, overviewFit = 1;
  let walk = null, flight = null;
  const savedPosition = new THREE.Vector3();
  const savedQuaternion = new THREE.Quaternion();
  const standable = (x, y) => canStand(plan, house.colliders, x, y, PLAYER_RADIUS);

  function resetInput() {
    keys.clear(); stickX = stickY = 0; sprinting = false; joystickId = lookId = null;
    knob.style.transform = 'translate(0, 0)';
    canvas.classList.remove('looking');
  }

  function setPose(x, y, yawDeg) {
    if (!standable(x, y)) throw new Error(`预设站位不可通行：${x.toFixed(2)}, ${y.toFixed(2)}`);
    camera.position.set(x, plan.settings.eyeHeight, -y);
    camera.rotation.set(INITIAL_PITCH, -radians(yawDeg), 0, 'YXZ');
  }
  function setSavedPose(x, y, yaw) {
    savedPosition.set(x, plan.settings.eyeHeight, -y);
    savedQuaternion.setFromEuler(poseEuler.set(INITIAL_PITCH, yaw, 0, 'YXZ'));
  }
  setPose(plan.settings.initialPosition.x, plan.settings.initialPosition.y, plan.settings.initialPosition.yawDeg);
  savedPosition.copy(camera.position); savedQuaternion.copy(camera.quaternion);
  (window.requestIdleCallback || setTimeout)(() => pathfinder.prepare());

  // 第一次操作（入口按钮、拖动、按键、摇杆、点地面）即视为进入，入口提示不再出现。
  function begin() {
    if (active) return;
    active = true; callbacks.onActive(true);
  }
  function start() { if (!overview) begin(); }
  function pause() { resetInput(); stopWalk(); }

  function pointAt(distance) {
    const { points, lengths } = walk;
    let index = 1;
    while (index < points.length - 1 && lengths[index] < distance) index++;
    const a = points[index - 1], b = points[index];
    const t = clamp((distance - lengths[index - 1]) / ((lengths[index] - lengths[index - 1]) || 1), 0, 1);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  function startWalk(points, { finalYaw = null, fast = false, onArrive } = {}) {
    const lengths = [0];
    for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    const total = lengths[lengths.length - 1];
    // 远处走得快些，整段大致 1–2.5 秒。
    const maxSpeed = fast ? clamp(total / 1.1, 3, 6) : clamp(total / 1.3, 2.2, 4.2);
    walk = { points, lengths, total, travelled: 0, elapsed: 0, maxSpeed, finalYaw, turn: true, onArrive };
    callbacks.onWalk?.(points[points.length - 1]);
  }
  function stopWalk() {
    if (!walk) return;
    walk = null; callbacks.onWalk?.(null);
  }
  function stepWalk(delta) {
    walk.elapsed += delta;
    const speed = Math.max(.35, Math.min(walk.maxSpeed, .8 + walk.elapsed * 9, Math.sqrt(12 * (walk.total - walk.travelled))));
    walk.travelled = Math.min(walk.total, walk.travelled + speed * delta);
    const point = pointAt(walk.travelled);
    if (!standable(point.x, point.y)) { stopWalk(); return; }
    camera.position.set(point.x, plan.settings.eyeHeight, -point.y);
    const left = walk.total - walk.travelled;
    let targetYaw = null;
    if (walk.finalYaw !== null && left < 1.2) targetYaw = walk.finalYaw;
    else if (walk.turn) {
      const ahead = pointAt(Math.min(walk.total, walk.travelled + .8));
      if (Math.hypot(ahead.x - point.x, ahead.y - point.y) > .1) targetYaw = Math.atan2(point.x - ahead.x, ahead.y - point.y);
    }
    euler.setFromQuaternion(camera.quaternion);
    let turning = false;
    if (targetYaw !== null) {
      const difference = wrapAngle(targetYaw - euler.y);
      euler.y += difference * (1 - Math.exp(-delta * 6));
      turning = Math.abs(difference) > .03;
    }
    if (walk.turn || walk.finalYaw !== null) euler.x += (INITIAL_PITCH - euler.x) * (1 - Math.exp(-delta * 3));
    camera.quaternion.setFromEuler(euler);
    if (left > 1e-4 || (turning && walk.elapsed < walk.total / walk.maxSpeed + 1.5)) return;
    const { onArrive } = walk;
    stopWalk(); onArrive?.();
  }

  function startFlight(position, quaternion, onDone) {
    stopWalk();
    if (reduceMotion) {
      flight = null; camera.position.copy(position); camera.quaternion.copy(quaternion); onDone?.(); return;
    }
    flight = { fromPosition: camera.position.clone(), toPosition: position.clone(), fromQuaternion: camera.quaternion.clone(), toQuaternion: quaternion.clone(), elapsed: 0, onDone };
  }
  function stepFlight(delta) {
    flight.elapsed += delta;
    const t = Math.min(1, flight.elapsed / FLIGHT_SECONDS), eased = easeInOut(t);
    camera.position.lerpVectors(flight.fromPosition, flight.toPosition, eased);
    camera.quaternion.slerpQuaternions(flight.fromQuaternion, flight.toQuaternion, eased);
    if (t < 1) return;
    const { onDone } = flight;
    flight = null; onDone?.();
  }

  function overviewFitFactor() {
    return Math.max(1, .75 / camera.aspect, canvas.clientHeight < 550 ? 1.3 : 1);
  }
  function resize() {
    if (!overview || flight) return;
    const nextFit = overviewFitFactor();
    camera.position.sub(orbit.target).multiplyScalar(nextFit / overviewFit).add(orbit.target);
    overviewFit = nextFit; orbit.update();
  }
  function viewPose(view) {
    orbit.target.set(view.targetX, view.targetHeight ?? -.55, -view.targetY);
    overviewFit = overviewFitFactor();
    const position = new THREE.Vector3(view.x, view.height, -view.y).sub(orbit.target).multiplyScalar(overviewFit).add(orbit.target);
    viewMatrix.lookAt(position, orbit.target, camera.up);
    return { position, quaternion: new THREE.Quaternion().setFromRotationMatrix(viewMatrix) };
  }
  function enterView(view, isPlan) {
    if (!overview) {
      // 正在飞回室内时保留目标站位；否则记下当前站位，退出时飞回这里。
      if (!flight) { savedPosition.copy(camera.position); savedQuaternion.copy(camera.quaternion); }
      resetInput();
    }
    planMode = isPlan; overview = true; orbit.enabled = false;
    house.setCutaway(true); renderer.shadowMap.needsUpdate = true;
    const pose = viewPose(view);
    startFlight(pose.position, pose.quaternion, () => { orbit.enabled = true; orbit.update(); });
    callbacks.onMode(true, isPlan);
  }
  function leaveOverview(onArrive) {
    planMode = false; overview = false; orbit.enabled = false;
    startFlight(savedPosition, savedQuaternion, () => { house.setCutaway(false); onArrive?.(); });
    begin();
    callbacks.onMode(false, false);
  }
  function setOverview(enabled) {
    if (enabled === overview && !planMode) return;
    if (enabled) enterView(plan.settings.overview, false); else leaveOverview();
  }
  function setPlanView(enabled) {
    if (enabled === planMode) return;
    if (enabled) enterView(plan.settings.planView, true); else leaveOverview();
  }

  function teleport(roomId) {
    const room = plan.rooms.find(item => item.id === roomId);
    if (!room) throw new Error(`房间不存在：${roomId}`);
    const [x, y, yawDeg] = room.spawn;
    if (!standable(x, y)) throw new Error(`预设站位不可通行：${x.toFixed(2)}, ${y.toFixed(2)}`);
    resetInput(); stopWalk(); begin();
    const arrive = () => callbacks.onMessage(`已到 ${room.name}`);
    if (overview || flight) { setSavedPose(x, y, -radians(yawDeg)); leaveOverview(arrive); return; }
    const path = reduceMotion ? null : pathfinder.findPath({ x: camera.position.x, y: -camera.position.z }, { x, y });
    if (!path) { setPose(x, y, yawDeg); arrive(); return; }
    startWalk(path, { fast: true, finalYaw: -radians(yawDeg), onArrive: arrive });
  }
  // 点地面：吸附到 snap 米内可站的位置，再沿路线走过去。返回目的地，走不到时返回 null。
  function walkTo(x, y, snap = .6) {
    if (overview || flight) return null;
    const target = pathfinder.nearest(x, y, snap);
    if (!target) return null;
    const path = pathfinder.findPath({ x: camera.position.x, y: -camera.position.z }, target);
    if (!path) return null;
    begin();
    if (reduceMotion) { stopWalk(); camera.position.set(target.x, plan.settings.eyeHeight, -target.y); return target; }
    startWalk(path);
    return target;
  }
  // 鸟瞰中点地面：飞到该处，朝向沿用鸟瞰视线的水平方向。
  function enterAt(x, y, snap = .8) {
    if (!overview || planMode) return null;
    const target = pathfinder.nearest(x, y, snap);
    if (!target) return null;
    setSavedPose(target.x, target.y, Math.atan2(camera.position.x - target.x, camera.position.z + target.y));
    leaveOverview();
    return target;
  }

  window.addEventListener('keydown', event => {
    if (event.code === 'Escape') { pause(); return; }
    if (event.target.closest('input,select,textarea,button') || event.ctrlKey || event.metaKey || event.altKey) return;
    if (MOVE_KEYS.has(event.code)) {
      if (!overview) { keys.add(event.code); if (!event.code.startsWith('Shift')) begin(); event.preventDefault(); }
    } else if (event.code === 'KeyM' && !event.repeat) { setOverview(!overview); event.preventDefault(); }
    else if (event.code === 'Space' && !event.repeat) { callbacks.onPlayback(); event.preventDefault(); }
    else if (/^Digit[1-9]$/.test(event.code) && !event.repeat) {
      const room = plan.rooms[Number(event.code.slice(-1)) - 1]; if (room) teleport(room.id);
    }
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  function updateStick(event) {
    const rect = joystick.getBoundingClientRect();
    const max = rect.width * .32;
    const dx = event.clientX - rect.left - rect.width / 2;
    const dy = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(dx, dy);
    const factor = distance > max ? max / distance : 1;
    stickX = dx * factor / max; stickY = -dy * factor / max;
    knob.style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
  }
  joystick.addEventListener('pointerdown', event => {
    if (!mobile || overview || joystickId !== null) return;
    event.preventDefault(); event.stopPropagation(); joystickId = event.pointerId;
    joystick.setPointerCapture(event.pointerId); begin(); updateStick(event);
  });
  joystick.addEventListener('pointermove', event => { if (event.pointerId === joystickId) { updateStick(event); event.preventDefault(); } });
  function releaseStick(event) { if (event.pointerId === joystickId) { joystickId = null; stickX = stickY = 0; knob.style.transform = 'translate(0, 0)'; } }
  joystick.addEventListener('pointerup', releaseStick); joystick.addEventListener('pointercancel', releaseStick); joystick.addEventListener('lostpointercapture', releaseStick);

  // 鼠标与触屏都用按住拖动看四周，不再锁定鼠标；点击由界面层判断是走过去还是量家具。
  canvas.addEventListener('pointerdown', event => {
    if (overview || flight || lookId !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    event.preventDefault(); lookId = event.pointerId; lookX = event.clientX; lookY = event.clientY;
    canvas.setPointerCapture(event.pointerId); begin();
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== lookId || overview) return;
    const dx = event.clientX - lookX, dy = event.clientY - lookY;
    if (!dx && !dy) return;
    const speed = event.pointerType === 'mouse' ? MOUSE_LOOK_SPEED : TOUCH_LOOK_SPEED;
    euler.setFromQuaternion(camera.quaternion);
    euler.y -= dx * speed;
    euler.x = clamp(euler.x - dy * speed, -MAX_PITCH, MAX_PITCH);
    camera.quaternion.setFromEuler(euler); lookX = event.clientX; lookY = event.clientY;
    // 走动中拖视角：继续走，但不再自动转向。
    if (walk) { walk.turn = false; walk.finalYaw = null; }
    if (event.pointerType === 'mouse') canvas.classList.add('looking');
    event.preventDefault();
  });
  function releaseLook(event) { if (event.pointerId === lookId) { lookId = null; canvas.classList.remove('looking'); } }
  canvas.addEventListener('pointerup', releaseLook); canvas.addEventListener('pointercancel', releaseLook); canvas.addEventListener('lostpointercapture', releaseLook);
  sprint.addEventListener('pointerdown', event => { if (overview) return; sprinting = true; sprint.setPointerCapture(event.pointerId); event.preventDefault(); });
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) sprint.addEventListener(eventName, () => { sprinting = false; });

  function update(delta) {
    if (flight) { stepFlight(delta); return; }
    if (overview) { orbit.update(); return; }
    const turn = (keys.has('ArrowLeft') ? 1 : 0) - (keys.has('ArrowRight') ? 1 : 0);
    let moveForward = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + stickY;
    let moveRight = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0) + stickX;
    const length = Math.hypot(moveForward, moveRight);
    if (walk) {
      if (!turn && length < .01) { stepWalk(delta); return; }
      stopWalk();
    }
    if (turn) {
      euler.setFromQuaternion(camera.quaternion); euler.y += turn * KEY_TURN_SPEED * delta;
      camera.quaternion.setFromEuler(euler);
    }
    if (length < .01) return;
    if (length > 1) { moveForward /= length; moveRight /= length; }
    camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
    const speed = sprinting || keys.has('ShiftLeft') || keys.has('ShiftRight') ? SPRINT_SPEED : WALK_SPEED;
    const dx = (forward.x * moveForward - forward.z * moveRight) * speed * delta;
    const dy = (-forward.z * moveForward - forward.x * moveRight) * speed * delta;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / .07));
    let x = camera.position.x, y = -camera.position.z;
    for (let i = 0; i < steps; i++) {
      if (standable(x + dx / steps, y)) x += dx / steps;
      if (standable(x, y + dy / steps)) y += dy / steps;
    }
    camera.position.set(x, plan.settings.eyeHeight, -y);
  }
  return {
    start, pause, setOverview, setPlanView, teleport, walkTo, enterAt, update, resize,
    resolveTarget: (x, y, snap) => pathfinder.nearest(x, y, snap),
    get overview() { return overview; }, get plan() { return planMode; }, get active() { return active; }, get busy() { return !!flight; },
    get playerPosition() { return overview || flight ? savedPosition : camera.position; },
    get playerQuaternion() { return overview || flight ? savedQuaternion : camera.quaternion; },
  };
}

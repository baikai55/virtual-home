export const radians = degrees => degrees * Math.PI / 180;
export const degrees = angle => angle * 180 / Math.PI;
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function roomPolygon(room) {
  return room.polygon || [[room.x, room.y], [room.x + room.w, room.y], [room.x + room.w, room.y + room.h], [room.x, room.y + room.h]];
}

export function polygonBounds(polygon) {
  const xs = polygon.map(point => point[0]);
  const ys = polygon.map(point => point[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function currentRoom(plan, x, y) {
  return plan.rooms.find(room => pointInPolygon(x, y, roomPolygon(room)));
}

export function circleHitsRect(x, y, radius, rect) {
  const angle = radians(rect.rotation || 0);
  const dx = x - rect.x;
  const dy = y - rect.y;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = -dx * Math.sin(angle) + dy * Math.cos(angle);
  const nearestX = clamp(localX, -rect.w / 2, rect.w / 2);
  const nearestY = clamp(localY, -rect.d / 2, rect.d / 2);
  return (localX - nearestX) ** 2 + (localY - nearestY) ** 2 < radius ** 2 - 1e-9;
}

export function canStand(plan, colliders, x, y, radius) {
  return !!currentRoom(plan, x, y) && !colliders.some(rect => circleHitsRect(x, y, radius, rect));
}

export function wallLength(wall) {
  return Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
}

export function wallPoint(wall, offset) {
  const length = wallLength(wall);
  return { x: wall.x1 + (wall.x2 - wall.x1) * offset / length, y: wall.y1 + (wall.y2 - wall.y1) * offset / length };
}

export function validatePlan(plan) {
  if (!plan.rooms.length || !plan.walls.length) throw new Error('户型数据缺少房间或墙体。');
  const ids = new Set();
  for (const room of plan.rooms) {
    if (ids.has(room.id)) throw new Error(`房间编号重复：${room.id}`);
    ids.add(room.id);
    const polygon = roomPolygon(room);
    if (polygon.length < 3 || polygon.flat().some(value => !Number.isFinite(value))) throw new Error(`房间轮廓无效：${room.name}`);
  }
  const walls = new Map();
  for (const wall of plan.walls) {
    if (walls.has(wall.id)) throw new Error(`墙体编号重复：${wall.id}`);
    if (wall.x1 !== wall.x2 && wall.y1 !== wall.y2) throw new Error(`当前仅支持横直墙体：${wall.id}`);
    if (wallLength(wall) <= 0 || wall.thickness <= 0) throw new Error(`墙体尺寸无效：${wall.id}`);
    walls.set(wall.id, wall);
  }
  for (const opening of [...plan.doors, ...plan.windows]) {
    const wall = walls.get(opening.wallId);
    if (!wall) throw new Error(`门窗没有对应墙体：${opening.id}`);
    const bottom = opening.sillHeight || 0;
    if (opening.offset < 0 || opening.width <= 0 || opening.offset + opening.width > wallLength(wall) + 0.001 || bottom + opening.height > (wall.height || plan.settings.wallHeight) + 0.001) throw new Error(`门窗超出墙体范围：${opening.id}`);
  }
  return walls;
}

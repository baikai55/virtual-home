import { polygonBounds, roomPolygon, pointInPolygon, radians } from './plan.js';

const CELL = .1;
// 格心按 radius + MARGIN 判定可站：相邻格心连线（最长 0.14 m）离障碍仍不小于 radius，同时不堵住约 0.45 m 的窄过道。
const MARGIN = .02;
const SAMPLE = .05;
// 拉直时逐点精确判定，多留 1 cm 抵消采样间隔内的误差。
const SLACK = .01;
const NEIGHBORS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

// 平面坐标（米，y 向北）上的寻路：可站立网格 + A*，再拉直成少量折点。
export function createPathfinder(plan, colliders, radius) {
  const polygons = plan.rooms.map(roomPolygon);
  const bounds = polygonBounds(polygons.flat());
  const cols = Math.ceil((bounds.maxX - bounds.minX) / CELL);
  const rows = Math.ceil((bounds.maxY - bounds.minY) / CELL);
  const cellX = col => bounds.minX + (col + .5) * CELL;
  const cellY = row => bounds.minY + (row + .5) * CELL;
  const cellPoint = index => ({ x: cellX(index % cols), y: cellY(Math.floor(index / cols)) });
  // 与 plan.js 的 canStand 判定一致，只是预先算好三角函数，供建网格时上万次调用。
  const rects = colliders.map(rect => {
    const angle = radians(rect.rotation || 0);
    return { x: rect.x, y: rect.y, halfW: rect.w / 2, halfD: rect.d / 2, cos: Math.cos(angle), sin: Math.sin(angle), reach: Math.hypot(rect.w, rect.d) / 2 };
  });
  function clearAt(x, y, size) {
    if (!polygons.some(polygon => pointInPolygon(x, y, polygon))) return false;
    for (const rect of rects) {
      const dx = x - rect.x, dy = y - rect.y;
      if (Math.abs(dx) > rect.reach + size || Math.abs(dy) > rect.reach + size) continue;
      const localX = dx * rect.cos + dy * rect.sin, localY = -dx * rect.sin + dy * rect.cos;
      const nearX = Math.max(-rect.halfW, Math.min(rect.halfW, localX));
      const nearY = Math.max(-rect.halfD, Math.min(rect.halfD, localY));
      if ((localX - nearX) ** 2 + (localY - nearY) ** 2 < size * size - 1e-9) return false;
    }
    return true;
  }

  let walkable = null;
  function grid() {
    if (walkable) return walkable;
    walkable = new Uint8Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) walkable[row * cols + col] = clearAt(cellX(col), cellY(row), radius + MARGIN) ? 1 : 0;
    }
    return walkable;
  }
  // 不检查起点 a：它是当前站位或上一段已验证过的终点。
  function segmentClear(a, b) {
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / SAMPLE));
    for (let i = 1; i <= steps; i++) {
      if (!clearAt(a.x + (b.x - a.x) * i / steps, a.y + (b.y - a.y) * i / steps, radius + SLACK)) return false;
    }
    return true;
  }

  function nearestCell(x, y, maxDistance) {
    const cells = grid();
    const col0 = Math.floor((x - bounds.minX) / CELL), row0 = Math.floor((y - bounds.minY) / CELL);
    const reach = Math.ceil(maxDistance / CELL);
    let best = -1, bestDistance = maxDistance * maxDistance;
    for (let row = Math.max(0, row0 - reach); row <= Math.min(rows - 1, row0 + reach); row++) {
      for (let col = Math.max(0, col0 - reach); col <= Math.min(cols - 1, col0 + reach); col++) {
        if (!cells[row * cols + col]) continue;
        const distance = (cellX(col) - x) ** 2 + (cellY(row) - y) ** 2;
        if (distance <= bestDistance) { bestDistance = distance; best = row * cols + col; }
      }
    }
    return best;
  }
  // 点击位置本身能站就用原点，否则吸附到 maxDistance 内最近的可站格。
  function nearest(x, y, maxDistance = .6) {
    if (clearAt(x, y, radius + SLACK)) return { x, y };
    const index = nearestCell(x, y, maxDistance);
    return index < 0 ? null : cellPoint(index);
  }

  function search(startIndex, goalIndex) {
    const cells = grid();
    const total = cols * rows;
    const cost = new Float64Array(total).fill(Infinity);
    const score = new Float64Array(total);
    const parent = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const goalCol = goalIndex % cols, goalRow = Math.floor(goalIndex / cols);
    const heap = [];
    const push = index => {
      heap.push(index);
      for (let i = heap.length - 1; i > 0;) {
        const up = (i - 1) >> 1;
        if (score[heap[up]] <= score[heap[i]]) break;
        [heap[up], heap[i]] = [heap[i], heap[up]]; i = up;
      }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        for (let i = 0; ;) {
          const left = i * 2 + 1, right = left + 1;
          let smallest = i;
          if (left < heap.length && score[heap[left]] < score[heap[smallest]]) smallest = left;
          if (right < heap.length && score[heap[right]] < score[heap[smallest]]) smallest = right;
          if (smallest === i) break;
          [heap[smallest], heap[i]] = [heap[i], heap[smallest]]; i = smallest;
        }
      }
      return top;
    };
    cost[startIndex] = 0; push(startIndex);
    while (heap.length) {
      const current = pop();
      if (current === goalIndex) break;
      if (closed[current]) continue;
      closed[current] = 1;
      const col = current % cols, row = Math.floor(current / cols);
      for (const [dc, dr, step] of NEIGHBORS) {
        const nextCol = col + dc, nextRow = row + dr;
        if (nextCol < 0 || nextRow < 0 || nextCol >= cols || nextRow >= rows) continue;
        const next = nextRow * cols + nextCol;
        if (!cells[next] || closed[next]) continue;
        // 斜走时两侧格都要可站，避免擦过门框角。
        if (dc && dr && (!cells[row * cols + nextCol] || !cells[nextRow * cols + col])) continue;
        const nextCost = cost[current] + step;
        if (nextCost >= cost[next]) continue;
        const dx = Math.abs(goalCol - nextCol), dy = Math.abs(goalRow - nextRow);
        cost[next] = nextCost; parent[next] = current;
        score[next] = nextCost + dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
        push(next);
      }
    }
    if (startIndex !== goalIndex && parent[goalIndex] < 0) return null;
    const indices = [];
    for (let index = goalIndex; index >= 0; index = parent[index]) indices.push(index);
    return indices.reverse();
  }

  // 返回从 start 出发的折线（含起点）；终点到不了时返回 null。
  function findPath(start, goal) {
    const startIndex = nearestCell(start.x, start.y, .6);
    const goalIndex = nearestCell(goal.x, goal.y, .6);
    if (startIndex < 0 || goalIndex < 0) return null;
    const cells = search(startIndex, goalIndex);
    if (!cells) return null;
    // 同方向的连续格本身就是安全直线，只保留拐点，减少拉直时的检测次数。
    const turns = cells.filter((cell, i) => i === 0 || i === cells.length - 1 || cell - cells[i - 1] !== cells[i + 1] - cell);
    const raw = [start, ...turns.map(cellPoint)];
    if (segmentClear(raw[raw.length - 1], goal)) raw.push(goal);
    const path = [raw[0]];
    for (let i = 0; i < raw.length - 1;) {
      let j = i + 1;
      while (j + 1 < raw.length && segmentClear(raw[i], raw[j + 1])) j++;
      path.push(raw[j]); i = j;
    }
    return path;
  }

  return { nearest, findPath, prepare: () => { grid(); } };
}

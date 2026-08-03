/**
 * 把契约里以 viewBox 单位声明的框，换算成窗口内的归一化矩形。
 *
 * **为什么这个数学只能有一处。**
 * 外壳此前把角色包围盒硬编码成四个归一化小数，靠一条测试盯着它和契约一致。
 * 那能防漂移，但挡不住第二个问题：命中框需要**按动作变化**
 * （俯视平躺的 sleeping 比站立扁得多，用同一个框会让「点得到点不到」变得没道理），
 * 而外壳不知道当前在演哪个动作的几何。所以改成运行时算好、随 plan 一起下发，
 * 外壳只管用——契约是唯一来源，Swift 里一个几何常量都不留。
 *
 * 坐标系有个必须记住的翻转：SVG 的 y 向下，AppKit 的原点在**左下**。
 * 归一化 y 一律按 AppKit 给（0 = 窗口底边），外壳拿到就能直接用。
 */

/** 解析 `"-15 -25 45 45"`。 */
export function parseViewBox(viewBox) {
  const parts = String(viewBox ?? '').trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * viewBox 单位的框 → 窗口内的归一化矩形（AppKit 左下原点）。
 *
 * @returns {{x0:number,x1:number,y0:number,y1:number}|null}
 */
export function normalizeBox(box, viewBox) {
  const vb = parseViewBox(viewBox);
  if (!vb || !box) return null;
  const { x, y, w, h } = box;
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return {
    x0: (x - vb.x) / vb.width,
    x1: (x + w - vb.x) / vb.width,
    // 纵向翻转：SVG 的 y 向下，AppKit 的 y 向上
    y0: 1 - (y + h - vb.y) / vb.height,
    y1: 1 - (y - vb.y) / vb.height,
  };
}

/**
 * 某个动作该用哪一档命中框。
 *
 * 显式声明表，不靠 id 前缀猜——猜的话 `idle.drowsy`（还是站着的）
 * 会和 `sleeping`（躺平的）混为一谈。没列的一律用 default。
 */
export function hitBoxFor(actionId, contract) {
  const boxes = contract?.hitBoxes ?? {};
  const states = contract?.hitBoxStates ?? {};
  const key = states[actionId] ?? 'default';
  return boxes[key] ?? boxes.default ?? null;
}

/**
 * 给外壳的一整套几何。
 *
 * hit    —— 可点击区域，按动作变
 * margin —— 夹到屏幕内时用的可见画面框（**不是窗口框**）
 *
 * 窗口 135×135 而角色只占 45×27，按窗口框硬夹的话角色永远贴不到屏幕边，
 * 右侧至少空 45px。按可见内容夹，贴的才是画面的边。
 */
export function geometryFor(actionId, contract) {
  const viewBox = contract?.viewBox;
  const hit = normalizeBox(hitBoxFor(actionId, contract), viewBox);
  const margin = normalizeBox(contract?.marginBox, viewBox);
  if (!hit && !margin) return null;
  return { hit, margin };
}

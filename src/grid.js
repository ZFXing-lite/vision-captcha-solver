'use strict';

/**
 * grid.js — 图像网格的几何工具
 *
 * 用途：把整张挑战图按行列切成格子，供逐格识别使用，
 * 以及把归一化坐标换算回像素坐标。
 *
 * 注意：这个模块提供的是**几何能力**，不预设布局。
 * 实测 hCaptcha 的格子可能是 3x3、1x3，也可能图块间无分隔，
 * 所以默认值是 3x3，但行列数可显式指定。
 */

const WIDE_ASPECT = 2.2;

/**
 * 计算格子矩形。
 *
 * @param {number} width  图像宽（像素）
 * @param {number} height 图像高（像素）
 * @param {object} [opts]
 * @param {number} [opts.rows] 行数，不传则按宽高比推断
 * @param {number} [opts.cols] 列数
 * @returns {{rows:number, cols:number, cells:Array<{x,y,w,h}>, box:{x,y,w,h}}}
 */
function computeGrid(width, height, opts = {}) {
  const W = Number(width);
  const H = Number(height);
  if (!Number.isFinite(W) || !Number.isFinite(H) || W <= 0 || H <= 0) {
    throw new Error('computeGrid: width and height must be positive numbers');
  }

  let { rows, cols } = opts;

  if (!rows || !cols) {
    // 宽扁的图判为单行三列，其余按标准九宫格
    if (W / H > WIDE_ASPECT) {
      rows = rows || 1;
      cols = cols || 3;
    } else {
      rows = rows || 3;
      cols = cols || 3;
    }
  }

  const cells = [];
  const cw = W / cols;
  const ch = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ x: c * cw, y: r * ch, w: cw, h: ch });
    }
  }

  return { rows, cols, cells, box: { x: 0, y: 0, w: W, h: H } };
}

/**
 * 把归一化坐标换算成像素坐标。
 *
 * 本模块不 import 任何图像库 —— 裁剪工作交给调用方
 * （用 sharp / jimp / canvas / pngjs 均可）。
 */
function toPixels(nx, ny, width, height) {
  return { x: Number(nx) * Number(width), y: Number(ny) * Number(height) };
}

/**
 * 从整图里按格子索引取归一化裁剪框。
 * 调用方拿着这个框去裁图即可，本模块不碰像素数据。
 */
function cellRect(width, height, index, opts = {}) {
  const grid = computeGrid(width, height, opts);
  const cell = grid.cells[index];
  if (!cell) return null;
  return {
    left: cell.x / width,
    top: cell.y / height,
    width: cell.w / width,
    height: cell.h / height,
    // 同时给出像素值，方便直接使用
    pixels: { x: Math.round(cell.x), y: Math.round(cell.y), w: Math.round(cell.w), h: Math.round(cell.h) },
  };
}

module.exports = { computeGrid, cellRect, toPixels, WIDE_ASPECT };
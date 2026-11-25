/**
 * 缩略图：sharp 生成图片类文件 160px 宽度 JPEG 缩略图。
 * 缓存位于 <dataDir>/thumbs/<fileId>-<mtime>.jpg，mtime 变化自动失效（防串图）。
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { getDataDir } from '../config';
import { getDb, FileRow } from '../db';

const THUMB_WIDTH = 160;

/** 缓存目录 */
function thumbsDir(): string {
  const dir = path.join(getDataDir(), 'thumbs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * 获取（或生成）文件缩略图路径。
 * 仅图片类可生成；文件不存在 / 非图片 / 生成失败 → null（路由返回 404）。
 */
export async function ensureThumb(fileId: number): Promise<string | null> {
  const db = getDb();
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(fileId) as FileRow | undefined;
  if (!file) return null;
  if (file.category !== 'image') return null;
  if (file.missing) return null;

  const dir = thumbsDir();
  const cachePath = path.join(dir, `${file.id}-${file.mtime}.jpg`);
  if (fs.existsSync(cachePath) && fs.statSync(cachePath).size > 0) {
    return cachePath;
  }

  try {
    await sharp(file.path)
      .rotate() // 按 EXIF 方向摆正
      .resize({ width: THUMB_WIDTH, withoutEnlargement: false })
      .jpeg({ quality: 80 })
      .toFile(cachePath);
  } catch {
    // 损坏/不支持的图片
    try { fs.unlinkSync(cachePath); } catch { /* 忽略 */ }
    return null;
  }

  // 清理同 fileId 的旧版本缓存（mtime 已变化）
  try {
    const prefix = `${file.id}-`;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix) && f !== `${file.id}-${file.mtime}.jpg`) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  } catch {
    // 清理失败不影响返回
  }
  return cachePath;
}

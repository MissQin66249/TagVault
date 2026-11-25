-- TagVault 数据库结构（全部幂等，可重复执行）
-- 时间戳一律 epoch 毫秒。

-- 目录表（显式索引，路径归一化判重）
CREATE TABLE IF NOT EXISTS directories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  path            TEXT NOT NULL,             -- 原始路径（展示用）
  path_key        TEXT NOT NULL UNIQUE,      -- 归一化键：小写 + 正斜杠 + 去尾分隔符
  name            TEXT NOT NULL,
  last_scanned_at INTEGER,
  created_at      INTEGER NOT NULL
);

-- 文件表（只读用户文件，只存元数据）
CREATE TABLE IF NOT EXISTS files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  dir_id     INTEGER NOT NULL REFERENCES directories(id) ON DELETE CASCADE,
  path       TEXT NOT NULL UNIQUE,           -- 绝对路径
  name       TEXT NOT NULL,
  ext        TEXT,                           -- 小写扩展名（含点）
  category   TEXT NOT NULL,                  -- image/pdf/word/sheet/ppt/text/video/audio/archive/other
  size       INTEGER NOT NULL DEFAULT 0,
  mtime      INTEGER NOT NULL,               -- epoch ms，兼作缩略图内容版本号
  missing    INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_dir ON files(dir_id);
CREATE INDEX IF NOT EXISTS idx_files_cat ON files(category);

-- 标签类型表（sort_order 决定面板与打标下拉顺序）
CREATE TABLE IF NOT EXISTS tag_types (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL UNIQUE,     -- ≤30 字符，不含半角冒号
  input_mode       TEXT NOT NULL DEFAULT 'free' CHECK (input_mode IN ('enum','free')),
  sort_order       INTEGER NOT NULL DEFAULT 0,
  hidden_in_filter INTEGER NOT NULL DEFAULT 0,
  created_at       INTEGER NOT NULL
);

-- 字典值表（枚举下拉项；value ≤100 字符，后端强制）
CREATE TABLE IF NOT EXISTS tag_values (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  type_id    INTEGER NOT NULL REFERENCES tag_types(id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(type_id, value)
);

-- 标签表（file × type × value，幂等）
CREATE TABLE IF NOT EXISTS tags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id    INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  type_id    INTEGER NOT NULL REFERENCES tag_types(id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(file_id, type_id, value)
);
CREATE INDEX IF NOT EXISTS idx_tags_file ON tags(file_id);
CREATE INDEX IF NOT EXISTS idx_tags_type_value ON tags(type_id, value);

-- FTS5 全文索引（trigram tokenizer）。
-- 注：未使用 content=''（contentless），因为 contentless 表不支持 UPDATE/DELETE，
-- 而字典值改名/类型改名需要原地更新 FTS 行。普通 FTS5 表可正常增删改。
-- kind='file' → ref_id=file_id, tag_type_id=0；kind='tag' → ref_id=file_id, tag_type_id=类型id
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  text,
  kind,
  ref_id,
  tag_type_id,
  tokenize="trigram"
);

-- ============ files 触发器：文件名+路径进索引（kind='file'） ============
CREATE TRIGGER IF NOT EXISTS trg_files_ai AFTER INSERT ON files BEGIN
  INSERT INTO search_fts(text, kind, ref_id, tag_type_id)
  VALUES (new.name || ' ' || replace(new.path, '\', ' '), 'file', new.id, 0);
END;

CREATE TRIGGER IF NOT EXISTS trg_files_ad AFTER DELETE ON files BEGIN
  DELETE FROM search_fts WHERE kind='file' AND ref_id=old.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_files_au AFTER UPDATE OF name, path, mtime ON files BEGIN
  DELETE FROM search_fts WHERE kind='file' AND ref_id=old.id;
  INSERT INTO search_fts(text, kind, ref_id, tag_type_id)
  VALUES (new.name || ' ' || replace(new.path, '\', ' '), 'file', new.id, 0);
END;

-- ============ tags 触发器：类型名+值拼接进索引（kind='tag'，打标即搜） ============
CREATE TRIGGER IF NOT EXISTS trg_tags_ai AFTER INSERT ON tags BEGIN
  INSERT INTO search_fts(text, kind, ref_id, tag_type_id)
  VALUES ((SELECT name FROM tag_types WHERE id = new.type_id) || ' ' || new.value, 'tag', new.file_id, new.type_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_tags_ad AFTER DELETE ON tags BEGIN
  DELETE FROM search_fts WHERE kind='tag' AND ref_id=old.file_id AND tag_type_id=old.type_id;
END;

CREATE TRIGGER IF NOT EXISTS trg_tags_au AFTER UPDATE OF value, type_id ON tags BEGIN
  DELETE FROM search_fts WHERE kind='tag' AND ref_id=old.file_id AND tag_type_id=old.type_id;
  INSERT INTO search_fts(text, kind, ref_id, tag_type_id)
  VALUES ((SELECT name FROM tag_types WHERE id = new.type_id) || ' ' || new.value, 'tag', new.file_id, new.type_id);
END;

-- ============ tag_types 触发器：类型改名后原地同步 tag 类 FTS 行 ============
CREATE TRIGGER IF NOT EXISTS trg_tagtypes_name_au AFTER UPDATE OF name ON tag_types BEGIN
  UPDATE search_fts
  SET text = new.name || substr(text, length(old.name) + 1)
  WHERE kind='tag' AND tag_type_id=old.id;
END;

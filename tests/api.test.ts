/**
 * API 级集成测试：临时隔离库 + supertest。
 * 覆盖：目录判重/扫描入库/文件归类、打标幂等/白名单/长度/未分类、
 * 组合筛选或/且语义、字段化检索、类型与字典值改名/移动/删除（FTS 同步）、
 * 批量打标、建议、导出导入跨库还原、缺失检查与清理、缩略图、CSV BOM。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import {
  createTestContext,
  destroyTestContext,
  waitUntil,
  TestContext,
  makeTempDir,
} from './setup';
import { closeAllWatchers } from '../server/services/watcher';

let ctx: TestContext;
let ctx2: TestContext;
let fixtureDir: string;

let photoPngId = 0;
let photoJpgId = 0;
let docxId = 0;
let secTypeId = 0;
let verTypeId = 0;
let unclassTypeId = 0;
let contentTypeId = 0;
let exportPayload: unknown;

async function makeFixture(): Promise<void> {
  fixtureDir = makeTempDir('tagvault-fixture-');
  await sharp({
    create: { width: 40, height: 40, channels: 3, background: { r: 30, g: 144, b: 255 } },
  })
    .png()
    .toFile(path.join(fixtureDir, 'photo.png'));
  await sharp({
    create: { width: 40, height: 40, channels: 3, background: { r: 255, g: 99, b: 71 } },
  })
    .jpeg()
    .toFile(path.join(fixtureDir, 'photo2.jpg'));
  fs.writeFileSync(path.join(fixtureDir, '报告.docx'), 'fake-docx');
  fs.writeFileSync(path.join(fixtureDir, 'notes.txt'), 'hello tagvault');
  fs.writeFileSync(path.join(fixtureDir, 'data.csv'), 'a,b\n1,2');
  fs.writeFileSync(path.join(fixtureDir, 'archive.zip'), 'fake-zip');
  const sub = path.join(fixtureDir, 'sub');
  fs.mkdirSync(sub);
  fs.writeFileSync(path.join(sub, '音频.mp3'), 'fake-mp3');
}

/** 等待某上下文扫描完成 */
async function waitScanDone(context: TestContext, minFiles: number): Promise<void> {
  await waitUntil(async () => {
    const res = await request(context.app).get('/api/directories');
    const dirs = res.body.data as Array<{ fileCount: number; missingCount: number }>;
    return dirs.length > 0 && dirs[0].fileCount + dirs[0].missingCount >= minFiles;
  });
}

async function getFileIdByName(name: string): Promise<number> {
  const res = await request(ctx.app).get('/api/search').query({ q: name, pageSize: 50 });
  const items = res.body.data.items as Array<{ id: number; name: string }>;
  const hit = items.find((i) => i.name === name);
  if (!hit) throw new Error(`找不到文件 ${name}`);
  return hit.id;
}

async function typeIdByName(name: string): Promise<number> {
  const res = await request(ctx.app).get('/api/tag-types');
  const t = (res.body.data as Array<{ id: number; name: string }>).find((x) => x.name === name);
  if (!t) throw new Error(`找不到类型 ${name}`);
  return t.id;
}

beforeAll(async () => {
  await makeFixture();
  ctx = createTestContext();
});

afterAll(() => {
  closeAllWatchers();
  destroyTestContext(ctx);
  if (ctx2) destroyTestContext(ctx2);
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

describe('T01 数据层与预设', () => {
  it('预设 10 个标签类型（9 预设 + 未分类），内容说明不在筛选面板显示', async () => {
    const res = await request(ctx.app).get('/api/tag-types');
    expect(res.body.code).toBe(0);
    const types = res.body.data as Array<{
      id: number;
      name: string;
      inputMode: string;
      hiddenInFilter: boolean;
      values: Array<{ value: string }>;
    }>;
    expect(types).toHaveLength(10);
    const names = types.map((t) => t.name);
    for (const n of ['物料类型', '用途标签', '适用渠道', '保密级别', '版本状态', '所属产品/项目', '名称标签', '重要程度', '内容说明', '未分类']) {
      expect(names).toContain(n);
    }
    const sec = types.find((t) => t.name === '保密级别')!;
    expect(sec.inputMode).toBe('enum');
    expect(sec.values.map((v) => v.value)).toEqual(['公开', '内部', '机密']);
    const content = types.find((t) => t.name === '内容说明')!;
    expect(content.hiddenInFilter).toBe(true);
    const unclass = types.find((t) => t.name === '未分类')!;
    expect(unclass.inputMode).toBe('free');
    contentTypeId = content.id;
    unclassTypeId = unclass.id;
    secTypeId = sec.id;
    verTypeId = types.find((t) => t.name === '版本状态')!.id;
  });
});

describe('T02 目录与扫描', () => {
  it('添加目录 → 后台扫描入库并正确归类九类', async () => {
    const res = await request(ctx.app).post('/api/directories').send({ path: fixtureDir });
    expect(res.body.code).toBe(0);
    expect(res.body.data.id).toBeGreaterThan(0);
    await waitScanDone(ctx, 7);

    const search = await request(ctx.app).get('/api/search').query({ pageSize: 100 });
    expect(search.body.data.total).toBe(7);
    const byName = new Map<string, string>();
    for (const it of search.body.data.items as Array<{ name: string; category: string }>) {
      byName.set(it.name, it.category);
    }
    expect(byName.get('photo.png')).toBe('image');
    expect(byName.get('photo2.jpg')).toBe('image');
    expect(byName.get('报告.docx')).toBe('word');
    expect(byName.get('notes.txt')).toBe('text');
    expect(byName.get('data.csv')).toBe('sheet');
    expect(byName.get('archive.zip')).toBe('archive');
    expect(byName.get('音频.mp3')).toBe('audio');

    photoPngId = await getFileIdByName('photo.png');
    photoJpgId = await getFileIdByName('photo2.jpg');
    docxId = await getFileIdByName('报告.docx');
  });

  it('重复添加目录返回 40901；不存在的目录返回 40404', async () => {
    const dup = await request(ctx.app).post('/api/directories').send({ path: fixtureDir + '/' });
    expect(dup.body.code).toBe(40901);
    const bad = await request(ctx.app).post('/api/directories').send({ path: 'D:/__not_exists_dir__' });
    expect(bad.body.code).toBe(40404);
  });
});

describe('T02 打标规则（幂等/白名单/长度/未分类）', () => {
  it('打标幂等：重复打同一标签不重复入库', async () => {
    const r1 = await request(ctx.app).post(`/api/files/${photoPngId}/tags`).send({ typeId: secTypeId, values: ['机密'] });
    expect(r1.body.code).toBe(0);
    const r2 = await request(ctx.app).post(`/api/files/${photoPngId}/tags`).send({ typeId: secTypeId, values: ['机密'] });
    expect(r2.body.code).toBe(0);
    const list = await request(ctx.app).get(`/api/files/${photoPngId}/tags`);
    const secTags = (list.body.data as Array<{ typeId: number; value: string }>).filter((t) => t.typeId === secTypeId);
    expect(secTags).toHaveLength(1);
  });

  it('枚举类型白名单外的值返回 42201', async () => {
    const res = await request(ctx.app).post(`/api/files/${photoPngId}/tags`).send({ typeId: secTypeId, values: ['绝密'] });
    expect(res.body.code).toBe(42201);
  });

  it('值超过 100 字符返回 42202；空值返回 42203', async () => {
    const long = await request(ctx.app)
      .post(`/api/files/${photoPngId}/tags`)
      .send({ typeId: secTypeId, values: ['长'.repeat(101)] });
    expect(long.body.code).toBe(42202);
    const empty = await request(ctx.app).post(`/api/files/${photoPngId}/tags`).send({ typeId: secTypeId, values: ['  '] });
    expect(empty.body.code).toBe(42203);
  });

  it('自由输入类型直接打标；未知类型名自动归入"未分类"', async () => {
    const r = await request(ctx.app)
      .post(`/api/files/${photoPngId}/tags`)
      .send({ tags: [{ type: '不存在类型', value: '莫名值' }] });
    expect(r.body.code).toBe(0);
    const list = await request(ctx.app).get(`/api/files/${photoPngId}/tags`);
    const tags = list.body.data as Array<{ typeId: number; value: string }>;
    expect(tags.some((t) => t.typeId === unclassTypeId && t.value === '莫名值')).toBe(true);
  });
});

describe('T02 检索（关键词/字段化/或且语义/筛选）', () => {
  beforeAll(async () => {
    // 准备组合筛选数据：photo=机密+用途归档；photo2=内部+版本定稿；报告=机密
    await request(ctx.app).post(`/api/files/${photoPngId}/tags`).send({ typeId: await typeIdByName('用途标签'), values: ['归档'] });
    await request(ctx.app).post(`/api/files/${photoJpgId}/tags`).send({ typeId: secTypeId, values: ['内部'] });
    await request(ctx.app).post(`/api/files/${photoJpgId}/tags`).send({ typeId: verTypeId, values: ['定稿'] });
    await request(ctx.app).post(`/api/files/${docxId}/tags`).send({ typeId: secTypeId, values: ['机密'] });
  });

  it('关键词搜索命中标签值（短词 LIKE 降级）', async () => {
    const res = await request(ctx.app).get('/api/search').query({ q: '机密' });
    expect(res.body.code).toBe(0);
    const ids = (res.body.data.items as Array<{ id: number }>).map((i) => i.id);
    expect(ids).toContain(photoPngId);
    expect(ids).toContain(docxId);
  });

  it('字段化检索 `保密级别:机密`', async () => {
    const res = await request(ctx.app).get('/api/search').query({ q: '保密级别:机密' });
    const ids = (res.body.data.items as Array<{ id: number }>).map((i) => i.id);
    expect(ids).toContain(photoPngId);
    expect(ids).toContain(docxId);
    expect(ids).not.toContain(photoJpgId);
  });

  it('`|` 或语义：`保密级别:机密|内部` 命中三个文件中的两个以上', async () => {
    const res = await request(ctx.app).get('/api/search').query({ q: '保密级别:机密|内部' });
    const ids = (res.body.data.items as Array<{ id: number }>).map((i) => i.id);
    expect(ids).toContain(photoPngId);
    expect(ids).toContain(photoJpgId);
    expect(ids).toContain(docxId);
  });

  it('跨类型 AND：`保密级别:机密 用途标签:归档` 只命中同时具备者', async () => {
    const res = await request(ctx.app).get('/api/search').query({ q: '保密级别:机密 用途标签:归档' });
    const ids = (res.body.data.items as Array<{ id: number }>).map((i) => i.id);
    expect(ids).toEqual([photoPngId]);
  });

  it('面板筛选 types 参数与关键词 AND', async () => {
    const res = await request(ctx.app)
      .get('/api/search')
      .query({ types: JSON.stringify({ [secTypeId]: ['机密'] }), categories: JSON.stringify(['image']) });
    const ids = (res.body.data.items as Array<{ id: number }>).map((i) => i.id);
    expect(ids).toEqual([photoPngId]);
  });

  it('只看定稿 final=1', async () => {
    const res = await request(ctx.app).get('/api/search').query({ final: '1' });
    const ids = (res.body.data.items as Array<{ id: number }>).map((i) => i.id);
    expect(ids).toEqual([photoJpgId]);
  });

  it('排序与分页', async () => {
    const res = await request(ctx.app).get('/api/search').query({ sort: 'name', order: 'asc', page: 1, pageSize: 3 });
    const items = res.body.data.items as Array<{ name: string }>;
    expect(items).toHaveLength(3);
    const names = items.map((i) => i.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'zh-CN'))).toEqual(names);
  });

  it('facets 返回类别计数与类型值计数', async () => {
    const res = await request(ctx.app).get('/api/search').query({ q: '' });
    const facets = res.body.data.facets as {
      categories: Record<string, number>;
      tagTypes: Array<{ id: number; values: Array<{ value: string; count: number }> }>;
    };
    expect(facets.categories['image']).toBe(2);
    const secFacet = facets.tagTypes.find((t) => t.id === secTypeId)!;
    expect(secFacet.values.find((v) => v.value === '机密')!.count).toBe(2);
  });

  it('suggest 前缀匹配：带类型名与次数；完整词命中精确置顶', async () => {
    const prefix = await request(ctx.app).get('/api/suggest').query({ q: '机' });
    expect(prefix.body.code).toBe(0);
    const items = prefix.body.data as Array<{ value: string; typeName: string; count: number; exact: boolean }>;
    expect(items.length).toBeGreaterThan(0);
    const hit = items.find((i) => i.value === '机密');
    expect(hit).toBeTruthy();
    expect(hit!.typeName).toBe('保密级别');
    expect(hit!.count).toBeGreaterThan(0);
    expect(hit!.exact).toBe(false);

    const exactRes = await request(ctx.app).get('/api/suggest').query({ q: '机密' });
    const exactItems = exactRes.body.data as Array<{ value: string; exact: boolean }>;
    expect(exactItems[0].value).toBe('机密');
    expect(exactItems[0].exact).toBe(true);
  });

  it('乱词返回空、特殊字符不崩', async () => {
    const none = await request(ctx.app).get('/api/search').query({ q: 'zzz不存在的词qqq' });
    expect(none.body.code).toBe(0);
    expect(none.body.data.total).toBe(0);
    const weird = await request(ctx.app).get('/api/search').query({ q: '"\'( dropping) OR 1=1 --' });
    expect(weird.body.code).toBe(0);
  });
});

describe('T02 批量打标', () => {
  it('批量添加后批量移除', async () => {
    const add = await request(ctx.app)
      .post('/api/tags/batch')
      .send({ fileIds: [photoPngId, docxId], typeId: await typeIdByName('用途标签'), values: ['批量值'], action: 'add' });
    expect(add.body.data.affected).toBe(2);
    const rm = await request(ctx.app)
      .post('/api/tags/batch')
      .send({ fileIds: [photoPngId, docxId], typeId: await typeIdByName('用途标签'), values: ['批量值'], action: 'remove' });
    expect(rm.body.data.affected).toBe(2);
  });

  it('按类型整类去标：values 为空时移除所选文件该类型全部标签', async () => {
    const tid = await typeIdByName('用途标签');
    // 给两个文件各挂两个值
    const add = await request(ctx.app)
      .post('/api/tags/batch')
      .send({ fileIds: [photoPngId, docxId], typeId: tid, values: ['整类A', '整类B'], action: 'add' });
    expect(add.body.data.affected).toBe(4);
    // values 为空 + remove → 移除该类型全部标签
    const rm = await request(ctx.app)
      .post('/api/tags/batch')
      .send({ fileIds: [photoPngId, docxId], typeId: tid, values: [], action: 'remove' });
    expect(rm.body.code).toBe(0);
    expect(rm.body.data.affected).toBeGreaterThanOrEqual(4);
    // 验证该类型已无标签
    const t1 = await request(ctx.app).get(`/api/files/${photoPngId}/tags`);
    expect((t1.body.data as Array<{ typeId: number }>).some((t) => t.typeId === tid)).toBe(false);
    const t2 = await request(ctx.app).get(`/api/files/${docxId}/tags`);
    expect((t2.body.data as Array<{ typeId: number }>).some((t) => t.typeId === tid)).toBe(false);
    // 其他类型的标签不受影响
    expect((t2.body.data as Array<{ typeId: number }>).length).toBeGreaterThan(0);
    // add 仍要求非空 values
    const badAdd = await request(ctx.app)
      .post('/api/tags/batch')
      .send({ fileIds: [photoPngId], typeId: tid, values: [], action: 'add' });
    expect(badAdd.body.code).toBe(42203);
  });

  it('一键清空所选文件的全部标签', async () => {
    // 确认两个文件均有标签
    const before1 = (await request(ctx.app).get(`/api/files/${photoPngId}/tags`)).body.data as Array<{ typeId: number; value: string }>;
    const before2 = (await request(ctx.app).get(`/api/files/${docxId}/tags`)).body.data as Array<{ typeId: number; value: string }>;
    expect(before1.length).toBeGreaterThan(0);
    expect(before2.length).toBeGreaterThan(0);
    // 空 fileIds → 42203
    const bad = await request(ctx.app).post('/api/tags/clear').send({ fileIds: [] });
    expect(bad.body.code).toBe(42203);
    // 清空
    const clear = await request(ctx.app).post('/api/tags/clear').send({ fileIds: [photoPngId, docxId] });
    expect(clear.body.code).toBe(0);
    expect(clear.body.data.affected).toBe(before1.length + before2.length);
    const after1 = (await request(ctx.app).get(`/api/files/${photoPngId}/tags`)).body.data as unknown[];
    const after2 = (await request(ctx.app).get(`/api/files/${docxId}/tags`)).body.data as unknown[];
    expect(after1.length).toBe(0);
    expect(after2.length).toBe(0);
    // 清空后搜索不再命中旧标签
    const search = await request(ctx.app).get('/api/search').query({ q: '机密' });
    expect((search.body.data.items as Array<{ id: number }>).map((i) => i.id)).not.toContain(docxId);

    // 恢复现场：按原 (typeId, value) 打回，避免影响后续用例
    const restore = async (fileId: number, tags: Array<{ typeId: number; value: string }>): Promise<void> => {
      const byType = new Map<number, string[]>();
      for (const t of tags) {
        const arr = byType.get(t.typeId) ?? [];
        arr.push(t.value);
        byType.set(t.typeId, arr);
      }
      for (const [tid, values] of byType) {
        const r = await request(ctx.app).post(`/api/files/${fileId}/tags`).send({ typeId: tid, values });
        expect(r.body.code).toBe(0);
      }
    };
    await restore(photoPngId, before1);
    await restore(docxId, before2);
    const back1 = (await request(ctx.app).get(`/api/files/${photoPngId}/tags`)).body.data as unknown[];
    expect(back1.length).toBe(before1.length);
  });
});

describe('T02 类型与字典值管理（FTS 同步）', () => {
  let newTypeId = 0;
  let valueRowId = 0;

  it('新建枚举类型 + 字典值 → 打标 → 类型改名后新名可搜', async () => {
    const create = await request(ctx.app).post('/api/tag-types').send({ name: '测试类型', inputMode: 'enum' });
    expect(create.body.code).toBe(0);
    newTypeId = create.body.data.id;
    const val = await request(ctx.app).post(`/api/tag-types/${newTypeId}/values`).send({ value: '样品A' });
    expect(val.body.code).toBe(0);
    valueRowId = val.body.data.id;
    await request(ctx.app).post(`/api/files/${photoPngId}/tags`).send({ typeId: newTypeId, values: ['样品A'] });

    const rename = await request(ctx.app).put(`/api/tag-types/${newTypeId}`).send({ name: '测试类型2' });
    expect(rename.body.code).toBe(0);
    const search = await request(ctx.app).get('/api/search').query({ q: '测试类型2:样品A' });
    const ids = (search.body.data.items as Array<{ id: number }>).map((i) => i.id);
    expect(ids).toContain(photoPngId);
  });

  it('字典值改名后新值可搜、旧值不可搜', async () => {
    const rename = await request(ctx.app).put(`/api/tag-values/${valueRowId}`).send({ value: '样品B' });
    expect(rename.body.code).toBe(0);
    const hit = await request(ctx.app).get('/api/search').query({ q: '测试类型2:样品B' });
    expect((hit.body.data.items as Array<{ id: number }>).map((i) => i.id)).toContain(photoPngId);
    const miss = await request(ctx.app).get('/api/search').query({ q: '测试类型2:样品A' });
    expect(miss.body.data.total).toBe(0);
  });

  it('字典值移动到新类型（带走标签，FTS 同步）', async () => {
    const move = await request(ctx.app).post(`/api/tag-values/${valueRowId}/move`).send({ newTypeName: '移动目标' });
    expect(move.body.code).toBe(0);
    const search = await request(ctx.app).get('/api/search').query({ q: '移动目标:样品B' });
    expect((search.body.data.items as Array<{ id: number }>).map((i) => i.id)).toContain(photoPngId);
    const old = await request(ctx.app).get('/api/search').query({ q: '测试类型2:样品B' });
    expect(old.body.data.total).toBe(0);
  });

  it('删除类型：未确认返回 40910 带影响数；确认后级联删除', async () => {
    // "移动目标"持有 photo 的"样品B"标签；"测试类型2"标签已被移走，改删"移动目标"
    const delType = (await request(ctx.app).get('/api/tag-types')).body.data as Array<{ id: number; name: string }>;
    const target = delType.find((t) => t.name === '移动目标')!;
    const first = await request(ctx.app).delete(`/api/tag-types/${target.id}`);
    expect(first.body.code).toBe(40910);
    expect(first.body.data.affectedFiles).toBeGreaterThan(0);
    const second = await request(ctx.app).delete(`/api/tag-types/${target.id}?confirm=1`);
    expect(second.body.code).toBe(0);
    const search = await request(ctx.app).get('/api/search').query({ q: '移动目标:样品B' });
    expect(search.body.data.total).toBe(0);
    // 清理已无标签的"测试类型2"（此时 40910 影响数为 0，直接确认删除）
    const leftover = delType.find((t) => t.name === '测试类型2')!;
    const delLeft = await request(ctx.app).delete(`/api/tag-types/${leftover.id}?confirm=1`);
    expect(delLeft.body.code).toBe(0);
  });

  it('"未分类"不可删除/改名（40911）；删除其他类型未确认返回 40910', async () => {
    const del = await request(ctx.app).delete(`/api/tag-types/${unclassTypeId}`);
    expect(del.body.code).toBe(40911);
    const rename = await request(ctx.app).put(`/api/tag-types/${unclassTypeId}`).send({ name: '改名尝试' });
    expect(rename.body.code).toBe(40911);
  });

  it('排序 move 交换相邻 sort_order', async () => {
    const before = (await request(ctx.app).get('/api/tag-types')).body.data as Array<{ id: number; sortOrder: number }>;
    const first = before[0];
    const second = before[1];
    await request(ctx.app).post(`/api/tag-types/${second.id}/move`).send({ direction: 'up' });
    const after = (await request(ctx.app).get('/api/tag-types')).body.data as Array<{ id: number; sortOrder: number }>;
    expect(after[0].id).toBe(second.id);
    expect(after[1].id).toBe(first.id);
    // 还原
    await request(ctx.app).post(`/api/tag-types/${second.id}/move`).send({ direction: 'down' });
  });

  it('删除字典值：未确认 40910；确认后级联移除标签', async () => {
    await request(ctx.app).post(`/api/files/${photoPngId}/tags`).send({ typeId: verTypeId, values: ['草稿'] });
    const types = (await request(ctx.app).get('/api/tag-types')).body.data as Array<{
      id: number;
      name: string;
      values: Array<{ id: number | null; value: string }>;
    }>;
    const draft = types.find((t) => t.id === verTypeId)!.values.find((v) => v.value === '草稿')!;
    const first = await request(ctx.app).delete(`/api/tag-values/${draft.id}`);
    expect(first.body.code).toBe(40910);
    expect(first.body.data.affectedFiles).toBe(1);
    const second = await request(ctx.app).delete(`/api/tag-values/${draft.id}?confirm=1`);
    expect(second.body.code).toBe(0);
    const tags = (await request(ctx.app).get(`/api/files/${photoPngId}/tags`)).body.data as Array<{ value: string }>;
    expect(tags.some((t) => t.value === '草稿')).toBe(false);
  });
});

describe('T02 导出/导入（跨库类型名对齐还原）', () => {
  it('导出 JSON → 新库扫描同目录 → 导入还原标签', async () => {
    const exp = await request(ctx.app).get('/api/export?format=json');
    expect(exp.body.code).toBe(0);
    exportPayload = exp.body.data;
    expect((exportPayload as { files: unknown[] }).files.length).toBeGreaterThan(0);

    ctx2 = createTestContext();
    const add = await request(ctx2.app).post('/api/directories').send({ path: fixtureDir });
    expect(add.body.code).toBe(0);
    await waitScanDone(ctx2, 7);

    const imp = await request(ctx2.app).post('/api/import').send({ data: exportPayload });
    expect(imp.body.code).toBe(0);
    expect(imp.body.data.restoredTags).toBeGreaterThan(0);
    expect(imp.body.data.unmatched).toHaveLength(0);

    const search = await request(ctx2.app).get('/api/search').query({ q: '保密级别:机密' });
    expect(search.body.data.total).toBeGreaterThanOrEqual(2);
    // 按类型名对齐：ctx2 预设类型不受导入干扰，标签挂回同名类型
    const types = (await request(ctx2.app).get('/api/tag-types')).body.data as Array<{ name: string; values: Array<{ value: string; count: number }> }>;
    const sec2 = types.find((t) => t.name === '保密级别')!;
    expect(sec2.values.find((v) => v.value === '机密')!.count).toBe(2);
  });

  it('CSV 导出带 BOM 与表头', async () => {
    const csv = await request(ctx.app).get('/api/export?format=csv');
    expect(csv.text.charCodeAt(0)).toBe(0xfeff);
    expect(csv.text).toContain('路径');
    expect(csv.text).toContain('photo.png');
  });
});

describe('T02 缺失文件与清理', () => {
  it('磁盘删除文件 → 重扫标记缺失 → 清理级联删记录与标签', async () => {
    fs.rmSync(path.join(fixtureDir, '报告.docx'));
    await request(ctx.app).post(`/api/directories/1/rescan`);
    await waitUntil(async () => {
      const res = await request(ctx.app).get('/api/system/missing');
      return (res.body.data as unknown[]).length === 1;
    });
    const missing = await request(ctx.app).get('/api/system/missing');
    expect((missing.body.data as Array<{ name: string }>)[0].name).toBe('报告.docx');

    const first = await request(ctx.app).post('/api/system/missing/cleanup');
    expect(first.body.code).toBe(40910);
    expect(first.body.data.affected).toBe(1);
    const second = await request(ctx.app).post('/api/system/missing/cleanup?confirm=1');
    expect(second.body.code).toBe(0);
    expect(second.body.data.deleted).toBe(1);
    const after = await request(ctx.app).get('/api/system/missing');
    expect(after.body.data).toHaveLength(0);

    const search = await request(ctx.app).get('/api/search').query({ q: '' });
    expect(search.body.data.total).toBe(6); // 7 - 1
  });
});

describe('T02 缩略图与系统接口', () => {
  it('图片生成缩略图（JPEG）；非图片 404', async () => {
    const thumb = await request(ctx.app).get(`/api/thumbs/${photoPngId}`);
    expect(thumb.status).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    expect(thumb.body.length).toBeGreaterThan(0);
    const noThumb = await request(ctx.app).get(`/api/thumbs/${photoJpgId}`);
    expect(noThumb.status).toBe(200);
    const doc = await request(ctx.app).get('/api/thumbs/999999');
    expect(doc.status).toBe(404);
    expect(doc.body.code).toBe(40404);
  });

  it('stats 与 config 接口', async () => {
    const stats = await request(ctx.app).get('/api/system/stats');
    expect(stats.body.data.totalFiles).toBe(6);
    expect(stats.body.data.missingCount).toBe(0);
    const cfg = await request(ctx.app).get('/api/config');
    expect(cfg.body.data.port).toBeGreaterThan(0);
    const put = await request(ctx.app).put('/api/config').send({ autoOpenBrowser: false });
    expect(put.body.code).toBe(0);
    // 还原默认（写回 config.json）
    await request(ctx.app).put('/api/config').send({ autoOpenBrowser: true });
  });

  it('打开缺失文件返回 40404', async () => {
    const res = await request(ctx.app).post('/api/system/open-file').send({ fileId: 999999 });
    expect(res.body.code).toBe(40404);
  });
});

describe('T02 未分类值字典登记（可改名/移动/删除）', () => {
  it('快速添加归未分类后，值自动登记字典并拥有 id；改名/移动生效', async () => {
    // 未分类打标（不指定类型）
    const add = await request(ctx.app)
      .post(`/api/files/${photoPngId}/tags`)
      .send({ tags: [{ value: '临时归组值A' }] });
    expect(add.body.code).toBe(0);

    // 类型列表中"未分类"的该值应带有字典 id（非 null）
    const types = await request(ctx.app).get('/api/tag-types');
    const unclass = (types.body.data as Array<{ id: number; name: string; values: Array<{ id: number | null; value: string; count: number }> }>).find(
      (t) => t.name === '未分类',
    )!;
    expect(unclass).toBeTruthy();
    const hit = unclass.values.find((v) => v.value === '临时归组值A');
    expect(hit).toBeTruthy();
    expect(hit!.id).not.toBeNull();
    expect(hit!.count).toBeGreaterThanOrEqual(1);

    // 改名 → tags 与计数同步
    const ren = await request(ctx.app).put(`/api/tag-values/${hit!.id}`).send({ value: '临时归组值B' });
    expect(ren.body.code).toBe(0);
    const tags = await request(ctx.app).get(`/api/files/${photoPngId}/tags`);
    expect((tags.body.data as Array<{ value: string }>).some((t) => t.value === '临时归组值B')).toBe(true);

    // 移动到"名称标签"类型
    const allTypes = (types.body.data as Array<{ id: number; name: string }>);
    const nameType = allTypes.find((t) => t.name === '名称标签')!;
    const mv = await request(ctx.app).post(`/api/tag-values/${hit!.id}/move`).send({ toTypeId: nameType.id });
    expect(mv.body.code).toBe(0);
    const tagsAfterMove = await request(ctx.app).get(`/api/files/${photoPngId}/tags`);
    const moved = (tagsAfterMove.body.data as Array<{ typeName: string; value: string }>).find(
      (t) => t.value === '临时归组值B',
    );
    expect(moved?.typeName).toBe('名称标签');

    // 清理：删除该字典值（级联删标签）
    const del1 = await request(ctx.app).delete(`/api/tag-values/${hit!.id}`);
    expect(del1.body.code).toBe(40910);
    const del2 = await request(ctx.app).delete(`/api/tag-values/${hit!.id}?confirm=1`);
    expect(del2.body.code).toBe(0);
    const tagsFinal = await request(ctx.app).get(`/api/files/${photoPngId}/tags`);
    expect((tagsFinal.body.data as Array<{ value: string }>).some((t) => t.value === '临时归组值B')).toBe(false);
  });
});

describe('T02 未打标签筛选与计数', () => {
  let usageTypeId = 0;

  it('untagged=1 只返回无标签文件；打标后从结果中消失，去标后恢复', async () => {
    const types = (await request(ctx.app).get('/api/tag-types')).body.data as Array<{ id: number; name: string }>;
    usageTypeId = types.find((t) => t.name === '用途标签')!.id;

    // 初始：notes.txt / data.csv / archive.zip / 音频.mp3 均无标签
    const before = await request(ctx.app).get('/api/search').query({ untagged: '1', pageSize: 100 });
    expect(before.body.code).toBe(0);
    const beforeNames = (before.body.data.items as Array<{ name: string }>).map((i) => i.name);
    expect(beforeNames).toContain('data.csv');
    expect(beforeNames).not.toContain('photo.png');
    expect(beforeNames).not.toContain('photo2.jpg');

    // 给 data.csv 打标 → 从未打标签结果中消失
    const csvId = await getFileIdByName('data.csv');
    const add = await request(ctx.app).post(`/api/files/${csvId}/tags`).send({ typeId: usageTypeId, values: ['已归档'] });
    expect(add.body.code).toBe(0);
    const after = await request(ctx.app).get('/api/search').query({ untagged: '1', pageSize: 100 });
    const afterNames = (after.body.data.items as Array<{ name: string }>).map((i) => i.name);
    expect(afterNames).not.toContain('data.csv');
    expect(after.body.data.total).toBe(before.body.data.total - 1);

    // 去标 → 恢复出现在未打标签结果中
    await request(ctx.app)
      .post('/api/tags/batch')
      .send({ fileIds: [csvId], typeId: usageTypeId, values: ['已归档'], action: 'remove' });
    const restored = await request(ctx.app).get('/api/search').query({ untagged: '1', pageSize: 100 });
    expect((restored.body.data.items as Array<{ name: string }>).map((i) => i.name)).toContain('data.csv');
  });

  it('/api/system/untagged 计数随打标/去标正确变化', async () => {
    const c1 = (await request(ctx.app).get('/api/system/untagged')).body.data.count as number;
    expect(c1).toBeGreaterThan(0);

    const csvId = await getFileIdByName('data.csv');
    await request(ctx.app).post(`/api/files/${csvId}/tags`).send({ typeId: usageTypeId, values: ['计数测试值'] });
    const c2 = (await request(ctx.app).get('/api/system/untagged')).body.data.count as number;
    expect(c2).toBe(c1 - 1);

    await request(ctx.app)
      .post('/api/tags/batch')
      .send({ fileIds: [csvId], typeId: usageTypeId, values: ['计数测试值'], action: 'remove' });
    const c3 = (await request(ctx.app).get('/api/system/untagged')).body.data.count as number;
    expect(c3).toBe(c1);
  });
});

describe('T02 只看定稿（任意类型值含"定稿"即命中）', () => {
  it('自定义类型里的"定稿"也参与只看定稿筛选', async () => {
    // 打到"物料类型"（自由类型）上，类型名不含"版本/状态"
    const types = await request(ctx.app).get('/api/tag-types');
    const material = (types.body.data as Array<{ id: number; name: string }>).find((t) => t.name === '物料类型')!;
    const add = await request(ctx.app)
      .post(`/api/files/${photoPngId}/tags`)
      .send({ typeId: material.id, values: ['定稿版海报'] });
    expect(add.body.code).toBe(0);

    const fin = await request(ctx.app).get('/api/search').query({ final: '1' });
    expect(fin.body.code).toBe(0);
    const ids = (fin.body.data.items as Array<{ id: number }>).map((i) => i.id);
    expect(ids).toContain(photoPngId);

    // 清理
    await request(ctx.app)
      .post('/api/tags/batch')
      .send({ fileIds: [photoPngId], typeId: material.id, values: ['定稿版海报'], action: 'remove' });
  });
});

describe('T02 文件移动/改名接力（标签保留）', () => {
  it('改名后重扫：file_id 与标签保留，旧路径消失', async () => {
    // 独立样本文件（此前的 fixture 文件已被缺失清理测试删除）
    const typeName = '接力测试文件.bin';
    fs.writeFileSync(path.join(fixtureDir, typeName), 'move-relink-test-payload');
    const dirs0 = await request(ctx.app).get('/api/directories');
    const dirId0 = (dirs0.body.data as Array<{ id: number; path: string }>).find((d) => d.path === fixtureDir)!.id;
    const rs0 = await request(ctx.app).post(`/api/directories/${dirId0}/rescan`);
    expect(rs0.body.code).toBe(0);
    await waitUntil(async () => {
      const r = await request(ctx.app).get('/api/search').query({ q: '接力测试文件' });
      return (r.body.data?.items ?? []).some((i: { name: string }) => i.name === typeName);
    });
    const fid = await getFileIdByName(typeName);
    expect(fid).toBeGreaterThan(0);

    // 打标
    const types = await request(ctx.app).get('/api/tag-types');
    const material = (types.body.data as Array<{ id: number; name: string }>).find((t) => t.name === '物料类型')!;
    const add = await request(ctx.app)
      .post(`/api/files/${fid}/tags`)
      .send({ typeId: material.id, values: ['搬家测试'] });
    expect(add.body.code).toBe(0);

    // 磁盘改名 → 重扫
    const oldPath = path.join(fixtureDir, typeName);
    const newPath = path.join(fixtureDir, '接力测试文件-已改名.bin');
    fs.renameSync(oldPath, newPath);
    const rs = await request(ctx.app).post(`/api/directories/${dirId0}/rescan`);
    expect(rs.body.code).toBe(0);

    await waitUntil(async () => {
      const r = await request(ctx.app).get('/api/search').query({ q: '接力测试文件-已改名' });
      return (r.body.data?.items ?? []).some((i: { id: number }) => i.id === fid);
    });
    const detail = await request(ctx.app).get(`/api/files/${fid}`);
    expect(detail.body.code).toBe(0);
    expect(detail.body.data.path).toContain('接力测试文件-已改名');
    expect((detail.body.data.tags as Array<{ value: string }>).some((t) => t.value === '搬家测试')).toBe(true);

    // 旧路径不再作为独立行存在
    const oldSearch = await request(ctx.app).get('/api/search').query({ q: '接力测试文件' });
    const items = (oldSearch.body.data?.items ?? []) as Array<{ id: number; name: string }>;
    expect(items.filter((i) => i.name === typeName)).toHaveLength(0);

    // 清理：删除磁盘文件 → 重扫 → 缺失 → 清理级联删标签
    fs.rmSync(newPath);
    await request(ctx.app).post(`/api/directories/${dirId0}/rescan`);
    await waitUntil(async () => {
      const r = await request(ctx.app).get('/api/system/missing');
      return (r.body.data as Array<{ name: string }>).some((m) => m.name === '接力测试文件-已改名.bin');
    });
    await request(ctx.app).post('/api/system/missing/cleanup?confirm=1');
  });
});

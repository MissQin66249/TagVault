# 标签管家（TagVault）

> 完全离线的本地文件/图片标签检索工具：给电脑里的文件打多维标签，像 Everything 一样「输入即搜」——文件本体一根毫毛都不动。
> 纯AI开发~有bug鄙人只能力压AI

[![Tests](https://img.shields.io/badge/tests-49%2F49-brightgreen)](#开发) [![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)]() [![Offline](https://img.shields.io/badge/network-fully%20offline-red)]()

## 这是什么

一个本地运行的文件/图片标签检索工具（Windows）：

- **不打乱现状**：不复制、不搬移、不改名，只读文件元数据，标签存在工具自己的单文件 SQLite 数据库里，整个文件夹拷走数据一起带走
- **标签是资产**：二维「类型 + 值」标签体系，类型/值完全自定义，支持字典值改名/移动/删除（自动同步标签与全文索引），可导出 JSON/CSV 备份
- **快**：万级文件输入即搜（FTS5 trigram，实测中位 8ms）；组合筛选语义清晰（同类型=或，跨类型=且）
- **零依赖**：完全离线、无账号、无遥测

## 核心功能

- 🔍 **输入即搜** + 字段化检索语法 `保密级别:机密`（空格=且、`|`=或）、类别/标签 facet 筛选、只看定稿、未打标签筛选
- 🏷 **三种打标方式**：右侧详情面板（联想建议）、顶部批量工具条（**不选类型直接回车打标**，自动归「未分类」）、多选批量模式（操作作用于全部所选文件，标签并集 + 部分徽标）
- 🗑 **批量去标**：填值去指定值 / 不填值整类去标 / 一键清空所选文件全部标签
- 📡 **自动更新**：已索引目录实时监听（约 1 秒入库）+ 启动回扫补录 + 🔔 未打标签提醒徽标
- 🔁 **移动追踪**：文件改名/移动/跨目录挪动，标签不丢（接力机制）；移出标记缺失、移回自动恢复
- 🖼 表格/缩略图双视图、右键打开/定位/复制路径、JSON/CSV 导入导出、标签类型管理（改名/移动/删除全同步）

详见 **[docs/用户手册.md](docs/用户手册.md)**（怎么用）与 **[docs/开发文档.md](docs/开发文档.md)**（怎么实现的）。

## 快速开始

### 方式一：便携版（推荐普通用户）

1. 到 [Releases](../../releases) 下载 `TagVault-便携版.zip`
2. 解压到任意目录，双击 **「启动标签管家-静默.vbs」**——浏览器自动打开 `http://localhost:48765`
3. 设置 → 索引目录 → 添加你要管理的文件夹，开始打标签

免安装（内置 Node 运行时），数据在 `app/data/tagvault.db`，备份=拷这个目录。

### 方式二：源码运行（开发者）

```bash
git clone https://github.com/<你的用户名>/TagVault.git
cd TagVault
npm install
npm test          # 49 个测试全绿
npm start         # 构建并启动，自动打开浏览器
npm run dev       # 前端热更开发模式（需后端已在跑）
```

要求：Node.js 20+（Windows 10/11 x64；better-sqlite3 / sharp 有官方 prebuilt）。

## 目录结构

```
server/     Express 后端（routes → services → db，schema.sql 含 FTS5 与触发器）
client/     React 18 + TypeScript + Tailwind + zustand 前端
tests/      Vitest + Supertest API 级测试
docs/       SRS v1.3 / 开发文档（As-Built）/ 用户手册 / 架构设计
```

## 技术栈

Express 4 · better-sqlite3 11（FTS5 trigram + 触发器同步）· chokidar 3 · sharp 0.33 · React 18 · Vite 5 · zustand · Tailwind · Vitest + Supertest

## 文档

| 文档 | 内容 |
|---|---|
| [docs/用户手册.md](docs/用户手册.md) | 全功能使用说明、FAQ |
| [docs/开发文档.md](docs/开发文档.md) | As-Built 架构、API 全清单、打包发布流程、扩展指南 |
| [docs/SRS.md](docs/SRS.md) | 需求规格说明书 v1.3 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 设计稿与任务分解 |

## License

[MIT](LICENSE)

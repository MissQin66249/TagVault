/**
 * `类型:值` 字段化检索解析器单测。
 */
import { describe, it, expect } from 'vitest';
import { parseQuery, TypeCandidate } from '../server/query-parser';

const types: TypeCandidate[] = [
  { id: 1, name: '保密级别' },
  { id: 2, name: '用途标签' },
  { id: 3, name: '版本状态' },
  { id: 4, name: '所属产品/项目' },
];

describe('parseQuery', () => {
  it('空输入返回空', () => {
    expect(parseQuery('', types)).toEqual({ keywords: [], fieldFilters: [] });
    expect(parseQuery('   ', types)).toEqual({ keywords: [], fieldFilters: [] });
  });

  it('纯关键词', () => {
    const r = parseQuery('hello 海洋生物', types);
    expect(r.keywords).toEqual(['hello', '海洋生物']);
    expect(r.fieldFilters).toHaveLength(0);
  });

  it('单个字段条件', () => {
    const r = parseQuery('保密级别:机密', types);
    expect(r.keywords).toHaveLength(0);
    expect(r.fieldFilters).toEqual([{ typeId: 1, typeName: '保密级别', values: ['机密'] }]);
  });

  it('空格 = 且：两个类型条件', () => {
    const r = parseQuery('保密级别:机密 用途标签:归档', types);
    expect(r.fieldFilters).toHaveLength(2);
    expect(r.fieldFilters[0].typeId).toBe(1);
    expect(r.fieldFilters[1].typeId).toBe(2);
  });

  it('| = 或：同类型多值', () => {
    const r = parseQuery('保密级别:机密|内部', types);
    expect(r.fieldFilters).toEqual([{ typeId: 1, typeName: '保密级别', values: ['机密', '内部'] }]);
  });

  it('全角冒号与全角竖线等价', () => {
    const r = parseQuery('保密级别：机密｜内部', types);
    expect(r.fieldFilters).toEqual([{ typeId: 1, typeName: '保密级别', values: ['机密', '内部'] }]);
  });

  it('非类型名前缀退化为普通关键词', () => {
    const r = parseQuery('规格:A4 报告', types);
    expect(r.keywords).toEqual(['规格:A4', '报告']);
    expect(r.fieldFilters).toHaveLength(0);
  });

  it('引号语法支持含空格类型名', () => {
    const r = parseQuery('"所属产品/项目":A1', types);
    expect(r.fieldFilters).toEqual([{ typeId: 4, typeName: '所属产品/项目', values: ['A1'] }]);
  });

  it('字段条件与关键词混合', () => {
    const r = parseQuery('海洋 保密级别:机密 蓝色', types);
    expect(r.keywords).toEqual(['海洋', '蓝色']);
    expect(r.fieldFilters).toHaveLength(1);
  });

  it('冒号后无值退化为关键词', () => {
    const r = parseQuery('保密级别:', types);
    expect(r.keywords).toEqual(['保密级别:']);
    expect(r.fieldFilters).toHaveLength(0);
  });

  it('字段值内可多值叠加且过滤空段', () => {
    const r = parseQuery('保密级别:机密||内部', types);
    expect(r.fieldFilters[0].values).toEqual(['机密', '内部']);
  });
});

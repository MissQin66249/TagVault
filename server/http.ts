/**
 * HTTP 辅助：统一响应 {code,data,message}、业务错误、路由包装。
 * HTTP 状态码由业务码推导：40901→409、42201→422、50000→500（code/100 取整）。
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** 业务错误码 */
export const CODE = {
  OK: 0,
  DIR_DUPLICATE: 40901,        // 目录重复
  NAME_DUPLICATE: 40902,       // 类型名/值重复
  NEED_CONFIRM: 40910,         // 删除需二次确认（data 携带影响数）
  PROTECTED: 40911,            // "未分类"不可删改
  NOT_FOUND: 40404,            // 资源不存在
  ENUM_NOT_ALLOWED: 42201,     // 枚举类型打标值不在字典白名单
  VALUE_TOO_LONG: 42202,       // 值超长（>100）
  EMPTY_VALUE: 42203,          // 值/类型名为空
  INTERNAL: 50000,             // 内部错误
} as const;

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public data: unknown = null,
  ) {
    super(message);
  }
}

/** 由业务码推导 HTTP 状态码 */
function httpStatus(code: number): number {
  if (code === CODE.OK) return 200;
  const status = Math.floor(code / 100);
  return status >= 400 && status <= 599 ? status : 500;
}

/** 成功响应 */
export function ok(res: Response, data: unknown = null, message = 'ok'): void {
  res.json({ code: CODE.OK, data, message });
}

/** 业务错误响应 */
export function fail(res: Response, code: number, message: string, data: unknown = null): void {
  res.status(httpStatus(code)).json({ code, data, message });
}

/** 异步路由包装：捕获异常（含 ApiError）交给错误中间件 */
export function wrap(fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** 全局错误中间件（挂在路由之后） */
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ApiError) {
    fail(res, err.code, err.message, err.data);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error('[TagVault] 未处理错误：', err);
  fail(res, CODE.INTERNAL, message || '内部错误');
}

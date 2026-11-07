export type ErrorCode =
  | 'unavailable'
  | 'security'
  | 'quota'
  | 'storage'
  | 'invalid-json'
  | 'unsupported-version'
  | 'invalid-data'
  | 'not-found'
  | 'conflict'
  | 'validation'
  | 'inactive'
  | 'busy'
  | 'recovery-pending'

export interface AppError {
  readonly code: ErrorCode
  readonly message: string
}

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AppError }

export function success<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function failure(code: ErrorCode, message: string): Result<never> {
  return { ok: false, error: { code, message } }
}

export function storageFailure(error: unknown): Result<never> {
  const name = error instanceof Error ? error.name : ''
  if (name === 'SecurityError')
    return failure('security', 'Доступ к хранилищу запрещён браузером')
  if (name === 'QuotaExceededError')
    return failure('quota', 'Недостаточно места в хранилище')
  return failure('storage', 'Не удалось выполнить операцию с хранилищем')
}

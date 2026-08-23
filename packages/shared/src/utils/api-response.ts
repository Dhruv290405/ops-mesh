import { ApiResponse, PaginatedResponse } from '../types';

export function createApiResponse<T>(
  success: boolean,
  data?: T,
  error?: { code: string; message: string; details?: unknown },
  requestId?: string
): ApiResponse<T> {
  return {
    success,
    ...(data !== undefined && { data }),
    ...(error && { error }),
    meta: {
      requestId: requestId ?? 'unknown',
      timestamp: new Date().toISOString()
    }
  };
}

export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> {
  return {
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit)
  };
}
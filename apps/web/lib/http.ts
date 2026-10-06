import { NextResponse } from 'next/server';
import { corsHeaders } from './cors';

/**
 * Общие части ответов API.
 *
 * Нужны, чтобы у всех эндпоинтов была одинаковая форма ошибок и одинаковые
 * заголовки. Разъехавшиеся ответы — это интеграторы, которые гадают, почему
 * один эндпоинт отвечает `{ error }`, а другой `{ message }`.
 */

export function jsonResponse(payload: unknown, status: number, origin: string): NextResponse {
  return NextResponse.json(payload, { status, headers: corsHeaders(origin) });
}

/** Ошибка в едином виде: машинный код, без подробностей внутренностей. */
export function errorResponse(code: string, status: number, origin: string): NextResponse {
  return jsonResponse({ error: code }, status, origin);
}

/**
 * Ответ на предварительный запрос браузера.
 *
 * Источник здесь не проверяется: этот запрос и существует для того, чтобы
 * браузер разрешил основной. Настоящая проверка — в самом обработчике.
 */
export function preflightResponse(request: Request): Response {
  return new NextResponse(null, { status: 204, headers: corsHeaders(requestOrigin(request)) });
}

export function requestOrigin(request: Request): string {
  return request.headers.get('origin') ?? '';
}

/** Читает тело запроса как JSON, не падая на мусоре. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

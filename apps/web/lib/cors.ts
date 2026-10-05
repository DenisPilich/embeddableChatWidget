/**
 * Заголовки CORS для запросов виджета.
 *
 * Виджет живёт на чужом домене и обращается к нашему API — это межсайтовый
 * запрос, и без этих заголовков браузер запретит виджету прочитать ответ.
 *
 * Источник отражается в ответе как есть. Это безопасно именно потому, что мы НЕ
 * выставляем `Access-Control-Allow-Credentials`: cookie и заголовки авторизации
 * браузер к такому запросу не приложит. Доступ решает не CORS, а проверка
 * источника и подписанный токен; CORS лишь сообщает браузеру, что ответ можно
 * прочитать. Отражение источника даёт внятные ошибки в консоли интегратора
 * вместо невнятного «заблокировано политикой CORS».
 */
export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    // Ответ зависит от источника запроса. Без этого заголовка кэш может отдать
    // посетителю одного сайта ответ, выданный для другого.
    Vary: 'Origin',
  };
}

/**
 * Приводит источник к виду «схема + хост + порт».
 *
 * `Origin` приходит без пути, но полагаться на это не стоит: значение может
 * быть `null` (например, из песочницы iframe) или мусором. Приводим к
 * каноническому виду, чтобы `HTTPS://Example.com/` и `https://example.com` не
 * считались разными сайтами.
 */
export function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Разрешён ли источник для сайта. */
export function isOriginAllowed(origin: string | null, allowedOrigins: readonly string[]): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  return allowedOrigins.some((allowed) => normalizeOrigin(allowed) === normalized);
}

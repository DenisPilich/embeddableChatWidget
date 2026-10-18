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
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

/**
 * Разрешён ли источник.
 *
 * Кроме списка сайта разрешается запрос с того же адреса, на котором работает
 * само приложение. Это не лазейка: для браузера такие запросы свои, CORS к ним
 * не применяется вовсе, а чужой сайт под этот адрес не подделается — его
 * источник будет другим, и он упрётся в список.
 *
 * Зачем это нужно. Демонстрационная страница живёт на том же домене, что и API,
 * и раньше была обязана вписывать себя в список руками. Каждый новый адрес
 * предпросмотра на Vercel (а их у деплоя много) ломал виджет, и выглядело это
 * как «не отправлено» без единого намёка на причину: `/api/v1/init` отвечал 403,
 * а на странице не менялось ничего.
 */
export function isOriginAllowed(
  origin: string | null,
  allowedOrigins: readonly string[],
  ownOrigin?: string | null,
): boolean {
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;

  // Свой адрес — всегда разрешён.
  if (ownOrigin !== undefined && ownOrigin !== null && normalizeOrigin(ownOrigin) === normalized) {
    return true;
  }

  return allowedOrigins.some((allowed) => normalizeOrigin(allowed) === normalized);
}

/**
 * Адрес, на котором приложение отвечает на этот запрос.
 *
 * За прокси Vercel настоящий хост приходит в `x-forwarded-host`, а схема — в
 * `x-forwarded-proto`: `request.url` внутри функции описывает внутренний адрес,
 * и сравнивать источник с ним бессмысленно.
 */
export function ownOrigin(request: Request): string | null {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return null;

  const proto =
    request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '');

  return `${proto}://${host}`;
}

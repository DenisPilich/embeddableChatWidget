import { verifyWidgetToken, type WidgetTokenClaims } from './tokens';

/**
 * Достаёт и проверяет токен виджета.
 *
 * Токен приходит заголовком `Authorization`, а не в теле запроса: тела попадают
 * в журналы и в кэши, заголовки — нет. Плюс заголовок одинаково работает и для
 * отправки, и для выборки сообщений.
 *
 * Проверка области действия (какому сайту и какому диалогу принадлежит токен)
 * здесь не делается намеренно: она часть конкретного запроса. Токен отвечает на
 * вопрос «кто это», а «что ему можно» решает каждый эндпоинт, ограничивая
 * выборку своим siteId.
 */
export async function authenticateWidget(request: Request): Promise<WidgetTokenClaims | null> {
  const header = request.headers.get('authorization');
  if (!header) return null;

  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1];
  if (!token) return null;

  return verifyWidgetToken(token);
}

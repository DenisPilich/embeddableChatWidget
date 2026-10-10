import type { InitResponse } from '@ecw/shared';
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { isOriginAllowed } from '@/lib/cors';
import { findSiteByPublicKey, resolveOpenConversation, resolveVisitor } from '@/lib/data';
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  readJson,
  requestOrigin,
} from '@/lib/http';
import { signWidgetToken, verifyWidgetToken } from '@/lib/tokens';

/**
 * Первый запрос виджета: посетитель получает право разговаривать.
 *
 * Что здесь важно и почему:
 *
 * 1. **Проверка источника.** `siteId` — публичный ключ, он виден в HTML любого
 *    клиента. Секретом он не является и защитой быть не может. Поэтому запрос
 *    принимается только с доменов, которые владелец сайта указал в настройках.
 *    Без этой проверки кто угодно, скопировав ключ со страницы, слал бы
 *    сообщения в базу клиента и жёг бюджет его ассистента.
 *
 * 2. **Узкий токен.** В нём только идентификаторы: сайт, посетитель, диалог.
 *    Токен не даёт доступа ни к чему другому.
 *
 * 3. **Поиск сайта идёт первым**, и это единственный запрос без siteId — до
 *    него мы не знаем, о каком сайте речь. Дальше всё уже ограничено сайтом.
 */

export const dynamic = 'force-dynamic';

const initSchema = z.object({
  /** Публичный ключ сайта из атрибута data-site-id. */
  siteId: z.string().min(1).max(120),
  /** Токен, выданный посетителю в прошлый раз. Необязателен. */
  visitorToken: z.string().max(4000).optional(),
});

export function OPTIONS(request: Request): Response {
  return preflightResponse(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = requestOrigin(request);

  const parsed = initSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    // Подробности разбора наружу не отдаём: они описывают нашу схему, а не
    // проблему интегратора.
    return errorResponse('invalid_request', 400, origin);
  }

  const site = await findSiteByPublicKey(parsed.data.siteId);
  if (!site) {
    return errorResponse('unknown_site', 404, origin);
  }

  if (!isOriginAllowed(origin, site.allowedOrigins)) {
    console.warn('[ecw] отклонён запрос с постороннего источника', {
      origin: origin || '(пусто)',
      siteId: site.id,
    });
    return errorResponse('origin_not_allowed', 403, origin);
  }

  // Токен подписан нами, поэтому посетителя можно узнать. Но только в пределах
  // того же сайта: идентификатор посетителя верен лишь на своём сайте.
  const previous = parsed.data.visitorToken
    ? await verifyWidgetToken(parsed.data.visitorToken)
    : null;
  const knownVisitorId = previous && previous.siteId === site.id ? previous.visitorId : null;

  const visitor = await resolveVisitor(site.id, knownVisitorId);
  const conversation = await resolveOpenConversation(site.id, visitor.id);

  const token = await signWidgetToken({
    siteId: site.id,
    visitorId: visitor.id,
    conversationId: conversation.id,
  });

  const response: InitResponse = {
    token,
    conversationId: conversation.id,
    lastSeq: conversation.lastSeq,
    // Диалог мог ждать оператора ещё с прошлого визита: посетитель должен
    // видеть это сразу, а не после первого вопроса в пустоту.
    waitingForHuman: conversation.humanRequestedAt !== null,
  };
  return jsonResponse(response, 200, origin);
}

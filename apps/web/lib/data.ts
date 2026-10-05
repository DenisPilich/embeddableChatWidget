import type { Conversation, Site, Visitor } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Доступ к данным.
 *
 * Правило, ради которого этот модуль существует: всё, что относится к клиенту,
 * запрашивается ВМЕСТЕ с siteId. Не «помнят» о нём, а передают обязательным
 * аргументом и включают в условие. Забытый siteId в одном запросе — это не
 * мелкая оплошность, а выдача переписки одного клиента другому.
 *
 * Исключение ровно одно, и оно названо явно: поиск сайта по публичному ключу.
 * До него siteId ещё неизвестен — мы как раз выясняем, о каком сайте речь.
 * Поэтому у функции особое имя, и она первая в файле.
 */

/** Единственный запрос без ограничения по сайту: мы ещё не знаем, какой это сайт. */
export async function findSiteByPublicKey(publicKey: string): Promise<Site | null> {
  return prisma.site.findUnique({ where: { publicKey } });
}

/**
 * Находит вернувшегося посетителя или заводит нового.
 *
 * `visitorId` приходит из подписанного токена, то есть выдан нами. Но и ему
 * нужна проверка по siteId: идентификатор верен только в пределах своего сайта,
 * и без этого условия посетитель одного клиента мог бы предъявить свой
 * идентификатор на сайте другого.
 */
export async function resolveVisitor(siteId: string, visitorId: string | null): Promise<Visitor> {
  if (visitorId) {
    const existing = await prisma.visitor.findFirst({ where: { id: visitorId, siteId } });
    if (existing) {
      return prisma.visitor.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date() },
      });
    }
  }

  return prisma.visitor.create({ data: { siteId } });
}

/**
 * Возвращает открытый диалог посетителя или создаёт новый.
 *
 * Один открытый диалог на посетителя: закрывать его будет оператор или политика
 * по времени, а не каждое новое сообщение.
 */
export async function resolveOpenConversation(
  siteId: string,
  visitorId: string,
): Promise<Conversation> {
  const existing = await prisma.conversation.findFirst({
    where: { siteId, visitorId, status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;

  return prisma.conversation.create({ data: { siteId, visitorId } });
}

import type { Conversation, Message, Site, Visitor } from '@prisma/client';
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

/** Диалог не найден среди принадлежащих этому сайту. */
export class ConversationNotFoundError extends Error {
  constructor() {
    super('Диалог не найден для этого сайта');
    this.name = 'ConversationNotFoundError';
  }
}

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

/** Диалог, принадлежащий указанному сайту. Чужой диалог не найдётся. */
export async function findConversation(
  siteId: string,
  conversationId: string,
): Promise<Conversation | null> {
  return prisma.conversation.findFirst({ where: { id: conversationId, siteId } });
}

/**
 * Сообщения после указанного номера, по возрастанию.
 *
 * У сообщения своего `siteId` нет — оно принадлежит диалогу. Поэтому ограничение
 * идёт через связь: `conversation: { siteId }`. Так его невозможно «забыть»:
 * без этого условия запрос просто не соберётся.
 */
export async function listMessages(params: {
  siteId: string;
  conversationId: string;
  afterSeq: number;
  limit: number;
}): Promise<Message[]> {
  return prisma.message.findMany({
    where: {
      conversationId: params.conversationId,
      conversation: { siteId: params.siteId },
      seq: { gt: params.afterSeq },
    },
    orderBy: { seq: 'asc' },
    take: params.limit,
  });
}

/**
 * Записывает сообщение в диалог.
 *
 * Две нетривиальные вещи, ради которых функция существует отдельно:
 *
 * 1. **Идемпотентность.** Сообщения посетителя приходят со своим идентификатором.
 *    Если ответ не дошёл и виджет повторит отправку, второго сообщения не
 *    появится — вернётся уже записанное. К сообщениям ассистента и оператора это
 *    не относится: повторной отправки у них не бывает, и `clientId` не задаётся.
 *
 * 2. **Номер выдаётся атомарно.** Прочитать `lastSeq`, прибавить единицу и
 *    записать обратно нельзя: два одновременных сообщения получат один номер и
 *    одно из них потеряется. `UPDATE ... RETURNING` делает и то и другое одной
 *    операцией, а заодно проверяет, что диалог принадлежит этому сайту.
 */
export async function appendMessage(params: {
  siteId: string;
  conversationId: string;
  author: Message['author'];
  body: string;
  /** Только для сообщений посетителя: на нём держится защита от повторов. */
  clientId?: string;
}): Promise<{ message: Message; duplicate: boolean }> {
  if (params.clientId) {
    const existing = await findMessageByClientId(params.conversationId, params.clientId);
    if (existing) return { message: existing, duplicate: true };
  }

  const updated = await prisma.$queryRaw<{ lastSeq: number }[]>`
    UPDATE "conversations"
    SET "lastSeq" = "lastSeq" + 1, "updatedAt" = NOW()
    WHERE "id" = ${params.conversationId} AND "siteId" = ${params.siteId}
    RETURNING "lastSeq"
  `;

  const seq = updated[0]?.lastSeq;
  if (seq === undefined) throw new ConversationNotFoundError();

  try {
    const message = await prisma.message.create({
      data: {
        conversationId: params.conversationId,
        seq,
        author: params.author,
        clientId: params.clientId ?? null,
        body: params.body,
      },
    });
    return { message, duplicate: false };
  } catch (error) {
    // Гонка: между проверкой и вставкой то же сообщение успело записаться.
    // Номер при этом сгорит — в нумерации останется пропуск, и это нормально:
    // курсору важна монотонность, а не отсутствие дыр.
    if (params.clientId && isUniqueViolation(error)) {
      const raced = await findMessageByClientId(params.conversationId, params.clientId);
      if (raced) return { message: raced, duplicate: true };
    }
    throw error;
  }
}

async function findMessageByClientId(
  conversationId: string,
  clientId: string,
): Promise<Message | null> {
  return prisma.message.findUnique({
    where: { conversationId_clientId: { conversationId, clientId } },
  });
}

/**
 * Нарушение уникальности.
 *
 * Проверяем код, а не класс ошибки: класс живёт внутри сгенерированного клиента,
 * и его расположение менялось между версиями Prisma. Код `P2002` — часть
 * документированного контракта и переживёт обновление.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** Настройки ассистента, как их видит код. Без служебных полей таблицы. */
export interface AiSettings {
  systemPrompt: string;
  model: string;
  temperature: number;
  dailyTokenBudget: number;
}

/** Настройки ассистента для сайта или `null`, если их ещё не заводили. */
export async function findAiSettings(siteId: string): Promise<AiSettings | null> {
  const config = await prisma.aiConfig.findUnique({ where: { siteId } });
  if (!config) return null;

  return {
    systemPrompt: config.systemPrompt,
    model: config.model,
    temperature: config.temperature,
    dailyTokenBudget: config.dailyTokenBudget,
  };
}

/**
 * Последние сообщения диалога — в том порядке, в каком их читает модель.
 *
 * Забираем с конца, потому что «последние N» — это про конец переписки, а
 * отдаём по возрастанию: разговор, переданный модели задом наперёд, она
 * поймёт неправильно.
 */
export async function listRecentMessages(params: {
  siteId: string;
  conversationId: string;
  limit: number;
}): Promise<Message[]> {
  const recent = await prisma.message.findMany({
    where: {
      conversationId: params.conversationId,
      conversation: { siteId: params.siteId },
    },
    orderBy: { seq: 'desc' },
    take: params.limit,
  });

  return recent.reverse();
}

/**
 * Сколько токенов сайт израсходовал сегодня.
 *
 * Сутки считаются по UTC. Для клиента из другого пояса граница придётся не на
 * полночь, и это осознанное упрощение: часовой пояс сайта в модели данных не
 * хранится, а придумывать его на этом шаге рано.
 */
export async function tokensUsedToday(siteId: string): Promise<number> {
  const usage = await prisma.tokenUsage.findUnique({
    where: { siteId_day: { siteId, day: startOfUtcDay() } },
  });
  return usage?.tokens ?? 0;
}

/** Записывает расход. Сложение делает база, а не код: два запроса не потеряются. */
export async function recordTokenUsage(siteId: string, tokens: number): Promise<void> {
  const day = startOfUtcDay();

  await prisma.tokenUsage.upsert({
    where: { siteId_day: { siteId, day } },
    update: { tokens: { increment: tokens } },
    create: { siteId, day, tokens },
  });
}

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Просит живого оператора для диалога.
 *
 * Возвращает `true`, если просьба записана впервые. Повторный вызов ничего не
 * меняет и возвращает `false`: посетитель может нажать кнопку дважды, и второй
 * раз не должен сбрасывать время ожидания — по нему оператор понимает, кто ждёт
 * дольше всех.
 */
export async function requestHuman(params: {
  siteId: string;
  conversationId: string;
}): Promise<boolean> {
  const updated = await prisma.conversation.updateMany({
    // Условие по сайту обязательно: без него чужой диалог можно было бы позвать
    // в операторы.
    where: { id: params.conversationId, siteId: params.siteId, humanRequestedAt: null },
    data: { humanRequestedAt: new Date(), answerFailures: 0 },
  });

  return updated.count > 0;
}

/** Ждёт ли диалог оператора. */
export async function isWaitingForHuman(params: {
  siteId: string;
  conversationId: string;
}): Promise<boolean> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: params.conversationId, siteId: params.siteId },
    select: { humanRequestedAt: true },
  });

  if (conversation === null) return false;
  return conversation.humanRequestedAt !== null;
}

/**
 * Считает неудачный ответ модели.
 *
 * Возвращает новое число неудач подряд или `null`, если диалога нет. Счётчик
 * нужен, чтобы отличить разовую неудачу сервиса от постоянной: при постоянной
 * посетителю предлагается человек, а не бесконечное «попробуйте позже».
 *
 * Приращение делает база, а не код: два одновременных запроса не потеряются.
 */
export async function countAnswerFailure(params: {
  siteId: string;
  conversationId: string;
}): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ answerFailures: number }[]>`
    UPDATE "conversations"
    SET "answerFailures" = "answerFailures" + 1, "updatedAt" = NOW()
    WHERE "id" = ${params.conversationId} AND "siteId" = ${params.siteId}
    RETURNING "answerFailures"
  `;

  return rows[0]?.answerFailures ?? null;
}

/** Сбрасывает счётчик неудач после успешного ответа. */
export async function resetAnswerFailures(params: {
  siteId: string;
  conversationId: string;
}): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: params.conversationId, siteId: params.siteId, answerFailures: { gt: 0 } },
    data: { answerFailures: 0 },
  });
}

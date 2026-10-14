import type { AiConfig, Conversation, Message, Site, User, Visitor } from '@prisma/client';
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
  /** Кто из людей ответил, если это оператор. */
  authorUserId?: string;
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
        authorUserId: params.authorUserId ?? null,
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

/**
 * Сколько сообщений посетителя пришло в диалог с указанного времени.
 *
 * Считаем именно сообщения посетителя: ответы ассистента — следствие, и
 * ограничивать надо то, что приходит снаружи.
 */
export async function countRecentVisitorMessages(params: {
  siteId: string;
  conversationId: string;
  since: Date;
}): Promise<number> {
  return prisma.message.count({
    where: {
      conversationId: params.conversationId,
      // Ограничение по сайту идёт через связь: у сообщения своего siteId нет.
      conversation: { siteId: params.siteId },
      author: 'VISITOR',
      createdAt: { gte: params.since },
    },
  });
}

/** Сколько новых посетителей пришло на сайт с указанного времени. */
export async function countRecentVisitors(params: {
  siteId: string;
  since: Date;
}): Promise<number> {
  return prisma.visitor.count({
    where: { siteId: params.siteId, createdAt: { gte: params.since } },
  });
}

/** Пользователь по адресу почты. Адрес сравниваем в нижнем регистре. */
export async function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
}

export async function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

/** Рабочие пространства, в которых состоит оператор. Граница его доступа. */
export async function listMembershipWorkspaceIds(userId: string): Promise<string[]> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    select: { workspaceId: true },
  });

  return memberships.map((membership) => membership.workspaceId);
}

export interface QueueItem {
  id: string;
  status: Conversation['status'];
  humanRequestedAt: Date | null;
  updatedAt: Date;
  siteName: string;
  lastSeq: number;
  lastMessage: string | null;
  /** Кто написал последним. Видно, нужно ли вообще открывать разговор. */
  lastAuthor: Message['author'] | null;
  lastAt: Date | null;
}

/** Что показывать в очереди. */
export type QueueFilter = 'all' | 'waiting' | 'active' | 'closed';

export interface ConversationCounts {
  all: number;
  waiting: number;
  active: number;
  closed: number;
}

/**
 * Число диалогов по состояниям — для вкладок очереди.
 *
 * Отдельным запросом, а не подсчётом по загруженному списку: список ограничен
 * пятьюдесятью строками, и число на вкладке разошлось бы с настоящим.
 */
export async function countConversationStates(params: {
  workspaceIds: readonly string[];
}): Promise<ConversationCounts> {
  const scope = { site: { workspaceId: { in: [...params.workspaceIds] } } };

  const [all, waiting, active, closed] = await Promise.all([
    prisma.conversation.count({ where: scope }),
    // «Ждёт» — это не состояние диалога, а признак на нём: диалог остаётся
    // открытым, в нём продолжают писать.
    prisma.conversation.count({
      where: { ...scope, status: 'OPEN', humanRequestedAt: { not: null } },
    }),
    prisma.conversation.count({ where: { ...scope, status: 'OPEN', humanRequestedAt: null } }),
    prisma.conversation.count({ where: { ...scope, status: 'CLOSED' } }),
  ]);

  return { all, waiting, active, closed };
}

/**
 * Очередь диалогов для оператора.
 *
 * Сначала те, кто ждёт человека, — и дольше всех ждущие первыми. Очередь, в
 * которой непонятно, кого брать, — не очередь, а список.
 *
 * Граница доступа задана рабочими пространствами оператора: чужие диалоги в
 * выборку не попадают вовсе, а не отсеиваются потом.
 */
export async function listOperatorQueue(params: {
  workspaceIds: readonly string[];
  limit: number;
  filter?: QueueFilter;
}): Promise<QueueItem[]> {
  const scope = { site: { workspaceId: { in: [...params.workspaceIds] } } };

  const byFilter: Record<QueueFilter, object> = {
    all: {},
    waiting: { status: 'OPEN', humanRequestedAt: { not: null } },
    active: { status: 'OPEN', humanRequestedAt: null },
    closed: { status: 'CLOSED' },
  };

  const conversations = await prisma.conversation.findMany({
    where: { ...scope, ...byFilter[params.filter ?? 'all'] },
    orderBy: [
      // Пустые значения в конце: Postgres по умолчанию ставит их в начало при
      // сортировке по убыванию, и без этого ожидающие уехали бы в хвост.
      { humanRequestedAt: { sort: 'asc', nulls: 'last' } },
      { updatedAt: 'desc' },
    ],
    take: params.limit,
    select: {
      id: true,
      status: true,
      humanRequestedAt: true,
      updatedAt: true,
      lastSeq: true,
      site: { select: { name: true } },
      messages: {
        orderBy: { seq: 'desc' },
        take: 1,
        select: { body: true, author: true, createdAt: true },
      },
    },
  });

  return conversations.map((conversation) => {
    const last = conversation.messages[0];

    return {
      id: conversation.id,
      status: conversation.status,
      humanRequestedAt: conversation.humanRequestedAt,
      updatedAt: conversation.updatedAt,
      siteName: conversation.site.name,
      lastSeq: conversation.lastSeq,
      lastMessage: last?.body ?? null,
      lastAuthor: last?.author ?? null,
      lastAt: last?.createdAt ?? null,
    };
  });
}

/**
 * Диалог, доступный оператору.
 *
 * Это единственная проверка доступа к чужой переписке, и она здесь: диалог
 * находится, только если его сайт принадлежит рабочему пространству оператора.
 * Отдельной проверки «а можно ли» нет намеренно — её забыли бы в одном из мест.
 */
export async function findOperatorConversation(params: {
  workspaceIds: readonly string[];
  conversationId: string;
}): Promise<(Conversation & { site: Site }) | null> {
  return prisma.conversation.findFirst({
    where: {
      id: params.conversationId,
      site: { workspaceId: { in: [...params.workspaceIds] } },
    },
    include: { site: true },
  });
}

/**
 * Ответ оператора.
 *
 * Ожидание человека при этом НЕ снимается: раз человек вмешался, ассистент
 * остаётся в стороне до закрытия диалога. Иначе модель и оператор отвечали бы по
 * очереди, и посетитель читал бы двух собеседников.
 */
export async function appendAgentMessage(params: {
  siteId: string;
  conversationId: string;
  operatorId: string;
  body: string;
}): Promise<Message> {
  const stored = await appendMessage({
    siteId: params.siteId,
    conversationId: params.conversationId,
    author: 'AGENT',
    body: params.body,
    authorUserId: params.operatorId,
  });

  return stored.message;
}

/** Закрывает диалог. Ожидание человека снимается: разговор окончен. */
export async function closeConversation(params: {
  siteId: string;
  conversationId: string;
}): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: params.conversationId, siteId: params.siteId, status: 'OPEN' },
    data: { status: 'CLOSED', humanRequestedAt: null, answerFailures: 0 },
  });
}

/**
 * Возвращает закрытый диалог в работу.
 *
 * Нужно потому, что закрытие — действие в один клик, а последствия у него
 * долгие: без этой команды случайно закрытый разговор остался бы в архиве
 * навсегда. Ожидание человека при возврате НЕ выставляется: ассистент снова
 * отвечает сам, а человека позовут заново, если понадобится.
 */
export async function reopenConversation(params: {
  siteId: string;
  conversationId: string;
}): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: params.conversationId, siteId: params.siteId, status: 'CLOSED' },
    data: { status: 'OPEN', humanRequestedAt: null, answerFailures: 0 },
  });
}

/**
 * Сайт, доступный оператору.
 *
 * Как и с диалогами, граница доступа здесь одна: чужой сайт не найдётся, и
 * вызывающему не нужно ни о чём помнить отдельно.
 */
export async function findOperatorSite(params: {
  workspaceIds: readonly string[];
  siteId: string;
}): Promise<(Site & { aiConfig: AiConfig | null }) | null> {
  return prisma.site.findFirst({
    where: { id: params.siteId, workspaceId: { in: [...params.workspaceIds] } },
    // Настройки ассистента нужны той же странице, что и сам сайт: отдельный
    // запрос ради них означал бы, что форма может показать одно, а сохранить
    // другое.
    include: { aiConfig: true },
  });
}

/** Сайты оператора вместе с настройками ассистента. */
export async function listOperatorSites(params: {
  workspaceIds: readonly string[];
}): Promise<(Site & { aiConfig: AiConfig | null })[]> {
  return prisma.site.findMany({
    where: { workspaceId: { in: [...params.workspaceIds] } },
    include: { aiConfig: true },
    orderBy: { name: 'asc' },
  });
}

/**
 * Первый сайт в базе.
 *
 * Нужен только демонстрационной странице: она изображает конкретную кофейню, и ей
 * нужен ключ сайта, иначе виджет не запустится. Настоящему развёртыванию такая
 * страница не нужна — там сайтов много и «первый» ничего не значит.
 */
export async function findFirstSite(): Promise<Site | null> {
  return prisma.site.findFirst({ orderBy: { createdAt: 'asc' } });
}

/** Сохраняет настройки сайта. Доступ проверен до вызова. */
export async function saveSiteSettings(params: {
  siteId: string;
  name: string;
  allowedOrigins: string[];
  widgetColor: string | null;
  widgetTitle: string | null;
  widgetGreeting: string | null;
}): Promise<void> {
  await prisma.site.update({
    where: { id: params.siteId },
    data: {
      name: params.name,
      allowedOrigins: params.allowedOrigins,
      widgetColor: params.widgetColor,
      widgetTitle: params.widgetTitle,
      widgetGreeting: params.widgetGreeting,
    },
  });
}

/**
 * Сохраняет настройки ассистента.
 *
 * Через `upsert`, а не `update`: у нового сайта настроек ещё нет, и владелец не
 * должен получать ошибку за то, что первым делом открыл форму.
 */
export async function saveAiSettings(params: {
  siteId: string;
  systemPrompt: string;
  model: string;
  temperature: number;
  dailyTokenBudget: number;
}): Promise<void> {
  const data = {
    systemPrompt: params.systemPrompt,
    model: params.model,
    temperature: params.temperature,
    dailyTokenBudget: params.dailyTokenBudget,
  };

  await prisma.aiConfig.upsert({
    where: { siteId: params.siteId },
    update: data,
    create: { siteId: params.siteId, ...data },
  });
}

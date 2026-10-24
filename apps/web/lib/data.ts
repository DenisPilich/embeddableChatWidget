import { randomBytes } from 'node:crypto';
import type {
  AiConfig,
  Conversation,
  Membership,
  Message,
  Site,
  User,
  Visitor,
  Workspace,
} from '@prisma/client';
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

/**
 * Запоминает номер, оставленный посетителем.
 *
 * Номер пишется в сам разговор, а не в отдельную сущность: он нужен ровно в
 * контексте «перезвонить вот этому человеку про вот это».
 */
export async function setConversationPhone(params: {
  siteId: string;
  conversationId: string;
  phone: string;
}): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: params.conversationId, siteId: params.siteId },
    data: { phone: params.phone },
  });
}

/** Состояние разговора, которое видно посетителю. */
export async function readConversationState(params: {
  siteId: string;
  conversationId: string;
}): Promise<{
  waitingForHuman: boolean;
  humanRequestedAt: Date | null;
  phone: string | null;
} | null> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: params.conversationId, siteId: params.siteId },
    select: { humanRequestedAt: true, phone: true },
  });

  if (conversation === null) return null;

  return {
    waitingForHuman: conversation.humanRequestedAt !== null,
    humanRequestedAt: conversation.humanRequestedAt,
    phone: conversation.phone,
  };
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
  /** Телефон, оставленный вместо ожидания оператора. */
  phone: string | null;
  /** Перезвонили ли уже. Пусто — ещё нет. */
  calledBackAt: Date | null;
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
  /** Поиск по имени сайта и по тексту переписки. */
  search?: string;
}): Promise<QueueItem[]> {
  const scope = { site: { workspaceId: { in: [...params.workspaceIds] } } };

  const byFilter: Record<QueueFilter, object> = {
    all: {},
    waiting: { status: 'OPEN', humanRequestedAt: { not: null } },
    active: { status: 'OPEN', humanRequestedAt: null },
    closed: { status: 'CLOSED' },
  };

  const search = params.search?.trim() ?? '';
  // Поиск идёт по базе, а не по загруженной полусотне: иначе находка зависела бы
  // от того, попал ли разговор в список, — а именно этого оператор и не видит.
  const bySearch =
    search === ''
      ? {}
      : {
          OR: [
            { site: { name: { contains: search, mode: 'insensitive' as const } } },
            { messages: { some: { body: { contains: search, mode: 'insensitive' as const } } } },
          ],
        };

  const conversations = await prisma.conversation.findMany({
    where: { ...scope, ...byFilter[params.filter ?? 'all'], ...bySearch },
    orderBy:
      // В «всех» наверху то, где только что что-то произошло: владелец ищет
      // свежий разговор, а не самый старый. В остальных вкладках порядок прежний —
      // «дольше всех ждёт» значит именно это.
      params.filter === 'all' || params.filter === undefined
        ? [{ updatedAt: 'desc' }]
        : [{ humanRequestedAt: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
    take: params.limit,
    select: {
      id: true,
      status: true,
      humanRequestedAt: true,
      updatedAt: true,
      lastSeq: true,
      phone: true,
      calledBackAt: true,
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
      phone: conversation.phone,
      calledBackAt: conversation.calledBackAt,
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

  // Первый ответ человека переводит разговор в «ведёт человек»: с этого момента
  // ассистент молчит, даже если ожидание уже снято.
  await prisma.conversation.updateMany({
    where: { id: params.conversationId, siteId: params.siteId, humanJoinedAt: null },
    data: { humanJoinedAt: new Date() },
  });

  return stored.message;
}

/**
 * Ведёт ли разговор человек.
 *
 * Истина и когда человека позвали (ожидание), и когда он уже ответил. Ассистенту
 * нужно именно это: молчать в обоих случаях. Виджету нужно только первое —
 * отсчёт ожидания, — поэтому у него остался отдельный isWaitingForHuman.
 */
export async function isHandledByHuman(params: {
  siteId: string;
  conversationId: string;
}): Promise<boolean> {
  const conversation = await prisma.conversation.findFirst({
    where: { id: params.conversationId, siteId: params.siteId },
    select: { humanRequestedAt: true, humanJoinedAt: true },
  });

  return (
    conversation !== null &&
    (conversation.humanRequestedAt !== null || conversation.humanJoinedAt !== null)
  );
}

/** Закрывает диалог. Ожидание человека снимается: разговор окончен. */
export async function closeConversation(params: {
  siteId: string;
  conversationId: string;
}): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: params.conversationId, siteId: params.siteId, status: 'OPEN' },
    data: {
      status: 'CLOSED',
      humanRequestedAt: null,
      humanJoinedAt: null,
      answerFailures: 0,
    },
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
 * Настройки общения с посетителем: включён ли ассистент и сколько ждать
 * оператора, прежде чем предложить телефон.
 */
export async function saveChatSettings(params: {
  siteId: string;
  aiEnabled: boolean;
  handoverTimeoutSeconds: number;
}): Promise<void> {
  await prisma.site.update({
    where: { id: params.siteId },
    data: { aiEnabled: params.aiEnabled, handoverTimeoutSeconds: params.handoverTimeoutSeconds },
  });
}

/**
 * Снимает флаг ожидания оператора.
 *
 * Вызывается, когда оператор ответил: разговор больше не ждёт человека, и
 * очередь не должна считать его ожидающим. Иначе счётчик растёт вечно, а
 * «дольше всех ждёт» перестаёт что-либо значить.
 */
export async function clearHumanRequest(params: {
  siteId: string;
  conversationId: string;
}): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: params.conversationId, siteId: params.siteId, humanRequestedAt: { not: null } },
    data: { humanRequestedAt: null, answerFailures: 0 },
  });
}

/** Настройки общения сайта: сколько ждать оператора и включён ли ассистент. */
export async function readChatSettings(siteId: string): Promise<{
  handoverTimeoutSeconds: number;
  aiEnabled: boolean;
} | null> {
  return prisma.site.findUnique({
    where: { id: siteId },
    select: { handoverTimeoutSeconds: true, aiEnabled: true },
  });
}

/**
 * Отмечает, что по номеру перезвонили.
 *
 * Без этой отметки номера уходят в пустоту, а обещание «мы вам перезвоним»
 * остаётся обещанием.
 */
export async function markCalledBack(params: {
  siteId: string;
  conversationId: string;
}): Promise<void> {
  await prisma.conversation.updateMany({
    where: { id: params.conversationId, siteId: params.siteId, phone: { not: null } },
    data: { calledBackAt: new Date() },
  });
}

/**
 * Закрывает несколько диалогов сразу.
 *
 * Один запрос на все: закрывать по одному — это столько же походов в базу,
 * сколько диалогов, и оператор, разбирающий очередь после выходных, ждал бы
 * впустую. Возвращает, сколько действительно закрылось.
 *
 * Условия те же, что везде: чужие диалоги не закроются, даже если их
 * идентификаторы прислали в форме, а уже закрытые не считаются второй раз.
 */
export async function closeConversations(params: {
  workspaceIds: readonly string[];
  ids: readonly string[];
}): Promise<number> {
  if (params.ids.length === 0) return 0;

  const updated = await prisma.conversation.updateMany({
    where: {
      id: { in: [...params.ids] },
      site: { workspaceId: { in: [...params.workspaceIds] } },
      status: 'OPEN',
    },
    data: { status: 'CLOSED', humanRequestedAt: null, answerFailures: 0 },
  });

  return updated.count;
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

export interface OperatorWorkspace {
  id: string;
  name: string;
  /** Роль самого оператора в этом пространстве: от неё зависит право приглашать. */
  role: Membership['role'];
  siteCount: number;
  members: { userId: string; email: string; name: string | null; role: Membership['role'] }[];
}

/**
 * Рабочие пространства оператора вместе с участниками.
 *
 * Это единственное место, где наружу выходят чужие адреса почты, и происходит
 * это только для своих пространств: список ограничен членством оператора.
 */
export async function listOperatorWorkspaces(params: {
  workspaceIds: readonly string[];
  operatorId: string;
}): Promise<OperatorWorkspace[]> {
  const workspaces = await prisma.workspace.findMany({
    where: { id: { in: [...params.workspaceIds] } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      _count: { select: { sites: true } },
      memberships: {
        // Владельцы первыми: список читают, чтобы понять, к кому идти.
        orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
        select: { role: true, userId: true, user: { select: { email: true, name: true } } },
      },
    },
  });

  return workspaces.map((workspace) => {
    const mine = workspace.memberships.find((member) => member.userId === params.operatorId);

    return {
      id: workspace.id,
      name: workspace.name,
      // Если членства вдруг нет, считаем роль низшей: пусть лучше не хватает
      // прав, чем наоборот.
      role: mine?.role ?? 'AGENT',
      siteCount: workspace._count.sites,
      members: workspace.memberships.map((member) => ({
        userId: member.userId,
        email: member.user.email,
        name: member.user.name,
        role: member.role,
      })),
    };
  });
}

/** Членство оператора в пространстве или `null`. */
export async function findMembership(params: {
  userId: string;
  workspaceId: string;
}): Promise<Membership | null> {
  return prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: params.userId, workspaceId: params.workspaceId } },
  });
}

/**
 * Заводит рабочее пространство вместе с владельцем.
 *
 * Одним запросом, а не двумя: пространство без участников оказалось бы ничьим —
 * его не увидел бы никто, и приглашать в него было бы некому.
 */
export async function createWorkspaceWithOwner(params: {
  name: string;
  ownerId: string;
}): Promise<string> {
  const workspace = await prisma.workspace.create({
    data: {
      name: params.name,
      memberships: { create: { userId: params.ownerId, role: 'OWNER' } },
    },
    select: { id: true },
  });

  return workspace.id;
}

/** Заводит оператора с готовым хешем пароля. */
export async function createOperator(params: {
  email: string;
  name: string | null;
  passwordHash: string;
}): Promise<User> {
  return prisma.user.create({
    data: {
      // Приводим к нижнему регистру: почта — идентификатор, и «Иван@…» с
      // «иван@…» не должны оказаться двумя разными людьми.
      email: params.email.trim().toLowerCase(),
      name: params.name,
      passwordHash: params.passwordHash,
    },
  });
}

/** Добавляет оператора в пространство или меняет его роль там. */
export async function addMembership(params: {
  userId: string;
  workspaceId: string;
  role: Membership['role'];
}): Promise<void> {
  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: params.userId, workspaceId: params.workspaceId } },
    update: { role: params.role },
    create: { userId: params.userId, workspaceId: params.workspaceId, role: params.role },
  });
}

/**
 * Меняет пароль и увеличивает поколение сессий.
 *
 * Возвращает новое поколение: тому, кто пароль сменил сам, нужно сразу выдать
 * свежую cookie, иначе он выгонит и себя. Все остальные входы при этом
 * перестают работать — в этом и смысл.
 */
export async function updatePassword(params: {
  userId: string;
  passwordHash: string;
}): Promise<number> {
  const user = await prisma.user.update({
    where: { id: params.userId },
    data: { passwordHash: params.passwordHash, sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });

  return user.sessionVersion;
}

/**
 * Запоминает хеш кода восстановления.
 *
 * Хранится именно хеш: код показывается один раз владельцу учётной записи, и
 * потеря базы не должна давать возможности сбросить чужой пароль. `null`
 * означает, что кода нет и восстановиться по нему нельзя.
 */
export async function setRecoveryHash(params: {
  userId: string;
  recoveryHash: string | null;
}): Promise<void> {
  await prisma.user.update({
    where: { id: params.userId },
    data: { recoveryHash: params.recoveryHash },
  });
}

/** Пространство по идентификатору. */
export async function findWorkspace(workspaceId: string): Promise<Workspace | null> {
  return prisma.workspace.findUnique({ where: { id: workspaceId } });
}

/**
 * Заводит сайт в рабочем пространстве.
 *
 * Ключ генерируется здесь, а не приходит из формы: он должен быть случайным.
 * Придуманный человеком ключ рано или поздно окажется одинаковым у двух сайтов,
 * и переписка одного польётся в другой.
 *
 * Настроек ассистента у нового сайта нет — и это нормально: пока владелец их не
 * задал, работают умолчания из кода.
 */
export async function createSite(params: {
  workspaceId: string;
  name: string;
  allowedOrigins: string[];
}): Promise<Site> {
  return prisma.site.create({
    data: {
      workspaceId: params.workspaceId,
      name: params.name,
      publicKey: `pub_${randomBytes(16).toString('base64url')}`,
      allowedOrigins: [...params.allowedOrigins],
    },
  });
}

/** Сколько владельцев в пространстве. */
export async function countWorkspaceOwners(workspaceId: string): Promise<number> {
  return prisma.membership.count({ where: { workspaceId, role: 'OWNER' } });
}

/** Убирает оператора из пространства. */
export async function removeMembership(params: {
  userId: string;
  workspaceId: string;
}): Promise<void> {
  await prisma.membership.deleteMany({
    where: { userId: params.userId, workspaceId: params.workspaceId },
  });
}

/**
 * Удаляет пространство.
 *
 * Каскадом уходят сайты, их переписки и сообщения — то есть действие
 * необратимое. Поэтому подтверждение в панели требует набрать имя пространства,
 * а не нажать кнопку.
 */
export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await prisma.workspace.deleteMany({ where: { id: workspaceId } });
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

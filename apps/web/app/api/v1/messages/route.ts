import type { ChatMessage, MessagesResponse, SendMessageResponse } from '@ecw/shared';
import type { Message } from '@prisma/client';
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateWidget } from '@/lib/auth';
import { ConversationNotFoundError, appendVisitorMessage, listMessages } from '@/lib/data';
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  readJson,
  requestOrigin,
} from '@/lib/http';

/**
 * Обмен сообщениями.
 *
 * Отправка идёт POST, приём — GET с курсором. Курсор (`after`) — это номер
 * последнего известного клиенту сообщения: сервер отдаёт всё, что после него.
 * Такой способ, в отличие от «последние N сообщений», не теряет и не дублирует
 * сообщения при обрывах связи и повторных запросах.
 *
 * Токен проверяется на КАЖДОМ запросе, а не только при входе. Это не
 * избыточность: токен может истечь между запросами, а диалог из токена обязан
 * принадлежать тому же сайту — иначе по украденному токену можно было бы читать
 * чужую переписку.
 */

export const dynamic = 'force-dynamic';

/** Сколько сообщений отдаём за один запрос. */
const PAGE_LIMIT = 100;

/** Предельная длина сообщения. Ограничение защищает базу и бюджет ассистента. */
const MAX_BODY_LENGTH = 4000;

const sendSchema = z.object({
  /** Идентификатор, присвоенный клиентом. На нём держится идемпотентность. */
  clientId: z.string().min(1).max(120),
  body: z.string().min(1).max(MAX_BODY_LENGTH),
});

export function OPTIONS(request: Request): Response {
  return preflightResponse(request);
}

/** Выборка новых сообщений: всё, что после указанного номера. */
export async function GET(request: Request): Promise<NextResponse> {
  const origin = requestOrigin(request);

  const claims = await authenticateWidget(request);
  if (!claims) return errorResponse('unauthorized', 401, origin);

  const raw = new URL(request.url).searchParams.get('after') ?? '0';
  const parsed = Number.parseInt(raw, 10);
  const afterSeq = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;

  const messages = await listMessages({
    siteId: claims.siteId,
    conversationId: claims.conversationId,
    afterSeq,
    limit: PAGE_LIMIT,
  });

  const response: MessagesResponse = {
    messages: messages.map(toWireMessage),
    lastSeq: messages.at(-1)?.seq ?? afterSeq,
  };
  return jsonResponse(response, 200, origin);
}

/** Отправка сообщения посетителя. */
export async function POST(request: Request): Promise<NextResponse> {
  const origin = requestOrigin(request);

  const claims = await authenticateWidget(request);
  if (!claims) return errorResponse('unauthorized', 401, origin);

  const parsed = sendSchema.safeParse(await readJson(request));
  if (!parsed.success) return errorResponse('invalid_request', 400, origin);

  const body = parsed.data.body.trim();
  if (!body) return errorResponse('empty_message', 400, origin);

  try {
    const { message, duplicate } = await appendVisitorMessage({
      siteId: claims.siteId,
      conversationId: claims.conversationId,
      clientId: parsed.data.clientId,
      body,
    });

    const response: SendMessageResponse = { message: toWireMessage(message), duplicate };
    // Повторная отправка ничего не создала — отвечаем как за обычный успех.
    return jsonResponse(response, duplicate ? 200 : 201, origin);
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return errorResponse('conversation_not_found', 404, origin);
    }
    console.error('[ecw] не удалось записать сообщение', error);
    return errorResponse('server_error', 500, origin);
  }
}

/** Приводит сообщение из базы к общему контракту. */
function toWireMessage(message: Message): ChatMessage {
  return {
    id: message.id,
    seq: message.seq,
    conversationId: message.conversationId,
    authorKind: AUTHOR_KIND[message.author],
    body: message.body,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * Перечисление в базе — заглавными буквами, в контракте — строчными.
 * Соответствие задано таблицей, а не преобразованием регистра: если в базе
 * появится новое значение, компилятор заставит его описать.
 */
const AUTHOR_KIND = {
  VISITOR: 'visitor',
  AI: 'ai',
  AGENT: 'agent',
} as const satisfies Record<Message['author'], ChatMessage['authorKind']>;

import type { MessagesResponse, SendMessageResponse } from '@ecw/shared';
import type { Message } from '@prisma/client';
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { HISTORY_TURNS, answerQuestion, toChatTurns } from '@/lib/assistant';
import type { ChatTurn } from '@/lib/ai';
import { authenticateWidget } from '@/lib/auth';
import {
  ConversationNotFoundError,
  appendMessage,
  countAnswerFailure,
  countRecentVisitorMessages,
  listMessages,
  listRecentMessages,
  readConversationState,
} from '@/lib/data';
import { corsHeaders } from '@/lib/cors';
import { messagesPerMinute, minuteAgo } from '@/lib/limits';
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  readJson,
  requestOrigin,
  tooManyRequests,
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
 *
 * Отправка умеет отвечать двумя способами. Обычный JSON — полный ответ сразу.
 * Поток событий (`Accept: text/event-stream`) — текст по мере генерации; его
 * просит виджет, чтобы посетитель видел ответ, а не ждал молча. Выбор делает
 * клиент заголовком, а не отдельным адресом: тело запроса и проверки у обоих
 * способов одинаковые.
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
    state: toState(
      await readConversationState({
        siteId: claims.siteId,
        conversationId: claims.conversationId,
      }),
    ),
  };
  return jsonResponse(response, 200, origin);
}

/**
 * Состояние разговора для виджета.
 *
 * Если диалог не нашёлся (его удалили), отдаём «закрыт»: меню вернётся, и
 * посетитель начнёт заново — это лучше, чем молча ждать ничего.
 */
function toState(
  state: Awaited<ReturnType<typeof readConversationState>>,
): MessagesResponse['state'] {
  if (state === null) {
    return {
      waitingForHuman: false,
      humanRequestedAt: null,
      aiMode: false,
      humanJoined: false,
      closed: true,
    };
  }

  return {
    waitingForHuman: state.waitingForHuman,
    humanRequestedAt: state.humanRequestedAt?.toISOString() ?? null,
    aiMode: state.aiMode,
    humanJoined: state.humanJoined,
    closed: state.closed,
  };
}

/** Отправка сообщения посетителя. */
export async function POST(request: Request): Promise<Response> {
  const origin = requestOrigin(request);

  const claims = await authenticateWidget(request);
  if (!claims) return errorResponse('unauthorized', 401, origin);

  const parsed = sendSchema.safeParse(await readJson(request));
  if (!parsed.success) return errorResponse('invalid_request', 400, origin);

  const body = parsed.data.body.trim();
  if (!body) return errorResponse('empty_message', 400, origin);

  // Предел на сообщения в диалоге. Считаем по базе, а не в памяти: серверные
  // функции не хранят состояние между вызовами.
  const recent = await countRecentVisitorMessages({
    siteId: claims.siteId,
    conversationId: claims.conversationId,
    since: minuteAgo(),
  });
  if (recent >= messagesPerMinute()) {
    console.warn('[ecw] слишком часто пишут в диалог', {
      conversationId: claims.conversationId,
      recent,
    });
    return tooManyRequests(origin);
  }

  let history: ChatTurn[];
  let stored: { message: Message; duplicate: boolean };

  try {
    // Историю забираем ДО записи вопроса. Иначе он попал бы в переписку дважды:
    // один раз как последняя реплика истории, второй — как сам вопрос.
    history = toChatTurns(
      await listRecentMessages({
        siteId: claims.siteId,
        conversationId: claims.conversationId,
        limit: HISTORY_TURNS,
      }),
    );

    stored = await appendMessage({
      siteId: claims.siteId,
      conversationId: claims.conversationId,
      author: 'VISITOR',
      clientId: parsed.data.clientId,
      body,
    });
  } catch (error) {
    if (error instanceof ConversationNotFoundError) {
      return errorResponse('conversation_not_found', 404, origin);
    }
    console.error('[ecw] не удалось записать сообщение', error);
    return errorResponse('server_error', 500, origin);
  }

  const wantsStream = (request.headers.get('accept') ?? '').includes('text/event-stream');
  if (!wantsStream) {
    // Повторную отправку не переспрашиваем: ответ на неё уже есть, и каждый
    // повтор порождал бы новую реплику.
    if (!stored.duplicate) {
      await replyTo({
        siteId: claims.siteId,
        conversationId: claims.conversationId,
        question: body,
        history,
      });
    }

    const response: SendMessageResponse = {
      message: toWireMessage(stored.message),
      duplicate: stored.duplicate,
    };
    // Повторная отправка ничего не создала — отвечаем как за обычный успех.
    return jsonResponse(response, stored.duplicate ? 200 : 201, origin);
  }

  return streamReply({
    origin,
    signal: request.signal,
    siteId: claims.siteId,
    conversationId: claims.conversationId,
    question: body,
    history,
    visitor: stored.message,
    duplicate: stored.duplicate,
  });
}

/** Спрашивает модель и записывает ответ как обычное сообщение диалога. */
async function replyTo(params: {
  siteId: string;
  conversationId: string;
  question: string;
  history: readonly ChatTurn[];
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<Message | null> {
  const outcome = await answerQuestion({
    siteId: params.siteId,
    conversationId: params.conversationId,
    question: params.question,
    history: params.history,
    ...(params.onDelta === undefined ? {} : { onDelta: params.onDelta }),
    ...(params.signal === undefined ? {} : { signal: params.signal }),
  });

  if (outcome.source === 'none') {
    // Модель не ответила. Неудачи считаем — они видны в журнале и объясняют,
    // почему ассистент молчит, — но человека НЕ зовём.
    //
    // Раньше после трёх неудач подряд код сам звал оператора. Это оказалось
    // неверным решением: посетитель выбрал ассистента, а получал очередь к
    // человеку. Решать за него нельзя: он увидит честный текст, что ассистент
    // сейчас недоступен, и сам выберет пункт «позвать человека», если нужно.
    await countAnswerFailure(params);
  }

  // Пустой текст означает «отвечать нечем»: например, диалог уже ждёт живого
  // оператора, и ассистент молчит, чтобы не перебивать человека.
  if (outcome.text === '') return null;

  const stored = await appendMessage({
    siteId: params.siteId,
    conversationId: params.conversationId,
    author: 'AI',
    body: outcome.text,
  });
  return stored.message;
}

/** Отвечает потоком событий: подтверждение приёма, куски текста, готовое сообщение. */
function streamReply(params: {
  origin: string;
  signal: AbortSignal;
  siteId: string;
  conversationId: string;
  question: string;
  history: readonly ChatTurn[];
  visitor: Message;
  duplicate: boolean;
}): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Посетитель закрыл окно и соединение. Генерацию не прерываем: ответ
          // всё равно надо записать, иначе оператор не увидит, что отвечали.
        }
      };

      try {
        // Подтверждение приёма идёт первым: виджет снимает состояние
        // «отправляется», не дожидаясь ответа модели.
        send('accepted', {
          message: toWireMessage(params.visitor),
          duplicate: params.duplicate,
        });

        if (!params.duplicate) {
          const answer = await replyTo({
            siteId: params.siteId,
            conversationId: params.conversationId,
            question: params.question,
            history: params.history,
            onDelta: (text) => {
              send('delta', { text });
            },
            signal: params.signal,
          });

          // Ответа может не быть: диалог ждёт живого оператора, или модель
          // сейчас недоступна. Виджету сообщаем прямо и с настоящим состоянием:
          // «молчит модель» — не повод показывать посетителю очередь к человеку.
          if (answer) send('done', { message: toWireMessage(answer) });
          else {
            const state = await readConversationState({
              siteId: params.siteId,
              conversationId: params.conversationId,
            });
            send('idle', { waitingForHuman: state?.waitingForHuman ?? false });
          }
        }
      } catch (error) {
        console.error('[ecw] не удалось ответить в потоке', error);
        send('error', { error: 'server_error' });
      } finally {
        try {
          controller.close();
        } catch {
          // Поток уже закрыт — например, клиент ушёл и чтение прекратилось.
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // Ни кэш, ни посредник не должны копить ответ: иначе весь смысл потока
      // теряется и текст придёт одним куском в самом конце.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(params.origin),
    },
  });
}

/**
 * Переписку отдаёт не только этот маршрут, поэтому приведение к контракту живёт
 * в lib/chat-message.ts. Импортируем под прежним именем: внутри файла оно
 * читается как местное, а второй копии формата не появляется.
 */
import { toChatMessage as toWireMessage } from '@/lib/chat-message';

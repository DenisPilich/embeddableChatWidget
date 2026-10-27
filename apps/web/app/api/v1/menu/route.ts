import type { ChatMessage, MenuClickResponse } from '@ecw/shared';
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateWidget } from '@/lib/auth';
import { toChatMessage } from '@/lib/chat-message';
import {
  appendMessage,
  clearHumanRequest,
  readConversationState,
  requestHuman,
  setAiMode,
} from '@/lib/data';
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  readJson,
  requestOrigin,
} from '@/lib/http';
import { countMenuClick, findMenuOption } from '@/lib/menu';

/**
 * Выбор пункта меню.
 *
 * Отдельный адрес, а не сообщение: нажатие и текст — разные действия. Нажатие
 * может означать «покажи ответ», «позови человека» или «открой подменю», и
 * превращать его в реплику посетителя значило бы врать в переписке.
 *
 * Ответ содержит появившиеся сообщения: виджет показывает их сразу, не дожидаясь
 * следующего опроса. Подписка на новые сообщения остаётся как страховка — если
 * ответ потеряется, текст всё равно приедет.
 */
export const dynamic = 'force-dynamic';

const clickSchema = z.object({
  optionId: z.string().min(1).max(120),
});

export function OPTIONS(request: Request): Response {
  return preflightResponse(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = requestOrigin(request);

  const claims = await authenticateWidget(request);
  if (claims === null) return errorResponse('unauthorized', 401, origin);

  const parsed = clickSchema.safeParse(await readJson(request));
  if (!parsed.success) return errorResponse('invalid_request', 400, origin);

  // Пункт обязан принадлежать сайту из токена: иначе, подобрав идентификатор,
  // можно было бы заставить чужой чат отвечать чужими ответами.
  const option = await findMenuOption({ siteId: claims.siteId, optionId: parsed.data.optionId });
  if (option === null) return errorResponse('invalid_request', 404, origin);

  await countMenuClick(option.id);

  const messages: ChatMessage[] = [];

  if (option.action === 'ANSWER' && option.answer !== null) {
    // Вопрос посетителя попадает в переписку его же словами: оператор должен
    // видеть, что человек выбрал, а не догадываться по ответу.
    const asked = await appendMessage({
      siteId: claims.siteId,
      conversationId: claims.conversationId,
      author: 'VISITOR',
      body: option.label,
    });
    messages.push(toChatMessage(asked.message));

    const replied = await appendMessage({
      siteId: claims.siteId,
      conversationId: claims.conversationId,
      author: 'AI',
      body: option.answer,
    });
    messages.push(toChatMessage(replied.message));
  }

  if (option.action === 'OPERATOR') {
    // requestHuman сам пишет в переписку «оператор приглашён», поэтому отдельную
    // реплику с текстом кнопки здесь не добавляем — вышло бы два раза про одно.
    await requestHuman({ siteId: claims.siteId, conversationId: claims.conversationId });
  }

  if (option.action === 'AI') {
    // Только здесь и только по явному выбору посетителя ассистент получает
    // право отвечать. Ни в каком другом случае модель не вмешивается.
    await setAiMode({ siteId: claims.siteId, conversationId: claims.conversationId, on: true });

    // И снимаем ожидание человека: посетитель мог позвать оператора, не
    // дождаться и вернуться к ассистенту. Без этого разговор оставался бы
    // «ведёт человек», и модель молчала бы, хотя её только что выбрали.
    await clearHumanRequest({ siteId: claims.siteId, conversationId: claims.conversationId });
  }

  // Подменю и «свой вопрос» в переписку ничего не пишут: посетитель ещё ничего
  // не спросил, он только открыл следующий список или поле ввода.

  const state = await readConversationState({
    siteId: claims.siteId,
    conversationId: claims.conversationId,
  });

  const response: MenuClickResponse = {
    messages,
    waitingForHuman: state?.waitingForHuman ?? false,
    humanRequestedAt: state?.humanRequestedAt?.toISOString() ?? null,
  };

  return jsonResponse(response, 200, origin);
}

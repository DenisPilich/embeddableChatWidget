import type { NextResponse } from 'next/server';
import { authenticateWidget } from '@/lib/auth';
import { appendMessage, requestHuman } from '@/lib/data';
import { errorResponse, jsonResponse, preflightResponse, requestOrigin } from '@/lib/http';

/**
 * Просьба позвать живого оператора.
 *
 * Отдельное действие, а не сообщение: посетитель не пишет текст, он нажимает
 * кнопку. Смешивать это с перепиской нельзя — оператор должен видеть в списке,
 * кто именно просит человека, а не разбирать текст в поисках намёка.
 *
 * После просьбы ассистент замолкает: иначе оператор и модель отвечали бы по
 * очереди, и посетитель читал бы двух разных собеседников, не понимая, кому
 * верить.
 *
 * Повторная просьба безопасна: время ожидания не сбрасывается, и очередь
 * «кто ждёт дольше всех» остаётся честной.
 */

export const dynamic = 'force-dynamic';

const CONFIRMATION =
  'An operator has been asked to join this conversation. You can keep writing here.';

export function OPTIONS(request: Request): Response {
  return preflightResponse(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = requestOrigin(request);

  const claims = await authenticateWidget(request);
  if (!claims) return errorResponse('unauthorized', 401, origin);

  try {
    const first = await requestHuman({
      siteId: claims.siteId,
      conversationId: claims.conversationId,
    });

    if (first) {
      // Подтверждение — обычное сообщение диалога: посетитель видит, что
      // просьба принята, а оператор в дашборде видит её в переписке, а не
      // только в списке ожидающих.
      await appendMessage({
        siteId: claims.siteId,
        conversationId: claims.conversationId,
        author: 'AI',
        body: CONFIRMATION,
      });
    }

    return jsonResponse({ waitingForHuman: true }, 200, origin);
  } catch (error) {
    console.error('[ecw] не удалось позвать оператора', error);
    return errorResponse('server_error', 500, origin);
  }
}

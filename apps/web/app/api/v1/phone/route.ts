import type { PhoneResponse } from '@ecw/shared';
import type { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticateWidget } from '@/lib/auth';
import { toChatMessage } from '@/lib/chat-message';
import { appendMessage, setConversationPhone } from '@/lib/data';
import {
  errorResponse,
  jsonResponse,
  preflightResponse,
  readJson,
  requestOrigin,
} from '@/lib/http';

/**
 * Телефон, оставленный вместо ожидания оператора.
 *
 * Номер не требует подтверждения по SMS и не является «заявкой»: это строчка в
 * разговоре, по которой оператор перезвонит. Обещание перезвонить держится на
 * человеке, а не на системе, и в панели для этого есть отметка «перезвонил».
 */
export const dynamic = 'force-dynamic';

const phoneSchema = z.object({
  phone: z.string().trim().min(4).max(40),
});

export function OPTIONS(request: Request): Response {
  return preflightResponse(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  const origin = requestOrigin(request);

  const claims = await authenticateWidget(request);
  if (claims === null) return errorResponse('unauthorized', 401, origin);

  const parsed = phoneSchema.safeParse(await readJson(request));
  if (!parsed.success) return errorResponse('invalid_request', 400, origin);

  const phone = normalizePhone(parsed.data.phone);
  if (phone === null) return errorResponse('invalid_request', 400, origin);

  await setConversationPhone({
    siteId: claims.siteId,
    conversationId: claims.conversationId,
    phone,
  });

  const confirmation = await appendMessage({
    siteId: claims.siteId,
    conversationId: claims.conversationId,
    author: 'AI',
    body: `Thank you. We will call you back at ${phone} as soon as an operator is free. Sorry for the wait.`,
  });

  const response: PhoneResponse = { message: toChatMessage(confirmation.message), phone };
  return jsonResponse(response, 200, origin);
}

/**
 * Приводит номер к виду «плюс и цифры».
 *
 * Человек наберёт пробелы, скобки и дефисы, а оператору нужен номер, по которому
 * можно набрать. Минимум шесть цифр — отсекает случайные нажатия, максимум
 * пятнадцать — предел телефонных номеров по стандарту.
 */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length < 6 || digits.length > 15) return null;

  return `+${digits}`;
}

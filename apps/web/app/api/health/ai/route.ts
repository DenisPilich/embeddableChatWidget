import { NextResponse } from 'next/server';
import { DEFAULT_MODEL, providerName } from '@/lib/ai';

/**
 * Диагностика ассистента.
 *
 * Отвечает на вопрос «отвечает модель или заготовки». Без этого отсутствие ключа
 * выглядит как странное поведение ассистента, и причину приходится искать в
 * журналах сервера.
 *
 * Ключ и системные промпты наружу не отдаются: имя провайдера и имя модели —
 * не секреты, а всё остальное секрет или чужая коммерческая информация.
 */

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  const provider = providerName();

  return NextResponse.json({
    provider,
    model: process.env.ECW_AI_MODEL?.trim() || DEFAULT_MODEL,
    // Готов ли ассистент отвечать по-настоящему.
    ready: provider !== 'canned',
  });
}

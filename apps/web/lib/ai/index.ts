import { createCannedProvider } from './canned';
import { createGroqProvider } from './groq';
import type { AnswerProvider } from './provider';

export type { AnswerProvider, AnswerRequest, AnswerResult, ChatTurn } from './provider';
export { DEFAULT_MODEL } from './provider';

/**
 * Выбирает провайдера по настройкам окружения.
 *
 * Без ключа проект работает на заготовках: установить, запустить и посмотреть
 * демо можно, не заводя ни одного аккаунта. Ключ появился — включается модель,
 * и больше ничего менять не нужно.
 *
 * Результат запоминается: разбирать окружение на каждый вопрос незачем.
 */
let cached: AnswerProvider | null = null;

export function resolveProvider(): AnswerProvider {
  if (cached) return cached;

  // Принудительный выбор провайдера. Нужен автотестам (чтобы не зависеть от
  // живой модели) и отладке: сравнить, как отвечает модель и как заготовки.
  const forced = process.env.ECW_AI_PROVIDER?.trim();
  if (forced === 'canned') {
    cached = createCannedProvider();
    return cached;
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (forced === 'groq' && !apiKey) {
    throw new Error('ECW_AI_PROVIDER=groq, но GROQ_API_KEY не задан');
  }

  if (!apiKey) {
    // Сообщаем один раз и внятно: иначе «ассистент отвечает заготовками»
    // выглядит как поломка, а не как отсутствие ключа.
    console.warn('[ecw] GROQ_API_KEY не задан: ассистент отвечает заготовками');
    cached = createCannedProvider();
    return cached;
  }

  cached = createGroqProvider({ apiKey });
  return cached;
}

/** Имя действующего провайдера. Нужно диагностике и проверкам. */
export function providerName(): string {
  return resolveProvider().name;
}

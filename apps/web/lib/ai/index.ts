import { createCannedProvider } from './canned';
import { createChatCompletionsProvider } from './chat-completions';
import { PRESETS, ProviderError, type AnswerProvider, type PresetName } from './provider';

export type { AnswerProvider, AnswerRequest, AnswerResult, ChatTurn } from './provider';
export { PRESETS } from './provider';

/**
 * Выбирает провайдера по настройкам окружения.
 *
 * Без ключа проект работает целиком на заготовках: установить, запустить и
 * посмотреть демо можно, не заводя ни одного аккаунта. Ключ появился —
 * включается модель, и больше ничего менять не нужно.
 *
 * Сервис выбирается переменной `ECW_AI_PROVIDER` (см. PRESETS). По умолчанию
 * Groq; ключ принимается и под общим именем `ECW_AI_KEY`, и под старым
 * `GROQ_API_KEY`.
 *
 * Результат запоминается: разбирать окружение на каждый вопрос незачем.
 */
let cached: AnswerProvider | null = null;

/** Имя выбранного сервиса: `canned`, `groq`, `gemini` или `custom`. */
export function providerName(): string {
  const forced = process.env.ECW_AI_PROVIDER?.trim().toLowerCase();
  if (forced === 'canned') return 'canned';
  if (forced && forced in PRESETS) return forced;
  return 'groq';
}

/**
 * Ключ доступа.
 *
 * Два имени принимаются намеренно: `ECW_AI_KEY` — общее, потому что сервис
 * выбирается настройкой, а `GROQ_API_KEY` — по старому имени, чтобы уже
 * заполненные файлы окружения продолжали работать.
 */
function readKey(): string {
  return (process.env.ECW_AI_KEY?.trim() ?? '') || (process.env.GROQ_API_KEY?.trim() ?? '');
}

/** Адрес точки chat completions для выбранного сервиса. */
export function activeEndpoint(): string {
  const custom = process.env.ECW_AI_ENDPOINT?.trim();
  if (custom) return custom;

  const preset = PRESETS[providerName() as PresetName];
  return preset ? preset.endpoint : '';
}

/** Имя модели: из окружения, из настроек сайта или из пресета сервиса. */
export function activeModel(): string {
  const fromEnv = process.env.ECW_AI_MODEL?.trim();
  if (fromEnv) return fromEnv;

  const preset = PRESETS[providerName() as PresetName];
  return preset ? preset.model : '';
}

/** Что отвечает посетителям сейчас. Для диагностики и проверок. */
export interface ProviderInfo {
  provider: string;
  model: string;
  endpoint: string;
  /**
   * Настроен ли сервис — то есть выбран не `canned` и ключ непустой.
   *
   * **Это не значит, что ключ рабочий.** Проверить его можно только настоящим
   * обращением к модели: `verifyProvider()`. Поле названо `configured`, а не
   * `ready`, именно поэтому: однажды `ready: true` при негодном ключе уже
   * ввело в заблуждение.
   */
  configured: boolean;
}

export function providerInfo(): ProviderInfo {
  const provider = providerName();
  return {
    provider,
    model: activeModel(),
    endpoint: activeEndpoint(),
    configured: provider !== 'canned' && readKey() !== '',
  };
}

/** Итог настоящей проверки: один минимальный запрос к модели. */
export interface ProviderCheck {
  ok: boolean;
  /** Что чинить, если не прошло. Человеческим языком. */
  reason?: string;
  /** Код ответа сервиса, если он был. */
  status?: number;
}

/**
 * Проверяет сервис настоящим запросом.
 *
 * Одного вопроса в несколько токенов достаточно, чтобы отличить рабочий ключ от
 * нерабочего. Стоит доли копейки, поэтому вызывается по явной просьбе
 * (`?check=1`), а не при каждом обращении к диагностике.
 *
 * Текст ответа сервиса наружу не отдаётся: отдаём код и объяснение, что он
 * значит. Подробность остаётся в журнале.
 */
export async function verifyProvider(): Promise<ProviderCheck> {
  try {
    const provider = resolveProvider();
    await provider.answer({
      question: 'Reply with the single word: ready',
      systemPrompt: 'Answer with one word only.',
      history: [],
      model: activeModel(),
      temperature: 0,
      maxTokens: 8,
    });
    return { ok: true };
  } catch (error) {
    const status = error instanceof ProviderError ? error.status : null;
    console.error('[ecw] проверка сервиса модели не прошла', error);

    return {
      ok: false,
      ...(status === null ? {} : { status }),
      reason: explain(status, error),
    };
  }
}

function explain(status: number | null, error: unknown): string {
  // Google отвечает 400 на негодный ключ, а не 401, как большинство сервисов.
  // Поэтому 400 разбираем отдельно — иначе самая частая причина выглядит как
  // «не удалось получить ответ», по чему нельзя понять, что чинить.
  if (status === 400) return 'сервис отклонил запрос: обычно это неверный ключ или имя модели';
  if (status === 401 || status === 403) return 'сервис отклонил ключ';
  if (status === 404) return 'сервис не знает такую модель или адрес';
  if (status === 429) return 'упёрлись в ограничение скорости запросов';
  if (status !== null && status >= 500) return 'сервис модели недоступен';
  if (error instanceof Error && error.name === 'AbortError') return 'сервис не ответил вовремя';
  return 'не удалось получить ответ от сервиса';
}

export function resolveProvider(): AnswerProvider {
  if (cached) return cached;

  const provider = providerName();

  if (provider === 'canned') {
    cached = createCannedProvider();
    return cached;
  }

  const apiKey = readKey();
  if (!apiKey) {
    const preset = PRESETS[provider as PresetName];
    const hint = preset?.keysUrl ? ` Ключ можно получить здесь: ${preset.keysUrl}` : '';
    // Сообщаем внятно и один раз: иначе «ассистент отвечает заготовками»
    // выглядит как поломка, а не как отсутствие ключа.
    console.warn(`[ecw] ключ модели не задан, ассистент отвечает заготовками.${hint}`);
    cached = createCannedProvider();
    return cached;
  }

  const endpoint = activeEndpoint();
  if (!endpoint) {
    throw new Error('Не задан адрес модели: для сервиса `custom` нужна переменная ECW_AI_ENDPOINT');
  }

  cached = createChatCompletionsProvider({ name: provider, apiKey, endpoint });
  return cached;
}

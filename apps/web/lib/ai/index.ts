import { createCannedProvider } from './canned';
import { createChatCompletionsProvider } from './chat-completions';
import { PRESETS, type AnswerProvider, type PresetName } from './provider';

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
  ready: boolean;
}

export function providerInfo(): ProviderInfo {
  const provider = providerName();
  return {
    provider,
    model: activeModel(),
    endpoint: activeEndpoint(),
    ready: provider !== 'canned' && readKey() !== '',
  };
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

import {
  ProviderError,
  type AnswerProvider,
  type AnswerRequest,
  type AnswerResult,
} from './provider';

/**
 * Провайдер, говорящий на языке chat completions.
 *
 * Запрос идёт обычным `fetch` — без библиотеки-обёртки. Пакет SDK добавил бы
 * зависимость и слой абстракции над одним HTTP-запросом; здесь же всё видно
 * целиком, включая то, что уходит наружу.
 *
 * Один и тот же код обслуживает и Groq, и Gemini, и модель на своём компьютере:
 * различаются только адрес и ключ. Это и есть смысл того, что провайдер спрятан
 * за интерфейсом.
 *
 * Транспорт подменяем (`fetchImpl`): так сборку запроса и разбор ответа можно
 * проверять без сети и без ключа. Это не украшение — иначе единственным способом
 * узнать, что мы правильно формируем запрос, была бы живая модель.
 */

/** Сколько ждать ответа, прежде чем считать попытку потерянной. */
const TIMEOUT_MS = 30_000;

/** Сколько символов ответа провайдера писать в журнал при ошибке. */
const ERROR_DETAIL_LIMIT = 500;

export interface ChatCompletionsOptions {
  /** Имя для журнала: groq, gemini, свой сервер. */
  name: string;
  apiKey: string;
  /** Полный адрес точки chat/completions. */
  endpoint: string;
  /** Подменяемый транспорт для проверок. */
  fetchImpl?: typeof fetch;
}

interface CompletionResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createChatCompletionsProvider(options: ChatCompletionsOptions): AnswerProvider {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: options.name,

    async answer(request: AnswerRequest): Promise<AnswerResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, TIMEOUT_MS);

      try {
        const response = await doFetch(options.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(buildBody(request)),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Подробность уходит в наш журнал и только туда: в теле ответа
          // провайдера может лежать кусок нашего запроса, то есть системный
          // промпт клиента. Наружу его отдавать нельзя.
          const detail = await readErrorDetail(response);
          throw new ProviderError(
            `${options.name} ответил ${String(response.status)}: ${detail}`,
            response.status,
          );
        }

        const payload = (await response.json()) as CompletionResponse;
        const text = payload.choices?.[0]?.message?.content?.trim();
        if (!text) {
          throw new ProviderError(`${options.name} вернул пустой ответ`);
        }

        return {
          text,
          inputTokens: payload.usage?.prompt_tokens ?? 0,
          outputTokens: payload.usage?.completion_tokens ?? 0,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Собирает тело запроса. Вынесено отдельно, чтобы это можно было проверить. */
export function buildBody(request: AnswerRequest): Record<string, unknown> {
  return {
    model: request.model,
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    messages: [
      { role: 'system', content: request.systemPrompt },
      ...request.history.map((turn) => ({ role: turn.role, content: turn.text })),
      { role: 'user', content: request.question },
    ],
  };
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, ERROR_DETAIL_LIMIT);
  } catch {
    return '(тело ответа прочитать не удалось)';
  }
}

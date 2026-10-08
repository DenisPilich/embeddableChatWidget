import type { AnswerProvider, AnswerRequest, AnswerResult } from './provider';

/**
 * Провайдер на Groq.
 *
 * Запрос идёт обычным `fetch` по адресу, совместимому с OpenAI, — без
 * библиотеки-обёртки. Пакет SDK добавил бы зависимость и слой абстракции над
 * одним HTTP-запросом; здесь же всё видно целиком, включая то, что уходит
 * наружу.
 *
 * Транспорт подменяем (`fetchImpl`): так сборку запроса и разбор ответа можно
 * проверять без сети и без ключа. Это не украшение — иначе единственным
 * способом узнать, что мы правильно формируем запрос, была бы живая модель.
 */

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** Сколько ждать ответа, прежде чем считать попытку потерянной. */
const TIMEOUT_MS = 30_000;

/** Сколько символов ответа провайдера писать в журнал при ошибке. */
const ERROR_DETAIL_LIMIT = 500;

interface GroqOptions {
  apiKey: string;
  /** Подменяемый транспорт для проверок. */
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

interface GroqResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createGroqProvider(options: GroqOptions): AnswerProvider {
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = options.endpoint ?? ENDPOINT;

  return {
    name: 'groq',

    async answer(request: AnswerRequest): Promise<AnswerResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, TIMEOUT_MS);

      try {
        const response = await doFetch(endpoint, {
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
          throw new Error(`провайдер ответил ${String(response.status)}: ${detail}`);
        }

        const payload = (await response.json()) as GroqResponse;
        const text = payload.choices?.[0]?.message?.content?.trim();
        if (!text) {
          throw new Error('провайдер вернул пустой ответ');
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

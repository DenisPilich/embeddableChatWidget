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

/** Сколько ждать ответа целиком, прежде чем считать попытку потерянной. */
const TIMEOUT_MS = 30_000;

/**
 * Сколько ждать поток. Больше, чем обычный ответ: текст идёт по частям, и
 * «думающая» модель может молчать дольше, чем длится весь обычный запрос.
 */
const STREAM_TIMEOUT_MS = 60_000;

/** Сколько символов ответа сервиса писать в журнал при ошибке. */
const ERROR_DETAIL_LIMIT = 500;

/**
 * Сколько символов приходится на токен при оценке.
 *
 * Нужна для сервисов, которые в потоковом режиме не сообщают расход. Оценка
 * грубая, но лучше неё отсутствие учёта: иначе дневной бюджет перестал бы
 * что-либо ограничивать ровно в том режиме, которым пользуются все.
 */
const CHARS_PER_TOKEN = 4;

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
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface StreamChunk {
  choices?: { delta?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function createChatCompletionsProvider(options: ChatCompletionsOptions): AnswerProvider {
  const doFetch = options.fetchImpl ?? fetch;

  return {
    name: options.name,

    async answer(request: AnswerRequest): Promise<AnswerResult> {
      const streaming = request.onDelta !== undefined;
      const controller = new AbortController();
      const timer = setTimeout(
        () => {
          controller.abort();
        },
        streaming ? STREAM_TIMEOUT_MS : TIMEOUT_MS,
      );

      // Отмена снаружи должна прерывать и наш запрос к сервису: иначе работа
      // продолжится, а результат будет выброшен.
      const onOuterAbort = (): void => {
        controller.abort();
      };
      request.signal?.addEventListener('abort', onOuterAbort, { once: true });

      try {
        const response = await doFetch(options.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            'Content-Type': 'application/json',
            ...(streaming ? { Accept: 'text/event-stream' } : {}),
          },
          body: JSON.stringify(buildBody(request, streaming)),
          signal: controller.signal,
        });

        if (!response.ok) {
          // Подробность уходит в наш журнал и только туда: в теле ответа
          // провайдера может лежать кусок нашего запроса, то есть системный
          // промпт клиента. Наружу его отдавать нельзя. А вот код ответа —
          // можно и нужно: по нему понятно, что чинить.
          const detail = await readErrorDetail(response);
          throw new ProviderError(
            `${options.name} ответил ${String(response.status)}: ${detail}`,
            response.status,
          );
        }

        return streaming
          ? await readStream(response, request, options.name)
          : await readWhole(response, options.name);
      } finally {
        clearTimeout(timer);
        request.signal?.removeEventListener('abort', onOuterAbort);
      }
    },
  };
}

/**
 * Собирает тело запроса.
 *
 * Вынесено отдельно, чтобы это можно было проверить: ошибка в сборке запроса не
 * видна — модель ведь всё равно отвечает, просто не то, что нужно, или не
 * помнит разговора.
 */
export function buildBody(request: AnswerRequest, streaming = false): Record<string, unknown> {
  return {
    model: request.model,
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    ...(streaming ? { stream: true } : {}),
    messages: [
      { role: 'system', content: request.systemPrompt },
      ...request.history.map((turn) => ({ role: turn.role, content: turn.text })),
      { role: 'user', content: request.question },
    ],
  };
}

/** Ответ пришёл целиком, одним куском. */
async function readWhole(response: Response, name: string): Promise<AnswerResult> {
  const payload = (await response.json()) as CompletionResponse;
  const choice = payload.choices?.[0];
  const text = choice?.message?.content?.trim();

  if (!text) throw emptyAnswer(choice?.finish_reason, name);

  return {
    text,
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
  };
}

/**
 * Ответ приходит потоком событий.
 *
 * Формат простой: события разделяются пустой строкой, внутри — строки `data:` с
 * куском JSON. Собирать его приходится вручную, потому что тела ответов в
 * браузере и в Node выглядят по-разному, а нам нужен один код на оба.
 */
async function readStream(
  response: Response,
  request: AnswerRequest,
  name: string,
): Promise<AnswerResult> {
  const body = response.body;
  if (!body) throw new ProviderError(`${name} не отдал поток`);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  const notify = request.onDelta ?? ((): void => undefined);

  let buffer = '';
  let text = '';
  let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice('data:'.length).trim();
        if (payload === '' || payload === '[DONE]') continue;

        const chunk = parseChunk(payload);
        if (chunk === null) continue;

        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta !== '') {
          text += delta;
          notify(delta);
        }
        if (chunk.usage) usage = chunk.usage;
      }
    }
  }

  const trimmed = text.trim();
  if (trimmed === '') throw emptyAnswer(null, name);

  return {
    text: trimmed,
    inputTokens: usage?.prompt_tokens ?? estimateTokens(request),
    outputTokens: usage?.completion_tokens ?? estimateTokens(text),
  };
}

/** Разбирает одно событие. Служебные и неполные пропускаем молча. */
function parseChunk(payload: string): StreamChunk | null {
  try {
    return JSON.parse(payload) as StreamChunk;
  } catch {
    return null;
  }
}

function estimateTokens(value: string | AnswerRequest): number {
  const length = typeof value === 'string' ? value.length : estimateRequestLength(value);
  return Math.max(1, Math.round(length / CHARS_PER_TOKEN));
}

function estimateRequestLength(request: AnswerRequest): number {
  return (
    request.systemPrompt.length +
    request.question.length +
    request.history.reduce((total, turn) => total + turn.text.length, 0)
  );
}

/**
 * Пустой ответ.
 *
 * Пустой ответ бывает не поломкой, а следствием тесного предела длины: модели,
 * которые «думают» перед ответом, тратят часть предела на размышление, и на сам
 * ответ ничего не остаётся. Разница принципиальная — одно чинится числом.
 */
function emptyAnswer(finishReason: string | null | undefined, name: string): ProviderError {
  if (finishReason === 'length') {
    return new ProviderError(`${name}: ответ не поместился в предел длины — увеличьте max_tokens`);
  }
  return new ProviderError(`${name} вернул пустой ответ`);
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.slice(0, ERROR_DETAIL_LIMIT);
  } catch {
    return '(тело ответа прочитать не удалось)';
  }
}

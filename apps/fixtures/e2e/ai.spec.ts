import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { activeEndpoint, activeModel, providerName } from '../../web/lib/ai';
import { buildBody, createChatCompletionsProvider } from '../../web/lib/ai/chat-completions';
import { ProviderError } from '../../web/lib/ai/provider';

/**
 * Проверки слоя модели.
 *
 * Сборка запроса проверяется всегда: она не зависит ни от сети, ни от ключа, и
 * именно она чаще всего ломается незаметно — модель ведь всё равно отвечает,
 * просто не то, что нужно, или не помнит разговора.
 *
 * Живое обращение к модели проверяется только когда ключ есть. Набор не должен
 * становиться платным, медленным и зависимым от чужого сервиса — иначе упавшая
 * у провайдера модель красила бы тесты, к ней не относящиеся.
 *
 * Настройки читаются прямо из `apps/web/.env`, где они и живут. В окружение
 * тестов ключ намеренно не попадает.
 */

const REQUEST = {
  question: 'How much is a cappuccino?',
  systemPrompt: 'You are a barista.',
  history: [
    { role: 'user' as const, text: 'Hello' },
    { role: 'assistant' as const, text: 'Hello! How can I help?' },
  ],
  model: 'test-model',
  temperature: 0.3,
  maxTokens: 100,
};

function readEnvFile(): string | null {
  try {
    return readFileSync(new URL('../../web/.env', import.meta.url), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Переносит настройки из `apps/web/.env` в окружение теста.
 *
 * Функции слоя модели читают окружение **в момент вызова**, а не при импорте,
 * поэтому такой порядок работает и не требует дублировать правила выбора
 * сервиса. Без этого шага тест проверял бы не тот сервис, который настроен:
 * скрипт сервера видит файл, а процесс тестов — нет.
 */
function loadEnvFile(): void {
  const text = readEnvFile();
  if (!text) return;

  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const name = match[1];
    if (!name) continue;
    process.env[name] = (match[2] ?? '').trim().replace(/^"|"$/g, '');
  }
}

loadEnvFile();

/** Ключ выбранного сервиса. Оба имени переменной, как и в самом приложении. */
function readApiKey(): string | null {
  const key = (process.env.ECW_AI_KEY ?? '').trim() || (process.env.GROQ_API_KEY ?? '').trim();
  return key === '' ? null : key;
}

test.describe('слой модели', () => {
  test('запрос собирается из системного промпта, истории и вопроса', () => {
    const body = buildBody(REQUEST);

    expect(body).toMatchObject({ model: 'test-model', temperature: 0.3, max_tokens: 100 });
    // Порядок важен: системный промпт первым, вопрос последним, история между
    // ними — ровно так, как читает модель.
    expect(body.messages).toEqual([
      { role: 'system', content: 'You are a barista.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hello! How can I help?' },
      { role: 'user', content: 'How much is a cappuccino?' },
    ]);
  });

  test('ответ сервиса с ошибкой приводит к исключению', async () => {
    const provider = createChatCompletionsProvider({
      name: 'test',
      apiKey: 'нет-такого-ключа',
      endpoint: 'https://example.invalid/chat/completions',
      fetchImpl: () =>
        Promise.resolve(
          new Response('invalid api key', { status: 401, statusText: 'Unauthorized' }),
        ),
    });

    // Код ответа обязан попасть в текст ошибки: без него в журнале не понять,
    // кончился ключ, лимит запросов или модель переименовали.
    await expect(provider.answer(REQUEST)).rejects.toThrow(/401/);
  });

  test('пустой ответ считается ошибкой, а не пустым сообщением в чате', async () => {
    const provider = createChatCompletionsProvider({
      name: 'test',
      apiKey: 'ключ',
      endpoint: 'https://example.invalid/chat/completions',
      fetchImpl: () =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [] }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        ),
    });

    await expect(provider.answer(REQUEST)).rejects.toThrow(/пустой/);
  });

  test('поток разбирается по кускам, расход берётся из последнего события', async () => {
    const collected: string[] = [];
    const body = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"!"}}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    const provider = createChatCompletionsProvider({
      name: 'test',
      apiKey: 'ключ',
      endpoint: 'https://example.invalid/chat/completions',
      fetchImpl: () =>
        Promise.resolve(
          new Response(body, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
    });

    const result = await provider.answer({
      ...REQUEST,
      onDelta: (text) => {
        collected.push(text);
      },
    });

    // Куски отдаются вызывающему сразу, а не одним куском в конце: в этом и
    // смысл потока.
    expect(collected).toEqual(['Hel', 'lo', '!']);
    expect(result.text).toBe('Hello!');
    expect(result.inputTokens).toBe(5);
    expect(result.outputTokens).toBe(3);
  });

  test('без отчёта о расходе токены оцениваются, а не считаются нулём', async () => {
    // Так ведут себя некоторые сервисы в потоковом режиме. Ноль означал бы, что
    // дневной бюджет перестал ограничивать расход ровно там, где им пользуются.
    const provider = createChatCompletionsProvider({
      name: 'test',
      apiKey: 'ключ',
      endpoint: 'https://example.invalid/chat/completions',
      fetchImpl: () =>
        Promise.resolve(
          new Response('data: {"choices":[{"delta":{"content":"Hello there"}}]}\n\n', {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          }),
        ),
    });

    const result = await provider.answer({ ...REQUEST, onDelta: () => undefined });

    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.inputTokens).toBeGreaterThan(0);
  });

  test.describe('живая модель', () => {
    test.skip(!readApiKey(), 'нет ключа модели в apps/web/.env');

    // Один настоящий запрос: он стоит доли копейки и проверяет то, что макетом
    // не проверить — что ключ рабочий, адрес верный, а имя модели существует.
    test('ключ, адрес и модель по умолчанию рабочие', async () => {
      const provider = createChatCompletionsProvider({
        name: providerName(),
        apiKey: readApiKey() ?? '',
        endpoint: activeEndpoint(),
      });

      const request = {
        ...REQUEST,
        question: 'Reply with the single word: ready',
        systemPrompt: 'Answer with one word only.',
        history: [],
        model: activeModel(),
        temperature: 0,
        // Не двадцать: модели, которые «думают», тратят часть предела на
        // размышление, и при тесном пределе ответ приходит пустым.
        maxTokens: 128,
      };

      let result;
      try {
        result = await provider.answer(request);
      } catch (error) {
        const status = error instanceof ProviderError ? error.status : null;

        // Занятость сервиса не означает, что настройка неверна: ключ, адрес и
        // имя модели при этом могут быть совершенно правильными. Бесплатные
        // тарифы ограничивают число запросов в сутки — у Gemini это двадцать, —
        // и набор, краснеющий от исчерпанной чужой квоты, приучает не смотреть
        // на красное. Поэтому помечаем проверку пропущенной, а не упавшей.
        test.skip(
          status === 429 || (status !== null && status >= 500),
          `сервис модели занят или исчерпана квота (ответ ${String(status)})`,
        );

        // Всё остальное — настоящая поломка настройки, и её надо видеть.
        throw error;
      }

      expect(result.text.length).toBeGreaterThan(0);

      // Расход считают все крупные сервисы, но локальная модель может его не
      // сообщать — для неё это не ошибка.
      if (providerName() !== 'custom') {
        expect(result.inputTokens).toBeGreaterThan(0);
        expect(result.outputTokens).toBeGreaterThan(0);
      }
    });
  });
});

import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { activeEndpoint, activeModel, providerName } from '../../web/lib/ai';
import { buildBody, createChatCompletionsProvider } from '../../web/lib/ai/chat-completions';

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

/** Ключ выбранного сервиса. Оба имени переменной, как и в самом приложении. */
function readApiKey(): string | null {
  const env = readEnvFile();
  if (!env) return null;

  const match = /^\s*(?:ECW_AI_KEY|GROQ_API_KEY)\s*=\s*"?([^"\r\n]+)"?/m.exec(env);
  const value = match?.[1]?.trim();
  return value ? value : null;
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

      const result = await provider.answer({
        ...REQUEST,
        question: 'Reply with the single word: ready',
        systemPrompt: 'Answer with one word only.',
        history: [],
        model: activeModel(),
        temperature: 0,
        maxTokens: 20,
      });

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

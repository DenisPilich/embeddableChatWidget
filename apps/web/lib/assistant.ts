import type { Message } from '@prisma/client';
import { activeModel, resolveProvider, type ChatTurn } from './ai';
import { findAiSettings, recordTokenUsage, tokensUsedToday, type AiSettings } from './data';

/**
 * Ассистент: связывает вопрос посетителя с провайдером модели.
 *
 * Здесь сходятся все решения, которые не должен принимать ни провайдер, ни
 * обработчик запроса: каким промптом пользоваться, сколько истории отдавать,
 * не исчерпан ли дневной бюджет и что делать, если модель не ответила.
 *
 * Функция **никогда не бросает исключение**. Посетитель, задавший вопрос, обязан
 * получить хоть какой-то ответ: молчание в окне чата выглядит как поломка,
 * даже когда всё в порядке и вопрос просто ждёт оператора.
 */

/** Сколько последних реплик отдаём модели. */
const HISTORY_LIMIT = 10;

/** Предел длины ответа: простата в чате не нужна, да и расход конечен. */
const MAX_ANSWER_TOKENS = 400;

const BUDGET_EXHAUSTED =
  'The assistant has reached its daily limit. Your message is saved and a human will reply.';

const UNAVAILABLE =
  'Sorry, the assistant is unavailable right now. Your message is saved and a human will reply.';

/** Настройки по умолчанию: нужны сайтам, у которых своих ещё нет. */
const DEFAULT_SETTINGS: AiSettings = {
  systemPrompt:
    'You are a helpful assistant on a company website. Answer briefly and only from what you know about the company. If you do not know something, say so instead of guessing.',
  model: activeModel(),
  temperature: 0.3,
  dailyTokenBudget: 50_000,
};

export interface AnswerOutcome {
  text: string;
  /** Кто ответил: имя провайдера, `budget` или `none`. Для журнала и проверок. */
  source: string;
  tokens: number;
}

export async function answerQuestion(params: {
  siteId: string;
  question: string;
  /** Реплики до текущего вопроса: сам вопрос добавляется отдельно. */
  history: readonly ChatTurn[];
}): Promise<AnswerOutcome> {
  const settings = (await findAiSettings(params.siteId)) ?? DEFAULT_SETTINGS;

  // Бюджет проверяется ДО обращения к модели: платить за ответ, который всё
  // равно не будет отправлен, незачем.
  const spent = await tokensUsedToday(params.siteId);
  if (spent >= settings.dailyTokenBudget) {
    console.warn('[ecw] дневной бюджет исчерпан', {
      siteId: params.siteId,
      spent,
      budget: settings.dailyTokenBudget,
    });
    return { text: BUDGET_EXHAUSTED, source: 'budget', tokens: 0 };
  }

  try {
    const provider = resolveProvider();
    const result = await provider.answer({
      question: params.question,
      systemPrompt: settings.systemPrompt,
      history: params.history,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: MAX_ANSWER_TOKENS,
    });

    const tokens = result.inputTokens + result.outputTokens;
    if (tokens > 0) await recordTokenUsage(params.siteId, tokens);

    return { text: result.text, source: provider.name, tokens };
  } catch (error) {
    console.error('[ecw] модель не ответила', error);
    return { text: UNAVAILABLE, source: 'none', tokens: 0 };
  }
}

/**
 * Превращает сообщения диалога в реплики для модели.
 *
 * Ответы оператора отдаются как реплики ассистента: для посетителя это один
 * собеседник, и объяснять модели разницу между «ассистент» и «оператор» на этом
 * шаге незачем.
 */
export function toChatTurns(messages: readonly Message[]): ChatTurn[] {
  return messages.map((message) => ({
    role: message.author === 'VISITOR' ? ('user' as const) : ('assistant' as const),
    text: message.body,
  }));
}

/** Сколько реплик имеет смысл загружать перед вопросом. */
export const HISTORY_TURNS = HISTORY_LIMIT;

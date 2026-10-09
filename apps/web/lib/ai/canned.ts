import type { AnswerProvider, AnswerRequest, AnswerResult } from './provider';

/**
 * Заготовки вместо модели.
 *
 * Нужны в двух случаях. Первый: ключа модели нет, а проект должен работать
 * целиком — установить, запустить и пощёлкать демо можно без единого секрета.
 * Второй: проверки. Автотесты не должны зависеть от живой модели, иначе они
 * станут платными, медленными и непредсказуемыми.
 *
 * Токенов этот провайдер не тратит, поэтому дневной бюджет в режиме заготовок
 * не расходуется — и это правильно: расходовать нечего.
 *
 * Текст отдаётся по словам, а не целиком. Так проверки видят ту же картину,
 * что и с настоящей моделью: куски приходят по мере появления, интерфейс
 * успевает показать их раньше окончания ответа.
 */

interface ReplyRule {
  match: RegExp;
  answer: string;
}

const RULES: readonly ReplyRule[] = [
  {
    match: /hello|hi\b|hey|good (morning|afternoon|evening)/i,
    answer: 'Hello! How can I help?',
  },
  {
    match: /hour|time|open|close|schedule|weekend|when/i,
    answer:
      'We are open 8:00 to 21:00 on weekdays, until 22:00 on Saturday and until 19:00 on Sunday.',
  },
  {
    match: /address|where|find|direction|map|located/i,
    answer:
      'Vinogradnaya 14, the entrance is from the courtyard. If there is a queue outside, it moves faster than it looks.',
  },
  {
    match: /bean|roast|coffee|grind|origin|arabica|robusta/i,
    answer:
      'We roast our own beans, every Tuesday. Light, medium and dark are all on the shelf — tell us how you brew and we will pick one.',
  },
  {
    match: /thank/i,
    answer: 'You are welcome. Anything else?',
  },
];

const FALLBACK =
  'This is a demonstration answer: the real assistant arrives once a model key is configured. ' +
  'For now, try asking about our opening hours or how to find us.';

export function createCannedProvider(): AnswerProvider {
  return {
    name: 'canned',
    answer(request: AnswerRequest): Promise<AnswerResult> {
      const rule = RULES.find((candidate) => candidate.match.test(request.question));
      const text = rule?.answer ?? FALLBACK;

      deliver(text, request.onDelta);

      return Promise.resolve({ text, inputTokens: 0, outputTokens: 0 });
    },
  };
}

/** Отдаёт текст по словам, сохраняя пробелы между ними. */
function deliver(text: string, onDelta: ((chunk: string) => void) | undefined): void {
  if (!onDelta) return;

  for (const piece of text.split(/(\s+)/)) {
    if (piece !== '') onDelta(piece);
  }
}

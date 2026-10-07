/**
 * Демонстрационный ассистент.
 *
 * Отвечает заготовками, подобранными под содержимое стенда: так демонстрация
 * выглядит живой, а не как «эхо». Настоящая модель появится в Фазе 3 — внутри
 * этой же функции, с той же сигнатурой. Поэтому она уже асинхронная: обращение
 * к модели — это сетевой запрос, и менять из-за этого вызывающий код не придётся.
 *
 * Живёт на сервере, а не в виджете, по важной причине: сервер владеет диалогом.
 * Ответ должен стать таким же сообщением в базе, с настоящим номером, как и
 * сообщение посетителя. Иначе переписка существует в двух местах, и они
 * расходятся — а оператор в дашборде не увидит, что вообще отвечали.
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
  'This is a demonstration answer: the real assistant arrives once the widget is connected to a model. ' +
  'For now, try asking about our opening hours or how to find us.';

/** Возвращает ответ на сообщение посетителя. */
export async function generateReply(question: string): Promise<string> {
  const rule = RULES.find((candidate) => candidate.match.test(question));
  return Promise.resolve(rule?.answer ?? FALLBACK);
}

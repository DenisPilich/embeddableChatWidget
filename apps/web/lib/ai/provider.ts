/**
 * Провайдер ответов: интерфейс, за которым стоит модель.
 *
 * Причина существования та же, что и у транспорта в виджете: способ получения
 * ответа придётся менять. Сегодня это Groq, завтра другая модель или своя, а
 * код, который ведёт диалог, хранит историю и считает расход, меняться не
 * должен.
 *
 * Интерфейс описан по потребностям вызывающего кода, а не по возможностям
 * сервиса: поэтому здесь нет ни ключей, ни адресов, ни названий полей чужого
 * API.
 *
 * Потоковая передача («печатает…» по мере генерации) появится следующим шагом.
 * Интерфейс к ней готов: `answer` можно будет заменить на итератор, не трогая
 * того, кто его вызывает, — как это уже сделано с транспортом.
 */

/** Одна реплика в переписке, как её видит модель. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AnswerRequest {
  /** Вопрос посетителя. */
  question: string;
  /** Системный промпт сайта: кто отвечает и о чём. */
  systemPrompt: string;
  /** Предыдущие реплики: без них ассистент не поймёт «а сколько это стоит?». */
  history: readonly ChatTurn[];
  model: string;
  temperature: number;
  /** Предел длины ответа. Защита от простыни и от неожиданного расхода. */
  maxTokens: number;
}

export interface AnswerResult {
  text: string;
  /** Израсходовано токенов. Нужно для дневного бюджета. */
  inputTokens: number;
  outputTokens: number;
}

export interface AnswerProvider {
  /** Имя для журнала и диагностики. Не секрет. */
  readonly name: string;
  answer(request: AnswerRequest): Promise<AnswerResult>;
}

/**
 * Ошибка обращения к сервису модели.
 *
 * Отделён от обычной ошибки ради одного поля — кода ответа. По нему можно
 * сказать человеку, что именно чинить: `401` — ключ, `404` — имя модели,
 * `429` — упёрлись в ограничение скорости. Текст ответа сервиса наружу не
 * отдаётся: в нём может лежать кусок нашего запроса.
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    /** Код ответа сервиса или `null`, если ответа не было вовсе. */
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * Известные сервисы, говорящие на языке chat completions.
 *
 * Язык этот придумала не наша отрасль, а OpenAI, и его повторяют почти все:
 * поэтому один и тот же код работает и с Groq, и с Gemini, и с моделью,
 * запущенной на своём компьютере. Разница — в адресе и ключе, то есть в
 * настройке, а не в коде.
 *
 * Имена моделей здесь — значения по умолчанию, а не истина: провайдеры меняют
 * их чаще, чем мы выпускаем версии. Настоящее имя задаётся настройками сайта или
 * переменной окружения.
 */
export interface ProviderPreset {
  /** Адрес точки, куда отправляется запрос. */
  endpoint: string;
  /** Модель по умолчанию для этого сервиса. */
  model: string;
  /** Где взять ключ. Попадает в подсказку, когда ключа нет. */
  keysUrl: string;
}

export const PRESETS = {
  groq: {
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'openai/gpt-oss-20b',
    keysUrl: 'https://console.groq.com/keys',
  },
  gemini: {
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    model: 'gemini-3.6-flash',
    keysUrl: 'https://aistudio.google.com/apikey',
  },
  /**
   * Свой сервер: адрес обязателен.
   *
   * Сюда же попадает модель, запущенная локально, — у неё ключ не нужен вовсе.
   * Пример для Ollama: `ECW_AI_ENDPOINT=http://localhost:11434/v1/chat/completions`
   * и `ECW_AI_KEY=ollama` (любая непустая строка).
   */
  custom: {
    endpoint: '',
    model: '',
    keysUrl: '',
  },
} as const satisfies Record<string, ProviderPreset>;

export type PresetName = keyof typeof PRESETS;

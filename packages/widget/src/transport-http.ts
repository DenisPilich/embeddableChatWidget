import type { ChatMessage, InitResponse, MessagesResponse } from '@ecw/shared';
import { loadToken, saveToken } from './storage';
import type { DeltaHandler, MessagesHandler, OutgoingMessage, Transport } from './transport';

/**
 * Транспорт через обычные HTTP-запросы.
 *
 * Два способа получить ответ, и оба живут в одном классе:
 *
 * - **Поток.** Отправка сообщения сразу открывает поток, и текст ответа приходит
 *   по мере генерации. Это то, что видит посетитель.
 * - **Опрос.** Страховка. Если сервер потока не дал или он оборвался, ответ
 *   заберёт ближайший опрос — он никуда не делся и работает как раньше.
 *
 * Такое сочетание выбрано сознательно: поток даёт живость, опрос — надёжность.
 * Однослойная схема либо живая, либо надёжная; здесь виджет не ломается от того,
 * что посредник буферизует ответ или рвёт долгие соединения.
 *
 * Частота опроса меняется сама. Сразу после отправки виджет опрашивает часто:
 * ответ ассистента готовится на сервере, и ждать его лишние секунды незачем.
 * Когда в диалоге тихо, промежуток растёт до редкого — виджет живёт на чужой
 * странице и не имеет права занимать сеть посетителя постоянно.
 */

/** Промежуток между опросами, мс. */
const BUSY_POLL_DELAY = 400;
const IDLE_POLL_DELAY = 4000;

/**
 * Сколько сообщений «назад» виджет добирает при запуске.
 *
 * Без этого возвращение на страницу означало бы потерю всего, что пришло, пока
 * вкладка была закрыта: курсор начинался бы с последнего известного номера и
 * пропускал бы ответ оператора, пришедший пять минут назад. Локальный кэш помнит
 * то, что посетитель уже видел, но не то, чего он не видел.
 *
 * Лишние сообщения не страшны: виджет узнаёт свои по номеру и не показывает
 * дважды.
 */
const CATCH_UP_WINDOW = 20;

/** Сколько ждать ответа на один запрос, прежде чем считать его потерянным. */
const REQUEST_TIMEOUT = 15_000;

/** Ошибка с кодом ответа: нужна, чтобы отличить «просрочен токен» от «упала сеть». */
class HttpError extends Error {
  constructor(readonly status: number) {
    super(`Ответ ${String(status)}`);
    this.name = 'HttpError';
  }
}

export interface HttpTransportOptions {
  siteId: string;
  apiUrl: string;
}

export class HttpTransport implements Transport {
  private handler: MessagesHandler | null = null;
  private deltaHandler: DeltaHandler | null = null;
  /** Ждёт подтверждения приёма сообщения, которое завершает `send`. */
  private confirmAccepted: (() => void) | null = null;
  /** Пропуск посетителя. Живёт в хранилище браузера между загрузками страницы. */
  private token: string | null = null;
  /** Номер последнего полученного сообщения: всё, что не больше него, уже видели. */
  private cursor = 0;
  private timer: number | null = null;
  private delay = BUSY_POLL_DELAY;
  private stopped = false;
  /** Следим за вкладкой один раз, а не при каждом подключении. */
  private watching = false;
  /** О неудаче сообщаем один раз на серию, чтобы не засорять чужую консоль. */
  private failureReported = false;
  /** Что уже отправлено этим виджетом: сервер вернёт это же в общем списке. */
  private readonly sent = new Set<string>();

  constructor(private readonly options: HttpTransportOptions) {}

  onMessages(handler: MessagesHandler): void {
    this.handler = handler;
  }

  onDelta(handler: DeltaHandler): void {
    this.deltaHandler = handler;
  }

  async connect(): Promise<void> {
    this.token = loadToken(this.options.siteId);

    const session = await this.request<InitResponse>('/api/v1/init', {
      method: 'POST',
      body: { siteId: this.options.siteId, visitorToken: this.token ?? undefined },
    });

    this.token = session.token;
    saveToken(this.options.siteId, session.token);
    // Отступаем на окно назад, а не встаём на последний номер: иначе то, что
    // пришло, пока страница была закрыта, не увидит никто.
    this.cursor = Math.max(0, session.lastSeq - CATCH_UP_WINDOW);

    this.watchVisibility();
    this.scheduleNext();
  }

  async send(message: OutgoingMessage): Promise<void> {
    await this.ensureSession();

    // Запоминаем ДО отправки: если ответ на запрос потеряется, а сообщение всё
    // же запишется, виджет не покажет его посетителю второй раз.
    this.sent.add(message.clientId);

    try {
      await this.deliver(message);
    } catch (error) {
      // Токен живёт 12 часов, а вкладка может жить дольше. Просроченный токен —
      // это не ошибка посетителя, а обычное дело: молча берём новый и повторяем.
      if (error instanceof HttpError && error.status === 401) {
        this.token = null;
        await this.connect();
        await this.deliver(message);
      } else {
        throw error;
      }
    }

    // Ответ приходит потоком, но частый опрос всё равно нужен: если поток не
    // удался, ответ заберёт ближайшая проверка.
    this.delay = BUSY_POLL_DELAY;
    this.scheduleNext();
  }

  close(): void {
    this.stopped = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.handler = null;
    this.deltaHandler = null;
  }

  private async ensureSession(): Promise<void> {
    if (!this.token) await this.connect();
  }

  /** Отправляет сообщение и, если сервер умеет, читает поток ответа. */
  private async deliver(message: OutgoingMessage): Promise<void> {
    const response = await this.requestRaw('/api/v1/messages', {
      method: 'POST',
      authorized: true,
      accept: this.deltaHandler === null ? 'application/json' : 'text/event-stream',
      body: { clientId: message.clientId, body: message.body },
    });

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream')) {
      // Сервер ответил обычным JSON — значит потока у него нет. Разбираем ответ
      // как раньше: виджет работает и с серверной частью постарше, и с его
      // двойником в проверках.
      await response.json();
      return;
    }

    // send() обязан завершиться, как только сервер подтвердил приём. Ждать конца
    // ответа нельзя: всё это время виджет показывал бы «отправляется» и не
    // включил бы индикатор набора.
    const accepted = new Promise<void>((resolve) => {
      this.confirmAccepted = resolve;
    });

    void this.readEvents(response);
    await accepted;
  }

  /**
   * Читает поток событий.
   *
   * Формат простой: события разделяются пустой строкой, внутри — строки `event:`
   * и `data:`. Обрыв потока не считается ошибкой отправки: сообщение уже
   * записано, а ответ заберёт ближайший опрос.
   */
  private async readEvents(response: Response): Promise<void> {
    const body = response.body;
    if (!body) return;

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');
          this.handleEvent(event);
        }
      }
    } catch (error) {
      // Посредник оборвал соединение. Молчать об этом нельзя, но и пугать
      // посетителя нечем: сообщение доставлено, ответ придёт опросом.
      console.warn('[ecw] поток ответа оборвался, ответ заберёт опрос', error);
    } finally {
      // Если подтверждения так и не было, `send` не должен ждать вечно.
      this.confirmAccepted?.();
      this.confirmAccepted = null;
    }
  }

  private handleEvent(event: string): void {
    let name = 'message';
    let data = '';

    for (const line of event.split('\n')) {
      if (line.startsWith('event:')) name = line.slice('event:'.length).trim();
      else if (line.startsWith('data:')) data += line.slice('data:'.length).trim();
    }
    if (data === '') return;

    try {
      const payload = JSON.parse(data) as { text?: string; message?: ChatMessage };

      if (name === 'accepted') {
        this.confirmAccepted?.();
        this.confirmAccepted = null;
        return;
      }

      if (name === 'delta' && typeof payload.text === 'string') {
        this.deltaHandler?.(payload.text);
        return;
      }

      if (name === 'done' && payload.message) {
        // Курсор сдвигаем сразу: иначе ближайший опрос вернул бы то же
        // сообщение второй раз.
        this.cursor = Math.max(this.cursor, payload.message.seq);
        this.handler?.([payload.message]);
      }
    } catch {
      // Неполное или служебное событие. Поток продолжается, терять нечего.
    }
  }

  private async request<T>(
    path: string,
    options: { method: 'GET' | 'POST'; body?: unknown; authorized?: boolean },
  ): Promise<T> {
    const response = await this.requestRaw(path, options);
    return (await response.json()) as T;
  }

  private async requestRaw(
    path: string,
    options: {
      method: 'GET' | 'POST';
      body?: unknown;
      authorized?: boolean;
      accept?: string;
    },
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT);

    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (options.accept !== undefined) headers.Accept = options.accept;
    if (options.authorized && this.token) headers.Authorization = `Bearer ${this.token}`;

    try {
      const response = await fetch(`${this.options.apiUrl}${path}`, {
        method: options.method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        // Токен идёт заголовком, а не cookie: сторонние cookie браузеры режут, а
        // вместе с ними отвалилась бы и сессия посетителя на чужом сайте.
        credentials: 'omit',
        mode: 'cors',
      });

      if (!response.ok) throw new HttpError(response.status);
      return response;
    } finally {
      // Снимаем предел сразу после заголовков: иначе долгий ответ обрывался бы
      // на середине, а поток — тем более.
      window.clearTimeout(timeout);
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    if (this.timer !== null) window.clearTimeout(this.timer);

    this.timer = window.setTimeout(() => {
      void this.poll();
    }, this.delay);
  }

  private async poll(): Promise<void> {
    this.timer = null;
    if (this.stopped) return;

    // Свёрнутая вкладка не должна занимать ни сеть, ни батарею: чужой сайт нам
    // этого не простит. Работа возобновится, когда посетитель вернётся.
    if (document.visibilityState === 'hidden') {
      this.scheduleNext();
      return;
    }

    try {
      const response = await this.request<MessagesResponse>(
        `/api/v1/messages?after=${String(this.cursor)}`,
        { method: 'GET', authorized: true },
      );

      const fresh = response.messages.filter(
        (message) => message.clientId === undefined || !this.sent.has(message.clientId),
      );
      this.cursor = Math.max(this.cursor, response.lastSeq);

      if (fresh.length > 0) {
        this.delay = IDLE_POLL_DELAY;
        this.failureReported = false;
        this.handler?.(fresh);
      } else {
        // Пусто — ответ ещё готовится. Подождём чуть дольше, но не так долго,
        // как в тишине: иначе ответ появится с заметной задержкой.
        this.delay = Math.min(this.delay * 2, IDLE_POLL_DELAY);
      }
    } catch (error) {
      if (!this.failureReported) {
        this.failureReported = true;
        console.warn('[ecw] не удалось получить сообщения', error);
      }
      // Не долбим сервер, но и не сдаёмся: ждём дольше и пробуем снова.
      this.delay = Math.min(this.delay * 2, IDLE_POLL_DELAY);
    }

    this.scheduleNext();
  }

  private watchVisibility(): void {
    if (this.watching) return;
    this.watching = true;
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private readonly onVisibilityChange = (): void => {
    if (this.stopped || document.visibilityState !== 'visible') return;
    // Вернулись на страницу — проверяем сразу, не дожидаясь редкого опроса.
    this.delay = BUSY_POLL_DELAY;
    this.scheduleNext();
  };
}

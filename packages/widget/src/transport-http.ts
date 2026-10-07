import type { InitResponse, MessagesResponse } from '@ecw/shared';
import { loadToken, saveToken } from './storage';
import type { MessagesHandler, OutgoingMessage, Transport } from './transport';

/**
 * Транспорт через обычные HTTP-запросы с периодическим опросом.
 *
 * Первый способ доставки и самый неприхотливый: он работает через любые
 * посредники, не требует постоянного соединения и не мешает хозяйской странице.
 * SSE появится позже отдельной реализацией того же интерфейса — интерфейс
 * поэтому и описан подпиской, а не запросом «дай список».
 *
 * Частота опроса меняется сама. Сразу после отправки виджет опрашивает часто:
 * ответ ассистента готовится на сервере, и ждать его лишние секунды незачем.
 * Когда в диалоге тихо, промежуток растёт до редкого — виджет живёт на чужой
 * странице и не имеет права занимать сеть посетителя постоянно.
 */

/** Промежуток между опросами, мс. */
const BUSY_POLL_DELAY = 400;
const IDLE_POLL_DELAY = 4000;

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

  async connect(): Promise<void> {
    this.token = loadToken(this.options.siteId);

    const session = await this.request<InitResponse>('/api/v1/init', {
      method: 'POST',
      body: { siteId: this.options.siteId, visitorToken: this.token ?? undefined },
    });

    this.token = session.token;
    saveToken(this.options.siteId, session.token);
    this.cursor = session.lastSeq;

    this.watchVisibility();
    this.scheduleNext();
  }

  async send(message: OutgoingMessage): Promise<void> {
    await this.ensureSession();

    // Запоминаем ДО отправки: если ответ на запрос потеряется, а сообщение всё
    // же запишется, виджет не покажет его посетителю второй раз.
    this.sent.add(message.clientId);

    try {
      await this.postMessage(message);
    } catch (error) {
      // Токен живёт 12 часов, а вкладка может жить дольше. Просроченный токен —
      // это не ошибка посетителя, а обычное дело: молча берём новый и повторяем.
      if (error instanceof HttpError && error.status === 401) {
        this.token = null;
        await this.connect();
        await this.postMessage(message);
      } else {
        throw error;
      }
    }

    // Ответ ассистента готовится на сервере: узнаем о нём на ближайшем опросе.
    this.delay = BUSY_POLL_DELAY;
    this.scheduleNext();
  }

  close(): void {
    this.stopped = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.handler = null;
  }

  private async ensureSession(): Promise<void> {
    if (!this.token) await this.connect();
  }

  private async postMessage(message: OutgoingMessage): Promise<void> {
    await this.request<unknown>('/api/v1/messages', {
      method: 'POST',
      authorized: true,
      body: { clientId: message.clientId, body: message.body },
    });
  }

  private async request<T>(
    path: string,
    options: { method: 'GET' | 'POST'; body?: unknown; authorized?: boolean },
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, REQUEST_TIMEOUT);

    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
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
      return (await response.json()) as T;
    } finally {
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
      this.cursor = response.lastSeq;

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

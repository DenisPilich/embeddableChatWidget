import type { ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';

/**
 * Двойник серверной части для стендов.
 *
 * Виджет теперь по-настоящему обращается к API, но проверки виджета нельзя
 * ставить в зависимость от живой базы: они должны запускаться у каждого, кто
 * склонировал репозиторий, без секретов и без сети. Поэтому здесь стоит
 * двойник — он держит сообщения в памяти и отвечает по тому же контракту.
 *
 * Настоящий сервер проверяется отдельно, в `api.spec.ts`, против Next.js и
 * настоящей базы. Здесь проверяется виджет: успел ли он отправить, показать
 * индикатор набора, принять ответ и не задвоить собственное сообщение.
 *
 * У каждого посетителя свой диалог — как на настоящем сервере. Это не деталь
 * ради правдоподобия: тесты идут параллельно, и на общем диалоге они видели бы
 * сообщения друг друга. Один такой случай уже всплыл счётчиком непрочитанных.
 */

/** Начало ответа двойника. По нему тесты отличают ответ от местного приветствия. */
export const STUB_REPLY_PREFIX = 'Stub reply to';

/** Пауза между кусками потока, мс. Нужна только проверкам, чтобы успеть увидеть текст. */
const STREAM_PIECE_DELAY_MS = 40;

/**
 * Пауза перед первым куском, мс.
 *
 * Модель не начинает отвечать мгновенно: она «думает». Без этой паузы поток
 * неотличим от обычного ответа — индикатор набора не успевает появиться, и
 * проверка на него перестала бы что-либо значить.
 */
const STREAM_THINK_MS = 300;

interface StubMessage {
  id: string;
  seq: number;
  conversationId: string;
  authorKind: 'visitor' | 'ai' | 'agent';
  body: string;
  createdAt: string;
  clientId?: string;
}

interface StubConversation {
  id: string;
  token: string;
  seq: number;
  messages: StubMessage[];
}

interface RecordedRequest {
  method: string;
  path: string;
  authorized: boolean;
  body: unknown;
}

export function stubApi(): Plugin {
  let created = 0;
  /** Диалоги по токену: токен и есть пропуск посетителя. */
  const conversations = new Map<string, StubConversation>();
  let requests: RecordedRequest[] = [];

  function openConversation(visitorToken: string): StubConversation {
    const existing = conversations.get(visitorToken);
    if (existing) return existing;

    created += 1;
    const conversation: StubConversation = {
      id: `stub-conversation-${String(created)}`,
      token: `stub-token-${String(created)}`,
      seq: 0,
      messages: [],
    };
    conversations.set(conversation.token, conversation);
    return conversation;
  }

  function push(
    conversation: StubConversation,
    authorKind: StubMessage['authorKind'],
    body: string,
    clientId?: string,
  ): StubMessage {
    conversation.seq += 1;
    const message: StubMessage = {
      id: `${conversation.id}-${String(conversation.seq)}`,
      seq: conversation.seq,
      conversationId: conversation.id,
      authorKind,
      body,
      createdAt: new Date().toISOString(),
      ...(clientId === undefined ? {} : { clientId }),
    };
    conversation.messages.push(message);
    return message;
  }

  async function handle(
    req: Connect.IncomingMessage,
    res: ServerResponse,
    next: Connect.NextFunction,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const isApi = url.pathname.startsWith('/api/v1');
    const isControl = url.pathname.startsWith('/__stub');
    if (!isApi && !isControl) {
      next();
      return;
    }

    // Предварительный запрос браузера. Стенды обращаются к тому же адресу, что и
    // страница, поэтому обычно его не бывает; обрабатываем на случай, когда
    // страницу открыли по другому имени хоста.
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.end();
      return;
    }

    if (url.pathname === '/__stub/reset') {
      created = 0;
      conversations.clear();
      requests = [];
      send(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/__stub/requests') {
      send(res, 200, { requests });
      return;
    }

    const raw = req.method === 'POST' ? await readBody(req) : '';
    let body: unknown = null;
    if (raw) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = null;
      }
    }

    const authorization = req.headers.authorization ?? '';
    const authorized = authorization.startsWith('Bearer ');
    requests.push({
      method: req.method ?? '',
      path: `${url.pathname}${url.search}`,
      authorized,
      body,
    });

    if (url.pathname === '/api/v1/init') {
      const input = body as { visitorToken?: unknown } | null;
      const visitorToken = typeof input?.visitorToken === 'string' ? input.visitorToken : '';
      const conversation = openConversation(visitorToken);

      send(res, 200, {
        token: conversation.token,
        conversationId: conversation.id,
        lastSeq: conversation.seq,
      });
      return;
    }

    if (url.pathname === '/api/v1/messages') {
      const conversation = conversations.get(authorization.slice('Bearer '.length));
      if (!conversation) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }

      if (req.method === 'GET') {
        const parsed = Number.parseInt(url.searchParams.get('after') ?? '0', 10);
        const after = Number.isFinite(parsed) ? parsed : 0;
        send(res, 200, {
          messages: conversation.messages.filter((message) => message.seq > after),
          lastSeq: conversation.seq,
        });
        return;
      }

      if (req.method === 'POST') {
        const input = body as { clientId?: unknown; body?: unknown } | null;
        const clientId = typeof input?.clientId === 'string' ? input.clientId : '';
        const text = typeof input?.body === 'string' ? input.body : '';

        // Повторная отправка: тот же ответ, что и в первый раз, без новой записи.
        const existing =
          clientId === ''
            ? undefined
            : conversation.messages.find((message) => message.clientId === clientId);
        if (existing) {
          send(res, 200, { message: existing, duplicate: true });
          return;
        }

        const own = push(conversation, 'visitor', text, clientId);
        const answerText = `${STUB_REPLY_PREFIX} "${text}"`;

        if (!(req.headers.accept ?? '').includes('text/event-stream')) {
          // Ответ готовится здесь же, как на настоящем сервере: к моменту опроса
          // он уже лежит в диалоге.
          push(conversation, 'ai', answerText);
          send(res, 201, { message: own, duplicate: false });
          return;
        }

        // Поток, как у настоящего сервера: подтверждение приёма, куски текста,
        // готовое сообщение. Запись в диалог происходит в КОНЦЕ — иначе опрос
        // успел бы забрать ответ раньше, чем он закончился, и текст задвоился бы.
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const write = (event: string, data: unknown): void => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };

        write('accepted', { message: own, duplicate: false });

        await delay(STREAM_THINK_MS);

        for (const piece of answerText.split(/(\s+)/)) {
          if (piece === '') continue;
          write('delta', { text: piece });
          // Пауза нужна проверкам: без неё поток заканчивается раньше, чем тест
          // успевает увидеть промежуточный текст.
          await delay(STREAM_PIECE_DELAY_MS);
        }

        const answer = push(conversation, 'ai', answerText);
        write('done', { message: answer });
        res.end();
        return;
      }
    }

    next();
  }

  return {
    name: 'ecw-stub-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handle(req, res, next);
      });
    },
  };
}

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      data += chunk;
    });
    req.on('end', () => {
      resolve(data);
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(payload));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

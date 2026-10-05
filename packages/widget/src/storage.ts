import type { WidgetMessage } from './types';

/**
 * Хранилище переписки на стороне посетителя.
 *
 * В Фазе 2 источником правды станет сервер. Локальное хранилище при этом не
 * исчезнет: оно превратится в кэш, который позволяет показать последние
 * сообщения мгновенно, ещё до ответа сервера, и не терять их при перезагрузке
 * страницы в плохой сети. Поэтому это не выбрасываемая работа, а основа для
 * следующего шага.
 *
 * Доступ к хранилищу может быть недоступен: приватный режим, запрет сторонних
 * данных, переполнение квоты. Виджет обязан работать и в этом случае — просто
 * без истории.
 */

/** Версия формата. Меняется вместе с форматом: старые данные просто не читаются. */
const FORMAT_VERSION = 1;

/** Сколько последних сообщений храним. Ограничение защищает от переполнения. */
const MAX_MESSAGES = 50;

interface StoredMessage {
  id: string;
  authorKind: WidgetMessage['authorKind'];
  body: string;
  createdAt: string;
}

interface StoredHistory {
  version: number;
  messages: StoredMessage[];
}

let storageChecked = false;
let cachedStorage: Storage | null = null;

/**
 * Возвращает доступное хранилище или `null`.
 *
 * Проверяем не только наличие `localStorage`, но и запись: в некоторых режимах
 * обращение к хранилищу проходит, а запись падает. Результат запоминаем — нет
 * смысла проверять его на каждом сообщении.
 */
function getStorage(): Storage | null {
  if (storageChecked) return cachedStorage;
  storageChecked = true;

  try {
    const storage = window.localStorage;
    const probe = '__ecw_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    cachedStorage = storage;
  } catch {
    // Наша проблема не должна мешать посетителю общаться.
    cachedStorage = null;
  }
  return cachedStorage;
}

function keyFor(siteId: string): string {
  return `ecw:${siteId}:history:v${FORMAT_VERSION}`;
}

/** Читает переписку. При любой проблеме возвращает пустой список. */
export function loadHistory(siteId: string): WidgetMessage[] {
  const storage = getStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(keyFor(siteId));
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!isStoredHistory(parsed)) return [];

    return parsed.messages.filter(isStoredMessage).map((message) => ({
      id: message.id,
      authorKind: message.authorKind,
      body: message.body,
      createdAt: message.createdAt,
      // Незавершённая отправка перезагрузку не переживает: подтверждения от
      // сервера не было, и выдавать её за доставленную нельзя.
      status: 'sent' as const,
    }));
  } catch {
    // Повреждённые данные — не повод ломать виджет: начинаем переписку заново.
    return [];
  }
}

/** Сохраняет переписку. Молча ничего не делает, если хранилище недоступно. */
export function saveHistory(siteId: string, messages: readonly WidgetMessage[]): void {
  const storage = getStorage();
  if (!storage) return;

  const payload: StoredHistory = {
    version: FORMAT_VERSION,
    messages: messages
      .filter((message) => message.status === 'sent')
      .slice(-MAX_MESSAGES)
      .map(({ id, authorKind, body, createdAt }) => ({ id, authorKind, body, createdAt })),
  };

  try {
    storage.setItem(keyFor(siteId), JSON.stringify(payload));
  } catch {
    // Переполнение квоты и подобное: продолжаем работать без истории.
  }
}

function isStoredHistory(value: unknown): value is StoredHistory {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredHistory>;
  return candidate.version === FORMAT_VERSION && Array.isArray(candidate.messages);
}

/**
 * Проверяет каждое сообщение по отдельности.
 *
 * В том же хранилище может писать кто угодно — другой скрипт на странице, старая
 * версия виджета, человек руками в devtools. Поэтому данным из хранилища доверяем
 * ровно настолько, насколько проверили.
 */
function isStoredMessage(value: unknown): value is StoredMessage {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredMessage>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.body === 'string' &&
    typeof candidate.createdAt === 'string' &&
    (candidate.authorKind === 'visitor' ||
      candidate.authorKind === 'ai' ||
      candidate.authorKind === 'agent')
  );
}

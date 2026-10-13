import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '@prisma/client';

/**
 * Единственный экземпляр клиента базы на процесс.
 *
 * Устроено так не для красоты. В режиме разработки Next.js перезагружает модули
 * при каждом изменении файла, и если создавать клиент на уровне модуля без
 * защиты, каждый перезапуск открывал бы новое соединение — до исчерпания лимита
 * базы. Поэтому клиент кладётся в глобальный объект, который переживает
 * перезагрузку модулей.
 *
 * Строка подключения — С ПУЛЕРОМ (в адресе есть «-pooler»). Для serverless это
 * обязательно: каждое обращение к функции — отдельный процесс, и без пулера
 * соединения к базе заканчиваются очень быстро.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Настроена ли база: задана ли строка подключения. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Падаем громко и понятно: молчаливый клиент без строки подключения даст
    // невнятную ошибку где-то в середине запроса.
    throw new Error(
      'Не задана переменная окружения DATABASE_URL — см. apps/web/.env.example или переменные окружения развёртывания',
    );
  }

  // Адаптер драйвера вместо строки в схеме. Так устроена Prisma 7: клиент
  // получает готовый драйвер, а не адрес базы. Для Neon это даёт соединения
  // поверх WebSocket и конвейеризацию запросов.
  const adapter = new PrismaNeon({ connectionString });
  const client = new PrismaClient({ adapter });

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = client;
  }

  return client;
}

/** Клиент, созданный при первом обращении. */
function getClient(): PrismaClient {
  return globalForPrisma.prisma ?? createClient();
}

/**
 * Клиент базы.
 *
 * Через прокси, а не готовым объектом — и это не украшение. Сборка Next
 * выполняет модули маршрутов, чтобы собрать о них данные, и клиент, созданный
 * при импорте, требовал бы строку подключения во время сборки. База в этот
 * момент не нужна вовсе: запросы идут во время работы. На развёртывании это
 * выглядело так, что сборка падала с сообщением о переменной окружения — то
 * есть о том, к сборке не относящемся.
 *
 * Поэтому клиент создаётся при первом запросе, и ошибка о ненастроенной базе
 * появляется там, где она что-то значит: в обработчике, который к базе идёт.
 * Функции привязываются к настоящему клиенту: без этого `this` внутри методов
 * был бы прокси, а не клиент.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property: string | symbol): unknown {
    const client = getClient();
    const value: unknown = Reflect.get(client, property);

    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client)
      : value;
  },
});

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

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // Падаем громко и понятно: молчаливый клиент без строки подключения даст
    // невнятную ошибку где-то в середине запроса.
    throw new Error('Не задана переменная окружения DATABASE_URL — см. apps/web/.env.example');
  }

  // Адаптер драйвера вместо строки в схеме. Так устроена Prisma 7: клиент
  // получает готовый драйвер, а не адрес базы. Для Neon это даёт соединения
  // поверх WebSocket и конвейеризацию запросов.
  const adapter = new PrismaNeon({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

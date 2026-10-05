import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Настройка Prisma CLI — отдельный файл, а не блок в схеме.
 *
 * Так устроена Prisma 7: схема описывает данные, а всё, что нужно инструментам,
 * живёт здесь. Строка подключения отсюда используется только миграциями.
 *
 * Здесь именно ПРЯМОЕ соединение, без пулера. Через пулер миграции не работают:
 * Prisma для них нужны возможности сессии, которых пулер не даёт.
 *
 * `dotenv/config` нужен потому, что Prisma CLI больше не читает `.env` сам.
 * Next.js читает, а CLI — нет, и без этой строки `prisma migrate` не увидит
 * переменные.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Запускается командой `pnpm db:seed`. tsx нужен потому, что Node не умеет
    // исполнять TypeScript напрямую, а сид написан на нём — как и весь проект.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DIRECT_URL'),
  },
});

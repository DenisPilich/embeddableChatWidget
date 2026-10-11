import 'dotenv/config';
import { prisma } from '../lib/prisma';

/**
 * Убирает демонстрационный мусор: диалоги и посетителей.
 *
 * Нужно перед показом проекта людям. Панель показывает ВСЕ диалоги сайта, и
 * после десятка прогонов автотестов очередь выглядит как свалка: непонятно, где
 * настоящая переписка, а где следы проверок. Первое впечатление портится именно
 * этим, а не отсутствием функций.
 *
 * Что НЕ удаляется: рабочие пространства, сайты, пользователи и настройки
 * ассистента. Иначе после уборки пришлось бы заново наполнять базу и вспоминать
 * пароль оператора — а уборка не должна ломать вход.
 *
 * Файл запускается руками и никогда — автоматически: удаление данных не должно
 * происходить само.
 */
async function main(): Promise<void> {
  const conversations = await prisma.conversation.count();
  const visitors = await prisma.visitor.count();

  console.log(
    `Deleting conversations (${String(conversations)}) and visitors (${String(visitors)}).`,
  );
  console.log('Sites, users and assistant settings stay untouched.');

  // Сообщения уходят вместе с диалогами: у них внешний ключ с каскадом.
  const removedConversations = await prisma.conversation.deleteMany({});
  const removedVisitors = await prisma.visitor.deleteMany({});

  console.log(
    `Done: removed ${String(removedConversations.count)} conversations and ${String(removedVisitors.count)} visitors.`,
  );
  console.log('The dashboard is empty now — a good moment to show it to someone.');
}

main()
  .catch((error: unknown) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

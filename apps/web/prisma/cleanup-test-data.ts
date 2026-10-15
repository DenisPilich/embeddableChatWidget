import 'dotenv/config';
import { prisma } from '../lib/prisma';

/**
 * Временный файл: убирает данные, оставленные прошлыми прогонами проверок.
 *
 * Проверки завели себе пространства и операторов, чтобы проверить изоляцию, и
 * до появления удаления в панели оставляли их в базе. Теперь они убирают за
 * собой сами, а этот скрипт разбирается со старым мусором.
 *
 * Удаляет только то, что названо по шаблону самих проверок: пространства
 * «Test workspace …» и операторов с почтой на «test-». Всё остальное не трогает.
 */
async function main(): Promise<void> {
  const workspaces = await prisma.workspace.findMany({
    where: { name: { startsWith: 'Test workspace' } },
    select: { id: true, name: true },
  });

  const users = await prisma.user.findMany({
    where: { email: { startsWith: 'test-' } },
    select: { id: true, email: true },
  });

  console.log(`Пространств по шаблону: ${String(workspaces.length)}`);
  for (const workspace of workspaces) console.log(`  ${workspace.name}`);
  console.log(`Операторов по шаблону: ${String(users.length)}`);
  for (const user of users) console.log(`  ${user.email}`);

  const removedWorkspaces = await prisma.workspace.deleteMany({
    where: { id: { in: workspaces.map((workspace) => workspace.id) } },
  });

  // Оператора удаляем только если он не остался ни в одном пространстве: иначе
  // унесли бы доступ человеку, который всё ещё где-то числится.
  const removedUsers = await prisma.user.deleteMany({
    where: { id: { in: users.map((user) => user.id) }, memberships: { none: {} } },
  });

  console.log(
    `Удалено: пространств ${String(removedWorkspaces.count)}, операторов ${String(removedUsers.count)}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('Уборка не удалась:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

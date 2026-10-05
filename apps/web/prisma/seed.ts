import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma';

/**
 * Наполнение базы данными для разработки.
 *
 * Скрипт идемпотентен: повторный запуск не создаёт дублей, а обновляет то, что
 * уже есть. Это важнее, чем кажется — сид запускают после каждой пересборки
 * базы, и «второй раз нельзя» означает «однажды придётся чинить руками».
 *
 * Публичные ключи создаются один раз и при повторных запусках сохраняются: они
 * уже вписаны в страницы стенда, и менять их на каждом запуске нельзя.
 *
 * Идентификаторы здесь фиксированные — это данные разработки, а не рабочие.
 * В бою идентификаторы случайные.
 */

const WORKSPACE_ID = 'ws_local_demo';
const OWNER_EMAIL = 'demo@example.com';

interface SiteSeed {
  id: string;
  name: string;
  allowedOrigins: string[];
}

const SITES: readonly SiteSeed[] = [
  {
    id: 'site_local_stand',
    name: 'Стенд «Кофейня Тучка»',
    allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  },
  {
    // Второй сайт нужен не для полноты картины: на нём проверяется, что данные
    // одного клиента недоступны другому. Токен, выданный для первого сайта, не
    // должен открывать что-либо на втором. Без второго сайта эту проверку
    // поставить не на чем.
    id: 'site_local_other',
    name: 'Стенд «Второй сайт»',
    allowedOrigins: ['http://localhost:5174'],
  },
];

async function main(): Promise<void> {
  const workspace = await prisma.workspace.upsert({
    where: { id: WORKSPACE_ID },
    update: { name: 'Демо-пространство' },
    create: { id: WORKSPACE_ID, name: 'Демо-пространство' },
  });

  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: {},
    create: { email: OWNER_EMAIL, name: 'Владелец демо-сайта' },
  });

  await prisma.membership.upsert({
    where: { userId_workspaceId: { userId: owner.id, workspaceId: workspace.id } },
    update: { role: 'OWNER' },
    create: { userId: owner.id, workspaceId: workspace.id, role: 'OWNER' },
  });

  for (const seed of SITES) {
    const existing = await prisma.site.findUnique({ where: { id: seed.id } });

    const site = existing
      ? await prisma.site.update({
          where: { id: seed.id },
          // Источники и имя обновляем при каждом запуске: если стенд переехал на
          // другой порт, сид — то место, где это правится.
          data: { name: seed.name, allowedOrigins: [...seed.allowedOrigins] },
        })
      : await prisma.site.create({
          data: {
            id: seed.id,
            workspaceId: workspace.id,
            name: seed.name,
            // Случайный ключ, как в бою. Секретом не является — он виден в HTML.
            publicKey: `pub_${randomBytes(16).toString('base64url')}`,
            allowedOrigins: [...seed.allowedOrigins],
          },
        });

    await prisma.aiConfig.upsert({
      where: { siteId: site.id },
      update: {},
      create: {
        siteId: site.id,
        systemPrompt:
          'Ты ассистент кофейни «Тучка». Отвечай коротко и по делу, не выдумывай факты, которых нет в описании сайта.',
        model: 'demo-assistant',
        temperature: 0.3,
        dailyTokenBudget: 50_000,
      },
    });

    console.log(`Сайт «${site.name}»`);
    console.log('  публичный ключ:', site.publicKey);
    console.log('  разрешённые источники:', site.allowedOrigins.join(', '));
  }

  console.log('Наполнение выполнено.');
}

main()
  .catch((error: unknown) => {
    console.error('Наполнение не удалось:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { activeModel } from '../lib/ai';
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

/**
 * Системный промпт демонстрационного сайта.
 *
 * Факты перечислены прямо здесь, потому что другого источника знаний у модели
 * нет: виджет не отдаёт ей содержимое страницы. В рабочем варианте этот текст
 * пишет владелец сайта — ровно поэтому он и хранится в настройках сайта, а не в
 * коде.
 */
const SYSTEM_PROMPT = [
  'You are the assistant of "Little Cloud Coffee", a small coffee shop.',
  'Opening hours: Monday to Friday 8:00-21:00, Saturday 9:00-22:00, Sunday 9:00-19:00.',
  'Address: Vinogradnaya 14, the entrance is from the courtyard.',
  'We roast our own beans, every Tuesday.',
  'Answer briefly, in the language the visitor wrote in.',
  'If something is not in this list, say you do not know and offer to pass the question to a human.',
  'Never invent prices, dishes or facts that are not listed here.',
].join(' ');

/** Файл с ключами для автотестов. В репозиторий не попадает — он в .gitignore. */
const SEED_FILE = new URL('../.seed-sites.json', import.meta.url);

interface SiteSeed {
  id: string;
  name: string;
  allowedOrigins: string[];
}

const SITES: readonly SiteSeed[] = [
  {
    id: 'site_local_stand',
    name: 'Stand "Little Cloud Coffee"',
    allowedOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],
  },
  {
    // Второй сайт нужен не для полноты картины: на нём проверяется, что данные
    // одного клиента недоступны другому. Токен, выданный для первого сайта, не
    // должен открывать что-либо на втором. Без второго сайта эту проверку
    // поставить не на чем.
    id: 'site_local_other',
    name: 'Stand "Second site"',
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

  const summary: { id: string; name: string; publicKey: string; allowedOrigins: string[] }[] = [];

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
      // Промпт и имя модели обновляем при каждом запуске: наполнение — источник
      // правды для данных разработки, а демонстрационное имя модели здесь уже
      // оказывалось нерабочим и падало только на живом обращении.
      update: { model: activeModel(), systemPrompt: SYSTEM_PROMPT },
      create: {
        siteId: site.id,
        systemPrompt: SYSTEM_PROMPT,
        model: activeModel(),
        temperature: 0.3,
        dailyTokenBudget: 50_000,
      },
    });

    summary.push({
      id: site.id,
      name: site.name,
      publicKey: site.publicKey,
      allowedOrigins: site.allowedOrigins,
    });

    console.log(`Site "${site.name}"`);
    console.log('  public key:', site.publicKey);
    console.log('  allowed origins:', site.allowedOrigins.join(', '));
  }

  // Ключи для автотестов. Вписывать их в тесты руками нельзя: они случайные, и
  // после пересоздания базы тесты начали бы падать загадочным образом.
  writeFileSync(SEED_FILE, `${JSON.stringify({ sites: summary }, null, 2)}\n`, 'utf8');

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

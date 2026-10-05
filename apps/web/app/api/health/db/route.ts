import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Проверка связи с базой.
 *
 * Отдельно от `/api/health`, который базу намеренно не трогает: когда что-то
 * ломается, важно сразу понимать, недоступно приложение или база.
 *
 * Запрос идёт через пулер и адаптер драйвера — тем же путём, которым пойдут
 * настоящие запросы. Миграции ходят по прямой строке, поэтому проверка через
 * них ничего не сказала бы о работе приложения.
 */

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  try {
    const rows = await prisma.$queryRaw<{ tables: number }[]>`
      select count(*)::int as tables
      from information_schema.tables
      where table_schema = 'public'
    `;

    return NextResponse.json({ ok: true, tables: rows[0]?.tables ?? 0 });
  } catch (error) {
    // Наружу — ничего конкретного: текст ошибки базы может содержать имена
    // таблиц, узлы и другие подробности, которых посетителю знать не нужно.
    console.error('[ecw] проверка базы не прошла', error);
    return NextResponse.json({ ok: false, error: 'database unavailable' }, { status: 503 });
  }
}

import { NextResponse } from 'next/server';
import { countConversationStates } from '@/lib/data';
import { currentOperator } from '@/lib/operator';

/**
 * Сколько разговоров ждёт человека.
 *
 * Отдельный адрес, а не данные страницы: уведомлять нужно на любой странице
 * панели, а не только в очереди. Оператор чаще всего сидит в переписке, и
 * извещение о новом разговоре не должно зависеть от того, где он находится.
 *
 * Отвечает только вошедшему: это счётчик его рабочих пространств, и посторонним
 * он ничего не должен.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const operator = await currentOperator();
  if (operator === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const counts = await countConversationStates({ workspaceIds: operator.workspaceIds });

  return NextResponse.json(
    { waiting: counts.waiting },
    // Кэшировать нечего: смысл ответа в том, что он свежий.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

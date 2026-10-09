import { NextResponse } from 'next/server';
import { providerInfo, verifyProvider } from '@/lib/ai';

/**
 * Диагностика ассистента.
 *
 * Отвечает на два разных вопроса, и путать их нельзя:
 *
 * - **Настроен ли сервис** — обычный ответ. Ключ непустой, сервис выбран. Это
 *   НЕ значит, что ключ рабочий: однажды поле `ready` при негодном ключе уже
 *   ввело в заблуждение, поэтому теперь оно называется `configured`.
 * - **Работает ли он** — `?check=1`. Один настоящий запрос к модели в несколько
 *   токенов. Стоит доли копейки, поэтому только по явной просьбе.
 *
 * Ключ и системные промпты наружу не отдаются. Имя сервиса, имя модели, адрес и
 * код ответа — не секреты: без них диагностика бесполезна.
 *
 * Провайдер при обычном обращении НЕ создаётся: иначе проверка состояния писала
 * бы в журнал предупреждения о том, что ключа нет, при каждом заходе.
 */

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const info = providerInfo();
  const wantsCheck = new URL(request.url).searchParams.get('check') === '1';

  if (!wantsCheck) {
    return NextResponse.json({
      ...info,
      hint: 'configuration only. Add ?check=1 to make one real request to the model',
    });
  }

  return NextResponse.json({ ...info, check: await verifyProvider() });
}

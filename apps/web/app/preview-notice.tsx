import { headers } from 'next/headers';

/**
 * Предупреждение о том, что страница открыта по адресу предпросмотра.
 *
 * У Vercel у каждой сборки свой адрес, и защита деплоя закрывает их: страница
 * открывается, а `/api/v1/init` отвечает 401. Для посетителя это выглядит как
 * сломанный чат — «не отправлено» и красная строка, без единого намёка на
 * причину. Для портфолио это худшее первое впечатление из возможных: человек
 * пришёл посмотреть, а увидел поломку.
 *
 * Поэтому страница сама говорит, что чат живёт на боевом адресе, и даёт ссылку
 * туда. Проверка серверная: посетитель видит предупреждение сразу, без вспышки
 * и без JavaScript.
 *
 * Откуда берётся боевой адрес: Vercel кладёт его в `VERCEL_PROJECT_PRODUCTION_URL`
 * на каждой сборке. Настраивать ничего не нужно, и локально предупреждение не
 * появляется — переменной там нет.
 */
export async function PreviewNotice({ path }: { path: string }): Promise<React.ReactNode> {
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? '';
  if (production === '') return null;

  const store = await headers();
  const host = store.get('x-forwarded-host') ?? store.get('host') ?? '';
  if (host === '' || host === production) return null;

  return (
    <div className="notice" role="status">
      <span className="notice__text">
        This is a preview address of the project. The chat and the dashboard answer on the main
        address only.
      </span>
      <a className="notice__link" href={`https://${production}${path}`}>
        Open the main site →
      </a>
    </div>
  );
}

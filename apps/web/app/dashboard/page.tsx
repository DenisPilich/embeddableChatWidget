import type { Metadata } from 'next';
import Link from 'next/link';
import { listOperatorQueue, listOperatorSites } from '@/lib/data';
import { formatMoment, formatWaiting } from '@/lib/format';
import { requireOperator } from '@/lib/operator';
import { logout } from './actions';
import './dashboard.css';

export const metadata: Metadata = {
  title: 'Conversations',
};

export const dynamic = 'force-dynamic';

/** Сколько диалогов показываем в очереди. */
const QUEUE_LIMIT = 50;

export default async function DashboardPage() {
  const operator = await requireOperator();
  const [queue, sites] = await Promise.all([
    listOperatorQueue({ workspaceIds: operator.workspaceIds, limit: QUEUE_LIMIT }),
    listOperatorSites({ workspaceIds: operator.workspaceIds }),
  ]);

  const waiting = queue.filter((item) => item.humanRequestedAt !== null);

  return (
    <main className="dash">
      <header className="dash__bar">
        <div>
          <h1 className="dash__title">Conversations</h1>
          <p className="dash__subtitle">
            {waiting.length === 0
              ? 'Nobody is waiting for a human.'
              : `${String(waiting.length)} waiting for a human.`}
          </p>
        </div>

        <form action={logout}>
          <button className="dash__link-button" type="submit">
            Sign out
          </button>
        </form>
      </header>

      <section className="sites">
        <h2 className="sites__title">Sites</h2>
        <ul className="sites__list">
          {sites.map((site) => (
            <li key={site.id}>
              <Link className="sites__link" href={`/dashboard/sites/${site.id}`}>
                {site.name}
              </Link>
              <span className="queue__meta">
                {site.aiConfig === null ? 'assistant not configured yet' : site.aiConfig.model}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {queue.length === 0 ? (
        // Пустая панель обязана объяснять, как получить первый разговор: иначе
        // непонятно, работает ли вообще то, что перед тобой.
        <p className="dash__empty">
          No conversations yet. Open the demo site on{' '}
          <a href="http://localhost:5173">localhost:5173</a>, ask the assistant something, and press
          “Talk to a human” — the conversation will appear here. It has to come from that page: the
          other stands answer from a test double and never reach this database.
        </p>
      ) : (
        <ul className="queue">
          {queue.map((item) => {
            // Отдельная переменная, чтобы компилятор видел: внутри ветки
            // значение уже не пустое.
            const waitingSince = item.humanRequestedAt;

            return (
              <li key={item.id}>
                <Link
                  className={
                    waitingSince === null ? 'queue__row' : 'queue__row queue__row--waiting'
                  }
                  href={`/dashboard/conversations/${item.id}`}
                >
                  <span className="queue__site">{item.siteName}</span>
                  <span className="queue__text">{item.lastMessage ?? 'No messages yet'}</span>
                  <span className="queue__meta">
                    {waitingSince === null
                      ? `Updated ${formatMoment(item.updatedAt)}`
                      : `Waiting ${formatWaiting(waitingSince)}`}
                    {item.status === 'CLOSED' ? ' · closed' : ''}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

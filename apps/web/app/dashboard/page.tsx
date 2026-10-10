import type { Metadata } from 'next';
import Link from 'next/link';
import { listOperatorQueue } from '@/lib/data';
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
  const queue = await listOperatorQueue({
    workspaceIds: operator.workspaceIds,
    limit: QUEUE_LIMIT,
  });

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

      {queue.length === 0 ? (
        <p className="dash__empty">No conversations yet.</p>
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

import type { Metadata } from 'next';
import Link from 'next/link';
import { countConversationStates, listOperatorQueue } from '@/lib/data';
import { formatMoment, formatWaiting } from '@/lib/format';
import { requireOperator } from '@/lib/operator';
import { AutoRefresh } from './auto-refresh';
import { TitleCount } from './title-count';
import './dashboard.css';

export const metadata: Metadata = {
  title: 'Conversations',
};

export const dynamic = 'force-dynamic';

/** Сколько диалогов показываем в очереди. */
const QUEUE_LIMIT = 50;

/**
 * Что показывает очередь.
 *
 * Порядок не случаен: «ждут» — то, ради чего панель открывают, и это первая
 * вкладка. Но по умолчанию открывается «все»: пустой экран на входе не
 * объясняет, работает ли вообще то, что перед тобой, а число на вкладке
 * «ждут» и так видно.
 */
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'active', label: 'Assistant' },
  { id: 'closed', label: 'Closed' },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

/** Неизвестное значение в адресе — не ошибка: показываем «все». */
function readFilter(value: string | undefined): FilterId {
  const found = FILTERS.find((filter) => filter.id === value);
  return found?.id ?? 'all';
}

const EMPTY: Record<FilterId, string> = {
  all: 'No conversations yet. They appear here as soon as a visitor writes in the widget.',
  waiting: 'Nobody is waiting for a human. The assistant is answering on its own.',
  active: 'No conversations the assistant is handling right now.',
  closed: 'Nothing has been closed yet.',
};

const AUTHOR_LABEL = {
  VISITOR: 'Visitor',
  AI: 'Assistant',
  AGENT: 'Operator',
} as const;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const operator = await requireOperator();
  const { filter: rawFilter } = await searchParams;
  const filter = readFilter(rawFilter);

  const [queue, counts] = await Promise.all([
    listOperatorQueue({ workspaceIds: operator.workspaceIds, limit: QUEUE_LIMIT, filter }),
    countConversationStates({ workspaceIds: operator.workspaceIds }),
  ]);

  return (
    <main className="page">
      {/* Очередь обновляется сама: список на момент открытия — это не очередь. */}
      <AutoRefresh seconds={5} />
      <TitleCount waiting={counts.waiting} />

      <header className="page__bar">
        <h1 className="page__title">Conversations</h1>
        <p className="page__subtitle">
          {counts.waiting === 0
            ? 'Nobody is waiting for a human.'
            : `${String(counts.waiting)} waiting for a human.`}
        </p>
      </header>

      <nav className="tabs" aria-label="Filter conversations">
        {FILTERS.map((item) => {
          const active = item.id === filter;

          return (
            <Link
              aria-current={active ? 'page' : undefined}
              className={active ? 'tab tab--active' : 'tab'}
              href={`/dashboard?filter=${item.id}`}
              key={item.id}
            >
              {item.label}
              <span
                className={
                  item.id === 'waiting' && counts.waiting > 0
                    ? 'tab__count tab__count--alert'
                    : 'tab__count'
                }
              >
                {counts[item.id]}
              </span>
            </Link>
          );
        })}
      </nav>

      {queue.length === 0 ? (
        <p className="dash__empty">
          {EMPTY[filter]}
          {filter === 'all' ? (
            <>
              {' '}
              Write in the widget on <Link href="/demo">the demo site</Link> — it talks to this
              database, unlike the test stands.
            </>
          ) : null}
        </p>
      ) : (
        <>
          {/* Ограничение списка должно быть видно, а не подразумеваться: очередь
              отсортирована самыми долго ждущими вперёд, и без этой строки новый
              разговор, не попавший в полсотню, просто исчез бы с глаз. */}
          {queue.length >= QUEUE_LIMIT ? (
            <p className="dash__empty">
              Showing the first {QUEUE_LIMIT} of {counts[filter]} conversations. The longest wait
              comes first, so close what is finished to keep the list short.
            </p>
          ) : null}

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
                    <span className="queue__head">
                      <span className="queue__site">{item.siteName}</span>
                      {waitingSince === null ? null : (
                        <span className="badge badge--waiting">
                          waiting {formatWaiting(waitingSince)}
                        </span>
                      )}
                      {item.status === 'CLOSED' ? <span className="badge">closed</span> : null}
                    </span>

                    <span className="queue__text">
                      {item.lastMessage === null ? (
                        <em className="queue__muted">no messages yet</em>
                      ) : (
                        <>
                          {/* Кто написал последним — видно сразу: от этого зависит,
                            нужно ли вообще открывать разговор. */}
                          {item.lastAuthor === null ? null : (
                            <span className="queue__who">{AUTHOR_LABEL[item.lastAuthor]}: </span>
                          )}
                          {item.lastMessage}
                        </>
                      )}
                    </span>

                    <span className="queue__meta">
                      {item.lastAt === null
                        ? `created ${formatMoment(item.updatedAt)}`
                        : `last message ${formatMoment(item.lastAt)}`}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </main>
  );
}

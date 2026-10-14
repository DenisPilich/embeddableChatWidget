import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findOperatorConversation, listMessages } from '@/lib/data';
import { formatMoment, formatWaiting } from '@/lib/format';
import { requireOperator } from '@/lib/operator';
import { close, reopen, reply } from '../../actions';
import { AutoRefresh } from '../../auto-refresh';
import { ReplyForm } from '../../reply-form';
import '../../dashboard.css';

export const metadata: Metadata = {
  title: 'Conversation',
};

export const dynamic = 'force-dynamic';

/** Сколько сообщений показываем в переписке. */
const PAGE_LIMIT = 200;

const AUTHOR_LABEL = {
  VISITOR: 'Visitor',
  AI: 'Assistant',
  AGENT: 'Operator',
} as const;

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const operator = await requireOperator();
  const { id } = await params;

  // Чужой диалог не найдётся, и мы отвечаем «нет страницы», а не «нет доступа»:
  // само существование чужого диалога — не наше дело.
  const conversation = await findOperatorConversation({
    workspaceIds: operator.workspaceIds,
    conversationId: id,
  });
  if (conversation === null) notFound();

  const messages = await listMessages({
    siteId: conversation.siteId,
    conversationId: conversation.id,
    afterSeq: 0,
    limit: PAGE_LIMIT,
  });

  const waitingSince = conversation.humanRequestedAt;

  return (
    <main className="conversation">
      {/* Оператору не нужно нажимать F5, чтобы увидеть новое сообщение: пока он
          читает, посетитель может написать ещё. */}
      <AutoRefresh seconds={5} />

      <div className="conversation__head">
        <Link className="conversation__back" href="/dashboard">
          ← All conversations
        </Link>
        <h1 className="conversation__title">{conversation.site.name}</h1>

        {waitingSince === null ? null : (
          <p className="conversation__note">
            Waiting for a human for {formatWaiting(waitingSince)}. The assistant stays quiet while
            this is set.
          </p>
        )}

        {conversation.status === 'CLOSED' ? (
          <p className="conversation__note">This conversation is closed.</p>
        ) : null}
      </div>

      {messages.length === 0 ? (
        <p className="dash__empty">No messages yet.</p>
      ) : (
        <ol className="thread">
          {messages.map((message) => (
            <li
              className={
                message.author === 'AGENT' ? 'thread__item thread__item--agent' : 'thread__item'
              }
              key={message.id}
            >
              <span className="thread__author">{AUTHOR_LABEL[message.author]}</span>
              <p className="thread__body">{message.body}</p>
              <span className="thread__time">{formatMoment(message.createdAt)}</span>
            </li>
          ))}
        </ol>
      )}

      {conversation.status === 'CLOSED' ? (
        // Закрытие обратимо: разговор можно вернуть, если закрыли по ошибке.
        // Без этого одна неверная кнопка уносила бы переписку в архив навсегда.
        <div className="reply">
          <form action={reopen.bind(null, conversation.id)}>
            <div className="reply__actions">
              <button className="reply__close" type="submit">
                Reopen conversation
              </button>
              <span className="reply__hint">
                The assistant stays quiet until the visitor asks for a human again.
              </span>
            </div>
          </form>
        </div>
      ) : (
        <div className="reply">
          <ReplyForm action={reply.bind(null, conversation.id)}>
            <label className="thread__author" htmlFor="reply-body">
              Reply as operator
            </label>
            <textarea
              className="reply__input"
              id="reply-body"
              name="body"
              required
              maxLength={4000}
              placeholder="Type your answer…"
            />
            <div className="reply__actions">
              <button className="reply__send" type="submit">
                Send reply
              </button>
              <span className="reply__hint">Ctrl+Enter sends</span>
            </div>
          </ReplyForm>

          <form action={close.bind(null, conversation.id)}>
            <div className="reply__actions">
              <button className="reply__close" type="submit">
                Close conversation
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}

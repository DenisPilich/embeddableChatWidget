import type { Metadata } from 'next';
import Link from 'next/link';
import { listOperatorWorkspaces } from '@/lib/data';
import { requireOperator } from '@/lib/operator';
import { InviteForm } from './invite-form';
import { WorkspaceForm } from './workspace-form';
import '../dashboard.css';

export const metadata: Metadata = {
  title: 'Access',
};

export const dynamic = 'force-dynamic';

/** Кто может приглашать операторов в пространство. */
const CAN_INVITE = new Set(['OWNER', 'ADMIN']);

const ROLE_LABEL = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  AGENT: 'Agent',
} as const;

/**
 * Доступы: рабочие пространства, их участники и приглашения.
 *
 * Страница существует ради одной задачи — разделить демонстрацию и настоящую
 * работу. Пока всё лежало в одном пространстве, публичный демо-логин открывал
 * любую переписку, и это было не украшение, а дыра.
 */
export default async function AccessPage() {
  const operator = await requireOperator();
  const workspaces = await listOperatorWorkspaces({
    workspaceIds: operator.workspaceIds,
    operatorId: operator.id,
  });

  return (
    <main className="page">
      <header className="page__bar">
        <h1 className="page__title">Access</h1>
        <p className="page__subtitle">
          You are signed in as {operator.email}. Operators see only the workspaces they belong to —
          conversations from other workspaces do not exist for them.
        </p>
      </header>

      <section className="panel">
        <h2 className="panel__title">New workspace</h2>
        <p className="panel__note">
          Create one to keep real work away from the public demo: a separate workspace means a
          separate operator, a separate password and separate sites.
        </p>
        <WorkspaceForm />
      </section>

      {workspaces.map((workspace) => (
        <section className="panel" key={workspace.id}>
          <h2 className="panel__title">
            {workspace.name}
            <span className="badge">{ROLE_LABEL[workspace.role]}</span>
            <span className="badge">
              {workspace.siteCount} site{workspace.siteCount === 1 ? '' : 's'}
            </span>
          </h2>

          <ul className="members">
            {workspace.members.map((member) => (
              <li className="members__row" key={member.userId}>
                <span className="members__email">{member.email}</span>
                {member.name === null ? null : <span className="members__name">{member.name}</span>}
                <span className="badge">{ROLE_LABEL[member.role]}</span>
                {member.userId === operator.id ? <span className="badge">you</span> : null}
              </li>
            ))}
          </ul>

          {CAN_INVITE.has(workspace.role) ? (
            <InviteForm workspaceId={workspace.id} />
          ) : (
            <p className="panel__note">
              Only owners and admins of this workspace can invite operators.
            </p>
          )}
        </section>
      ))}

      <p className="panel__note">
        Sites live on the <Link href="/dashboard/sites">Sites</Link> page. Everything an operator
        sees — conversations, queues, settings — is limited to the workspaces listed here.
      </p>
    </main>
  );
}

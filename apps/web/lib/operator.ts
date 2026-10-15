import { redirect } from 'next/navigation';
import type { Membership } from '@prisma/client';
import { findUserById, listMembershipWorkspaceIds } from './data';
import { readOperatorSession } from './session';

/**
 * Кто сейчас в панели.
 *
 * Права читаются из базы на каждом запросе, а не кладутся в cookie: оператора
 * могут исключить из рабочего пространства, а выданная когда-то cookie об этом
 * не узнает. Cookie хранит только личность.
 */
export interface Operator {
  id: string;
  email: string;
  name: string | null;
  /** Рабочие пространства оператора. Граница всего, что он видит. */
  workspaceIds: string[];
}

export async function currentOperator(): Promise<Operator | null> {
  const userId = await readOperatorSession();
  if (userId === null) return null;

  const user = await findUserById(userId);
  // Пользователя могли удалить, а cookie остаться.
  if (user === null) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    workspaceIds: await listMembershipWorkspaceIds(user.id),
  };
}

/** То же, но для страниц: без входа дальше не пускаем. */
export async function requireOperator(): Promise<Operator> {
  const operator = await currentOperator();
  if (operator === null) redirect('/login');

  return operator;
}

/**
 * Роли, которым можно распоряжаться пространством: приглашать операторов,
 * заводить сайты, удалять участников.
 *
 * Правило живёт в одном месте намеренно. Разбросанное по действиям, оно рано или
 * поздно разойдётся: в одном месте поправят, в другом забудут, и появится дыра
 * ровно там, где о ней не подумали.
 */
export function canManage(role: Membership['role']): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

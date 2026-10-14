'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  addMembership,
  createOperator,
  createWorkspaceWithOwner,
  findMembership,
  findUserByEmail,
} from '@/lib/data';
import { generatePassword, hashPassword } from '@/lib/password';
import { requireOperator } from '@/lib/operator';

/**
 * Управление доступами.
 *
 * Здесь появляется то, чего не хватало: рабочие пространства, приглашение
 * операторов и пароли. До этого всё это делалось только наполнением базы, и
 * оба демонстрационных пространства заводились с одним паролем. На настоящем
 * сайте так нельзя: публичный демо-логин не должен открывать чужие переписки.
 *
 * Каждое действие заново проверяет права. Серверное действие — обычная точка
 * входа: полагаться на то, что до него дошёл только видевший страницу, нельзя.
 */

const ROLE = z.enum(['OWNER', 'ADMIN', 'AGENT']);

/** Кто может приглашать: владелец и администратор пространства. */
const CAN_INVITE = new Set(['OWNER', 'ADMIN']);

export interface InviteState {
  /** Пароль нового оператора. Показывается один раз и только в этом ответе. */
  password: string | null;
  email: string | null;
  error: string | null;
}

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z
    .string()
    .trim()
    .max(80)
    .transform((value) => (value === '' ? null : value)),
  role: ROLE,
});

export async function invite(
  workspaceId: string,
  _previous: InviteState,
  form: FormData,
): Promise<InviteState> {
  const operator = await requireOperator();

  // Сначала «твоё ли это пространство и хватает ли прав», потом «что ты написал».
  const membership = await findMembership({ userId: operator.id, workspaceId });
  if (membership === null || !CAN_INVITE.has(membership.role)) {
    return { password: null, email: null, error: 'You cannot invite operators to this workspace.' };
  }

  const parsed = inviteSchema.safeParse({
    email: field(form, 'email'),
    name: field(form, 'name'),
    role: field(form, 'role'),
  });

  if (!parsed.success) {
    return { password: null, email: null, error: 'Check the email address and the role.' };
  }

  const { email, name, role } = parsed.data;

  const existing = await findUserByEmail(email);
  if (existing !== null) {
    // Пароль существующему не меняем: у него свой, и владелец не должен уметь
    // зайти под чужой учётной записью.
    await addMembership({ userId: existing.id, workspaceId, role });
    revalidatePath('/dashboard/access');

    return { password: null, email, error: null };
  }

  const password = generatePassword();
  const created = await createOperator({
    email,
    name,
    passwordHash: await hashPassword(password),
  });
  await addMembership({ userId: created.id, workspaceId, role });
  revalidatePath('/dashboard/access');

  // Пароль возвращается один раз, в ответе на это действие. Он не попадает ни в
  // адрес, ни в базу в открытом виде, ни в журнал: перезагрузка страницы его
  // теряет, и это правильно.
  return { password, email, error: null };
}

const workspaceSchema = z.object({
  name: z.string().trim().min(2).max(80),
});

export async function createWorkspace(
  _previous: { error: string | null },
  form: FormData,
): Promise<{ error: string | null }> {
  const operator = await requireOperator();

  const parsed = workspaceSchema.safeParse({ name: field(form, 'name') });
  if (!parsed.success) {
    return { error: 'Give the workspace a name of two characters or more.' };
  }

  await createWorkspaceWithOwner({ name: parsed.data.name, ownerId: operator.id });
  revalidatePath('/dashboard/access');
  revalidatePath('/dashboard');

  return { error: null };
}

/** `form.get` возвращает ещё и файл: приведение через `String` дало бы `[object File]`. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

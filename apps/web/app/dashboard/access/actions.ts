'use server';

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  addMembership,
  countWorkspaceOwners,
  createOperator,
  createWorkspaceWithOwner,
  deleteWorkspace,
  findMembership,
  findUserByEmail,
  findWorkspace,
  removeMembership,
  setRecoveryHash,
} from '@/lib/data';
import { generatePassword, generateRecoveryCode, hashPassword } from '@/lib/password';
import { canManage, requireOperator } from '@/lib/operator';

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

/** Кто может распоряжаться пространством. Правило лежит в lib/operator.ts. */
const CAN_MANAGE = canManage;

export interface InviteState {
  /** Пароль нового оператора. Показывается один раз и только в этом ответе. */
  password: string | null;
  /**
   * Код восстановления. Тоже показывается один раз и передаётся лично: с ним
   * человек вернёт себе доступ, если забудет пароль, — и для этого не нужны ни
   * почта, ни чужой сервис.
   */
  recoveryCode: string | null;
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
  if (membership === null || !CAN_MANAGE(membership.role)) {
    return {
      password: null,
      recoveryCode: null,
      email: null,
      error: 'You cannot invite operators to this workspace.',
    };
  }

  const parsed = inviteSchema.safeParse({
    email: field(form, 'email'),
    name: field(form, 'name'),
    role: field(form, 'role'),
  });

  if (!parsed.success) {
    return {
      password: null,
      recoveryCode: null,
      email: null,
      error: 'Check the email address and the role.',
    };
  }

  const { email, name, role } = parsed.data;

  const existing = await findUserByEmail(email);
  if (existing !== null) {
    // Пароль существующему не меняем: у него свой, и владелец не должен уметь
    // зайти под чужой учётной записью. Код восстановления тоже не трогаем — он
    // уже есть у владельца той записи.
    await addMembership({ userId: existing.id, workspaceId, role });
    revalidatePath('/dashboard/access');

    return { password: null, recoveryCode: null, email, error: null };
  }

  const password = generatePassword();
  const recoveryCode = generateRecoveryCode();
  const created = await createOperator({
    email,
    name,
    passwordHash: await hashPassword(password),
  });
  await setRecoveryHash({ userId: created.id, recoveryHash: await hashPassword(recoveryCode) });
  await addMembership({ userId: created.id, workspaceId, role });
  revalidatePath('/dashboard/access');

  // Пароль и код возвращаются один раз, в ответе на это действие. Они не
  // попадают ни в адрес, ни в открытом виде в базу, ни в журнал: перезагрузка
  // страницы их теряет, и это правильно.
  return { password, recoveryCode, email, error: null };
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

/**
 * Убирает оператора из пространства.
 *
 * Два запрета, и оба не формальность. Себя убрать нельзя: владелец, случайно
 * лишивший себя доступа, больше не сможет ни пригласить кого-то, ни вернуть
 * права. Последнего владельца тоже нельзя: пространство осталось бы без того,
 * кто отвечает за настройки, и починить это можно было бы только из базы.
 */
export async function removeMember(workspaceId: string, form: FormData): Promise<void> {
  const operator = await requireOperator();

  const membership = await findMembership({ userId: operator.id, workspaceId });
  if (membership === null || !CAN_MANAGE(membership.role)) notFound();

  const userId = field(form, 'userId');
  if (userId === operator.id) {
    redirect('/dashboard/access?error=self');
  }

  const target = await findMembership({ userId, workspaceId });
  if (target === null) {
    revalidatePath('/dashboard/access');
    redirect('/dashboard/access');
  }

  if (target.role === 'OWNER' && (await countWorkspaceOwners(workspaceId)) <= 1) {
    redirect('/dashboard/access?error=lastOwner');
  }

  await removeMembership({ userId, workspaceId });
  revalidatePath('/dashboard/access');
  redirect('/dashboard/access');
}

/** Удаляет пространство вместе с сайтами и переписками. */
export async function removeWorkspace(workspaceId: string, form: FormData): Promise<void> {
  const operator = await requireOperator();

  const membership = await findMembership({ userId: operator.id, workspaceId });
  if (membership === null || membership.role !== 'OWNER') notFound();

  const workspace = await findWorkspace(workspaceId);
  if (workspace === null) notFound();

  // Удаление необратимо и уносит с собой переписки, поэтому просим набрать имя
  // пространства. Одна кнопка для такого действия — слишком мало.
  if (field(form, 'confirm').trim() !== workspace.name) {
    redirect('/dashboard/access?error=confirm');
  }

  await deleteWorkspace(workspaceId);
  revalidatePath('/dashboard/access');
  revalidatePath('/dashboard');
  redirect('/dashboard/access');
}

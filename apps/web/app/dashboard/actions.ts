'use server';

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  appendAgentMessage,
  closeConversation,
  findOperatorConversation,
  reopenConversation,
} from '@/lib/data';
import { requireOperator } from '@/lib/operator';
import { destroyOperatorSession } from '@/lib/session';

/** Предельная длина ответа оператора — та же, что у сообщения посетителя. */
const MAX_BODY_LENGTH = 4000;

export async function logout(): Promise<void> {
  await destroyOperatorSession();
  redirect('/login');
}

/**
 * Ответ оператора.
 *
 * Доступ проверяется здесь ещё раз, а не только на странице: серверное действие
 * — это обычная точка входа, и полагаться на то, что до неё дошёл только тот,
 * кто видел страницу, нельзя.
 */
export async function reply(conversationId: string, form: FormData): Promise<void> {
  const operator = await requireOperator();
  const value = form.get('body');
  const body = (typeof value === 'string' ? value : '').trim().slice(0, MAX_BODY_LENGTH);

  const conversation = await findOperatorConversation({
    workspaceIds: operator.workspaceIds,
    conversationId,
  });
  if (conversation === null) notFound();

  if (body !== '') {
    await appendAgentMessage({
      siteId: conversation.siteId,
      conversationId,
      operatorId: operator.id,
      body,
    });
  }

  const path = `/dashboard/conversations/${conversationId}`;
  revalidatePath(path);
  redirect(path);
}

export async function close(conversationId: string): Promise<void> {
  const operator = await requireOperator();

  const conversation = await findOperatorConversation({
    workspaceIds: operator.workspaceIds,
    conversationId,
  });
  if (conversation === null) notFound();

  await closeConversation({ siteId: conversation.siteId, conversationId });

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

/**
 * Возвращает разговор в работу.
 *
 * Доступ проверяется так же, как при ответе: серверное действие — обычная точка
 * входа, и полагаться на то, что до неё дошёл только видевший страницу, нельзя.
 */
export async function reopen(conversationId: string): Promise<void> {
  const operator = await requireOperator();

  const conversation = await findOperatorConversation({
    workspaceIds: operator.workspaceIds,
    conversationId,
  });
  if (conversation === null) notFound();

  await reopenConversation({ siteId: conversation.siteId, conversationId });

  const path = `/dashboard/conversations/${conversationId}`;
  revalidatePath(path);
  redirect(path);
}

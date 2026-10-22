import type { ChatMessage } from '@ecw/shared';
import type { Message } from '@prisma/client';

/**
 * Приводит сообщение из базы к общему контракту.
 *
 * Одна функция на все маршруты: переписку отдают три места — выборка, отправка и
 * меню, — и разъехавшийся формат означал бы, что виджет где-то показывает одно,
 * а где-то другое.
 */
export function toChatMessage(message: Message): ChatMessage {
  return {
    id: message.id,
    seq: message.seq,
    conversationId: message.conversationId,
    authorKind: AUTHOR_KIND[message.author],
    body: message.body,
    createdAt: message.createdAt.toISOString(),
    // Пустое поле не добавляем вовсе: у сообщений ассистента и оператора
    // клиентского идентификатора нет, и `clientId: undefined` в ответе был бы
    // шумом, который потребитель может принять за значение.
    ...(message.clientId === null ? {} : { clientId: message.clientId }),
  };
}

/**
 * Перечисление в базе — заглавными буквами, в контракте — строчными.
 * Соответствие задано таблицей, а не преобразованием регистра: если в базе
 * появится новое значение, компилятор заставит его описать.
 */
export const AUTHOR_KIND = {
  VISITOR: 'visitor',
  AI: 'ai',
  AGENT: 'agent',
} as const satisfies Record<Message['author'], ChatMessage['authorKind']>;

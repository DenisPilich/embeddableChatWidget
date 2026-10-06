import { reply } from './assistant';
import type { MessagesHandler, OutgoingMessage, Transport } from './transport';
import { createId, delay } from './utils';

/**
 * Транспорт для разработки: вместо сервера — выдуманный.
 *
 * Нужен для двух вещей. Первая: пока настоящего сервера нет, виджет должен
 * что-то показывать. Вторая, важнее: он проверяет, что интерфейс транспорта
 * описан правильно. Если виджет работает с выдуманным сервером так же, как
 * работал без него, значит интерфейс не просит лишнего.
 *
 * Этот класс не попадает в продакшен: после подключения настоящего транспорта
 * его перестанут создавать, и сборщик выбросит его из файла.
 */
export class LocalTransport implements Transport {
  private handler: MessagesHandler | null = null;
  private seq = 0;
  private readonly conversationId = `local-${createId()}`;

  connect(): Promise<void> {
    // Выдуманному серверу подключаться некуда.
    return Promise.resolve();
  }

  onMessages(handler: MessagesHandler): void {
    this.handler = handler;
  }

  async send(message: OutgoingMessage): Promise<void> {
    // Небольшая пауза изображает дорогу до сервера: без неё состояние
    // «отправляется» не успевало бы появиться на экране.
    await delay(150);

    // Ответ готовится отдельно и приходит позже — как от настоящего сервера.
    window.setTimeout(() => {
      void this.deliverAnswer(message.body);
    }, 300);
  }

  close(): void {
    this.handler = null;
  }

  private async deliverAnswer(question: string): Promise<void> {
    const answer = await reply(question);

    this.seq += 1;
    this.handler?.([
      {
        id: createId(),
        seq: this.seq,
        conversationId: this.conversationId,
        authorKind: 'ai',
        body: answer,
        createdAt: new Date().toISOString(),
      },
    ]);
  }
}

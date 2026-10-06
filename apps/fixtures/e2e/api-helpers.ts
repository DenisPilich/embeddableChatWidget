import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Вспомогательное для тестов API.
 *
 * Здесь намеренно нет импортов из `@ecw/shared`: тесты описывают контракт со
 * стороны потребителя. Если сервер изменит форму ответа, объявления ниже
 * разойдутся с реальностью, и тесты это покажут — а импорт общих типов скрыл бы
 * расхождение, потому что обе стороны менялись бы вместе.
 */

export interface SeededSite {
  id: string;
  name: string;
  publicKey: string;
  allowedOrigins: string[];
}

export interface SeedData {
  sites: SeededSite[];
}

/** Ответ на первый запрос виджета. */
export interface InitResponseBody {
  token: string;
  conversationId: string;
  lastSeq: number;
}

/** Сообщение в том виде, в каком его отдаёт API. */
export interface WireMessage {
  id: string;
  seq: number;
  conversationId: string;
  authorKind: string;
  body: string;
  createdAt: string;
}

export interface MessagesResponseBody {
  messages: WireMessage[];
  lastSeq: number;
}

export interface SendResponseBody {
  message: WireMessage;
  duplicate: boolean;
}

/** Адрес серверной части. */
export const apiBase = process.env.ECW_API_URL ?? 'http://localhost:3000';

const seedFile = fileURLToPath(new URL('../../web/.seed-sites.json', import.meta.url));

/** Данные наполнения базы или `null`, если её ещё не наполняли. */
export function readSeed(): SeedData | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(seedFile, 'utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as SeedData).sites)
    ) {
      return parsed as SeedData;
    }
    return null;
  } catch {
    // Файла нет — значит базу не наполняли. Это не ошибка, а повод пропустить
    // проверки API: без базы они всё равно ничего не проверят.
    return null;
  }
}

/** Два сайта из наполнения. Бросает, если их нет: тесты ниже уже пропущены. */
export function requireSites(): { first: SeededSite; second: SeededSite } {
  const [first, second] = readSeed()?.sites ?? [];
  if (!first || !second) {
    throw new Error('Нет данных наполнения: выполни pnpm --filter @ecw/web db:seed');
  }
  return { first, second };
}

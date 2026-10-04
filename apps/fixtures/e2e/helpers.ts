import type { Page } from '@playwright/test';

/** Селектор host-элемента виджета — единственного его элемента в светлом DOM. */
export const HOST = '[data-ecw-host]';

/**
 * Класс элемента, на котором сейчас фокус внутри виджета.
 *
 * Читать приходится через `shadowRoot.activeElement`: у теневого дерева свой
 * активный элемент, а `document.activeElement` показал бы только сам host.
 * `null` означает, что фокус находится вне виджета.
 */
export async function focusedInWidget(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const shadow = document.querySelector('[data-ecw-host]')?.shadowRoot;
    const active = shadow?.activeElement;
    return active instanceof HTMLElement ? active.className : null;
  });
}

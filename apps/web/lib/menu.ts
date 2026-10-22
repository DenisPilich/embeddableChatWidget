import type { MenuItem } from '@ecw/shared';
import type { MenuAction } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Меню для посетителя.
 *
 * Дерево собирается здесь, а не в виджете: виджету нужно показать список, а не
 * разбираться в связях родитель-потомок. Один запрос на сайт, один проход — и
 * дальше только готовые списки.
 */

/** Имя действия в контракте — строчными, в базе — заглавными. */
const ACTION: Record<MenuAction, MenuItem['action']> = {
  ANSWER: 'answer',
  OPERATOR: 'operator',
  SUBMENU: 'submenu',
  AI: 'ai',
};

/** Пункты сайта, собранные в дерево. Пустой массив — меню нет. */
export async function listMenuTree(siteId: string): Promise<MenuItem[]> {
  const rows = await prisma.menuOption.findMany({
    where: { siteId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, parentId: true, label: true, action: true, answer: true },
  });

  const nodes = new Map<string, MenuItem>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      label: row.label,
      action: ACTION[row.action],
      answer: row.answer,
      children: [],
    });
  }

  const roots: MenuItem[] = [];
  for (const row of rows) {
    const node = nodes.get(row.id);
    if (node === undefined) continue;

    // Родитель мог не попасть в выборку (битые данные) — тогда пункт становится
    // верхним: показать его лучше, чем потерять.
    const parent = row.parentId === null ? undefined : nodes.get(row.parentId);
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
  }

  return roots;
}

/** Пункт меню, если он принадлежит этому сайту. */
export async function findMenuOption(params: {
  siteId: string;
  optionId: string;
}): Promise<{ id: string; label: string; action: MenuAction; answer: string | null } | null> {
  return prisma.menuOption.findFirst({
    where: { id: params.optionId, siteId: params.siteId },
    select: { id: true, label: true, action: true, answer: true },
  });
}

/**
 * Учитывает выбор пункта.
 *
 * Единственная статистика в проекте. Она окупается сразу: владелец видит, какие
 * вопросы задают на самом деле, а не какие он придумал.
 */
export async function countMenuClick(optionId: string): Promise<void> {
  await prisma.menuOption.update({
    where: { id: optionId },
    data: { clicks: { increment: 1 } },
  });
}

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

/** Строка меню в том виде, в каком её правит панель. */
export interface MenuRow {
  id: string;
  parentId: string | null;
  label: string;
  action: MenuAction;
  answer: string | null;
  position: number;
  clicks: number;
}

/** Пункты сайта плоским списком — для редактора в панели. */
export async function listMenuOptions(siteId: string): Promise<MenuRow[]> {
  return prisma.menuOption.findMany({
    where: { siteId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      parentId: true,
      label: true,
      action: true,
      answer: true,
      position: true,
      clicks: true,
    },
  });
}

/** Данные пункта, которые приходят из формы. */
export interface MenuOptionInput {
  label: string;
  action: MenuAction;
  answer: string | null;
  parentId: string | null;
  position: number;
}

/**
 * Заводит пункт меню.
 *
 * Родитель проверяется по сайту: подставить идентификатор чужого пункта нельзя —
 * иначе дерево одного сайта можно было бы прицепить к другому.
 */
export async function createMenuOption(
  siteId: string,
  input: MenuOptionInput,
): Promise<{ id: string } | null> {
  const parentId = await resolveParent(siteId, input.parentId);

  const created = await prisma.menuOption.create({
    data: {
      siteId,
      parentId,
      label: input.label,
      action: input.action,
      answer: input.action === 'ANSWER' ? input.answer : null,
      position: input.position,
    },
    select: { id: true },
  });

  return created;
}

/** Меняет пункт. Чужой пункт не найдётся и не изменится. */
export async function updateMenuOption(
  siteId: string,
  optionId: string,
  input: MenuOptionInput,
): Promise<boolean> {
  const parentId = await resolveParent(siteId, input.parentId);

  // Пункт не может быть родителем сам себе: иначе ветка исчезнет из дерева.
  if (parentId === optionId) return false;

  const updated = await prisma.menuOption.updateMany({
    where: { id: optionId, siteId },
    data: {
      parentId,
      label: input.label,
      action: input.action,
      answer: input.action === 'ANSWER' ? input.answer : null,
      position: input.position,
    },
  });

  return updated.count > 0;
}

/**
 * Удаляет пункт.
 *
 * Вложенные пункты уходят вместе с ним — так задано в схеме каскадом. Это
 * осознанно: подменю без родителя всё равно не показать, и оставлять его в базе
 * значило бы копить мусор, которого не видно.
 */
export async function deleteMenuOption(siteId: string, optionId: string): Promise<boolean> {
  const deleted = await prisma.menuOption.deleteMany({ where: { id: optionId, siteId } });

  return deleted.count > 0;
}

/** Родитель, если он существует и принадлежит этому сайту. */
async function resolveParent(siteId: string, parentId: string | null): Promise<string | null> {
  if (parentId === null || parentId === '') return null;

  const parent = await prisma.menuOption.findFirst({
    where: { id: parentId, siteId },
    select: { id: true },
  });

  return parent?.id ?? null;
}

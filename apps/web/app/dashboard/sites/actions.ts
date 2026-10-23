'use server';

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  findMembership,
  findOperatorSite,
  createSite,
  saveAiSettings,
  saveChatSettings,
  saveSiteSettings,
} from '@/lib/data';
import {
  createMenuOption,
  deleteMenuOption,
  updateMenuOption,
  type MenuOptionInput,
} from '@/lib/menu';
import { canManage, requireOperator } from '@/lib/operator';

/**
 * Настройки сайта из панели.
 *
 * До проверки формы идёт проверка доступа: чужой сайт не найдётся, и дальше
 * дело не пойдёт. Порядок именно такой — сначала «твой ли это сайт», потом «что
 * ты в нём написал».
 *
 * Ошибки возвращаем в адресе, а не молча: форма, которая ничего не ответила, —
 * худший вид формы. Значения по умолчанию при этом не подставляются: владелец
 * должен видеть, что именно он написал не так.
 */

/** Цвет в виде #rrggbb. Проверяем строго: значение попадает в стили. */
const COLOR = /^#[0-9a-f]{6}$/i;

const settingsSchema = z.object({
  name: z.string().trim().min(1).max(80),
  origins: z
    .string()
    .transform((value) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    )
    .pipe(z.array(z.string().url().max(200)).max(20)),
  widgetColor: z
    .string()
    .trim()
    .transform((value) => (value === '' ? null : value))
    .pipe(z.string().regex(COLOR).nullable()),
  widgetTitle: z
    .string()
    .trim()
    .max(60)
    .transform((value) => (value === '' ? null : value)),
  widgetGreeting: z
    .string()
    .trim()
    .max(500)
    .transform((value) => (value === '' ? null : value)),
  // Флажок приходит только отмеченным: у неотмеченного в форме ничего нет,
  // поэтому «поле отсутствует» и означает «выключено».
  aiEnabled: z
    .string()
    .optional()
    .transform((value) => value === 'on'),
  handoverMinutes: z.coerce.number().int().min(1).max(30),
  systemPrompt: z.string().trim().min(20).max(8000),
  model: z.string().trim().min(1).max(120),
  temperature: z.coerce.number().min(0).max(2),
  dailyTokenBudget: z.coerce.number().int().min(0).max(10_000_000),
});

export async function saveSite(siteId: string, form: FormData): Promise<void> {
  const operator = await requireOperator();

  const site = await findOperatorSite({ workspaceIds: operator.workspaceIds, siteId });
  if (site === null) notFound();

  const path = `/dashboard/sites/${siteId}`;
  const parsed = settingsSchema.safeParse({
    name: field(form, 'name'),
    origins: field(form, 'origins'),
    widgetColor: field(form, 'widgetColor'),
    widgetTitle: field(form, 'widgetTitle'),
    widgetGreeting: field(form, 'widgetGreeting'),
    aiEnabled: field(form, 'aiEnabled'),
    handoverMinutes: field(form, 'handoverMinutes'),
    systemPrompt: field(form, 'systemPrompt'),
    model: field(form, 'model'),
    temperature: field(form, 'temperature'),
    dailyTokenBudget: field(form, 'dailyTokenBudget'),
  });

  if (!parsed.success) {
    console.warn('[ecw] настройки сайта не сохранены', {
      siteId,
      issues: parsed.error.issues.map((issue) => issue.path.join('.')),
    });
    redirect(`${path}?error=1`);
  }

  const data = parsed.data;

  await saveSiteSettings({
    siteId,
    name: data.name,
    allowedOrigins: data.origins,
    widgetColor: data.widgetColor,
    widgetTitle: data.widgetTitle,
    widgetGreeting: data.widgetGreeting,
  });

  await saveChatSettings({
    siteId,
    aiEnabled: data.aiEnabled,
    handoverTimeoutSeconds: data.handoverMinutes * 60,
  });

  await saveAiSettings({
    siteId,
    systemPrompt: data.systemPrompt,
    model: data.model,
    temperature: data.temperature,
    dailyTokenBudget: data.dailyTokenBudget,
  });

  revalidatePath(path);
  redirect(`${path}?saved=1`);
}

const menuSchema = z.object({
  label: z.string().trim().min(1).max(80),
  action: z.enum(['ANSWER', 'OPERATOR', 'SUBMENU', 'AI']),
  answer: z.string().trim().max(2000),
  parentId: z.string().trim().max(120),
  position: z.coerce.number().int().min(0).max(999),
});

/**
 * Проверяет доступ к сайту и разбирает форму пункта меню.
 *
 * Возвращает `null`, если что-то не так: вызывающий уже ответил редиректом или
 * 404. Так проверка не повторяется три раза в трёх действиях.
 */
function readMenuForm(form: FormData): { optionId: string | null; input: MenuOptionInput } | null {
  const parsed = menuSchema.safeParse({
    label: field(form, 'label'),
    action: field(form, 'action'),
    answer: field(form, 'answer'),
    parentId: field(form, 'parentId'),
    position: field(form, 'position'),
  });

  if (!parsed.success) return null;

  // Ответ обязателен только у «показать ответ». У остальных действий он пуст:
  // иначе в базе копится текст, который никогда не покажется.
  const answer = parsed.data.action === 'ANSWER' ? parsed.data.answer : '';
  if (parsed.data.action === 'ANSWER' && answer === '') return null;

  const optionId = field(form, 'optionId');

  return {
    optionId: optionId === '' ? null : optionId,
    input: {
      label: parsed.data.label,
      action: parsed.data.action,
      answer: answer === '' ? null : answer,
      parentId: parsed.data.parentId === '' ? null : parsed.data.parentId,
      position: parsed.data.position,
    },
  };
}

/** Заводит пункт меню. */
export async function addMenuItem(siteId: string, form: FormData): Promise<void> {
  const operator = await requireOperator();

  const site = await findOperatorSite({ workspaceIds: operator.workspaceIds, siteId });
  if (site === null) notFound();

  const parsed = readMenuForm(form);
  if (parsed === null) redirect(`/dashboard/sites/${siteId}?menu=bad`);

  await createMenuOption(siteId, parsed.input);

  const path = `/dashboard/sites/${siteId}`;
  revalidatePath(path);
  redirect(`${path}?menu=added`);
}

/** Меняет пункт меню. */
export async function saveMenuItem(siteId: string, form: FormData): Promise<void> {
  const operator = await requireOperator();

  const site = await findOperatorSite({ workspaceIds: operator.workspaceIds, siteId });
  if (site === null) notFound();

  const parsed = readMenuForm(form);
  if (parsed === null || parsed.optionId === null) {
    redirect(`/dashboard/sites/${siteId}?menu=bad`);
  }

  const saved = await updateMenuOption(siteId, parsed.optionId, parsed.input);

  const path = `/dashboard/sites/${siteId}`;
  revalidatePath(path);
  redirect(saved ? `${path}?menu=saved` : `${path}?menu=bad`);
}

/** Удаляет пункт меню вместе с вложенными. */
export async function deleteMenuItem(siteId: string, optionId: string): Promise<void> {
  const operator = await requireOperator();

  const site = await findOperatorSite({ workspaceIds: operator.workspaceIds, siteId });
  if (site === null) notFound();

  await deleteMenuOption(siteId, optionId);

  const path = `/dashboard/sites/${siteId}`;
  revalidatePath(path);
  redirect(`${path}?menu=deleted`);
}

/** `form.get` возвращает ещё и файл: приведение через `String` дало бы `[object File]`. */
function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export interface AddSiteState {
  error: string | null;
}

const addSiteSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().trim().min(2).max(80),
  origins: z
    .string()
    .transform((value) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== ''),
    )
    .pipe(z.array(z.string().url().max(200)).max(20)),
});

/**
 * Заводит сайт в рабочем пространстве.
 *
 * Без этого разделение доступов было бы неполным: пространство есть, оператор
 * есть, а подключить к нему сайт можно было только скриптом. Ключ генерируется
 * на сервере и показывается на странице сайта — его вставляют в разметку.
 */
export async function addSite(_previous: AddSiteState, form: FormData): Promise<AddSiteState> {
  const operator = await requireOperator();
  const workspaceId = field(form, 'workspaceId');

  // Право то же, что у приглашения операторов: распоряжаться пространством может
  // владелец или администратор.
  const membership = await findMembership({ userId: operator.id, workspaceId });
  if (membership === null || !canManage(membership.role)) {
    return { error: 'You cannot add sites to this workspace.' };
  }

  const parsed = addSiteSchema.safeParse({
    workspaceId,
    name: field(form, 'name'),
    origins: field(form, 'origins'),
  });

  if (!parsed.success) {
    return {
      error:
        'Check the name and the origins: each origin must be a full address, like https://example.com',
    };
  }

  const site = await createSite({
    workspaceId: parsed.data.workspaceId,
    name: parsed.data.name,
    allowedOrigins: parsed.data.origins,
  });

  revalidatePath('/dashboard/sites');
  // Сразу на страницу нового сайта: там лежит его ключ и готовая строка вставки,
  // то есть ровно то, зачем сайт и заводили.
  redirect(`/dashboard/sites/${site.id}`);
}

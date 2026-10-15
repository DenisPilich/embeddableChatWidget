'use server';

import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  findMembership,
  findOperatorSite,
  createSite,
  saveAiSettings,
  saveSiteSettings,
} from '@/lib/data';
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

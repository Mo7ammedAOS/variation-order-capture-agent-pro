import 'server-only';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { AuthenticatedUser } from '@/lib/auth/provider';
import { recordAudit } from '@/services/audit-log.service';
import { assertCapability } from '@/services/project-access.service';

/**
 * Company settings — one row, the deployment's own identity.
 *
 * `singleton` is a unique boolean, so the database itself refuses a second row.
 * That matters because half the app reads "the" settings with `findFirst`, and
 * a second row would mean the branding and the timezone depended on insertion
 * order.
 *
 * The timezone and workweek are not cosmetic. Notice deadlines are counted from
 * here, and getting them wrong moves a contractual date.
 */

export const companySettingsSchema = z.object({
  legalCompanyName: z.string().trim().min(2).max(200),
  displayCompanyName: z.string().trim().min(2).max(200),
  defaultCurrency: z.string().trim().length(3).default('AED'),
  timezone: z.string().trim().min(3).max(64).default('Asia/Dubai'),
  /** 0 = Sunday. The UAE working week starts on Monday and ends on Friday. */
  workweekStartDay: z.coerce.number().int().min(0).max(6).default(1),
  workweekEndDay: z.coerce.number().int().min(0).max(6).default(5),
  /**
   * Days remaining at which a notice turns amber. Red is zero or breached, and
   * is not configurable: a passed contractual deadline is not a preference.
   */
  riskAmberThresholdDays: z.coerce.number().int().min(1).max(60).default(7),
  defaultEmailSenderName: z.string().trim().max(200).optional().nullable(),
  defaultEmailSenderAddress: z
    .string()
    .trim()
    .email()
    .optional()
    .nullable()
    .or(z.literal('')),
  whatsappBusinessNumber: z.string().trim().max(40).optional().nullable(),
});

export type CompanySettingsInput = z.input<typeof companySettingsSchema>;

export async function getCompanySettings() {
  return prisma.companySettings.findFirst();
}

export async function updateCompanySettings(
  user: AuthenticatedUser,
  input: CompanySettingsInput,
) {
  await assertCapability(user, 'companySettings.manage');
  const data = companySettingsSchema.parse(input);

  const existing = await prisma.companySettings.findFirst();

  return prisma.$transaction(async (tx) => {
    const settings = existing
      ? await tx.companySettings.update({ where: { id: existing.id }, data })
      : await tx.companySettings.create({ data: { ...data, singleton: true } });

    // Recorded because the timezone and the amber threshold both move dates
    // people are judged against, and "it always said that" is a claim someone
    // will eventually make.
    await recordAudit({
      db: tx,
      userId: user.id,
      recordType: 'company_settings',
      recordId: settings.id,
      actionType: existing ? 'updated' : 'created',
      oldValue: existing
        ? {
            timezone: existing.timezone,
            riskAmberThresholdDays: existing.riskAmberThresholdDays,
            defaultCurrency: existing.defaultCurrency,
          }
        : undefined,
      newValue: {
        timezone: data.timezone,
        riskAmberThresholdDays: data.riskAmberThresholdDays,
        defaultCurrency: data.defaultCurrency,
      },
    });

    return settings;
  });
}

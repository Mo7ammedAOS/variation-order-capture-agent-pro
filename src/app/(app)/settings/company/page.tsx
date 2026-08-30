import type { Metadata } from 'next';
import { requirePageUser } from '@/lib/auth/session';
import { getCompanySettings } from '@/services/company.service';
import { hasCapability } from '@/services/permissions.service';
import { Card, CardContent } from '@/components/ui/card';
import { CompanyForm } from './company-form';

export const metadata: Metadata = { title: 'Company settings' };
export const dynamic = 'force-dynamic';

export default async function CompanySettingsPage() {
  const user = await requirePageUser();
  const mayManage = await hasCapability(user.systemRole, [], 'companySettings.manage');

  if (!mayManage) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="font-medium">Company settings are restricted</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Only a company administrator can change them.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const settings = await getCompanySettings();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <header>
        <h1 className="text-2xl font-extrabold tracking-[-0.02em]">Company settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One record for the whole deployment. Every change here is recorded against your
          name, because two of these settings move dates people are judged against.
        </p>
      </header>

      <CompanyForm
        defaults={{
          legalCompanyName: settings?.legalCompanyName ?? '',
          displayCompanyName: settings?.displayCompanyName ?? '',
          defaultCurrency: settings?.defaultCurrency ?? 'AED',
          timezone: settings?.timezone ?? 'Asia/Dubai',
          workweekStartDay: settings?.workweekStartDay ?? 1,
          workweekEndDay: settings?.workweekEndDay ?? 5,
          riskAmberThresholdDays: settings?.riskAmberThresholdDays ?? 7,
          defaultEmailSenderName: settings?.defaultEmailSenderName ?? '',
          defaultEmailSenderAddress: settings?.defaultEmailSenderAddress ?? '',
          whatsappBusinessNumber: settings?.whatsappBusinessNumber ?? '',
        }}
      />
    </div>
  );
}

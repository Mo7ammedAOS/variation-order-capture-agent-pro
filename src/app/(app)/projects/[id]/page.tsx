import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, FileText } from 'lucide-react';
import { requireUser } from '@/lib/auth/session';
import { getProject } from '@/services/project.service';
import { getProjectDashboard } from '@/services/dashboard.service';
import { listContacts } from '@/services/contact.service';
import { listMembers } from '@/services/project-member.service';
import { listPotentialChanges } from '@/services/potential-change.service';
import { listDocuments } from '@/services/document.service';
import { listTasks } from '@/services/task.service';
import { prisma } from '@/lib/prisma';
import { isAppError } from '@/lib/errors';
import { formatDate, formatDateTime } from '@/lib/dates';
import { humanise } from '@/services/dashboard.service';
import { PROJECT_ROLE_LABELS } from '@/lib/rbac';
import { hasCapability } from '@/services/permissions.service';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Money } from '@/components/domain/money';
import { RiskChip, StatusChip } from '@/components/domain/risk-chip';
import { NoticeCountdown } from '@/components/domain/notice-countdown';
import { StatCard } from '@/components/domain/stat-card';
import { getProjectRoles } from '@/services/project-access.service';
import { ContractRulesForm } from './contract-rules-form';

export const dynamic = 'force-dynamic';

const TABS = [
  'overview', 'potential-changes', 'contract-rules',
  'contacts', 'team', 'documents', 'tasks', 'activity',
] as const;
type Tab = (typeof TABS)[number];

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const project = await prisma.project
    .findUnique({ where: { id }, select: { projectCode: true, projectName: true } })
    .catch(() => null);
  return { title: project ? `${project.projectCode} — ${project.projectName}` : 'Project' };
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { tab: rawTab } = await searchParams;

  const tab: Tab = TABS.includes(rawTab as Tab) ? (rawTab as Tab) : 'overview';

  let project;
  try {
    project = await getProject(user, id);
  } catch (error) {
    if (isAppError(error) && (error.status === 403 || error.status === 404)) notFound();
    throw error;
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <Link
        href="/projects"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All projects
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="tabular text-sm font-semibold text-primary">{project.projectCode}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{project.projectName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {project.clientName}
            {project.consultantName ? ` · ${project.consultantName}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={`/projects/${id}/report`}
            className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-accent"
          >
            <FileText aria-hidden className="size-4" />
            Register report
          </Link>
          <StatusChip status={project.projectStatus} />
        </div>
      </header>

      {/* Tabs are links, so a tab is shareable and the back button works. */}
      <nav aria-label="Project sections" className="overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {TABS.map((name) => (
            <li key={name}>
              <Link
                href={`/projects/${id}?tab=${name}`}
                aria-current={tab === name ? 'page' : undefined}
                className={`-mb-px block whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium capitalize transition-colors ${
                  tab === name
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {name.replace(/-/g, ' ')}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {tab === 'overview' ? <OverviewTab user={user} projectId={id} /> : null}
      {tab === 'potential-changes' ? <ChangesTab user={user} projectId={id} /> : null}
      {tab === 'contract-rules' ? (
        <ContractRulesTab user={user} projectId={id} rules={project.contractRules} />
      ) : null}
      {tab === 'contacts' ? <ContactsTab user={user} projectId={id} /> : null}
      {tab === 'team' ? <TeamTab user={user} projectId={id} /> : null}
      {tab === 'documents' ? <DocumentsTab user={user} projectId={id} /> : null}
      {tab === 'tasks' ? <TasksTab user={user} projectId={id} /> : null}
      {tab === 'activity' ? <ActivityTab projectId={id} /> : null}
    </div>
  );
}

type User = Awaited<ReturnType<typeof requireUser>>;

async function OverviewTab({ user, projectId }: { user: User; projectId: string }) {
  const data = await getProjectDashboard(user, projectId);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Contract value"
          value={
            data.project?.originalContractValue
              ? `${data.project.currency} ${Number(data.project.originalContractValue).toLocaleString('en-AE')}`
              : '—'
          }
        />
        <StatCard
          label="Value at stake"
          value={`AED ${data.estimatedValue.toLocaleString('en-AE')}`}
          hint="Open potential changes"
        />
        <StatCard
          label="Notices overdue"
          value={data.noticesOverdue}
          tone={data.noticesOverdue > 0 ? 'red' : 'green'}
        />
        <StatCard
          label="Open bottlenecks"
          value={data.bottlenecks}
          tone={data.bottlenecks > 0 ? 'amber' : 'green'}
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Potential changes by stage</CardTitle>
        </CardHeader>
        <CardContent>
          {data.byStatus.length === 0 ? (
            <p className="text-sm text-muted-foreground">No potential changes yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {data.byStatus.map((row) => (
                <li key={row.label}>
                  <Badge variant="secondary">
                    {row.label} · <span className="tabular">{row.count}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

async function ChangesTab({ user, projectId }: { user: User; projectId: string }) {
  const changes = await listPotentialChanges(user, { projectId });
  if (changes.length === 0) return <Empty message="No potential changes on this project." />;

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>PC Number</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Notice due</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>Risk</TableHead>
            <TableHead className="text-end">Estimated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changes.map((change) => (
            <TableRow key={change.id}>
              <TableCell>
                <Link
                  href={`/variations/${change.id}`}
                  className="tabular font-medium text-primary hover:underline"
                >
                  {change.pcNumber}
                </Link>
              </TableCell>
              <TableCell className="max-w-72 truncate">{change.title}</TableCell>
              <TableCell>
                <StatusChip status={change.currentStatus} />
              </TableCell>
              <TableCell>
                <NoticeCountdown noticeDueDate={change.noticeDueDate} compact />
              </TableCell>
              <TableCell>{change.currentOwner?.fullName ?? '—'}</TableCell>
              <TableCell>
                <RiskChip level={change.riskLevel} />
              </TableCell>
              <TableCell className="text-end">
                <Money value={change.estimatedValue?.toString() ?? null} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

/** Money comes back as Prisma Decimal; the form wants a plain editable string. */
function decimalToInput(value: { toString(): string } | null): string {
  return value === null ? '' : value.toString();
}

async function ContractRulesTab({
  user,
  projectId,
  rules,
}: {
  user: Awaited<ReturnType<typeof requireUser>>;
  projectId: string;
  rules: Awaited<ReturnType<typeof getProject>>['contractRules'];
}) {
  if (!rules) return <Empty message="Contract rules have not been configured." />;

  // Whether to show the editor is decided here, but it is not what enforces the
  // rule — updateContractRules re-checks the same capability server-side, so
  // hiding the form is a courtesy and the service is the gate.
  const projectRoles = await getProjectRoles(user, projectId);
  const canEdit = await hasCapability(user.systemRole, projectRoles, 'project.manageContractRules');

  if (canEdit) {
    return (
      <ContractRulesForm
        projectId={projectId}
        values={{
          contractType: rules.contractType ?? '',
          contractClauseReference: rules.contractClauseReference ?? '',
          noticePeriodDays: rules.noticePeriodDays,
          detailedClaimPeriodDays: rules.detailedClaimPeriodDays,
          noticeDeliveryMethod: rules.noticeDeliveryMethod ?? '',
          noticeRecipientName: rules.noticeRecipientName ?? '',
          noticeRecipientEmail: rules.noticeRecipientEmail ?? '',
          noticeRecipientCompany: rules.noticeRecipientCompany ?? '',
          noticeTemplateName: rules.noticeTemplateName ?? '',
          variationProposalTemplateName: rules.variationProposalTemplateName ?? '',
          eotAssessmentRequired: rules.eotAssessmentRequired,
          approvalThresholdPm: decimalToInput(rules.approvalThresholdPm),
          approvalThresholdCm: decimalToInput(rules.approvalThresholdCm),
          approvalThresholdCommercialDirector: decimalToInput(rules.approvalThresholdCommercialDirector),
          approvalThresholdManagingDirector: decimalToInput(rules.approvalThresholdManagingDirector),
          highRiskVoValue: decimalToInput(rules.highRiskVoValue),
          clientFollowUpDays: rules.clientFollowUpDays,
          qsPricingDueDays: rules.qsPricingDueDays,
          pmScopeReviewDueDays: rules.pmScopeReviewDueDays,
          internalApprovalDueDays: rules.internalApprovalDueDays,
        }}
      />
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Notice</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="Contract type">{rules.contractType ?? '—'}</Detail>
            <Detail label="Clause reference">{rules.contractClauseReference ?? '—'}</Detail>
            <Detail label="Notice period">
              <span className="tabular font-medium">{rules.noticePeriodDays} days</span>
              <span className="block text-xs text-muted-foreground">
                Every notice deadline on this project is the event date plus this.
              </span>
            </Detail>
            <Detail label="Detailed claim period">
              <span className="tabular">{rules.detailedClaimPeriodDays} days</span>
            </Detail>
            <Detail label="Delivery method">{rules.noticeDeliveryMethod ?? '—'}</Detail>
            <Detail label="Recipient">
              {rules.noticeRecipientName ?? '—'}
              {rules.noticeRecipientEmail ? (
                <span className="block text-xs text-muted-foreground">
                  {rules.noticeRecipientEmail}
                </span>
              ) : null}
            </Detail>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Turnaround targets</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Detail label="PM scope review">
              <span className="tabular">{rules.pmScopeReviewDueDays} days</span>
            </Detail>
            <Detail label="QS pricing">
              <span className="tabular">{rules.qsPricingDueDays} days</span>
            </Detail>
            <Detail label="Internal approval">
              <span className="tabular">{rules.internalApprovalDueDays} days</span>
            </Detail>
            <Detail label="Client follow-up">
              <span className="tabular">{rules.clientFollowUpDays} days</span>
            </Detail>
            <Detail label="EOT assessment">
              {rules.eotAssessmentRequired ? 'Required' : 'Not required'}
            </Detail>
            <Detail label="High risk threshold">
              <Money value={rules.highRiskVoValue?.toString() ?? null} />
            </Detail>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

async function ContactsTab({ user, projectId }: { user: User; projectId: string }) {
  const contacts = await listContacts(user, projectId);
  if (contacts.length === 0) return <Empty message="No contacts recorded." />;

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Company</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Verified</TableHead>
            <TableHead>Authority</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => (
            <TableRow key={contact.id}>
              <TableCell>
                <p className="font-medium">{contact.fullName}</p>
                <p className="text-xs text-muted-foreground">{contact.jobTitle ?? '—'}</p>
              </TableCell>
              <TableCell className="text-muted-foreground">{contact.companyName ?? '—'}</TableCell>
              <TableCell>
                <StatusChip status={contact.contactType} />
              </TableCell>
              <TableCell>
                <Badge variant={contact.authorityVerified ? 'riskGreen' : 'riskAmber'}>
                  {contact.authorityVerified ? 'Verified' : 'Unverified'}
                </Badge>
              </TableCell>
              <TableCell>
                {/* What this person may actually do. Blank means nothing. */}
                <div className="flex flex-wrap gap-1">
                  {contact.canRequestChange ? <Badge variant="outline">Request</Badge> : null}
                  {contact.canIssueTechnicalInstruction ? (
                    <Badge variant="outline">Instruct (technical)</Badge>
                  ) : null}
                  {contact.canInstructWork ? <Badge variant="outline">Instruct work</Badge> : null}
                  {contact.canApproveCost ? <Badge variant="outline">Approve cost</Badge> : null}
                  {contact.canApproveTime ? <Badge variant="outline">Approve time</Badge> : null}
                  {contact.canSignFinalVo ? <Badge variant="outline">Sign VO</Badge> : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

async function TeamTab({ user, projectId }: { user: User; projectId: string }) {
  const members = await listMembers(user, projectId);
  if (members.length === 0) return <Empty message="No one is assigned to this project." />;

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Project role</TableHead>
            <TableHead>Assigned</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell className="font-medium">{member.user.fullName}</TableCell>
              <TableCell className="text-muted-foreground">{member.user.email}</TableCell>
              <TableCell>{PROJECT_ROLE_LABELS[member.projectRole]}</TableCell>
              <TableCell className="tabular text-muted-foreground">
                {formatDate(member.assignedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

async function DocumentsTab({ user, projectId }: { user: User; projectId: string }) {
  const documents = await listDocuments(user, { projectId });
  if (documents.length === 0) return <Empty message="No documents registered." />;

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Number</TableHead>
            <TableHead>Revision</TableHead>
            <TableHead>Uploaded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((document) => (
            <TableRow key={document.id}>
              <TableCell>
                {document.driveFileId ? (
                  <a
                    href={`/api/documents/${document.id}/content`}
                    className="font-medium text-primary hover:underline"
                  >
                    {document.documentName}
                  </a>
                ) : (
                  <span className="font-medium">{document.documentName}</span>
                )}
              </TableCell>
              <TableCell>
                <StatusChip status={document.documentType} />
              </TableCell>
              <TableCell className="tabular text-muted-foreground">
                {document.documentNumber ?? '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {document.revisionNumber ?? '—'}
              </TableCell>
              <TableCell className="tabular text-muted-foreground">
                {formatDate(document.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

async function TasksTab({ user, projectId }: { user: User; projectId: string }) {
  const tasks = await listTasks(user, { projectId });
  if (tasks.length === 0) return <Empty message="No tasks on this project." />;

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Assigned to</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.map((task) => (
            <TableRow key={task.id}>
              <TableCell className="max-w-80 truncate font-medium">{task.title}</TableCell>
              <TableCell className="text-muted-foreground">{humanise(task.taskType)}</TableCell>
              <TableCell>{task.assignedTo?.fullName ?? '—'}</TableCell>
              <TableCell className="tabular">{formatDate(task.dueDate)}</TableCell>
              <TableCell>
                <StatusChip status={task.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

async function ActivityTab({ projectId }: { projectId: string }) {
  // Reached only after getProject() asserted access above.
  const entries = await prisma.activityLog.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { user: { select: { fullName: true } } },
  });

  if (entries.length === 0) return <Empty message="No activity recorded." />;

  return (
    <Card>
      <CardContent className="pt-5">
        <ol className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.id} className="border-s-2 border-border ps-3">
              <p className="text-sm">
                <span className="font-medium capitalize">
                  {entry.actionType.replace(/_/g, ' ')}
                </span>{' '}
                <span className="text-muted-foreground">
                  {entry.recordType.replace(/_/g, ' ')}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.user?.fullName ?? humanise(entry.source)} · {formatDateTime(entry.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <Card>
      <CardContent className="py-12 text-center text-sm text-muted-foreground">{message}</CardContent>
    </Card>
  );
}

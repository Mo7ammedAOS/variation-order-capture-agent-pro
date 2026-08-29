# CLAUDE.md

## Project Identity

This project is called:

# VO Capture & Control

Full name:

**Variation Notice, Capture, Approval & Bottleneck-Control System  
for UAE Fit-Out and Interior Contracting Companies**

This product helps UAE fit-out companies capture, protect, price,
approve, invoice, and collect Variation Orders (VOs), Change Orders,
Notices of Claim, and project changes.

The system is used by:

- Managing Director
- Operations Director
- Commercial Director
- Commercial Manager
- Contract Administrator
- Project Manager
- Quantity Surveyor
- Site Engineer
- Foreman
- Procurement Team
- Planning Engineer
- Finance Team
- Document Controller

The system must be:

- Commercially useful
- Easy for Site Engineers
- Powerful for QS, PM, CM, and Directors
- Mobile friendly
- English and Arabic ready
- Arabic RTL ready
- Auditable
- Secure
- Evidence-driven
- Configurable
- Reusable for future client deployments

---

# Deployment Model

This is NOT a shared multi-company SaaS platform at this stage.

Each fit-out company receives a separate installation.

Each client deployment must have its own:

```text
Dedicated application
Dedicated database
Dedicated document storage
Dedicated n8n workspace or instance
Dedicated WhatsApp Business connection
Dedicated email connection
Dedicated API credentials
Dedicated AI credentials or scoped configuration
Dedicated user accounts
Dedicated projects
Dedicated branding
Dedicated dashboards
Dedicated backup
Dedicated audit logs
```

Example:

```text
Client A — ABC Fit-Out LLC
│
├── App: vo.abcfitout.ae
├── Database: ABC Fit-Out PostgreSQL database
├── Storage: ABC project document storage
├── n8n: ABC Fit-Out workflow workspace
├── WhatsApp: ABC VO Capture number
├── Email: vo@abcfitout.ae
└── Users: ABC Fit-Out staff only
```

Future client:

```text
Client B — XYZ Interiors LLC
│
├── App: vo.xyzinteriors.ae
├── Database: XYZ Interiors PostgreSQL database
├── Storage: XYZ project document storage
├── n8n: XYZ Interiors workflow workspace
├── WhatsApp: XYZ VO Capture number
├── Email: vo@xyzinteriors.ae
└── Users: XYZ Interiors staff only
```

Client A and Client B must never share:

```text
Database
Documents
Users
WhatsApp credentials
Email credentials
API keys
AI context
Dashboards
Reports
Project data
n8n execution logs
Workflow data
```

The product must be built as one reusable master template,
then duplicated and configured separately for each client company.

---

# Core Architecture

Use a hybrid architecture.

```text
WhatsApp / Email / QR Form / Documents
                ↓
        n8n Integration Layer
                ↓
        Secure Custom App API
                ↓
     PostgreSQL System of Record
                ↓
   Custom Dashboard and Business Logic
                ↓
AI Processing + Background Jobs + Notifications
```

## Main Rule

> **The custom application owns the truth.**  
> **n8n moves information between external systems.**  
> **AI understands, extracts, summarises, and drafts.**  
> **Humans approve commercial and contractual actions.**

---

# Ownership Boundaries

## Custom Application Owns

The custom application is the source of truth.

Build these features in the custom application:

```text
User authentication
User roles
Project membership
Project access permissions
Company settings
Project settings
Contract rules
Contact authority register
Potential Change register
Variation Order register
Notice register
QS pricing records
Approval rules
Client approval status
Invoice status
Payment status
Project document metadata
Task records
Bottleneck records
Escalation status
Audit logs
Dashboard calculations
Mobile dashboard
Arabic RTL interface
PDF notice generation
PDF Variation Proposal generation
Reports
Exports
Business rules
Notice deadline calculations
Approval validation
Commercial status transitions
```

The custom application must own all important business records.

Do not store the only copy of commercial logic or commercial data
inside n8n workflows.

## n8n Owns

n8n is the integration and automation layer.

Use n8n for:

```text
WhatsApp webhook reception
WhatsApp media download
WhatsApp outgoing notifications
Email inbox monitoring
Email attachment extraction
Email sending
Outlook integration
Gmail integration
SharePoint integration
Google Drive integration
Document upload triggers
External API calls
Scheduled trigger initiation
Retrying external integration failures
Calling secure app APIs
Calling AI APIs if required
Sending weekly report emails
Sending reminder notifications
Moving files to approved storage
```

n8n must not own:

```text
Primary business data
User permissions
Project permissions
Notice rules
Approval logic
Contract rules
Final VO status
Final invoice status
Payment status
Audit truth
Dashboard calculations
Commercial decision-making
Legal entitlement decisions
```

---

# WAT Architecture

Use WAT:

# W — Workflows

Workflows are documented Standard Operating Procedures.

Store them in:

```text
/workflows/
```

Each workflow file must include:

```text
Workflow Name
Business Objective
Trigger
Inputs
User Roles
Permissions Required
Custom App Services Used
n8n Workflow Used
AI Use
Human Approval Gates
Step-by-Step Logic
Database Changes
Notifications
Error Handling
Retry Logic
Audit Events
Edge Cases
Definition of Done
```

Create these workflow documents:

```text
/workflows/
├── project_onboarding.md
├── user_and_project_assignment.md
├── contact_authority_setup.md
├── capture_whatsapp_change.md
├── capture_email_change.md
├── capture_mobile_site_change.md
├── identify_project.md
├── unassigned_capture_inbox.md
├── upload_project_document.md
├── drawing_revision_review.md
├── notice_assessment.md
├── draft_initial_notice.md
├── approve_and_send_notice.md
├── qs_pricing.md
├── procurement_quotation.md
├── subcontractor_quotation.md
├── eot_assessment.md
├── commercial_review.md
├── internal_approval.md
├── client_vo_submission.md
├── client_approval_followup.md
├── bottleneck_detection.md
├── reminder_and_escalation.md
├── approved_but_unbilled.md
├── invoice_tracking.md
├── payment_collection.md
├── weekly_commercial_report.md
└── new_client_deployment.md
```

# A — Agents

Agents use AI for reasoning and assistance.

AI may:

```text
Read WhatsApp messages
Read emails
Transcribe voice notes
Read PDFs
Read screenshots
Read scanned documents
Read drawings
Extract drawing numbers
Extract document revisions
Extract project references
Identify possible variations
Identify missing evidence
Suggest project assignment
Suggest affected trade
Suggest possible cost/time risk
Suggest duplicate Potential Changes
Draft Notice of Potential Claim
Draft Variation Proposal description
Draft client follow-up
Summarise bottlenecks
Prepare weekly risk reports
```

AI must not:

```text
Decide legal entitlement
Approve a VO
Approve final QS pricing
Send a contractual notice automatically
Treat WhatsApp as final client approval automatically
Change Contract Sum automatically
Change invoice value automatically
Change payment status automatically
Delete source evidence
Delete audit logs
Override permission rules
Access another client deployment
```

Core rule:

> **AI suggests.  
> Humans approve.  
> Custom application validates.  
> n8n delivers integration actions.**

Agent specifications live in `/agents/`, one `.agent.md` per agent, with prompts in
`/agents/prompts/`. Implementations go behind the AI-provider abstraction in
`/src/integrations/claude/` — never a direct SDK call from a service or a route.

Prompts are version-controlled **files**, never string literals in application code.
This system drafts contractual notices; a prompt change must be a reviewable diff.

See `/agents/README.md` for the full may / must-not list and the output contract.

# T — Tools

Tools are deterministic services and integrations.

Custom application services live in:

```text
/src/services/
/src/lib/
/src/app/api/
/src/workers/
/src/jobs/
/src/integrations/
/src/utils/
```

Suggested structure:

```text
/src/
├── app/
│   ├── api/
│   │   ├── webhooks/
│   │   │   ├── whatsapp/
│   │   │   ├── email/
│   │   │   └── n8n/
│   │   ├── potential-changes/
│   │   ├── notices/
│   │   ├── variation-orders/
│   │   ├── tasks/
│   │   ├── bottlenecks/
│   │   └── reports/
│   ├── dashboard/
│   ├── projects/
│   ├── variations/
│   ├── notices/
│   ├── bottlenecks/
│   ├── pricing/
│   ├── finance/
│   └── settings/
│
├── components/
├── services/
│   ├── potential-change.service.ts
│   ├── notice.service.ts
│   ├── variation-order.service.ts
│   ├── pricing.service.ts
│   ├── project.service.ts
│   ├── project-access.service.ts
│   ├── task.service.ts
│   ├── bottleneck.service.ts
│   ├── reminder.service.ts
│   ├── escalation.service.ts
│   ├── document.service.ts
│   ├── audit-log.service.ts
│   ├── invoice.service.ts
│   └── payment.service.ts
│
├── integrations/
│   ├── whatsapp/
│   ├── outlook/
│   ├── gmail/
│   ├── sharepoint/
│   ├── google-drive/
│   ├── claude/
│   ├── n8n/
│   └── storage/
│
├── workers/
│   ├── notice-deadline.worker.ts
│   ├── reminder.worker.ts
│   ├── escalation.worker.ts
│   ├── client-followup.worker.ts
│   ├── approved-unbilled.worker.ts
│   ├── payment-overdue.worker.ts
│   ├── weekly-report.worker.ts
│   └── ai-processing.worker.ts
│
├── lib/
├── utils/
└── types/
```

n8n workflow exports must be stored in version control:

```text
/n8n-workflows/
├── whatsapp-capture.json
├── email-capture.json
├── document-upload.json
├── whatsapp-notification.json
├── email-notification.json
├── client-followup.json
├── weekly-report-delivery.json
└── integration-error-alert.json
```

---

# Recommended Stack

## Custom Application

```text
Next.js 15+
TypeScript
React
Tailwind CSS
shadcn/ui
TanStack Query
TanStack Table
React Hook Form
Zod
Lucide Icons
Recharts
```

## Database and Authentication

```text
PostgreSQL
Supabase PostgreSQL
Prisma ORM
Supabase Auth
Supabase Storage
```

## Background Jobs

Use a custom background-job engine for internal business rules.

Preferred options:

```text
BullMQ + Redis
or
Trigger.dev
or
Inngest
```

Choose one and document the decision.

Custom background jobs must manage:

```text
Notice deadline calculations
Notice deadline alerts
Task reminders
Bottleneck detection
Escalation logic
Client approval reminders
Approved-but-unbilled alerts
Payment overdue alerts
Weekly commercial report generation
Internal scheduled checks
```

## AI

```text
Claude API
```

Create an AI-provider abstraction so other models can be added later.

AI must return:

```text
Structured JSON
Confidence score
Source references
Extracted data
Missing information
Suggested next action
```

## n8n

Use n8n only for external integrations.

n8n must call secure application APIs.

Do not allow n8n to write directly to the database.

Preferred flow:

```text
External Event
        ↓
n8n receives event
        ↓
n8n validates external source
        ↓
n8n sends secure payload to Custom App API
        ↓
Custom App validates user/project/rules
        ↓
Custom App writes to database
        ↓
Custom App returns result
        ↓
n8n sends external confirmation if needed
```

---

# n8n Integration Rules

## Rule 1: n8n Does Not Write Directly to Database

n8n must not directly create, edit, approve, or close:

```text
Potential Changes
Notices
Variation Orders
QS pricing
Approval records
Invoice records
Payment records
Bottleneck records
```

n8n must use authenticated Custom App API endpoints.

Example:

```text
POST /api/integrations/whatsapp/incoming-message
POST /api/integrations/email/incoming-email
POST /api/integrations/documents/uploaded
POST /api/integrations/notifications/delivery-status
```

## Rule 2: Every n8n Event Must Be Idempotent

Every external event must have an idempotency key.

For example:

```text
WhatsApp message ID
Email message ID
Document ID
Webhook event ID
External notification ID
```

The system must not create duplicate Potential Changes
when a webhook retries.

## Rule 3: n8n Must Receive Only Required Data

n8n should receive only the minimum data needed
for the integration action.

Do not expose:

```text
Full contract database
All BOQ data
All project files
All VO values
All users
All client contacts
```

unless the specific workflow genuinely requires it.

## Rule 4: External Failures Must Not Change Business Truth

If WhatsApp, Outlook, Gmail, SharePoint, or another external provider fails:

```text
Do not mark notice as sent.
Do not mark email as delivered.
Do not mark client as notified.
Do not mark approval as complete.
```

Instead:

```text
Set external_delivery_status = failed
Create retry job
Create audit log
Notify responsible user if required
```

## Rule 5: n8n Must Log Back to Custom App

After n8n sends an external notification,
it must call the custom app API to log:

```text
Notification type
Channel
Recipient
Payload summary
Sent timestamp
Delivery status
External message ID
Failure reason if any
```

---

# Core Commercial Workflow

The mandatory workflow:

```text
Change Event
        ↓
Potential Change Captured
        ↓
Notice Assessment
        ↓
Initial Protective Notice if Required
        ↓
PM Scope Review
        ↓
QS Pricing
        ↓
Procurement Quotation
        ↓
Subcontractor Quotation
        ↓
EOT / Time Assessment
        ↓
CM Review
        ↓
Internal Approval
        ↓
Final Priced VO Sent to Client
        ↓
Client Review / Follow-Up
        ↓
Approved / Rejected / Disputed
        ↓
Approved but Unbilled
        ↓
Invoice Issued
        ↓
Payment Pending
        ↓
Collected / Closed
```

Core rule:

> **Capture the event immediately.  
> Assess notice risk immediately.  
> Send the protective notice if required.  
> Price and prove the change in parallel.**

---

# Project and User Model

Each deployed company may have:

```text
Many projects
Many PMs
Many QSs
Many Site Engineers
Many Foremen
Many Commercial Managers
Many Procurement Officers
Many Planners
Many Finance Users
Many Client / Consultant Contacts
```

A user can be assigned to:

```text
One project
Multiple selected projects
All company projects
```

System roles:

```text
company_owner
company_admin
managing_director
operations_director
commercial_director
commercial_manager
contract_administrator
finance_manager
procurement_manager
standard_user
viewer
```

Project roles:

```text
project_manager
quantity_surveyor
site_engineer
foreman
commercial_manager
contract_administrator
procurement_officer
planning_engineer
finance_officer
document_controller
project_viewer
client_viewer
consultant_viewer
```

Every project must have:

```text
Project Code
Client
Consultant
Contract
BOQ
Scope of Works
Tender Exclusions
Original Drawings
Revised Drawings
Specifications
Programme
Contract Rules
Notice Rules
Contact Authority Register
Project Members
Document Storage
Variation Register
Notice Register
Task Register
Bottleneck Register
Invoice/Payment Status
```

---

# Capture Channels

The system captures changes from more than Site Engineers.

Relevant people may include:

```text
Client
Client Representative
Consultant
Engineer
Architect
Interior Designer
MEP Consultant
Landlord
Authority
Project Manager
Quantity Surveyor
Site Engineer
Foreman
Commercial Manager
Contract Administrator
Procurement
Planner
Finance
Supplier
Subcontractor
```

Captured communication is evidence or a trigger.

It is not automatically an authorised instruction or final approval.

## WhatsApp Capture

Use the client company’s official WhatsApp Business number.

Example:

```text
ABC Fit-Out — VO Capture
```

n8n receives:

```text
Text
Photos
Screenshots
PDFs
Documents
Voice notes
Videos
Forwarded messages
```

n8n then sends the event to the custom app.

Required flow:

```text
Incoming WhatsApp Message
        ↓
n8n webhook receiver
        ↓
Verify webhook
        ↓
Extract message ID and sender
        ↓
Download permitted media
        ↓
Send secure payload to Custom App API
        ↓
Custom App identifies user
        ↓
Custom App identifies project
        ↓
Custom App creates or updates Potential Change
        ↓
Custom App creates task and evidence record
        ↓
Custom App responds to n8n
        ↓
n8n sends confirmation message if required
```

Project-identification rules:

```text
If sender has one active project:
→ Auto-select project.

If sender has several projects:
→ Ask sender to select project.

If project is unclear:
→ Do not guess.
→ Put the item in Unassigned Capture Inbox.
→ Assign PM, CM, or Company Admin to review.
```

## Email Capture

Use n8n to monitor:

```text
vo@clientcompany.com
projecta.vo@clientcompany.com
projectb.vo@clientcompany.com
Outlook Shared Mailbox
Gmail Inbox / Label
```

n8n must send email events to Custom App API.

Required captured information:

```text
Sender
Recipient
CC
Subject
Email body
Timestamp
Email message ID
Attachments
Project code if available
Drawing number if available
Contract number if available
```

If project is unclear:

```text
Unassigned Capture Inbox
```

Never guess project assignment.

## QR Code / Mobile Form

The custom app owns the mobile form.

Each project has a QR Code.

```text
Project QR Code
        ↓
Custom App Mobile Form
        ↓
Project automatically pre-selected
        ↓
Potential Change created
```

Required fields:

```text
Project
Location
What changed?
Who requested it?
Has work started? Yes / No
Upload photo/screenshot/drawing
Urgency
```

Optional fields:

```text
Voice note
Drawing number
RFI number
Estimated value
Potential time impact
Additional comments
```

---

# Notice-Control Rules

When a Potential Change is created:

```text
1. Custom App creates Notice Assessment task.
2. Assign PM and CM.
3. Calculate Notice Due Date from project contract rules.
4. Show Notice Countdown.
5. Show Red/Amber/Green risk.
6. If Notice Required:
   - Custom App creates notice draft.
   - AI may assist with draft.
   - CM or Contract Administrator reviews.
   - User clicks Approve for Sending.
   - Custom App creates final PDF.
   - Custom App creates send request.
   - n8n sends email or notification externally.
   - n8n returns delivery result.
   - Custom App stores evidence and audit log.
7. Custom App creates parallel tasks for PM, QS,
   Procurement, Planner, Site Team, and CM.
```

The system must track separately:

```text
Notice Required
Notice Drafted
Notice Sent
Notice Delivery Evidence
Notice Acknowledgement
Final VO Submitted
Client Approval
Invoice Status
Payment Status
```

Important:

> **Notice Sent is not Client Approved.**

---

# Bottleneck-Control Rules

The system must always answer:

```text
What is blocked?
Who owns the next action?
What are we waiting for?
What evidence is missing?
When is the deadline?
How long has it been waiting?
How much value is at risk?
What happens if nobody acts?
```

Every Potential Change and VO must show:

```text
Current Stage
Current Owner
Next Required Action
Due Date
Waiting For
Blocker Reason
Days Waiting
Escalation Level
Notice Countdown
Commercial Risk
Work Status
Estimated Value
Submitted Value
Approved Value
Invoiced Value
Collected Value
```

Detect:

```text
Notice Assessment overdue
Notice required but not drafted
Notice drafted but not sent
Notice sent but proof missing
PM Scope Review overdue
Missing client instruction
Missing drawing
Missing revised specification
Missing site photo
Missing labour record
QS pricing overdue
Procurement quotation overdue
Subcontractor quotation overdue
EOT assessment overdue
CM review overdue
Internal approval overdue
Client approval overdue
Client requests more information
Client rejects VO
Approved VO not invoiced
Invoice unpaid
Work started without approved VO
Work completed but VO not closed
```

The custom application detects bottlenecks.

n8n sends external messages when instructed by the custom application.

---

# Background Jobs

Use custom background jobs for commercial logic.

Do not place core reminder logic only inside n8n.

The custom application or job worker must:

```text
Calculate notice deadlines
Create task reminders
Detect overdue actions
Create bottlenecks
Calculate escalation level
Trigger internal alerts
Decide when client follow-up is due
Identify approved but unbilled VOs
Identify invoiced but unpaid VOs
Generate risk reports
```

n8n may deliver external reminders.

Example:

```text
Custom Job:
Checks all VOs awaiting client approval.
        ↓
Finds VO overdue by 3 working days.
        ↓
Creates client-follow-up task.
        ↓
Creates audit event.
        ↓
Requests n8n notification action.
        ↓
n8n sends approved email template.
        ↓
n8n reports delivery result.
        ↓
Custom App updates notification log.
```

---

# Dashboard Requirements

The custom app must provide a modern dashboard.

Requirements:

```text
Responsive
Mobile friendly
Tablet friendly
Desktop friendly
English LTR
Arabic RTL
Modern construction-tech design
Company branded
Fast search
Filters
Export
Role-specific views
Project-specific access
Red/Amber/Green risk indicators
```

Main navigation:

```text
Overview
My Tasks
Projects
Variations
Notice Control
QS Pricing
Client Approvals
Bottlenecks
Invoicing & Collection
Documents
Contacts & Authority
Reports
Settings
```

## Company Portfolio Dashboard

For:

```text
Managing Director
Commercial Director
Operations Director
Finance Manager
Company Admin
```

Show:

```text
Active Projects
Total Potential Change Value
Notice Risk Value
Notices Due This Week
Notices Overdue
Value Under QS Pricing
Internal Approval Pending Value
Client Approval Pending Value
Rejected / Disputed Value
Approved VO Value
Approved but Unbilled Value
Invoiced but Unpaid Value
Critical Bottlenecks
Top High-Risk Projects
Top Overdue Actions
Bottlenecks by Role
Submitted vs Approved vs Invoiced vs Collected Value
```

## Project Dashboard

Show:

```text
Project Contract Value
Potential Changes
Notice Countdown
Notice Risk
PM Review Status
QS Pricing Status
Procurement Delays
EOT Assessment Status
Client Approval Delays
Approved but Unbilled Value
Invoiced but Unpaid Value
Current Bottlenecks
Commercial Risk
```

## My Tasks Dashboard

For each user:

```text
Tasks Due Today
Overdue Tasks
Notice Review Tasks
PM Scope Review Tasks
QS Pricing Tasks
Missing Evidence Tasks
Procurement Tasks
EOT Tasks
Client Follow-Ups
Internal Approval Tasks
Finance Actions
```

---

# AI Processing

AI processing flow:

```text
WhatsApp / Email / Form / Document Upload
        ↓
Store original source evidence
        ↓
Transcribe voice note if needed
        ↓
OCR / document extraction if needed
        ↓
LLM structured extraction
        ↓
Custom App validates data
        ↓
Project identification
        ↓
Potential Change creation/update
        ↓
Evidence linking
        ↓
Task assignment
        ↓
Notice Assessment
```

AI output must be structured.

Example:

```json
{
  "change_detected": true,
  "suggested_project": "Dubai Office Fit-out",
  "location": "Reception, Level 2",
  "requested_by": "Client Representative",
  "change_description": "Replace paint finish with natural stone",
  "affected_trade": ["Finishes", "Stone", "MEP Coordination"],
  "possible_cost_impact": true,
  "possible_time_impact": true,
  "notice_assessment_required": true,
  "missing_information": [
    "Authorised instruction confirmation",
    "Revised drawing",
    "Work-started status"
  ],
  "confidence_score": 0.86
}
```

AI output must never overwrite original evidence.

---

# Security and Audit Rules

Store secrets only in:

```text
.env
Secure environment variable manager
Approved secret manager
```

Never commit secrets.

Never expose:

```text
Database passwords
WhatsApp tokens
Email credentials
Webhook secrets
Claude API keys
Client contracts
Client BOQs
Pricing data
Client documents
```

Create immutable audit logs for:

```text
Record created
Record updated
Status changed
File uploaded
File downloaded
Notice drafted
Notice approved
Notice sent
Email sent
WhatsApp message sent
Client response received
VO approved
VO rejected
Reminder sent
Escalation triggered
Invoice updated
Payment updated
AI suggestion generated
AI suggestion edited
Report exported
User permission changed
```

Every audit event must record:

```text
User
Project
Record type
Record ID
Action
Old value
New value
Source
Timestamp
Metadata
```

---

# Error Handling

When external integration fails:

```text
Do not mark notice as sent.
Do not mark email as delivered.
Do not mark client as notified.
Do not mark approval as complete.
Do not mark invoice as issued.
```

Instead:

```text
Record failure.
Create audit log.
Create retry job.
Update delivery status.
Notify responsible user if needed.
Escalate if commercial deadline is at risk.
```

When a workflow fails:

1. Read the full error.
2. Identify root cause.
3. Fix the smallest correct layer.
4. Add or update test.
5. Retest.
6. Check side effects.
7. Document learning in workflow.
8. Do not hide failures.

---

# Development Rules

Before creating anything:

1. Inspect repository structure.
2. Read relevant workflow documents.
3. Check existing services.
4. Check existing API routes.
5. Check existing n8n workflow exports.
6. Check database schema.
7. Check role and project access rules.
8. Avoid duplicate functionality.
9. Decide whether the feature belongs in:
   - Custom App
   - Background Job
   - n8n Integration
   - AI Assistant

When implementing:

1. Define acceptance criteria.
2. Update schema if required.
3. Build deterministic service.
4. Add server-side validation.
5. Add permission checks.
6. Add audit logging.
7. Add API endpoint.
8. Add UI.
9. Add mobile behaviour.
10. Add background job if required.
11. Add n8n integration only if external system connection is needed.
12. Add tests.
13. Update workflow documentation.
14. Test end-to-end.

---

# Definition of Done

A feature is complete only when:

```text
It works in the web UI.
It works on mobile.
It has server-side validation.
It respects project access permissions.
It creates audit logs.
It has error handling.
It has tests.
It has workflow documentation.
It preserves original evidence.
It does not bypass human approvals.
It does not make AI decisions final.
It uses n8n only for integration.
It stores commercial truth in PostgreSQL.
It is deployable separately for one client company.
It does not require hardcoded client-specific logic.
```

---

# Final Principles

```text
No instruction = weak proof.
No proof = weak claim.
No notice = commercial risk.
No owner = bottleneck.
No follow-up = delayed approval.
No invoice = lost revenue.
No collection = cash-flow risk.
```

Build the system so that:

> Every project change is captured.  
> Every important notice is tracked.  
> Every task has an owner.  
> Every bottleneck is visible.  
> Every approved VO reaches invoicing.  
> Every unpaid amount is followed up.  
> Every action is auditable.
---

# n8n Environment and Tooling

This section describes the **live n8n environment this repository is wired to**, and the
rules Claude Code must follow when touching it. It supplements the ownership boundaries
and integration rules above — it does not override them.

## Instance

```text
Instance:   https://n8n.osmanflow.com   (self-hosted, VPS, behind Caddy TLS)
Status:     reachable and verified 2026-08-29
Version:    not reported by the API (n8n stopped exposing it to API clients in 1.119.0)
```

This is the **development / master-template instance**. It is shared with unrelated
earlier projects (SRS site-reporting, Sales OS, content workflows) and already holds
several hundred workflows, mostly archived.

Consequences, and they are not optional:

```text
Never assume this instance is empty or dedicated.
Never activate a workflow here without explicit confirmation.
Never bulk-edit, bulk-archive, or bulk-rename.
Search before creating — n8n_list_workflows — a similar workflow may exist.
This instance is NOT a client deployment. It is where the master template is developed.
```

Per the Deployment Model above, each client company gets its **own** n8n workspace or
instance. Nothing built here is client-ready until it has been duplicated into that
client's own instance with that client's own credentials.

## MCP Servers

Two MCP servers are registered in `.mcp.json`. They serve different purposes.

### `n8n-mcp` (community server, stdio)

The primary server. ~2,150 node schemas, docs, validation, and workflow management
over the n8n REST API.

```text
Transport:  stdio, via npx n8n-mcp
Auth:       N8N_API_URL + N8N_API_KEY
```

Destructive operations are disabled at the transport level as a backstop:

```text
DISABLED_TOOLS:            n8n_delete_workflow
DISABLED_TOOL_OPERATIONS:  n8n_workflow_versions:delete,rollback,prune
                           n8n_executions:delete
```

Still reachable and therefore gated by the confirmation policy below, not by config:

```text
Credential creation, edit, deletion   (n8n_manage_credentials)
Data table deletion                   (n8n_manage_datatable)
Full workflow overwrite               (n8n_update_full_workflow)
Workflow activation                   (n8n_update_partial_workflow: activateWorkflow)
Real execution with side effects      (n8n_test_workflow)
```

### `n8n-builtin` (official n8n MCP endpoint, HTTP)

```text
Transport:  HTTP, https://n8n.osmanflow.com/mcp-server/http
Auth:       Bearer N8N_MCP_TOKEN
```

The official n8n Workflow SDK server. Its own instructions require, in order:
`get_sdk_reference` → `get_workflow_best_practices` → `search_nodes` →
`get_node_types` → `explore_node_resources` before writing SDK workflow code.
Follow that sequence when using it. Do not guess SDK syntax.

**Only one server should be driving a given change.** Pick the server, complete the
change, verify it, then stop. Mixing `n8n-mcp` partial diffs with `n8n-builtin` SDK
regeneration on the same workflow in the same pass will silently clobber work.

## Credentials

```text
N8N_API_URL     — machine-level environment variable
N8N_API_KEY     — machine-level environment variable
N8N_MCP_TOKEN   — machine-level environment variable
```

`.mcp.json` references these only as `${VAR}` placeholders. **Never** write a resolved
value into `.mcp.json`, into any file in this repository, or into a commit message.

n8n's own credentials (WhatsApp, Outlook, Gmail, SharePoint, Google Drive, Postgres,
Claude API) live in n8n's credential store. They are **never** put in Set nodes, HTTP
Request header text fields, Code node string literals, or workflow JSON. If a node has
no native credential type, use HTTP Request with the appropriate generic credential.

## Skills Pack

The `n8n-skills` pack lives in `.claude/skills/`, installed by direct file copy rather
than through the plugin path. This means **the PreToolUse hooks that would normally
remind you to consult a skill before a high-impact tool call are not wired up.** That
responsibility falls entirely on Claude. Consult the relevant skill proactively.

```text
using-n8n-mcp-skills      ← ALWAYS FIRST. Router to every other skill.
n8n-mcp-tools-expert       Tool selection, node discovery, credentials, audit
n8n-workflow-patterns      Architecture: webhook / API / DB / AI / scheduled / batch
n8n-node-configuration     Operation-aware required fields, property dependencies
n8n-expression-syntax      {{ }}, $json / $node, data mapping, Set-node discipline
n8n-validation-expert      Reading validation errors, false positives, the fix loop
n8n-error-handling         Error outputs, retries, 4xx/5xx, silent failures
n8n-binary-and-data        Files, images, PDFs, voice notes, $binary vs $json
n8n-subworkflows           Execute Workflow, shared logic, typed inputs
n8n-agents                 AI Agent, tools, $fromAI, structured output, memory
n8n-code-javascript        Code node JS (default), SplitInBatches, pairedItem
n8n-code-python            Code node Python (only on explicit request)
n8n-code-tool              The agent-callable toolCode — a different runtime contract
```

Turned off in `.claude/settings.local.json` (`skillOverrides`), deliberately:

```text
n8n-self-hosting      — the VPS is already provisioned; do not re-derive deployment
n8n-multi-instance    — single instance today; RE-ENABLE when the first client
                        deployment gets its own instance
ui-ux-pro-max         — superseded by frontend-design
design-taste-frontend — superseded by frontend-design
```

> **Re-enable `n8n-multi-instance` the moment a second n8n instance exists.**
> With more than one instance, every MCP call targets whichever instance is currently
> selected. Reads misroute *silently*. That is a cross-client data leak in a product
> whose entire deployment model is "clients never share anything".

## Non-Negotiable n8n Rules

**1. Invoke the router skill before any n8n action.**

Not just before an MCP call. Before designing a flow, configuring a node, writing an
expression or Code node, wiring a credential, or debugging. `using-n8n-mcp-skills` first.

**2. Validate AND verify. They are different things.**

```text
validate_workflow   → the JSON is well-formed
n8n_get_workflow    → the wiring is actually what you intended
```

Run `validate_workflow` before activating. Call `n8n_get_workflow` after **every**
create or update and inspect the `connections` object by eye. Silently dropped
connections, off-by-one Merge input indices, and unwired error outputs all pass
validation cleanly.

**3. Secrets never go in text fields.** See Credentials above.

**4. Node type strings come in two forms. Mixing them fails silently.**

```text
get_node, validate_node          → SHORT form   nodes-base.httpRequest
workflow JSON, validate_workflow → LONG form    n8n-nodes-base.httpRequest
```

**5. n8n evaluates `{{ }}` in every parameter, everywhere.**

Including inside SQL strings and text payloads where the braces were meant literally.
It substitutes the string `undefined` and the node runs anyway. Use a non-brace
placeholder such as `[[slot]]` in any SQL or text payload that must survive verbatim,
and substitute it in a Code node. This has bitten this codebase's author before.

**6. `n8n_test_workflow` runs real nodes.**

HTTP calls fire, database writes commit, messages send. Ask before running it against
anything that touches a real inbox, a real WhatsApp number, or production data.

**7. There is no `execute_workflow` tool** on `n8n-mcp`. Use `n8n_test_workflow`, or
inspect past runs with `n8n_executions`.

## Naming and Tagging Convention

**Status: PROPOSED, pending confirmation.** No convention exists on the instance today —
the existing workflows are named inconsistently. Confirm this before the first workflow
is created, then hold to it without exception.

Workflow name:

```text
VO · <client-slug> · <lane> · <name>
```

```text
VO · MASTER · capture · WhatsApp Inbound
VO · MASTER · notify  · Notice Delivery
VO · ABC    · capture · WhatsApp Inbound
```

`<client-slug>` is `MASTER` for the reusable template, otherwise the client's short code.
This makes client separation visible at a glance in a shared instance and makes an
accidental cross-client edit obvious before it is saved.

`<lane>` is one of:

```text
capture   inbound events → Custom App API
notify    Custom App → external channel
document  file movement and storage
report    scheduled outbound reporting
error     integration failure alerting
```

Tags:

```text
vo-capture          every workflow in this product
client:master       or client:<slug>
lane:capture        lane:notify, lane:document, lane:report, lane:error
```

Scratch and temporary work:

```text
ZZ-TEMP · <what> (delete after use)
```

Build new workflows **deactivated**. Always.

## Workflow Exports

Every n8n workflow this product depends on is exported to `/n8n-workflows/` and
committed. The n8n instance is not the source of truth for workflow definitions —
this repository is. See `/n8n-workflows/README.md` for the export procedure and the
secret-scrubbing rules that apply before any export is committed.

## Deployment and Safety Policy

The n8n instance is a live, shared external system. Treat every write as consequential.

Explicit user confirmation is required before:

```text
Activating any workflow
Deleting or overwriting an existing workflow
Creating, modifying, or deleting any credential
Running a workflow against production data
Any bulk operation across more than one workflow
```

Confirmation given for one action does not carry to the next.

## Build Checklist

```text
1. Invoke using-n8n-mcp-skills, then the specialist skill it names.
2. Read the relevant /workflows/*.md SOP. If a section says "Not yet specified",
   stop and ask. Do not invent commercial logic.
3. n8n_list_workflows — does this already exist?
4. search_nodes / get_node — read the LIVE schema for every node.
5. Build the workflow JSON, deactivated.
6. validate_workflow.
7. Deploy via n8n_create_workflow or n8n_update_partial_workflow.
8. n8n_get_workflow — inspect the connections object by eye.
9. Test. Review the error paths, not just the happy path.
10. Export to /n8n-workflows/, scrub, commit.
11. Update the /workflows/*.md SOP in the same pass.
12. Confirm with the user.
13. Only then activate.
```

## If the Tools and These Docs Disagree

n8n and the MCP servers move faster than any model's training data. If a tool a skill
names does not exist, or a parameter shape does not match what `get_node` returns:
**trust the live tool output**, tell the user, and suggest updating the MCP server or
the skill pack. Do not code around the discrepancy silently.

---

# Repository Conventions

## Where Things Live

```text
/CLAUDE.md            This file. The contract.

W — /workflows/       Business SOPs. 28 documents. Source of truth for behaviour.
A — /agents/          AI agent specs (12) and prompts. The reasoning layer.
T — /src/             The custom application. Deterministic. Owns commercial truth.

/n8n-workflows/       Committed n8n workflow exports. Integration only.
/prisma/              Database schema and migrations.
/docs/decisions/      Architecture decision records.
/.claude/skills/      The n8n skills pack.
/.mcp.json            MCP server registration. Placeholders only, never secrets.
/.env.example         Every variable the app needs, with placeholder values.
```

Inside `/src/`:

```text
/src/app/api/integrations/   The ONLY surface n8n may write through.
/src/services/               14 services. Own the registers. Enforce permissions.
/src/workers/                8 workers. Own commercial timing. Never n8n's job.
/src/integrations/claude/    The AI-provider abstraction. All agent calls go here.
/src/integrations/n8n/       Outbound requests to n8n. Delivery only, never truth.
```

Where a decision lives, when it is unclear:

```text
Is it a commercial rule, a deadline, or a status?      → /src/services/
Does it decide WHEN something happens?                  → /src/workers/
Does it read, extract, summarise, or draft?             → /agents/
Does it move data to or from an external system?        → n8n
Is it how the business is supposed to behave?           → /workflows/
```

## Documentation Stays Current

When a feature, workflow, or integration changes, its `/workflows/*.md` SOP is updated
**in the same pass**, unasked. A stub that says "Not yet specified" for something that
has since been built is worse than no document at all.

## Open Decisions

Tracked in `/docs/decisions/`. Nothing there is settled until the user confirms it.
The background-job engine choice is open — see `0001-background-job-engine.md`.

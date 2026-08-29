-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "SystemRole" AS ENUM ('company_owner', 'company_admin', 'managing_director', 'operations_director', 'commercial_director', 'commercial_manager', 'contract_administrator', 'finance_manager', 'procurement_manager', 'standard_user', 'viewer');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('project_manager', 'quantity_surveyor', 'site_engineer', 'foreman', 'commercial_manager', 'contract_administrator', 'procurement_officer', 'planning_engineer', 'finance_officer', 'document_controller', 'project_viewer', 'client_viewer', 'consultant_viewer');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('tender', 'awarded', 'active', 'on_hold', 'completed', 'closed');

-- CreateEnum
CREATE TYPE "PotentialChangeStatus" AS ENUM ('new_potential_change', 'notice_assessment', 'notice_required', 'needs_evidence', 'pm_scope_review', 'qs_pricing', 'cm_review', 'internal_approval', 'included_scope', 'cancelled');

-- CreateEnum
CREATE TYPE "NoticeStatus" AS ENUM ('not_assessed', 'required', 'not_required', 'needs_more_information', 'drafted', 'sent', 'acknowledged');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('green', 'amber', 'red');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('not_started', 'in_progress', 'completed', 'on_hold');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('mobile_form', 'whatsapp', 'email', 'document_upload', 'meeting', 'site_instruction', 'verbal', 'other');

-- CreateEnum
CREATE TYPE "AuthorityStatus" AS ENUM ('unknown', 'authorised', 'unauthorised', 'pending_verification');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('client', 'client_representative', 'consultant', 'engineer', 'architect', 'interior_designer', 'mep_consultant', 'landlord', 'authority', 'main_contractor', 'subcontractor', 'supplier', 'internal', 'other');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('contract', 'drawing', 'specification', 'boq', 'programme', 'correspondence', 'site_photo', 'voice_note', 'instruction', 'rfi', 'quotation', 'notice', 'variation_proposal', 'other');

-- CreateEnum
CREATE TYPE "ApprovedStatus" AS ENUM ('not_applicable', 'pending', 'approved', 'rejected', 'superseded');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('notice_assessment', 'pm_scope_review', 'qs_pricing', 'procurement_quotation', 'subcontractor_quotation', 'eot_assessment', 'cm_review', 'internal_approval', 'evidence_collection', 'client_follow_up', 'document_request', 'other');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('open', 'in_progress', 'blocked', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('low', 'normal', 'high', 'critical');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('none', 'level_1', 'level_2', 'level_3');

-- CreateEnum
CREATE TYPE "BottleneckType" AS ENUM ('notice_assessment_overdue', 'notice_required_not_drafted', 'notice_drafted_not_sent', 'notice_sent_no_proof', 'pm_scope_review_overdue', 'missing_client_instruction', 'missing_drawing', 'missing_specification', 'missing_site_photo', 'missing_labour_record', 'qs_pricing_overdue', 'procurement_quotation_overdue', 'subcontractor_quotation_overdue', 'eot_assessment_overdue', 'cm_review_overdue', 'internal_approval_overdue', 'client_approval_overdue', 'client_requested_information', 'client_rejected', 'work_started_without_approval', 'other');

-- CreateEnum
CREATE TYPE "ActivitySource" AS ENUM ('web_app', 'mobile_form', 'whatsapp', 'email', 'n8n', 'background_job', 'seed', 'system');

-- CreateEnum
CREATE TYPE "IntegrationSource" AS ENUM ('whatsapp', 'email', 'document_upload', 'notification_status', 'health_check');

-- CreateEnum
CREATE TYPE "IntegrationEventStatus" AS ENUM ('received', 'processed', 'failed', 'ignored');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('email', 'whatsapp', 'in_app');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'queued', 'sent', 'delivered', 'failed');

-- CreateTable
CREATE TABLE "company_settings" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "legal_company_name" TEXT NOT NULL,
    "display_company_name" TEXT NOT NULL,
    "company_logo_url" TEXT,
    "primary_colour" TEXT NOT NULL DEFAULT '#1e40af',
    "secondary_colour" TEXT NOT NULL DEFAULT '#0f172a',
    "default_currency" TEXT NOT NULL DEFAULT 'AED',
    "default_language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Dubai',
    "workweek_start_day" INTEGER NOT NULL DEFAULT 1,
    "workweek_end_day" INTEGER NOT NULL DEFAULT 5,
    "default_notice_template" TEXT,
    "default_vo_template" TEXT,
    "default_email_sender_name" TEXT,
    "default_email_sender_address" TEXT,
    "whatsapp_business_number" TEXT,
    "default_approval_matrix_json" JSONB,
    "default_reminder_rules_json" JSONB,
    "default_escalation_rules_json" JSONB,
    "risk_amber_threshold_days" INTEGER NOT NULL DEFAULT 7,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "avatar_url" TEXT,
    "system_role" "SystemRole" NOT NULL DEFAULT 'standard_user',
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "project_code" TEXT NOT NULL,
    "project_name" TEXT NOT NULL,
    "client_name" TEXT NOT NULL,
    "consultant_name" TEXT,
    "project_location" TEXT,
    "contract_number" TEXT,
    "contract_start_date" DATE,
    "contract_completion_date" DATE,
    "original_contract_value" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'AED',
    "project_status" "ProjectStatus" NOT NULL DEFAULT 'active',
    "pc_sequence" INTEGER NOT NULL DEFAULT 0,
    "drive_folder_id" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "project_role" "ProjectRole" NOT NULL,
    "permission_override_json" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_contract_rules" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "contract_type" TEXT,
    "contract_clause_reference" TEXT,
    "notice_period_days" INTEGER NOT NULL DEFAULT 28,
    "detailed_claim_period_days" INTEGER NOT NULL DEFAULT 42,
    "notice_delivery_method" TEXT,
    "notice_recipient_name" TEXT,
    "notice_recipient_email" TEXT,
    "notice_recipient_company" TEXT,
    "notice_template_name" TEXT,
    "variation_proposal_template_name" TEXT,
    "eot_assessment_required" BOOLEAN NOT NULL DEFAULT true,
    "approval_threshold_pm" DECIMAL(18,2),
    "approval_threshold_cm" DECIMAL(18,2),
    "approval_threshold_commercial_director" DECIMAL(18,2),
    "approval_threshold_managing_director" DECIMAL(18,2),
    "high_risk_vo_value" DECIMAL(18,2),
    "client_follow_up_days" INTEGER NOT NULL DEFAULT 3,
    "qs_pricing_due_days" INTEGER NOT NULL DEFAULT 7,
    "pm_scope_review_due_days" INTEGER NOT NULL DEFAULT 3,
    "internal_approval_due_days" INTEGER NOT NULL DEFAULT 5,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_contract_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "company_name" TEXT,
    "job_title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "contact_type" "ContactType" NOT NULL DEFAULT 'other',
    "authority_verified" BOOLEAN NOT NULL DEFAULT false,
    "can_request_change" BOOLEAN NOT NULL DEFAULT false,
    "can_issue_technical_instruction" BOOLEAN NOT NULL DEFAULT false,
    "can_instruct_work" BOOLEAN NOT NULL DEFAULT false,
    "can_approve_cost" BOOLEAN NOT NULL DEFAULT false,
    "can_approve_time" BOOLEAN NOT NULL DEFAULT false,
    "can_sign_final_vo" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_documents" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "potential_change_id" UUID,
    "document_type" "DocumentType" NOT NULL DEFAULT 'other',
    "document_name" TEXT NOT NULL,
    "document_number" TEXT,
    "revision_number" TEXT,
    "issue_date" DATE,
    "source_url" TEXT,
    "storage_path" TEXT,
    "drive_file_id" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "uploaded_by_user_id" UUID,
    "approved_status" "ApprovedStatus" NOT NULL DEFAULT 'not_applicable',
    "is_current_revision" BOOLEAN NOT NULL DEFAULT true,
    "source_channel" "SourceType" NOT NULL DEFAULT 'mobile_form',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "potential_changes" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "pc_number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL DEFAULT 'mobile_form',
    "source_reference" TEXT,
    "source_message_id" TEXT,
    "source_sender_name" TEXT,
    "source_sender_phone_or_email" TEXT,
    "source_sender_authority_status" "AuthorityStatus" NOT NULL DEFAULT 'unknown',
    "reported_by_user_id" UUID,
    "requested_by_contact_id" UUID,
    "event_date" DATE NOT NULL,
    "capture_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "location" TEXT,
    "trade" TEXT,
    "category" TEXT,
    "work_status" "WorkStatus" NOT NULL DEFAULT 'not_started',
    "estimated_value" DECIMAL(18,2),
    "potential_time_impact" BOOLEAN NOT NULL DEFAULT false,
    "time_impact_days" INTEGER,
    "current_status" "PotentialChangeStatus" NOT NULL DEFAULT 'new_potential_change',
    "current_owner_user_id" UUID,
    "waiting_for" TEXT,
    "next_action" TEXT,
    "next_action_due_date" DATE,
    "blocker_reason" TEXT,
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'green',
    "notice_required" BOOLEAN NOT NULL DEFAULT false,
    "notice_due_date" DATE,
    "notice_status" "NoticeStatus" NOT NULL DEFAULT 'not_assessed',
    "notice_assessed_at" TIMESTAMP(3),
    "notice_assessed_by_user_id" UUID,
    "notice_assessment_notes" TEXT,
    "drive_folder_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "potential_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "potential_change_id" UUID,
    "task_type" "TaskType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigned_to_user_id" UUID,
    "assigned_by_user_id" UUID,
    "due_date" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'open',
    "priority" "Priority" NOT NULL DEFAULT 'normal',
    "escalation_level" "EscalationLevel" NOT NULL DEFAULT 'none',
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bottlenecks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "potential_change_id" UUID,
    "bottleneck_type" "BottleneckType" NOT NULL,
    "blocked_by_role" TEXT,
    "blocked_by_user_id" UUID,
    "blocked_by_external_contact_id" UUID,
    "blocker_reason" TEXT,
    "risk_level" "RiskLevel" NOT NULL DEFAULT 'amber',
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_reminder_at" TIMESTAMP(3),
    "overdue_days" INTEGER NOT NULL DEFAULT 0,
    "escalation_level" "EscalationLevel" NOT NULL DEFAULT 'none',
    "value_at_risk" DECIMAL(18,2),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bottlenecks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "project_id" UUID,
    "user_id" UUID,
    "record_type" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "old_value_json" JSONB,
    "new_value_json" JSONB,
    "source" "ActivitySource" NOT NULL DEFAULT 'web_app',
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_events" (
    "id" UUID NOT NULL,
    "source" "IntegrationSource" NOT NULL,
    "external_id" TEXT NOT NULL,
    "status" "IntegrationEventStatus" NOT NULL DEFAULT 'received',
    "payload_json" JSONB NOT NULL,
    "result_json" JSONB,
    "error_message" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "integration_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_logs" (
    "id" UUID NOT NULL,
    "potential_change_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT,
    "payload_summary" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "external_message_id" TEXT,
    "failure_reason" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(384),
    "embedding_model" TEXT NOT NULL,
    "embedding_dims" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "potential_change_embeddings" (
    "id" UUID NOT NULL,
    "potential_change_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(384),
    "embedding_model" TEXT NOT NULL,
    "embedding_dims" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "potential_change_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_settings_singleton_key" ON "company_settings"("singleton");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_system_role_idx" ON "users"("system_role");

-- CreateIndex
CREATE INDEX "users_active_idx" ON "users"("active");

-- CreateIndex
CREATE UNIQUE INDEX "projects_project_code_key" ON "projects"("project_code");

-- CreateIndex
CREATE INDEX "projects_project_status_idx" ON "projects"("project_status");

-- CreateIndex
CREATE INDEX "projects_client_name_idx" ON "projects"("client_name");

-- CreateIndex
CREATE INDEX "project_members_user_id_active_idx" ON "project_members"("user_id", "active");

-- CreateIndex
CREATE INDEX "project_members_project_id_active_idx" ON "project_members"("project_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_project_id_user_id_project_role_key" ON "project_members"("project_id", "user_id", "project_role");

-- CreateIndex
CREATE UNIQUE INDEX "project_contract_rules_project_id_key" ON "project_contract_rules"("project_id");

-- CreateIndex
CREATE INDEX "contacts_project_id_active_idx" ON "contacts"("project_id", "active");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "project_documents_project_id_document_type_idx" ON "project_documents"("project_id", "document_type");

-- CreateIndex
CREATE INDEX "project_documents_potential_change_id_idx" ON "project_documents"("potential_change_id");

-- CreateIndex
CREATE INDEX "project_documents_drive_file_id_idx" ON "project_documents"("drive_file_id");

-- CreateIndex
CREATE INDEX "potential_changes_project_id_current_status_idx" ON "potential_changes"("project_id", "current_status");

-- CreateIndex
CREATE INDEX "potential_changes_project_id_risk_level_idx" ON "potential_changes"("project_id", "risk_level");

-- CreateIndex
CREATE INDEX "potential_changes_current_owner_user_id_idx" ON "potential_changes"("current_owner_user_id");

-- CreateIndex
CREATE INDEX "potential_changes_notice_due_date_idx" ON "potential_changes"("notice_due_date");

-- CreateIndex
CREATE INDEX "potential_changes_next_action_due_date_idx" ON "potential_changes"("next_action_due_date");

-- CreateIndex
CREATE INDEX "potential_changes_trade_idx" ON "potential_changes"("trade");

-- CreateIndex
CREATE UNIQUE INDEX "potential_changes_project_id_pc_number_key" ON "potential_changes"("project_id", "pc_number");

-- CreateIndex
CREATE INDEX "tasks_assigned_to_user_id_status_idx" ON "tasks"("assigned_to_user_id", "status");

-- CreateIndex
CREATE INDEX "tasks_project_id_status_idx" ON "tasks"("project_id", "status");

-- CreateIndex
CREATE INDEX "tasks_due_date_status_idx" ON "tasks"("due_date", "status");

-- CreateIndex
CREATE INDEX "tasks_potential_change_id_idx" ON "tasks"("potential_change_id");

-- CreateIndex
CREATE INDEX "bottlenecks_project_id_resolved_at_idx" ON "bottlenecks"("project_id", "resolved_at");

-- CreateIndex
CREATE INDEX "bottlenecks_potential_change_id_idx" ON "bottlenecks"("potential_change_id");

-- CreateIndex
CREATE INDEX "bottlenecks_risk_level_resolved_at_idx" ON "bottlenecks"("risk_level", "resolved_at");

-- CreateIndex
CREATE INDEX "activity_logs_project_id_created_at_idx" ON "activity_logs"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_record_type_record_id_idx" ON "activity_logs"("record_type", "record_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_created_at_idx" ON "activity_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "integration_events_status_received_at_idx" ON "integration_events"("status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "integration_events_source_external_id_key" ON "integration_events"("source", "external_id");

-- CreateIndex
CREATE INDEX "notification_logs_status_requested_at_idx" ON "notification_logs"("status", "requested_at");

-- CreateIndex
CREATE INDEX "notification_logs_potential_change_id_idx" ON "notification_logs"("potential_change_id");

-- CreateIndex
CREATE INDEX "document_chunks_project_id_idx" ON "document_chunks"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key" ON "document_chunks"("document_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "potential_change_embeddings_potential_change_id_key" ON "potential_change_embeddings"("potential_change_id");

-- CreateIndex
CREATE INDEX "potential_change_embeddings_project_id_idx" ON "potential_change_embeddings"("project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_contract_rules" ADD CONSTRAINT "project_contract_rules_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_potential_change_id_fkey" FOREIGN KEY ("potential_change_id") REFERENCES "potential_changes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "potential_changes" ADD CONSTRAINT "potential_changes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "potential_changes" ADD CONSTRAINT "potential_changes_reported_by_user_id_fkey" FOREIGN KEY ("reported_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "potential_changes" ADD CONSTRAINT "potential_changes_current_owner_user_id_fkey" FOREIGN KEY ("current_owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "potential_changes" ADD CONSTRAINT "potential_changes_requested_by_contact_id_fkey" FOREIGN KEY ("requested_by_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_potential_change_id_fkey" FOREIGN KEY ("potential_change_id") REFERENCES "potential_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bottlenecks" ADD CONSTRAINT "bottlenecks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bottlenecks" ADD CONSTRAINT "bottlenecks_potential_change_id_fkey" FOREIGN KEY ("potential_change_id") REFERENCES "potential_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bottlenecks" ADD CONSTRAINT "bottlenecks_blocked_by_user_id_fkey" FOREIGN KEY ("blocked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bottlenecks" ADD CONSTRAINT "bottlenecks_blocked_by_external_contact_id_fkey" FOREIGN KEY ("blocked_by_external_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_logs" ADD CONSTRAINT "notification_logs_potential_change_id_fkey" FOREIGN KEY ("potential_change_id") REFERENCES "potential_changes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "project_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "potential_change_embeddings" ADD CONSTRAINT "potential_change_embeddings_potential_change_id_fkey" FOREIGN KEY ("potential_change_id") REFERENCES "potential_changes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


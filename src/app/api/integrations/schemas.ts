import { z } from 'zod';

/**
 * The wire contracts n8n builds against.
 *
 * Every inbound event carries `idempotency_key`. For WhatsApp that is the
 * message id, for email the RFC message id, for a document the file id. It is
 * required, not optional, because a courier that retries without one would
 * create duplicate commercial records — and couriers do retry.
 *
 * Field names are snake_case here and only here: this is the boundary where an
 * external system's convention meets ours.
 */

export const mediaSchema = z.object({
  external_id: z.string().min(1),
  mime_type: z.string().min(1),
  file_name: z.string().optional(),
  /** Base64. n8n downloads the media and forwards the bytes. */
  content_base64: z.string().optional(),
  url: z.string().url().optional(),
});

export const whatsappIncomingSchema = z.object({
  idempotency_key: z.string().min(1, 'WhatsApp message id is required'),
  received_at: z.coerce.date().optional(),
  sender: z.object({
    phone: z.string().min(3),
    display_name: z.string().optional(),
  }),
  message: z.object({
    type: z.enum(['text', 'image', 'audio', 'video', 'document']),
    text: z.string().optional(),
    caption: z.string().optional(),
    media: z.array(mediaSchema).default([]),
  }),
  /** Optional hint. NEVER trusted over the sender's actual memberships. */
  project_code: z.string().optional(),
});

export const emailIncomingSchema = z.object({
  idempotency_key: z.string().min(1, 'Email message id is required'),
  received_at: z.coerce.date().optional(),
  from: z.object({ address: z.string().email(), name: z.string().optional() }),
  to: z.array(z.string()).default([]),
  cc: z.array(z.string()).default([]),
  subject: z.string().default(''),
  body_text: z.string().default(''),
  attachments: z.array(mediaSchema).default([]),
  project_code: z.string().optional(),
  drawing_number: z.string().optional(),
  contract_number: z.string().optional(),
});

export const documentUploadedSchema = z.object({
  idempotency_key: z.string().min(1),
  project_code: z.string().min(1),
  document_name: z.string().min(1),
  document_type: z
    .enum([
      'contract', 'drawing', 'specification', 'boq', 'programme', 'correspondence',
      'site_photo', 'voice_note', 'instruction', 'rfi', 'quotation', 'notice',
      'variation_proposal', 'other',
    ])
    .default('other'),
  document_number: z.string().optional(),
  revision_number: z.string().optional(),
  source_url: z.string().url().optional(),
  external_file_id: z.string().optional(),
});

export const deliveryStatusSchema = z.object({
  idempotency_key: z.string().min(1),
  notification_id: z.string().uuid(),
  status: z.enum(['queued', 'sent', 'delivered', 'failed']),
  external_message_id: z.string().optional(),
  failure_reason: z.string().optional(),
});

/**
 * The jobs n8n is allowed to start.
 *
 * A closed list, not a free string. This endpoint runs work with no signed-in
 * user behind it, so the set of things it can be persuaded to do has to be
 * finite and readable in one glance.
 */
export const scheduledJobSchema = z.object({
  job: z.enum(['reminder_sweep', 'bottleneck_sweep', 'notification_dispatch']),
});

export type WhatsappIncoming = z.infer<typeof whatsappIncomingSchema>;
export type EmailIncoming = z.infer<typeof emailIncomingSchema>;
export type DocumentUploaded = z.infer<typeof documentUploadedSchema>;
export type DeliveryStatusUpdate = z.infer<typeof deliveryStatusSchema>;
export type ScheduledJob = z.infer<typeof scheduledJobSchema>['job'];

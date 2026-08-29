import { beforeAll, describe, expect, it } from 'vitest';
import {
  deliveryStatusSchema,
  documentUploadedSchema,
  emailIncomingSchema,
  whatsappIncomingSchema,
} from '@/app/api/integrations/schemas';

beforeAll(() => {
  process.env.N8N_WEBHOOK_SECRET = 'test-secret-value-1234567890';
});

describe('WhatsApp payload contract', () => {
  const valid = {
    idempotency_key: 'wamid.HBgLOTcxNTAxMjM0NTY3',
    sender: { phone: '+971501234567', display_name: 'Ahmed Al Mansouri' },
    message: { type: 'text', text: 'Client asked to change reception paint to marble' },
  };

  it('accepts a well-formed message', () => {
    const parsed = whatsappIncomingSchema.parse(valid);
    expect(parsed.idempotency_key).toBe('wamid.HBgLOTcxNTAxMjM0NTY3');
    expect(parsed.message.media).toEqual([]);
  });

  it('REJECTS a message with no idempotency key', () => {
    // Without one, a courier retry creates a second Potential Change.
    const { idempotency_key: _omitted, ...withoutKey } = valid;
    expect(() => whatsappIncomingSchema.parse(withoutKey)).toThrow();
    expect(() => whatsappIncomingSchema.parse({ ...valid, idempotency_key: '' })).toThrow();
  });

  it('rejects an unknown message type rather than coercing it', () => {
    expect(() =>
      whatsappIncomingSchema.parse({ ...valid, message: { type: 'sticker' } }),
    ).toThrow();
  });

  it('carries media with a mime type', () => {
    const parsed = whatsappIncomingSchema.parse({
      ...valid,
      message: {
        type: 'image',
        caption: 'Reception wall',
        media: [{ external_id: 'media-1', mime_type: 'image/jpeg' }],
      },
    });
    expect(parsed.message.media[0]?.mime_type).toBe('image/jpeg');
  });
});

describe('email payload contract', () => {
  const valid = {
    idempotency_key: '<CAF=abc123@mail.example.com>',
    from: { address: 'consultant@example.com', name: 'Consultant' },
    subject: 'Revised ceiling layout',
    body_text: 'Please proceed with the revised ceiling.',
  };

  it('accepts a well-formed email and defaults the collections', () => {
    const parsed = emailIncomingSchema.parse(valid);
    expect(parsed.to).toEqual([]);
    expect(parsed.attachments).toEqual([]);
  });

  it('rejects a malformed sender address', () => {
    expect(() => emailIncomingSchema.parse({ ...valid, from: { address: 'not-an-email' } })).toThrow();
  });

  it('requires the message id', () => {
    const { idempotency_key: _omitted, ...withoutKey } = valid;
    expect(() => emailIncomingSchema.parse(withoutKey)).toThrow();
  });
});

describe('document + delivery contracts', () => {
  it('defaults an unknown document type to other', () => {
    const parsed = documentUploadedSchema.parse({
      idempotency_key: 'file-1',
      project_code: 'DXB-001',
      document_name: 'Ceiling RCP Rev C.pdf',
    });
    expect(parsed.document_type).toBe('other');
  });

  it('requires a real uuid for the notification being reported on', () => {
    expect(() =>
      deliveryStatusSchema.parse({
        idempotency_key: 'delivery-1',
        notification_id: 'not-a-uuid',
        status: 'sent',
      }),
    ).toThrow();
  });

  it('accepts a failure with a reason', () => {
    const parsed = deliveryStatusSchema.parse({
      idempotency_key: 'delivery-2',
      notification_id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301',
      status: 'failed',
      failure_reason: 'Mailbox does not exist',
    });
    expect(parsed.status).toBe('failed');
  });
});

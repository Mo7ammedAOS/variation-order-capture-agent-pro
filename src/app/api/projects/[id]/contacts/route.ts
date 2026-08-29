import { jsonResponse, parseJsonBody, withAuth } from '@/lib/api';
import { z } from 'zod';
import { contactSchema, createContact, listContacts } from '@/services/contact.service';

export const dynamic = 'force-dynamic';

export const GET = withAuth<{ id: string }>(async (_request, { user, params }) =>
  jsonResponse(await listContacts(user, params.id)),
);

export const POST = withAuth<{ id: string }>(async (request, { user, params }) => {
  const body = await parseJsonBody(
    request,
    contactSchema.omit({ projectId: true }).extend({ projectId: z.string().optional() }),
  );
  return jsonResponse(await createContact(user, { ...body, projectId: params.id }), 201);
});

'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/session';
import { isAppError } from '@/lib/errors';
import { createProject, projectCreateSchema, updateProject } from '@/services/project.service';

export interface ProjectFormState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * Creating a project is the first thing a real company does, and until now it
 * could only be done with a database client. The service and route already
 * existed and were tested; this is the door.
 */
export async function createProjectAction(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const user = await requireUser();

  // Blank optional fields arrive as '' from a form. Zod's coercion turns '' into
  // 0 for a number and Invalid Date for a date, so they are nulled here rather
  // than at every field.
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };

  const parsed = projectCreateSchema.safeParse({
    projectCode: formData.get('projectCode'),
    projectName: formData.get('projectName'),
    clientName: formData.get('clientName'),
    consultantName: text('consultantName'),
    projectLocation: text('projectLocation'),
    contractNumber: text('contractNumber'),
    contractStartDate: text('contractStartDate'),
    contractCompletionDate: text('contractCompletionDate'),
    originalContractValue: text('originalContractValue'),
    currency: text('currency') ?? 'AED',
    projectStatus: text('projectStatus') ?? 'active',
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: 'Check the highlighted fields', fieldErrors };
  }

  let project;
  try {
    project = await createProject(user, parsed.data);
  } catch (error) {
    if (isAppError(error)) return { error: error.message };
    throw error;
  }

  revalidatePath('/projects');
  revalidatePath('/dashboard');
  // Straight to the new project: the next thing anyone does is add its team and
  // its contract rules, and both live there.
  redirect(`/projects/${project.id}?tab=team`);
}

/**
 * Project status, which is how a project is deactivated.
 *
 * Deliberately not a delete. A completed project's variation history is the
 * record you reach for when the same client argues about the next one.
 */
export async function setProjectStatusAction(formData: FormData) {
  const user = await requireUser();
  const projectId = String(formData.get('projectId') ?? '');
  const projectStatus = String(formData.get('projectStatus') ?? '');

  await updateProject(user, projectId, {
    projectStatus: projectStatus as 'tender' | 'awarded' | 'active' | 'on_hold' | 'completed' | 'closed',
  });

  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
}

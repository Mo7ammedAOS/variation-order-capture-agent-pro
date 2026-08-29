import type { SystemRole, User } from '@prisma/client';

/**
 * The authentication boundary.
 *
 * Supabase Auth is the Phase 1 implementation, but nothing above this interface
 * knows that. Swapping to another identity provider — or to a self-hosted one
 * for a client who insists their staff directory never leaves the building —
 * means writing one adapter, not touching every route.
 */

export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  systemRole: SystemRole;
  active: boolean;
  preferredLanguage: string;
}

export interface AuthProvider {
  /** The signed-in user, or null. Never throws on absence. */
  getCurrentUser(): Promise<AuthenticatedUser | null>;

  signInWithPassword(email: string, password: string): Promise<{ userId: string }>;

  signOut(): Promise<void>;

  /**
   * Creates an identity for an invited person. There is no public signup —
   * accounts exist only because an admin created them.
   */
  createUser(input: { email: string; fullName: string }): Promise<{ userId: string }>;

  /** Sends the set-your-password link to an invited person. */
  sendPasswordSetupEmail(email: string, redirectTo: string): Promise<void>;

  /** Revokes access without deleting the identity, so audit history survives. */
  setUserActive(userId: string, active: boolean): Promise<void>;
}

export function toAuthenticatedUser(user: User): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    systemRole: user.systemRole,
    active: user.active,
    preferredLanguage: user.preferredLanguage,
  };
}

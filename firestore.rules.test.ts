/**
 * Security Rules Verification Suite for PostaJá Studio
 * Documents the 12 Dirty Dozen adversarial payloads tested against firestore.rules.
 */

export const DIRTY_DOZEN_CASES = [
  {
    name: '1. Cross-user read on social account tokens',
    actor: { uid: 'attacker', email_verified: true },
    path: '/users/victim/accounts/instagram',
    operation: 'get',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '2. Cross-user list on publish jobs',
    actor: { uid: 'attacker', email_verified: true },
    path: '/users/victim/jobs',
    operation: 'list',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '3. Unverified email write',
    actor: { uid: 'u1', email_verified: false },
    path: '/users/u1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '4. UID spoofing inside subcollection document',
    actor: { uid: 'u1', email_verified: true },
    path: '/users/u1/jobs/job-1',
    operation: 'create',
    payload: { userId: 'victim' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '5. Shadow field injection on automation settings',
    actor: { uid: 'u1', email_verified: true },
    path: '/users/u1/settings/automation',
    operation: 'create',
    payload: { isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '6. Orphan subcollection write before parent user doc exists',
    actor: { uid: 'u-no-parent', email_verified: true },
    path: '/users/u-no-parent/jobs/job-1',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '7. Path ID poisoning with oversized/invalid characters',
    actor: { uid: 'u1', email_verified: true },
    path: '/users/u1/jobs/invalid$id..slash',
    operation: 'create',
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '8. Disallowed platform in defaultTargets list',
    actor: { uid: 'u1', email_verified: true },
    path: '/users/u1/settings/automation',
    operation: 'create',
    payload: { defaultTargets: ['youtube'] },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '9. Oversized caption exceeding 2200 characters',
    actor: { uid: 'u1', email_verified: true },
    path: '/users/u1/jobs/job-2',
    operation: 'create',
    payload: { captionLength: 10000 },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '10. Timestamp forgery instead of request.time',
    actor: { uid: 'u1', email_verified: true },
    path: '/users/u1/jobs/job-3',
    operation: 'create',
    payload: { createdAt: '1999-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '11. Immutable userId/createdAt mutation on update',
    actor: { uid: 'u1', email_verified: true },
    path: '/users/u1/jobs/job-1',
    operation: 'update',
    payload: { userId: 'other' },
    expected: 'PERMISSION_DENIED',
  },
  {
    name: '12. Terminal state regression from published back to failed',
    actor: { uid: 'u1', email_verified: true },
    path: '/users/u1/jobs/job-published',
    operation: 'update',
    payload: { deliveries: { instagram: { status: 'failed' } } },
    expected: 'PERMISSION_DENIED',
  },
] as const;

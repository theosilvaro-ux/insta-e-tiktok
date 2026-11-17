# Security Specification & Payload-First TDD (`security_spec.md`)

## 1. Data Invariants

1. **Identity Isolation**: Every document under `/users/{userId}` and its subcollections (`settings`, `accounts`, `jobs`) is strictly owned by `request.auth.uid == userId` with a verified email (`request.auth.token.email_verified == true`).
2. **Master Gate**: Subcollection documents (`settings`, `accounts`, `jobs`) cannot be created or updated unless the parent `/users/{userId}` document exists.
3. **Immutable Ownership & Creation Time**: `userId` / `uid` and `createdAt` can never be mutated on update; `createdAt == request.time` on create and `updatedAt == request.time` on create/update.
4. **No Shadow Fields**: All documents enforce `keys().hasAll(...) && keys().hasOnly(...)` on create and `affectedKeys().hasOnly(...)` inside action-scoped update gates.
5. **Bounded Arrays & Strings**: Every string field enforces `.size() <= maxLength`; `defaultTargets` is bounded to `size() <= 2` and `hasOnly(['instagram', 'tiktok'])`; `privacyOptions` is bounded to `size() <= 10`.
6. **Terminal State Protection**: Once an enabled delivery (`instagram` or `tiktok`) reaches `'published'`, updates cannot overwrite that published delivery back to `'failed'`, `'uploading'`, or `'scheduled'`.
7. **Path Variable Hardening**: Every document ID (`userId`, `settingId`, `platform`, `jobId`) matches `^[a-zA-Z0-9_-]+$` and `size() <= 128`.

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Cross-User Read (`GET /users/victim-uid/accounts/instagram`)**: Authenticated as `attacker-uid` trying to steal `victim-uid` OAuth tokens -> `PERMISSION_DENIED`.
2. **Cross-User List (`LIST /users/victim-uid/jobs`)**: Authenticated as `attacker-uid` trying to list `victim-uid` jobs -> `PERMISSION_DENIED`.
3. **Unverified Email Write**: Authenticated user with `email_verified: false` creating `/users/{uid}` -> `PERMISSION_DENIED`.
4. **UID Spoofing on Create**: Authenticated as `uid-A`, creating `/users/uid-A/jobs/job1` with `userId: "uid-B"` -> `PERMISSION_DENIED`.
5. **Shadow Field Injection**: Creating `/users/{uid}/settings/automation` with extra `isAdmin: true` field -> `PERMISSION_DENIED`.
6. **Orphan Subcollection Write**: Creating `/users/{uid}/jobs/job1` before `/users/{uid}` exists -> `PERMISSION_DENIED`.
7. **ID Poisoning**: Creating `/users/{uid}/jobs/` with 500-character ID or invalid characters (`../etc`) -> `PERMISSION_DENIED`.
8. **Invalid Array Element**: Creating `/users/{uid}/settings/automation` with `defaultTargets: ["youtube"]` -> `PERMISSION_DENIED`.
9. **Oversized Caption / DoW**: Creating `/users/{uid}/jobs/job1` with 10,000-char `caption` -> `PERMISSION_DENIED`.
10. **Timestamp Forgery**: Creating `/users/{uid}/jobs/job1` with a past client-chosen `createdAt` instead of `request.time` -> `PERMISSION_DENIED`.
11. **Immutable Field Tampering**: Updating `/users/{uid}/jobs/job1` to change `userId` or `createdAt` -> `PERMISSION_DENIED`.
12. **Terminal State Regression**: Updating a job whose `instagram.status` is `'published'` back to `'failed'` -> `PERMISSION_DENIED`.

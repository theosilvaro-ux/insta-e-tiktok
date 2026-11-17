import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };
import type { PlatformDeliveryState, PlatformId, PublishJob } from '../src/types.ts';
import type { StoredAccount } from './store.ts';

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
  firebaseConfig.projectId,
)}/databases/${encodeURIComponent(firebaseConfig.firestoreDatabaseId)}/documents`;

const FIRESTORE_DOC_PREFIX = `projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents`;

export async function verifyIdTokenString(token: string): Promise<DecodedIdToken> {
  return adminAuth.verifyIdToken(token);
}

type FsValue =
  | { stringValue: string }
  | { integerValue: string }
  | { doubleValue: number }
  | { booleanValue: boolean }
  | { nullValue: null }
  | { arrayValue: { values?: FsValue[] } }
  | { mapValue: { fields?: Record<string, FsValue> } }
  | { timestampValue: string };

function toFsValue(val: unknown): FsValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map((item) => toFsValue(item)) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FsValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = toFsValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function fromFsValue(val: FsValue | undefined): unknown {
  if (!val) return undefined;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map((item) => fromFsValue(item));
  }
  if ('mapValue' in val) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      out[k] = fromFsValue(v);
    }
    return out;
  }
  return undefined;
}

async function getFsDocument(
  relPath: string,
  idToken: string,
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${FIRESTORE_BASE}/${relPath}`, {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore GET ${relPath} failed (${res.status}): ${txt}`);
  }
  const docJson = (await res.json()) as { fields?: Record<string, FsValue> };
  const parsed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(docJson.fields || {})) {
    parsed[k] = fromFsValue(v);
  }
  return parsed;
}

async function commitFsWrite(
  relPath: string,
  idToken: string,
  fieldsObj: Record<string, unknown>,
  options: {
    isCreate: boolean;
    updateFieldPaths?: string[];
    setCreatedAt?: boolean;
  },
): Promise<void> {
  const fields: Record<string, FsValue> = {};
  for (const [k, v] of Object.entries(fieldsObj)) {
    if (v !== undefined) {
      fields[k] = toFsValue(v);
    }
  }

  const fieldTransforms: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }> = [
    { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
  ];
  if (options.setCreatedAt) {
    fieldTransforms.push({ fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' });
  }

  const writeOp: Record<string, unknown> = {
    update: {
      name: `${FIRESTORE_DOC_PREFIX}/${relPath}`,
      fields,
    },
    updateTransforms: fieldTransforms,
  };

  if (options.isCreate) {
    writeOp.currentDocument = { exists: false };
  } else if (options.updateFieldPaths && options.updateFieldPaths.length > 0) {
    writeOp.updateMask = { fieldPaths: options.updateFieldPaths };
    writeOp.currentDocument = { exists: true };
  }

  const res = await fetch(`${FIRESTORE_BASE}:commit`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes: [writeOp] }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore commit ${relPath} failed (${res.status}): ${txt}`);
  }
}

export async function saveSocialAccountToFirestore(
  uid: string,
  idToken: string,
  account: StoredAccount,
): Promise<void> {
  const relPath = `users/${uid}/accounts/${account.platform}`;
  const existing = await getFsDocument(relPath, idToken);

  const payload: Record<string, unknown> = {
    userId: uid,
    platform: account.platform,
    externalUserId: account.userId.slice(0, 128),
    username: account.username.slice(0, 100),
    displayName: account.displayName.slice(0, 120),
    avatarUrl: account.avatarUrl ? account.avatarUrl.slice(0, 1024) : undefined,
    accountType: account.accountType ? account.accountType.slice(0, 40) : undefined,
    accessToken: account.accessToken.slice(0, 2048),
    refreshToken: account.refreshToken ? account.refreshToken.slice(0, 2048) : undefined,
    expiresAt: account.expiresAt ? account.expiresAt.slice(0, 64) : undefined,
    connectedAt: account.connectedAt.slice(0, 64),
    privacyOptions: account.privacyOptions?.slice(0, 10).map((s) => s.slice(0, 64)),
  };

  if (!existing) {
    await commitFsWrite(relPath, idToken, payload, {
      isCreate: true,
      setCreatedAt: true,
    });
  } else {
    const mutableKeys = [
      'externalUserId',
      'username',
      'displayName',
      'avatarUrl',
      'accountType',
      'accessToken',
      'refreshToken',
      'expiresAt',
      'connectedAt',
      'privacyOptions',
    ].filter((k) => payload[k] !== undefined);
    await commitFsWrite(relPath, idToken, payload, {
      isCreate: false,
      updateFieldPaths: mutableKeys,
    });
  }
}

export async function getSocialAccountFromFirestore(
  uid: string,
  idToken: string,
  platform: PlatformId,
): Promise<StoredAccount | null> {
  const data = await getFsDocument(`users/${uid}/accounts/${platform}`, idToken);
  if (!data || typeof data.accessToken !== 'string') return null;

  return {
    platform,
    userId: String(data.externalUserId || ''),
    username: String(data.username || ''),
    displayName: String(data.displayName || ''),
    avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : undefined,
    accountType: typeof data.accountType === 'string' ? data.accountType : undefined,
    accessToken: data.accessToken,
    refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : undefined,
    expiresAt: typeof data.expiresAt === 'string' ? data.expiresAt : undefined,
    connectedAt: String(data.connectedAt || new Date().toISOString()),
    privacyOptions: Array.isArray(data.privacyOptions)
      ? data.privacyOptions.map((item) => String(item))
      : undefined,
  };
}

export async function deleteSocialAccountFromFirestore(
  uid: string,
  idToken: string,
  platform: PlatformId,
): Promise<void> {
  const res = await fetch(`${FIRESTORE_BASE}/users/${uid}/accounts/${platform}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text();
    throw new Error(`Firestore DELETE account failed (${res.status}): ${txt}`);
  }
}

function sanitizeDeliveryForFirestore(d: PlatformDeliveryState): Record<string, unknown> {
  return {
    platform: d.platform,
    enabled: d.enabled,
    status: d.status,
    progressMessage: d.progressMessage.slice(0, 300),
    ...(d.externalId ? { externalId: d.externalId.slice(0, 200) } : {}),
    ...(d.permalink ? { permalink: d.permalink.slice(0, 1024) } : {}),
    ...(d.error ? { error: d.error.slice(0, 1000) } : {}),
    updatedAt: d.updatedAt.slice(0, 64),
  };
}

export async function saveJobToFirestore(
  uid: string,
  idToken: string,
  job: PublishJob,
): Promise<void> {
  const relPath = `users/${uid}/jobs/${job.id}`;
  const payload: Record<string, unknown> = {
    id: job.id,
    userId: uid,
    caption: job.caption.slice(0, 2200),
    hashtags: job.hashtags.slice(0, 500),
    mode: job.mode,
    scheduledAt: job.scheduledAt ? job.scheduledAt.slice(0, 64) : null,
    coverTimestampMs: Math.max(0, job.coverTimestampMs),
    video: {
      originalName: job.video.originalName.slice(0, 260),
      filename: job.video.filename.slice(0, 200),
      mimeType: job.video.mimeType.slice(0, 80),
      sizeBytes: job.video.sizeBytes,
      durationSec: job.video.durationSec,
      width: job.video.width,
      height: job.video.height,
    },
    videoUrl: job.videoUrl.slice(0, 1024),
    instagramOptions: { shareToFeed: job.instagramOptions.shareToFeed },
    tiktokOptions: {
      privacyLevel: job.tiktokOptions.privacyLevel,
      allowComment: job.tiktokOptions.allowComment,
      allowDuet: job.tiktokOptions.allowDuet,
      allowStitch: job.tiktokOptions.allowStitch,
    },
    deliveries: {
      instagram: sanitizeDeliveryForFirestore(job.deliveries.instagram),
      tiktok: sanitizeDeliveryForFirestore(job.deliveries.tiktok),
    },
    createdAtIso: job.createdAt.slice(0, 64),
  };

  await commitFsWrite(relPath, idToken, payload, {
    isCreate: true,
    setCreatedAt: true,
  });
}

export async function updateJobInFirestore(
  uid: string,
  idToken: string,
  job: PublishJob,
  includeModeFields = false,
): Promise<void> {
  const relPath = `users/${uid}/jobs/${job.id}`;
  const payload: Record<string, unknown> = {
    deliveries: {
      instagram: sanitizeDeliveryForFirestore(job.deliveries.instagram),
      tiktok: sanitizeDeliveryForFirestore(job.deliveries.tiktok),
    },
    ...(includeModeFields
      ? {
          mode: job.mode,
          scheduledAt: job.scheduledAt ? job.scheduledAt.slice(0, 64) : null,
        }
      : {}),
  };

  const updateFieldPaths = includeModeFields
    ? ['mode', 'scheduledAt', 'deliveries']
    : ['deliveries'];

  await commitFsWrite(relPath, idToken, payload, {
    isCreate: false,
    updateFieldPaths,
  });
}

export async function deleteJobFromFirestore(
  uid: string,
  idToken: string,
  jobId: string,
): Promise<void> {
  const res = await fetch(`${FIRESTORE_BASE}/users/${uid}/jobs/${jobId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text();
    throw new Error(`Firestore DELETE job failed (${res.status}): ${txt}`);
  }
}

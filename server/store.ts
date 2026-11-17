import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type {
  AutomationDefaults,
  ConnectedAccountPublic,
  PlatformId,
  PublishJob,
} from '../src/types.ts';

export interface StoredAccount {
  platform: PlatformId;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  accountType?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  connectedAt: string;
  privacyOptions?: string[];
}

export interface WorkspaceRecord {
  id: string;
  accounts: Partial<Record<PlatformId, StoredAccount>>;
  automation: AutomationDefaults;
  jobs: PublishJob[];
  createdAt: string;
  updatedAt: string;
}

interface StoreData {
  workspaces: Record<string, WorkspaceRecord>;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
export const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

export function ensureDirectories(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

export function defaultAutomation(): AutomationDefaults {
  return {
    autoPublishOnDrop: false,
    defaultTargets: ['instagram', 'tiktok'],
    defaultHashtags: '',
    instagramShareToFeed: true,
    tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
    tiktokAllowComment: true,
    tiktokAllowDuet: true,
    tiktokAllowStitch: true,
  };
}

function loadStore(): StoreData {
  ensureDirectories();
  if (!fs.existsSync(STORE_PATH)) {
    return { workspaces: {} };
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as StoreData;
    if (!parsed || typeof parsed !== 'object' || !parsed.workspaces) {
      return { workspaces: {} };
    }
    return parsed;
  } catch {
    return { workspaces: {} };
  }
}

function saveStore(data: StoreData): void {
  ensureDirectories();
  const tempPath = `${STORE_PATH}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tempPath, STORE_PATH);
}

export function getOrCreateWorkspace(workspaceId: string): WorkspaceRecord {
  const store = loadStore();
  if (!store.workspaces[workspaceId]) {
    const now = new Date().toISOString();
    store.workspaces[workspaceId] = {
      id: workspaceId,
      accounts: {},
      automation: defaultAutomation(),
      jobs: [],
      createdAt: now,
      updatedAt: now,
    };
    saveStore(store);
  }
  return store.workspaces[workspaceId];
}

export function saveAccountConnection(
  workspaceId: string,
  account: StoredAccount,
): WorkspaceRecord {
  const store = loadStore();
  const ws = store.workspaces[workspaceId] ?? getOrCreateWorkspace(workspaceId);
  ws.accounts[account.platform] = account;
  ws.updatedAt = new Date().toISOString();
  store.workspaces[workspaceId] = ws;
  saveStore(store);
  return ws;
}

export function removeAccountConnection(
  workspaceId: string,
  platform: PlatformId,
): WorkspaceRecord {
  const store = loadStore();
  const ws = store.workspaces[workspaceId] ?? getOrCreateWorkspace(workspaceId);
  delete ws.accounts[platform];
  ws.updatedAt = new Date().toISOString();
  store.workspaces[workspaceId] = ws;
  saveStore(store);
  return ws;
}

export function updateAutomationDefaults(
  workspaceId: string,
  patch: Partial<AutomationDefaults>,
): AutomationDefaults {
  const store = loadStore();
  const ws = store.workspaces[workspaceId] ?? getOrCreateWorkspace(workspaceId);
  ws.automation = { ...ws.automation, ...patch };
  ws.updatedAt = new Date().toISOString();
  store.workspaces[workspaceId] = ws;
  saveStore(store);
  return ws.automation;
}

export function addPublishJob(workspaceId: string, job: PublishJob): PublishJob {
  const store = loadStore();
  const ws = store.workspaces[workspaceId] ?? getOrCreateWorkspace(workspaceId);
  ws.jobs.unshift(job);
  ws.updatedAt = new Date().toISOString();
  store.workspaces[workspaceId] = ws;
  saveStore(store);
  return job;
}

export function getPublishJob(workspaceId: string, jobId: string): PublishJob | undefined {
  const ws = getOrCreateWorkspace(workspaceId);
  return ws.jobs.find((j) => j.id === jobId);
}

export function findPublishJobById(jobId: string): { workspaceId: string; job: PublishJob } | undefined {
  const store = loadStore();
  for (const [workspaceId, ws] of Object.entries(store.workspaces)) {
    const job = ws.jobs.find((j) => j.id === jobId);
    if (job) {
      return { workspaceId, job };
    }
  }
  return undefined;
}

export function updatePublishJob(
  workspaceId: string,
  jobId: string,
  updater: (job: PublishJob) => PublishJob,
): PublishJob | undefined {
  const store = loadStore();
  const ws = store.workspaces[workspaceId];
  if (!ws) return undefined;
  const idx = ws.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) return undefined;
  const updated = updater(ws.jobs[idx]);
  updated.updatedAt = new Date().toISOString();
  ws.jobs[idx] = updated;
  ws.updatedAt = updated.updatedAt;
  saveStore(store);
  return updated;
}

export function deletePublishJob(workspaceId: string, jobId: string): PublishJob | undefined {
  const store = loadStore();
  const ws = store.workspaces[workspaceId];
  if (!ws) return undefined;
  const idx = ws.jobs.findIndex((j) => j.id === jobId);
  if (idx === -1) return undefined;
  const [removed] = ws.jobs.splice(idx, 1);
  ws.updatedAt = new Date().toISOString();
  saveStore(store);
  return removed;
}

export function listDueScheduledJobs(nowIso: string): Array<{ workspaceId: string; job: PublishJob }> {
  const store = loadStore();
  const nowMs = Date.parse(nowIso);
  const due: Array<{ workspaceId: string; job: PublishJob }> = [];

  for (const [workspaceId, ws] of Object.entries(store.workspaces)) {
    for (const job of ws.jobs) {
      if (job.mode !== 'schedule' || !job.scheduledAt) continue;
      const schedMs = Date.parse(job.scheduledAt);
      if (Number.isNaN(schedMs) || schedMs > nowMs) continue;

      const hasScheduledTarget =
        (job.deliveries.instagram.enabled && job.deliveries.instagram.status === 'scheduled') ||
        (job.deliveries.tiktok.enabled && job.deliveries.tiktok.status === 'scheduled');

      if (hasScheduledTarget) {
        due.push({ workspaceId, job });
      }
    }
  }

  return due;
}

export function toPublicAccounts(
  ws: WorkspaceRecord,
  appUrl: string,
  configFlags: { instagram: boolean; tiktok: boolean },
): Record<PlatformId, ConnectedAccountPublic> {
  const ig = ws.accounts.instagram;
  const tt = ws.accounts.tiktok;

  return {
    instagram: {
      platform: 'instagram',
      connected: Boolean(ig?.accessToken),
      username: ig?.username,
      displayName: ig?.displayName,
      avatarUrl: ig?.avatarUrl,
      accountType: ig?.accountType,
      connectedAt: ig?.connectedAt,
      expiresAt: ig?.expiresAt,
      oauthConfigured: configFlags.instagram,
      callbackUrl: `${appUrl}/auth/instagram/callback`,
    },
    tiktok: {
      platform: 'tiktok',
      connected: Boolean(tt?.accessToken),
      username: tt?.username,
      displayName: tt?.displayName,
      avatarUrl: tt?.avatarUrl,
      connectedAt: tt?.connectedAt,
      expiresAt: tt?.expiresAt,
      privacyOptions: tt?.privacyOptions,
      oauthConfigured: configFlags.tiktok,
      callbackUrl: `${appUrl}/auth/tiktok/callback`,
    },
  };
}

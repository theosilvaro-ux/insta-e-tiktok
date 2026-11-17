import fs from 'node:fs';
import path from 'node:path';
import type { PlatformId, PublishJob } from '../src/types.ts';
import {
  UPLOADS_DIR,
  getOrCreateWorkspace,
  saveAccountConnection,
  updatePublishJob,
  type StoredAccount,
} from './store.ts';
import {
  getSocialAccountFromFirestore,
  saveSocialAccountToFirestore,
  updateJobInFirestore,
} from './firestoreRest.ts';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Cache latest verified Firebase ID token per uid so async background publish steps can sync to Firestore
const userTokenCache = new Map<string, string>();

export function setCachedUserIdToken(uid: string, idToken: string): void {
  if (uid && idToken) {
    userTokenCache.set(uid, idToken);
  }
}

export function getCachedUserIdToken(uid: string): string | undefined {
  return userTokenCache.get(uid);
}

export function getEnvConfig() {
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const instagramClientId = process.env.INSTAGRAM_CLIENT_ID?.trim() || '';
  const instagramClientSecret = process.env.INSTAGRAM_CLIENT_SECRET?.trim() || '';
  const tiktokClientKey = process.env.TIKTOK_CLIENT_KEY?.trim() || '';
  const tiktokClientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim() || '';

  return {
    appUrl,
    instagramClientId,
    instagramClientSecret,
    tiktokClientKey,
    tiktokClientSecret,
    instagramConfigured: Boolean(instagramClientId && instagramClientSecret),
    tiktokConfigured: Boolean(tiktokClientKey && tiktokClientSecret),
  };
}

export function buildInstagramAuthUrl(state: string): string {
  const cfg = getEnvConfig();
  const redirectUri = `${cfg.appUrl}/auth/instagram/callback`;
  const params = new URLSearchParams({
    enable_fb_login: '0',
    force_authentication: '1',
    client_id: cfg.instagramClientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish',
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params.toString()}`;
}

export function buildTikTokAuthUrl(state: string): string {
  const cfg = getEnvConfig();
  const redirectUri = `${cfg.appUrl}/auth/tiktok/callback`;
  const params = new URLSearchParams({
    client_key: cfg.tiktokClientKey,
    scope: 'user.info.basic,video.publish,video.upload',
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

export async function exchangeInstagramCode(
  code: string,
  workspaceId: string,
  idToken?: string,
): Promise<StoredAccount> {
  const cfg = getEnvConfig();
  const redirectUri = `${cfg.appUrl}/auth/instagram/callback`;

  const form = new URLSearchParams({
    client_id: cfg.instagramClientId,
    client_secret: cfg.instagramClientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });

  const tokenRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    user_id?: string | number;
    error_message?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_message || 'Falha ao trocar código de autorização do Instagram.',
    );
  }

  let finalAccessToken = tokenJson.access_token;
  let expiresAt: string | undefined;

  try {
    const longParams = new URLSearchParams({
      grant_type: 'ig_exchange_token',
      client_secret: cfg.instagramClientSecret,
      access_token: tokenJson.access_token,
    });
    const longRes = await fetch(
      `https://graph.instagram.com/access_token?${longParams.toString()}`,
    );
    const longJson = (await longRes.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (longRes.ok && longJson.access_token) {
      finalAccessToken = longJson.access_token;
      if (longJson.expires_in) {
        expiresAt = new Date(Date.now() + longJson.expires_in * 1000).toISOString();
      }
    }
  } catch {
    // Keep short-lived token if long-lived exchange is unavailable
  }

  const profileParams = new URLSearchParams({
    fields: 'user_id,username,name,profile_picture_url,account_type',
    access_token: finalAccessToken,
  });
  const profileRes = await fetch(
    `https://graph.instagram.com/v21.0/me?${profileParams.toString()}`,
  );
  const profileJson = (await profileRes.json()) as {
    user_id?: string;
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
    account_type?: string;
    error?: { message?: string };
  };

  if (!profileRes.ok || profileJson.error) {
    throw new Error(
      profileJson.error?.message || 'Não foi possível obter os dados do perfil do Instagram.',
    );
  }

  const account: StoredAccount = {
    platform: 'instagram',
    userId: String(profileJson.user_id || profileJson.id || tokenJson.user_id || ''),
    username: profileJson.username || 'instagram_user',
    displayName: profileJson.name || profileJson.username || 'Conta Instagram',
    avatarUrl: profileJson.profile_picture_url,
    accountType: profileJson.account_type || 'BUSINESS',
    accessToken: finalAccessToken,
    expiresAt,
    connectedAt: new Date().toISOString(),
  };

  saveAccountConnection(workspaceId, account);
  if (idToken) {
    await saveSocialAccountToFirestore(workspaceId, idToken, account);
  }
  return account;
}

export async function exchangeTikTokCode(
  code: string,
  workspaceId: string,
  idToken?: string,
): Promise<StoredAccount> {
  const cfg = getEnvConfig();
  const redirectUri = `${cfg.appUrl}/auth/tiktok/callback`;

  const form = new URLSearchParams({
    client_key: cfg.tiktokClientKey,
    client_secret: cfg.tiktokClientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });

  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    open_id?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description || tokenJson.error || 'Falha na autenticação com o TikTok.',
    );
  }

  const userRes = await fetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,avatar_url,display_name,username',
    {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    },
  );
  const userJson = (await userRes.json()) as {
    data?: {
      user?: {
        open_id?: string;
        avatar_url?: string;
        display_name?: string;
        username?: string;
      };
    };
  };

  let privacyOptions: string[] = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'];
  try {
    const creatorRes = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenJson.access_token}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
    );
    const creatorJson = (await creatorRes.json()) as {
      data?: { privacy_level_options?: string[] };
    };
    if (creatorJson.data?.privacy_level_options?.length) {
      privacyOptions = creatorJson.data.privacy_level_options;
    }
  } catch {
    // Use default privacy options
  }

  const user = userJson.data?.user;
  const expiresAt = tokenJson.expires_in
    ? new Date(Date.now() + tokenJson.expires_in * 1000).toISOString()
    : undefined;

  const account: StoredAccount = {
    platform: 'tiktok',
    userId: user?.open_id || tokenJson.open_id || '',
    username: user?.username || user?.display_name || 'tiktok_creator',
    displayName: user?.display_name || user?.username || 'Conta TikTok',
    avatarUrl: user?.avatar_url,
    accessToken: tokenJson.access_token,
    refreshToken: tokenJson.refresh_token,
    expiresAt,
    connectedAt: new Date().toISOString(),
    privacyOptions,
  };

  saveAccountConnection(workspaceId, account);
  if (idToken) {
    await saveSocialAccountToFirestore(workspaceId, idToken, account);
  }
  return account;
}

async function ensureFreshTikTokToken(
  workspaceId: string,
  account: StoredAccount,
): Promise<string> {
  if (!account.expiresAt || !account.refreshToken) {
    return account.accessToken;
  }
  const expiresMs = Date.parse(account.expiresAt);
  if (Number.isNaN(expiresMs) || expiresMs - Date.now() > 5 * 60 * 1000) {
    return account.accessToken;
  }

  const cfg = getEnvConfig();
  const form = new URLSearchParams({
    client_key: cfg.tiktokClientKey,
    client_secret: cfg.tiktokClientSecret,
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
  });

  const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const json = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (res.ok && json.access_token) {
    const updated: StoredAccount = {
      ...account,
      accessToken: json.access_token,
      refreshToken: json.refresh_token || account.refreshToken,
      expiresAt: json.expires_in
        ? new Date(Date.now() + json.expires_in * 1000).toISOString()
        : account.expiresAt,
    };
    saveAccountConnection(workspaceId, updated);
    const idToken = getCachedUserIdToken(workspaceId);
    if (idToken) {
      void saveSocialAccountToFirestore(workspaceId, idToken, updated).catch(() => undefined);
    }
    return updated.accessToken;
  }
  return account.accessToken;
}

function buildCaptionWithHashtags(caption: string, hashtags: string): string {
  const cleanCaption = caption.trim();
  const cleanTags = hashtags.trim();
  if (!cleanTags) return cleanCaption;
  if (!cleanCaption) return cleanTags;
  return `${cleanCaption}\n\n${cleanTags}`;
}

function setTargetState(
  workspaceId: string,
  jobId: string,
  platform: PlatformId,
  patch: Partial<PublishJob['deliveries'][PlatformId]>,
): void {
  const updated = updatePublishJob(workspaceId, jobId, (job) => ({
    ...job,
    deliveries: {
      ...job.deliveries,
      [platform]: {
        ...job.deliveries[platform],
        ...patch,
        updatedAt: new Date().toISOString(),
      },
    },
  }));

  const idToken = getCachedUserIdToken(workspaceId);
  if (updated && idToken) {
    void updateJobInFirestore(workspaceId, idToken, updated).catch((err) => {
      console.error('Firestore job sync failed:', err);
    });
  }
}

async function publishToInstagram(
  workspaceId: string,
  job: PublishJob,
  account: StoredAccount,
): Promise<void> {
  const cfg = getEnvConfig();
  const publicVideoUrl = `${cfg.appUrl}/uploads/${encodeURIComponent(job.video.filename)}`;
  const fullCaption = buildCaptionWithHashtags(job.caption, job.hashtags).slice(0, 2200);

  setTargetState(workspaceId, job.id, 'instagram', {
    status: 'uploading',
    progressMessage: 'Criando container de Reels no Instagram...',
    error: undefined,
  });

  const createParams = new URLSearchParams({
    media_type: 'REELS',
    video_url: publicVideoUrl,
    caption: fullCaption,
    share_to_feed: String(job.instagramOptions.shareToFeed),
    thumb_offset: String(Math.max(0, Math.round(job.coverTimestampMs))),
    access_token: account.accessToken,
  });

  const createRes = await fetch(
    `https://graph.instagram.com/v21.0/${encodeURIComponent(account.userId)}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: createParams.toString(),
    },
  );
  const createJson = (await createRes.json()) as {
    id?: string;
    error?: { message?: string };
  };

  if (!createRes.ok || !createJson.id) {
    throw new Error(
      createJson.error?.message || 'Instagram recusou a criação do container de vídeo.',
    );
  }

  const creationId = createJson.id;
  setTargetState(workspaceId, job.id, 'instagram', {
    status: 'processing',
    externalId: creationId,
    progressMessage: 'Instagram processando e codificando o vídeo...',
  });

  let finished = false;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await sleep(4000);
    const statusParams = new URLSearchParams({
      fields: 'status_code,status',
      access_token: account.accessToken,
    });
    const statusRes = await fetch(
      `https://graph.instagram.com/v21.0/${encodeURIComponent(creationId)}?${statusParams.toString()}`,
    );
    const statusJson = (await statusRes.json()) as {
      status_code?: string;
      status?: string;
      error?: { message?: string };
    };

    if (statusJson.status_code === 'FINISHED') {
      finished = true;
      break;
    }
    if (statusJson.status_code === 'ERROR' || statusJson.status_code === 'EXPIRED') {
      throw new Error(
        statusJson.status ||
          statusJson.error?.message ||
          `Processamento do Instagram falhou (${statusJson.status_code}).`,
      );
    }
  }

  if (!finished) {
    throw new Error('Tempo limite excedido aguardando o processamento do vídeo no Instagram.');
  }

  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: account.accessToken,
  });
  const pubRes = await fetch(
    `https://graph.instagram.com/v21.0/${encodeURIComponent(account.userId)}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishParams.toString(),
    },
  );
  const pubJson = (await pubRes.json()) as {
    id?: string;
    error?: { message?: string };
  };

  if (!pubRes.ok || !pubJson.id) {
    throw new Error(pubJson.error?.message || 'Falha ao publicar o Reels no Instagram.');
  }

  let permalink: string | undefined;
  try {
    const linkParams = new URLSearchParams({
      fields: 'permalink',
      access_token: account.accessToken,
    });
    const linkRes = await fetch(
      `https://graph.instagram.com/v21.0/${encodeURIComponent(pubJson.id)}?${linkParams.toString()}`,
    );
    const linkJson = (await linkRes.json()) as { permalink?: string };
    permalink = linkJson.permalink;
  } catch {
    // Permalink optional
  }

  setTargetState(workspaceId, job.id, 'instagram', {
    status: 'published',
    externalId: pubJson.id,
    permalink,
    progressMessage: 'Publicado automaticamente no Instagram Reels.',
    error: undefined,
  });
}

async function publishToTikTok(
  workspaceId: string,
  job: PublishJob,
  account: StoredAccount,
): Promise<void> {
  const filePath = path.join(UPLOADS_DIR, job.video.filename);
  if (!fs.existsSync(filePath)) {
    throw new Error('Arquivo de vídeo não encontrado no servidor para envio ao TikTok.');
  }

  const accessToken = await ensureFreshTikTokToken(workspaceId, account);
  const stats = fs.statSync(filePath);
  const fileSize = stats.size;
  const maxSingleChunk = 64 * 1024 * 1024;
  const defaultChunk = 10 * 1024 * 1024;
  const chunkSize = fileSize <= maxSingleChunk ? fileSize : defaultChunk;
  const totalChunks = fileSize <= maxSingleChunk ? 1 : Math.floor(fileSize / chunkSize);

  setTargetState(workspaceId, job.id, 'tiktok', {
    status: 'uploading',
    progressMessage: 'Iniciando sessão de envio no TikTok...',
    error: undefined,
  });

  const fullTitle = buildCaptionWithHashtags(job.caption, job.hashtags).slice(0, 2200);
  const initRes = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      post_info: {
        title: fullTitle,
        privacy_level: job.tiktokOptions.privacyLevel,
        disable_duet: !job.tiktokOptions.allowDuet,
        disable_comment: !job.tiktokOptions.allowComment,
        disable_stitch: !job.tiktokOptions.allowStitch,
        video_cover_timestamp_ms: Math.max(0, Math.round(job.coverTimestampMs)),
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    }),
  });

  const initJson = (await initRes.json()) as {
    data?: { publish_id?: string; upload_url?: string };
    error?: { code?: string; message?: string };
  };

  if (!initRes.ok || !initJson.data?.upload_url || !initJson.data?.publish_id) {
    throw new Error(
      initJson.error?.message || 'TikTok recusou a inicialização do envio de vídeo.',
    );
  }

  const { publish_id: publishId, upload_url: uploadUrl } = initJson.data;
  const fd = fs.openSync(filePath, 'r');
  try {
    for (let i = 0; i < totalChunks; i += 1) {
      const start = i * chunkSize;
      const isLast = i === totalChunks - 1;
      const end = isLast ? fileSize - 1 : start + chunkSize - 1;
      const byteLength = end - start + 1;
      const buffer = Buffer.allocUnsafe(byteLength);
      fs.readSync(fd, buffer, 0, byteLength, start);

      setTargetState(workspaceId, job.id, 'tiktok', {
        status: 'uploading',
        externalId: publishId,
        progressMessage: `Enviando parte ${i + 1} de ${totalChunks} para o TikTok...`,
      });

      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': job.video.mimeType || 'video/mp4',
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        },
        body: buffer,
      });

      if (!uploadRes.ok) {
        throw new Error(`Falha ao enviar bytes para o TikTok (HTTP ${uploadRes.status}).`);
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  setTargetState(workspaceId, job.id, 'tiktok', {
    status: 'processing',
    externalId: publishId,
    progressMessage: 'TikTok validando e publicando o vídeo...',
  });

  for (let attempt = 0; attempt < 45; attempt += 1) {
    await sleep(4000);
    const statusRes = await fetch(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
        body: JSON.stringify({ publish_id: publishId }),
      },
    );
    const statusJson = (await statusRes.json()) as {
      data?: { status?: string; fail_reason?: string };
      error?: { message?: string };
    };

    const st = statusJson.data?.status;
    if (st === 'PUBLISH_COMPLETE' || st === 'SEND_TO_USER_INBOX') {
      setTargetState(workspaceId, job.id, 'tiktok', {
        status: 'published',
        externalId: publishId,
        progressMessage:
          st === 'SEND_TO_USER_INBOX'
            ? 'Enviado para a caixa de entrada do TikTok para revisão final.'
            : 'Publicado automaticamente no TikTok.',
        error: undefined,
      });
      return;
    }

    if (st === 'FAILED') {
      throw new Error(
        statusJson.data?.fail_reason ||
          statusJson.error?.message ||
          'O TikTok falhou ao processar o vídeo.',
      );
    }
  }

  throw new Error('Tempo limite excedido aguardando confirmação de publicação do TikTok.');
}

const activeJobLocks = new Set<string>();

export async function runPublishJob(
  workspaceId: string,
  jobId: string,
  onlyFailedOrScheduled = false,
): Promise<void> {
  const lockKey = `${workspaceId}:${jobId}`;
  if (activeJobLocks.has(lockKey)) return;
  activeJobLocks.add(lockKey);

  try {
    const ws = getOrCreateWorkspace(workspaceId);
    const job = ws.jobs.find((j) => j.id === jobId);
    if (!job) return;

    const tasks: Array<Promise<void>> = [];
    const idToken = getCachedUserIdToken(workspaceId);

    for (const platform of ['instagram', 'tiktok'] as const) {
      const delivery = job.deliveries[platform];
      if (!delivery.enabled) continue;
      if (onlyFailedOrScheduled && delivery.status !== 'failed' && delivery.status !== 'scheduled') {
        continue;
      }
      if (delivery.status === 'published') continue;

      let account = ws.accounts[platform];
      if (!account?.accessToken && idToken) {
        try {
          const fromFs = await getSocialAccountFromFirestore(workspaceId, idToken, platform);
          if (fromFs) {
            saveAccountConnection(workspaceId, fromFs);
            account = fromFs;
          }
        } catch {
          // Fall through to missing account error
        }
      }

      if (!account?.accessToken) {
        setTargetState(workspaceId, job.id, platform, {
          status: 'failed',
          progressMessage: 'Conta não conectada.',
          error: `Conecte sua conta do ${platform === 'instagram' ? 'Instagram' : 'TikTok'} antes de publicar.`,
        });
        continue;
      }

      const runner =
        platform === 'instagram'
          ? publishToInstagram(workspaceId, job, account)
          : publishToTikTok(workspaceId, job, account);

      tasks.push(
        runner.catch((err: unknown) => {
          const message =
            err instanceof Error ? err.message : 'Erro desconhecido durante a publicação.';
          setTargetState(workspaceId, job.id, platform, {
            status: 'failed',
            progressMessage: 'Falha na publicação automática.',
            error: message.slice(0, 1000),
          });
        }),
      );
    }

    await Promise.all(tasks);
  } finally {
    activeJobLocks.delete(lockKey);
  }
}

import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  AutomationDefaults,
  PlatformId,
  PublishJob,
  PublishMode,
  TikTokPostOptions,
} from './src/types.ts';
import {
  UPLOADS_DIR,
  addPublishJob,
  deletePublishJob,
  ensureDirectories,
  getOrCreateWorkspace,
  getPublishJob,
  listDueScheduledJobs,
  removeAccountConnection,
  updateAutomationDefaults,
  updatePublishJob,
} from './server/store.ts';
import {
  buildInstagramAuthUrl,
  buildTikTokAuthUrl,
  exchangeInstagramCode,
  exchangeTikTokCode,
  getEnvConfig,
  runPublishJob,
  setCachedUserIdToken,
} from './server/publishers.ts';
import {
  deleteJobFromFirestore,
  deleteSocialAccountFromFirestore,
  saveJobToFirestore,
  updateJobInFirestore,
  verifyIdTokenString,
} from './server/firestoreRest.ts';

ensureDirectories();

const app = express();
const PORT = 3000;

app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

// Serve uploaded video files for HTML5 preview and Meta/Instagram video_url pull
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    acceptRanges: true,
    setHeaders: (res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);

interface PendingOAuthState {
  uid: string;
  idToken: string;
  platform: PlatformId;
  createdAt: number;
}

const pendingOAuthStates = new Map<string, PendingOAuthState>();

function cleanupExpiredStates(): void {
  const cutoff = Date.now() - 15 * 60 * 1000;
  for (const [key, val] of pendingOAuthStates.entries()) {
    if (val.createdAt < cutoff) {
      pendingOAuthStates.delete(key);
    }
  }
}

interface AuthedRequest extends express.Request {
  uid?: string;
  idToken?: string;
}

async function requireFirebaseAuth(
  req: AuthedRequest,
  res: express.Response,
  next: express.NextFunction,
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sessão não autenticada. Faça login com sua conta Google.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();
  try {
    const decoded = await verifyIdTokenString(token);
    req.uid = decoded.uid;
    req.idToken = token;
    setCachedUserIdToken(decoded.uid, token);
    next();
  } catch {
    res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
  }
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDirectories();
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    const safeExt = ['.mp4', '.mov', '.webm', '.m4v'].includes(ext) ? ext : '.mp4';
    cb(null, `video_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 512 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error('Envie um arquivo de vídeo válido (.mp4, .mov ou .webm).'));
    }
  },
});

app.get('/api/config', (_req, res) => {
  const cfg = getEnvConfig();
  res.json({
    appUrl: cfg.appUrl,
    oauthConfigured: {
      instagram: cfg.instagramConfigured,
      tiktok: cfg.tiktokConfigured,
    },
    callbacks: {
      instagram: `${cfg.appUrl}/auth/instagram/callback`,
      tiktok: `${cfg.appUrl}/auth/tiktok/callback`,
    },
  });
});

app.put('/api/automation', requireFirebaseAuth, (req: AuthedRequest, res) => {
  const uid = req.uid!;
  const body = req.body as Partial<AutomationDefaults>;
  const updated = updateAutomationDefaults(uid, body);
  res.json({ automation: updated });
});

app.get('/api/auth/instagram/url', requireFirebaseAuth, (req: AuthedRequest, res) => {
  const uid = req.uid!;
  const idToken = req.idToken!;
  const cfg = getEnvConfig();
  if (!cfg.instagramConfigured) {
    res.status(400).json({
      configured: false,
      error:
        'As credenciais INSTAGRAM_CLIENT_ID e INSTAGRAM_CLIENT_SECRET ainda não foram definidas nas variáveis de ambiente do servidor.',
      callbackUrl: `${cfg.appUrl}/auth/instagram/callback`,
    });
    return;
  }

  cleanupExpiredStates();
  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuthStates.set(state, { uid, idToken, platform: 'instagram', createdAt: Date.now() });
  res.json({ configured: true, url: buildInstagramAuthUrl(state) });
});

app.get('/api/auth/tiktok/url', requireFirebaseAuth, (req: AuthedRequest, res) => {
  const uid = req.uid!;
  const idToken = req.idToken!;
  const cfg = getEnvConfig();
  if (!cfg.tiktokConfigured) {
    res.status(400).json({
      configured: false,
      error:
        'As credenciais TIKTOK_CLIENT_KEY e TIKTOK_CLIENT_SECRET ainda não foram definidas nas variáveis de ambiente do servidor.',
      callbackUrl: `${cfg.appUrl}/auth/tiktok/callback`,
    });
    return;
  }

  cleanupExpiredStates();
  const state = crypto.randomBytes(24).toString('hex');
  pendingOAuthStates.set(state, { uid, idToken, platform: 'tiktok', createdAt: Date.now() });
  res.json({ configured: true, url: buildTikTokAuthUrl(state) });
});

app.post('/api/accounts/:platform/disconnect', requireFirebaseAuth, async (req: AuthedRequest, res) => {
  const uid = req.uid!;
  const idToken = req.idToken!;
  const platform = req.params.platform as PlatformId;
  if (platform !== 'instagram' && platform !== 'tiktok') {
    res.status(400).json({ error: 'Plataforma inválida.' });
    return;
  }
  removeAccountConnection(uid, platform);
  try {
    await deleteSocialAccountFromFirestore(uid, idToken, platform);
  } catch (err) {
    console.error('Failed to delete social account in Firestore:', err);
  }
  res.json({ ok: true });
});

function renderPopupCallbackHtml(payload: {
  ok: boolean;
  provider: PlatformId;
  error?: string;
}): string {
  const messageJson = JSON.stringify({
    type: payload.ok ? 'OAUTH_AUTH_SUCCESS' : 'OAUTH_AUTH_ERROR',
    provider: payload.provider,
    error: payload.error || null,
  });

  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <title>${payload.ok ? 'Conta conectada' : 'Falha na conexão'}</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
      .box { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; max-width: 420px; text-align: center; }
      h1 { font-size: 18px; margin: 0 0 8px; }
      p { font-size: 14px; color: #475569; margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>${payload.ok ? 'Autenticação concluída' : 'Não foi possível conectar'}</h1>
      <p>${
        payload.ok
          ? 'Sua conta foi vinculada e salva no banco de dados. Esta janela será fechada automaticamente.'
          : payload.error || 'Ocorreu um erro durante a autorização.'
      }</p>
    </div>
    <script>
      (function () {
        var data = ${messageJson};
        if (window.opener) {
          window.opener.postMessage(data, '*');
          setTimeout(function () { window.close(); }, ${payload.ok ? 400 : 2500});
        } else {
          window.location.href = '/';
        }
      })();
    </script>
  </body>
</html>`;
}

async function handleInstagramCallback(req: express.Request, res: express.Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const errorDesc =
    typeof req.query.error_description === 'string'
      ? req.query.error_description
      : typeof req.query.error === 'string'
        ? req.query.error
        : '';

  if (errorDesc || !code) {
    res
      .status(400)
      .send(renderPopupCallbackHtml({ ok: false, provider: 'instagram', error: errorDesc || 'Autorização cancelada.' }));
    return;
  }

  const pending = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);
  if (!pending) {
    res.status(400).send(
      renderPopupCallbackHtml({
        ok: false,
        provider: 'instagram',
        error: 'Sessão de autorização expirada. Tente conectar novamente.',
      }),
    );
    return;
  }

  try {
    await exchangeInstagramCode(code, pending.uid, pending.idToken);
    res.send(renderPopupCallbackHtml({ ok: true, provider: 'instagram' }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao conectar Instagram.';
    res.status(400).send(renderPopupCallbackHtml({ ok: false, provider: 'instagram', error: msg }));
  }
}

async function handleTikTokCallback(req: express.Request, res: express.Response): Promise<void> {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const errorDesc =
    typeof req.query.error_description === 'string'
      ? req.query.error_description
      : typeof req.query.error === 'string'
        ? req.query.error
        : '';

  if (errorDesc || !code) {
    res
      .status(400)
      .send(renderPopupCallbackHtml({ ok: false, provider: 'tiktok', error: errorDesc || 'Autorização cancelada.' }));
    return;
  }

  const pending = pendingOAuthStates.get(state);
  pendingOAuthStates.delete(state);
  if (!pending) {
    res.status(400).send(
      renderPopupCallbackHtml({
        ok: false,
        provider: 'tiktok',
        error: 'Sessão de autorização expirada. Tente conectar novamente.',
      }),
    );
    return;
  }

  try {
    await exchangeTikTokCode(code, pending.uid, pending.idToken);
    res.send(renderPopupCallbackHtml({ ok: true, provider: 'tiktok' }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao conectar TikTok.';
    res.status(400).send(renderPopupCallbackHtml({ ok: false, provider: 'tiktok', error: msg }));
  }
}

app.get(['/auth/instagram/callback', '/auth/instagram/callback/'], handleInstagramCallback);
app.get(['/auth/tiktok/callback', '/auth/tiktok/callback/'], handleTikTokCallback);

app.post('/api/posts', requireFirebaseAuth, upload.single('video'), async (req: AuthedRequest, res) => {
  const uid = req.uid!;
  const idToken = req.idToken!;
  if (!req.file) {
    res.status(400).json({ error: 'Selecione um arquivo de vídeo para publicar.' });
    return;
  }

  const cfg = getEnvConfig();
  const caption = (typeof req.body.caption === 'string' ? req.body.caption : '').slice(0, 2200);
  const hashtags = (typeof req.body.hashtags === 'string' ? req.body.hashtags : '').slice(0, 500);
  const mode: PublishMode = req.body.mode === 'schedule' ? 'schedule' : 'now';
  const scheduledAt =
    mode === 'schedule' && typeof req.body.scheduledAt === 'string' && req.body.scheduledAt
      ? req.body.scheduledAt.slice(0, 64)
      : null;

  if (mode === 'schedule' && (!scheduledAt || Number.isNaN(Date.parse(scheduledAt)))) {
    fs.unlink(req.file.path, () => undefined);
    res.status(400).json({ error: 'Informe uma data e horário válidos para o agendamento.' });
    return;
  }

  let targets: PlatformId[] = [];
  try {
    targets = JSON.parse(req.body.targets || '[]') as PlatformId[];
  } catch {
    targets = ['instagram', 'tiktok'];
  }
  const igEnabled = targets.includes('instagram');
  const ttEnabled = targets.includes('tiktok');

  if (!igEnabled && !ttEnabled) {
    fs.unlink(req.file.path, () => undefined);
    res.status(400).json({ error: 'Escolha pelo menos uma plataforma (Instagram ou TikTok).' });
    return;
  }

  let instagramOptions = { shareToFeed: true };
  try {
    if (req.body.instagramOptions) {
      const parsed = JSON.parse(req.body.instagramOptions) as { shareToFeed?: boolean };
      instagramOptions = { shareToFeed: Boolean(parsed.shareToFeed) };
    }
  } catch {
    // default
  }

  let tiktokOptions: TikTokPostOptions = {
    privacyLevel: 'PUBLIC_TO_EVERYONE',
    allowComment: true,
    allowDuet: true,
    allowStitch: true,
  };
  try {
    if (req.body.tiktokOptions) {
      const parsed = JSON.parse(req.body.tiktokOptions) as Partial<TikTokPostOptions>;
      tiktokOptions = {
        privacyLevel: parsed.privacyLevel || 'PUBLIC_TO_EVERYONE',
        allowComment: parsed.allowComment ?? true,
        allowDuet: parsed.allowDuet ?? true,
        allowStitch: parsed.allowStitch ?? true,
      };
    }
  } catch {
    // default
  }

  let clientMeta = { durationSec: 0, width: 0, height: 0 };
  try {
    if (req.body.videoMeta) {
      clientMeta = JSON.parse(req.body.videoMeta) as {
        durationSec: number;
        width: number;
        height: number;
      };
    }
  } catch {
    // default
  }

  const coverTimestampMs = Math.max(0, Number(req.body.coverTimestampMs) || 0);
  const now = new Date().toISOString();

  const initialStatus = mode === 'schedule' ? 'scheduled' : 'uploading';
  const initialMsg =
    mode === 'schedule' ? 'Agendado para publicação automática.' : 'Preparando envio automático...';

  const job: PublishJob = {
    id: crypto.randomUUID(),
    workspaceId: uid,
    caption,
    hashtags,
    mode,
    scheduledAt,
    coverTimestampMs,
    video: {
      originalName: req.file.originalname.slice(0, 260),
      filename: req.file.filename.slice(0, 200),
      mimeType: (req.file.mimetype || 'video/mp4').slice(0, 80),
      sizeBytes: req.file.size,
      durationSec: Number(clientMeta.durationSec) || 0,
      width: Number(clientMeta.width) || 0,
      height: Number(clientMeta.height) || 0,
    },
    videoUrl: `${cfg.appUrl}/uploads/${encodeURIComponent(req.file.filename)}`.slice(0, 1024),
    instagramOptions,
    tiktokOptions,
    deliveries: {
      instagram: {
        platform: 'instagram',
        enabled: igEnabled,
        status: igEnabled ? initialStatus : 'idle',
        progressMessage: igEnabled ? initialMsg : 'Não selecionado',
        updatedAt: now,
      },
      tiktok: {
        platform: 'tiktok',
        enabled: ttEnabled,
        status: ttEnabled ? initialStatus : 'idle',
        progressMessage: ttEnabled ? initialMsg : 'Não selecionado',
        updatedAt: now,
      },
    },
    createdAt: now,
    updatedAt: now,
  };

  addPublishJob(uid, job);
  try {
    await saveJobToFirestore(uid, idToken, job);
  } catch (err) {
    console.error('Failed to persist new job to Firestore:', err);
  }

  if (mode === 'now') {
    void runPublishJob(uid, job.id);
  }

  res.status(201).json({ job });
});

app.get('/api/posts', requireFirebaseAuth, (req: AuthedRequest, res) => {
  const ws = getOrCreateWorkspace(req.uid!);
  res.json({ jobs: ws.jobs });
});

app.post('/api/posts/:id/retry', requireFirebaseAuth, async (req: AuthedRequest, res) => {
  const uid = req.uid!;
  const idToken = req.idToken!;
  const jobId = String(req.params.id);
  const job = getPublishJob(uid, jobId);
  if (!job) {
    res.status(404).json({ error: 'Publicação não encontrada no servidor atual.' });
    return;
  }

  const updated = updatePublishJob(uid, job.id, (curr) => {
    const next = { ...curr, deliveries: { ...curr.deliveries } };
    for (const p of ['instagram', 'tiktok'] as const) {
      if (next.deliveries[p].enabled && next.deliveries[p].status === 'failed') {
        next.deliveries[p] = {
          ...next.deliveries[p],
          status: 'uploading',
          progressMessage: 'Reiniciando envio automático...',
          error: undefined,
          updatedAt: new Date().toISOString(),
        };
      }
    }
    return next;
  });

  if (updated) {
    try {
      await updateJobInFirestore(uid, idToken, updated);
    } catch (err) {
      console.error('Firestore retry sync error:', err);
    }
  }

  void runPublishJob(uid, job.id, false);
  res.json({ job: updated });
});

app.post('/api/posts/:id/publish-now', requireFirebaseAuth, async (req: AuthedRequest, res) => {
  const uid = req.uid!;
  const idToken = req.idToken!;
  const jobId = String(req.params.id);
  const job = getPublishJob(uid, jobId);
  if (!job) {
    res.status(404).json({ error: 'Publicação não encontrada no servidor atual.' });
    return;
  }

  const updated = updatePublishJob(uid, job.id, (curr) => {
    const next = { ...curr, mode: 'now' as const, scheduledAt: null, deliveries: { ...curr.deliveries } };
    for (const p of ['instagram', 'tiktok'] as const) {
      if (next.deliveries[p].enabled && next.deliveries[p].status === 'scheduled') {
        next.deliveries[p] = {
          ...next.deliveries[p],
          status: 'uploading',
          progressMessage: 'Iniciando publicação imediata...',
          updatedAt: new Date().toISOString(),
        };
      }
    }
    return next;
  });

  if (updated) {
    try {
      await updateJobInFirestore(uid, idToken, updated, true);
    } catch (err) {
      console.error('Firestore publish-now sync error:', err);
    }
  }

  void runPublishJob(uid, job.id, false);
  res.json({ job: updated });
});

app.delete('/api/posts/:id', requireFirebaseAuth, async (req: AuthedRequest, res) => {
  const uid = req.uid!;
  const idToken = req.idToken!;
  const jobId = String(req.params.id);
  const removed = deletePublishJob(uid, jobId);
  if (removed) {
    const filePath = path.join(UPLOADS_DIR, removed.video.filename);
    if (fs.existsSync(filePath)) {
      fs.unlink(filePath, () => undefined);
    }
  }
  try {
    await deleteJobFromFirestore(uid, idToken, jobId);
  } catch (err) {
    console.error('Firestore delete job error:', err);
  }
  res.json({ ok: true });
});

// Background scheduler: checks every 10 seconds for due scheduled jobs
setInterval(() => {
  const due = listDueScheduledJobs(new Date().toISOString());
  for (const item of due) {
    void runPublishJob(item.workspaceId, item.job.id, true);
  }
}, 10_000);

// Multer error handler
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const msg = err instanceof Error ? err.message : 'Erro interno no servidor.';
    res.status(400).json({ error: msg });
  },
);

async function startServer(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`PostaJá Studio server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();

import { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { AlertCircle, Loader2, LogIn, Menu, Plus, X } from 'lucide-react';
import type {
  AutomationDefaults,
  ConnectedAccountPublic,
  PlatformId,
  PublishJob,
} from './types';
import {
  OperationType,
  auth,
  db,
  googleAuthProvider,
  handleFirestoreError,
} from './lib/firebase';
import { Sidebar, type NavSection } from './components/Sidebar';
import { VideoComposer } from './components/VideoComposer';
import { JobsTable } from './components/JobsTable';
import { AccountsPanel } from './components/AccountsPanel';
import { AutomationPanel } from './components/AutomationPanel';

interface ServerConfigResponse {
  appUrl: string;
  oauthConfigured: Record<PlatformId, boolean>;
  callbacks: Record<PlatformId, string>;
}

const DEFAULT_AUTOMATION: AutomationDefaults = {
  autoPublishOnDrop: false,
  defaultTargets: ['instagram', 'tiktok'],
  defaultHashtags: '',
  instagramShareToFeed: true,
  tiktokPrivacyLevel: 'PUBLIC_TO_EVERYONE',
  tiktokAllowComment: true,
  tiktokAllowDuet: true,
  tiktokAllowStitch: true,
};

const SECTION_TITLES: Record<NavSection, string> = {
  compose: 'Publicar Vídeo',
  queue: 'Fila e Histórico',
  accounts: 'Contas Conectadas',
  automation: 'Regras Automáticas',
};

export default function App() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<NavSection>('compose');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [serverConfig, setServerConfig] = useState<ServerConfigResponse>({
    appUrl: '',
    oauthConfigured: { instagram: false, tiktok: false },
    callbacks: { instagram: '', tiktok: '' },
  });

  const [accountsDocMap, setAccountsDocMap] = useState<
    Partial<Record<PlatformId, Partial<ConnectedAccountPublic>>>
  >({});
  const [automation, setAutomation] = useState<AutomationDefaults>(DEFAULT_AUTOMATION);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [latestJobId, setLatestJobId] = useState<string | null>(null);

  const [connectingPlatform, setConnectingPlatform] = useState<PlatformId | null>(null);
  const [oauthError, setOauthError] = useState<{
    platform: PlatformId;
    message: string;
    callbackUrl?: string;
  } | null>(null);
  const [globalNotice, setGlobalNotice] = useState<string | null>(null);

  const getIdToken = useCallback(async (): Promise<string> => {
    const current = auth.currentUser;
    if (!current) {
      throw new Error('Faça login com sua conta Google para continuar.');
    }
    return current.getIdToken();
  }, []);

  // Load server OAuth config
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = (await res.json()) as ServerConfigResponse;
          setServerConfig(data);
        }
      } catch {
        // ignore network hiccup
      }
    })();
  }, []);

  // Firebase Auth listener & initial profile/automation provisioning
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setAccountsDocMap({});
        setAutomation(DEFAULT_AUTOMATION);
        setJobs([]);
        setJobsLoading(false);
        return;
      }

      void (async () => {
        const userPath = `users/${nextUser.uid}`;
        try {
          const userRef = doc(db, 'users', nextUser.uid);
          const snap = await getDoc(userRef);
          if (!snap.exists()) {
            await setDoc(userRef, {
              uid: nextUser.uid,
              email: (nextUser.email || '').slice(0, 254),
              displayName: (nextUser.displayName || '').slice(0, 120),
              photoURL: (nextUser.photoURL || '').slice(0, 512),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          } else {
            await updateDoc(userRef, {
              email: (nextUser.email || '').slice(0, 254),
              displayName: (nextUser.displayName || '').slice(0, 120),
              photoURL: (nextUser.photoURL || '').slice(0, 512),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, userPath);
        }

        const autoPath = `users/${nextUser.uid}/settings/automation`;
        try {
          const autoRef = doc(db, 'users', nextUser.uid, 'settings', 'automation');
          const autoSnap = await getDoc(autoRef);
          if (!autoSnap.exists()) {
            await setDoc(autoRef, {
              userId: nextUser.uid,
              ...DEFAULT_AUTOMATION,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, autoPath);
        }
      })();
    });

    return () => unsubscribe();
  }, []);

  // Firestore real-time listeners (only when authenticated)
  useEffect(() => {
    if (!user) return;
    setJobsLoading(true);

    const autoPath = `users/${user.uid}/settings/automation`;
    const unsubAuto = onSnapshot(
      doc(db, 'users', user.uid, 'settings', 'automation'),
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          setAutomation({
            autoPublishOnDrop: Boolean(d.autoPublishOnDrop),
            defaultTargets: Array.isArray(d.defaultTargets)
              ? (d.defaultTargets as PlatformId[]).slice(0, 2)
              : ['instagram', 'tiktok'],
            defaultHashtags: typeof d.defaultHashtags === 'string' ? d.defaultHashtags : '',
            instagramShareToFeed:
              typeof d.instagramShareToFeed === 'boolean' ? d.instagramShareToFeed : true,
            tiktokPrivacyLevel: d.tiktokPrivacyLevel || 'PUBLIC_TO_EVERYONE',
            tiktokAllowComment:
              typeof d.tiktokAllowComment === 'boolean' ? d.tiktokAllowComment : true,
            tiktokAllowDuet: typeof d.tiktokAllowDuet === 'boolean' ? d.tiktokAllowDuet : true,
            tiktokAllowStitch:
              typeof d.tiktokAllowStitch === 'boolean' ? d.tiktokAllowStitch : true,
          });
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, autoPath);
      },
    );

    const accountsPath = `users/${user.uid}/accounts`;
    const unsubAccounts = onSnapshot(
      collection(db, 'users', user.uid, 'accounts'),
      (snapshot) => {
        const nextMap: Partial<Record<PlatformId, Partial<ConnectedAccountPublic>>> = {};
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          const platform = docSnap.id as PlatformId;
          if (platform === 'instagram' || platform === 'tiktok') {
            nextMap[platform] = {
              platform,
              connected: Boolean(d.accessToken),
              username: typeof d.username === 'string' ? d.username : undefined,
              displayName: typeof d.displayName === 'string' ? d.displayName : undefined,
              avatarUrl: typeof d.avatarUrl === 'string' ? d.avatarUrl : undefined,
              accountType: typeof d.accountType === 'string' ? d.accountType : undefined,
              connectedAt: typeof d.connectedAt === 'string' ? d.connectedAt : undefined,
              expiresAt: typeof d.expiresAt === 'string' ? d.expiresAt : undefined,
              privacyOptions: Array.isArray(d.privacyOptions)
                ? (d.privacyOptions as string[])
                : undefined,
            };
          }
        });
        setAccountsDocMap(nextMap);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, accountsPath);
      },
    );

    const jobsPath = `users/${user.uid}/jobs`;
    const jobsQuery = query(
      collection(db, 'users', user.uid, 'jobs'),
      orderBy('createdAtIso', 'desc'),
    );
    const unsubJobs = onSnapshot(
      jobsQuery,
      (snapshot) => {
        const list: PublishJob[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          list.push({
            id: String(d.id || docSnap.id),
            workspaceId: String(d.userId || user.uid),
            caption: String(d.caption || ''),
            hashtags: String(d.hashtags || ''),
            mode: d.mode === 'schedule' ? 'schedule' : 'now',
            scheduledAt: typeof d.scheduledAt === 'string' ? d.scheduledAt : null,
            coverTimestampMs: Number(d.coverTimestampMs) || 0,
            video: d.video,
            videoUrl: String(d.videoUrl || ''),
            instagramOptions: d.instagramOptions || { shareToFeed: true },
            tiktokOptions: d.tiktokOptions || {
              privacyLevel: 'PUBLIC_TO_EVERYONE',
              allowComment: true,
              allowDuet: true,
              allowStitch: true,
            },
            deliveries: d.deliveries,
            createdAt: String(d.createdAtIso || new Date().toISOString()),
            updatedAt: String(d.createdAtIso || new Date().toISOString()),
          });
        });
        setJobs(list);
        setJobsLoading(false);
      },
      (error) => {
        setJobsLoading(false);
        handleFirestoreError(error, OperationType.LIST, jobsPath);
      },
    );

    return () => {
      unsubAuto();
      unsubAccounts();
      unsubJobs();
    };
  }, [user]);

  // Listen for OAuth popup postMessage completion
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) {
        return;
      }
      const payload = event.data as {
        type?: string;
        provider?: PlatformId;
        error?: string | null;
      };
      if (payload?.type === 'OAUTH_AUTH_SUCCESS') {
        setConnectingPlatform(null);
        setOauthError(null);
      } else if (payload?.type === 'OAUTH_AUTH_ERROR' && payload.provider) {
        setConnectingPlatform(null);
        setOauthError({
          platform: payload.provider,
          message: payload.error || 'Falha ao autorizar conta.',
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const accounts: Record<PlatformId, ConnectedAccountPublic> = useMemo(
    () => ({
      instagram: {
        platform: 'instagram',
        connected: Boolean(accountsDocMap.instagram?.connected),
        username: accountsDocMap.instagram?.username,
        displayName: accountsDocMap.instagram?.displayName,
        avatarUrl: accountsDocMap.instagram?.avatarUrl,
        accountType: accountsDocMap.instagram?.accountType,
        connectedAt: accountsDocMap.instagram?.connectedAt,
        expiresAt: accountsDocMap.instagram?.expiresAt,
        oauthConfigured: serverConfig.oauthConfigured.instagram,
        callbackUrl: serverConfig.callbacks.instagram,
      },
      tiktok: {
        platform: 'tiktok',
        connected: Boolean(accountsDocMap.tiktok?.connected),
        username: accountsDocMap.tiktok?.username,
        displayName: accountsDocMap.tiktok?.displayName,
        avatarUrl: accountsDocMap.tiktok?.avatarUrl,
        connectedAt: accountsDocMap.tiktok?.connectedAt,
        expiresAt: accountsDocMap.tiktok?.expiresAt,
        privacyOptions: accountsDocMap.tiktok?.privacyOptions,
        oauthConfigured: serverConfig.oauthConfigured.tiktok,
        callbackUrl: serverConfig.callbacks.tiktok,
      },
    }),
    [accountsDocMap, serverConfig],
  );

  const handleSignIn = async () => {
    setSigningIn(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Não foi possível concluir o login com Google.',
      );
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const handleConnectPlatform = async (platform: PlatformId) => {
    setConnectingPlatform(platform);
    setOauthError(null);
    setGlobalNotice(null);

    try {
      const idToken = await getIdToken();
      const res = await fetch(`/api/auth/${platform}/url`, {
        credentials: 'include',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = (await res.json()) as {
        configured?: boolean;
        url?: string;
        error?: string;
        callbackUrl?: string;
      };

      if (!res.ok || !data.url) {
        setConnectingPlatform(null);
        setOauthError({
          platform,
          message: data.error || 'Credenciais OAuth ainda não configuradas.',
          callbackUrl: data.callbackUrl,
        });
        setActiveSection('accounts');
        return;
      }

      const authWindow = window.open(data.url, 'oauth_popup', 'width=600,height=700');

      if (!authWindow) {
        setConnectingPlatform(null);
        setGlobalNotice(
          'O navegador bloqueou o pop-up de autorização. Libere os pop-ups para este site e tente novamente.',
        );
        return;
      }

      const closeWatcher = setInterval(() => {
        if (authWindow.closed) {
          clearInterval(closeWatcher);
          setConnectingPlatform((curr) => (curr === platform ? null : curr));
        }
      }, 600);
    } catch {
      setConnectingPlatform(null);
      setOauthError({
        platform,
        message: 'Erro de comunicação ao iniciar autenticação OAuth.',
      });
    }
  };

  const handleDisconnectPlatform = async (platform: PlatformId) => {
    const idToken = await getIdToken();
    await fetch(`/api/accounts/${platform}/disconnect`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  };

  const handleSaveAutomation = async (patch: Partial<AutomationDefaults>) => {
    if (!user) return;
    const merged: AutomationDefaults = {
      ...automation,
      ...patch,
      defaultTargets: (patch.defaultTargets ?? automation.defaultTargets).slice(0, 2),
      defaultHashtags: (patch.defaultHashtags ?? automation.defaultHashtags).slice(0, 500),
    };
    const autoPath = `users/${user.uid}/settings/automation`;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'settings', 'automation'), {
        autoPublishOnDrop: merged.autoPublishOnDrop,
        defaultTargets: merged.defaultTargets,
        defaultHashtags: merged.defaultHashtags,
        instagramShareToFeed: merged.instagramShareToFeed,
        tiktokPrivacyLevel: merged.tiktokPrivacyLevel,
        tiktokAllowComment: merged.tiktokAllowComment,
        tiktokAllowDuet: merged.tiktokAllowDuet,
        tiktokAllowStitch: merged.tiktokAllowStitch,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, autoPath);
    }
  };

  const handleRetryJob = async (jobId: string) => {
    const idToken = await getIdToken();
    await fetch(`/api/posts/${encodeURIComponent(jobId)}/retry`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  };

  const handlePublishNow = async (jobId: string) => {
    const idToken = await getIdToken();
    await fetch(`/api/posts/${encodeURIComponent(jobId)}/publish-now`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${idToken}` },
    });
  };

  const handleDeleteJob = async (jobId: string) => {
    const idToken = await getIdToken();
    await fetch(`/api/posts/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (latestJobId === jobId) setLatestJobId(null);
  };

  const pendingCount = useMemo(
    () =>
      jobs.filter((j) =>
        (['instagram', 'tiktok'] as const).some(
          (p) =>
            j.deliveries[p]?.enabled &&
            (j.deliveries[p].status === 'scheduled' ||
              j.deliveries[p].status === 'uploading' ||
              j.deliveries[p].status === 'processing'),
        ),
      ).length,
    [jobs],
  );

  const latestJob = useMemo(() => {
    if (latestJobId) {
      return jobs.find((j) => j.id === latestJobId) || jobs[0] || null;
    }
    return jobs[0] || null;
  }, [jobs, latestJobId]);

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex items-center gap-2.5 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin text-slate-900" />
          <span>Carregando estúdio...</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white font-display font-bold text-sm">
              PJ
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-900">
                PostaJá Studio
              </h1>
              <p className="text-xs text-slate-500">
                Publicação automática no Instagram Reels e TikTok
              </p>
            </div>
          </div>

          <p className="text-sm text-slate-600 leading-relaxed">
            Entre com sua conta Google para salvar suas conexões do Instagram e TikTok, agendamentos e histórico de publicações de forma permanente no banco de dados.
          </p>

          {authError && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
            >
              <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          <button
            type="button"
            disabled={signingIn}
            onClick={() => void handleSignIn()}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-sm font-semibold text-white transition-colors"
          >
            {signingIn ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LogIn className="h-4 w-4" />
            )}
            <span>{signingIn ? 'Entrando...' : 'Entrar com Google'}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        accounts={accounts}
        pendingCount={pendingCount}
        userName={user.displayName}
        userEmail={user.email}
        onSignOut={() => void handleSignOut()}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4 sticky top-0 z-30">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Abrir menu"
              className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm min-w-0">
              <span className="text-slate-400 whitespace-nowrap hidden sm:inline">Estúdio</span>
              <span className="text-slate-300 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-semibold text-slate-900 truncate">
                {SECTION_TITLES[activeSection]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeSection !== 'compose' ? (
              <button
                type="button"
                onClick={() => setActiveSection('compose')}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white whitespace-nowrap shrink-0 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Novo vídeo
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveSection('accounts')}
                className="px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 whitespace-nowrap shrink-0 transition-colors"
              >
                Gerenciar contas
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 py-6 sm:py-8 max-w-6xl w-full mx-auto">
          {globalNotice && (
            <div
              role="alert"
              className="mb-6 flex items-start justify-between gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900"
            >
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                <span>{globalNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setGlobalNotice(null)}
                aria-label="Dispensar aviso"
                className="text-amber-700 hover:text-amber-900"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {activeSection === 'compose' && (
            <VideoComposer
              accounts={accounts}
              automation={automation}
              latestJob={latestJob}
              getIdToken={getIdToken}
              onJobCreated={(job) => {
                setLatestJobId(job.id);
              }}
              onRetryJob={handleRetryJob}
              onConnectPlatform={handleConnectPlatform}
              onOpenQueue={() => setActiveSection('queue')}
            />
          )}

          {activeSection === 'queue' && (
            <JobsTable
              jobs={jobs}
              loading={jobsLoading}
              onRetry={handleRetryJob}
              onPublishNow={handlePublishNow}
              onDelete={handleDeleteJob}
              onGoToCompose={() => setActiveSection('compose')}
            />
          )}

          {activeSection === 'accounts' && (
            <AccountsPanel
              accounts={accounts}
              onConnect={handleConnectPlatform}
              onDisconnect={handleDisconnectPlatform}
              connectingPlatform={connectingPlatform}
              oauthError={oauthError}
            />
          )}

          {activeSection === 'automation' && (
            <AutomationPanel
              automation={automation}
              onSave={handleSaveAutomation}
            />
          )}
        </main>
      </div>
    </div>
  );
}

import {
  Clapperboard,
  Link2,
  ListVideo,
  LogOut,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { ConnectedAccountPublic, PlatformId } from '../types';

export type NavSection = 'compose' | 'queue' | 'accounts' | 'automation';

interface SidebarProps {
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  accounts: Record<PlatformId, ConnectedAccountPublic>;
  pendingCount: number;
  userEmail?: string | null;
  userName?: string | null;
  onSignOut: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof Clapperboard;
}> = [
  { id: 'compose', label: 'Publicar Vídeo', icon: Clapperboard },
  { id: 'queue', label: 'Fila e Histórico', icon: ListVideo },
  { id: 'accounts', label: 'Contas Conectadas', icon: Link2 },
  { id: 'automation', label: 'Regras Automáticas', icon: SlidersHorizontal },
];

export function Sidebar({
  activeSection,
  onSelectSection,
  accounts,
  pendingCount,
  userEmail,
  userName,
  onSignOut,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex h-full flex-col justify-between bg-white border-r border-slate-200">
      <div>
        <div className="flex h-16 items-center justify-between px-5 border-b border-slate-200">
          <button
            type="button"
            onClick={() => {
              onSelectSection('compose');
              onCloseMobile();
            }}
            className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-md"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white font-display font-bold text-sm">
              PJ
            </div>
            <span className="font-display text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              PostaJá Studio
            </span>
          </button>

          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Fechar menu"
            className="lg:hidden p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav aria-label="Navegação principal" className="p-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectSection(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5 truncate">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.id === 'queue' && pendingCount > 0 && (
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      active ? 'text-slate-300' : 'text-slate-500'
                    }`}
                  >
                    {pendingCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-200 space-y-3">
        <div className="text-xs font-medium text-slate-500">Contas de destino</div>
        <div className="space-y-2">
          {(['instagram', 'tiktok'] as const).map((platform) => {
            const acc = accounts[platform];
            return (
              <button
                key={platform}
                type="button"
                onClick={() => {
                  onSelectSection('accounts');
                  onCloseMobile();
                }}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg border border-slate-200 bg-slate-50/70 hover:bg-slate-100 transition-colors text-left"
              >
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {platform === 'instagram' ? 'Instagram Reels' : 'TikTok'}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {acc.connected ? `@${acc.username}` : 'Não conectado'}
                  </div>
                </div>
                <span
                  className={`text-xs font-medium shrink-0 ${
                    acc.connected ? 'text-emerald-700' : 'text-slate-400'
                  }`}
                >
                  {acc.connected ? 'Ativo' : 'Vincular'}
                </span>
              </button>
            );
          })}
        </div>

        {(userName || userEmail) && (
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-900 truncate">
                {userName || userEmail}
              </div>
              {userName && userEmail && (
                <div className="text-[11px] text-slate-500 truncate">{userEmail}</div>
              )}
            </div>
            <button
              type="button"
              onClick={onSignOut}
              title="Sair da conta"
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900 shrink-0"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[252px] shrink-0 h-screen sticky top-0">
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-[270px] max-w-[85vw] h-full z-10">
            {navContent}
          </aside>
        </div>
      )}
    </>
  );
}

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'Erro inesperado na aplicação.',
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2.5 text-red-700">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <h1 className="font-display text-lg font-bold text-slate-900">
                Algo deu errado
              </h1>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed">
              Ocorreu um erro ao carregar ou sincronizar os dados do seu painel. Tente recarregar a página.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Recarregar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

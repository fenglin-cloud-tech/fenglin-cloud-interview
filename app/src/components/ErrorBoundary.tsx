import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ui';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** 路由级错误边界：单个页面渲染异常时给出可恢复提示，而不是整站白屏。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ui] 页面渲染失败:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <ErrorState
            message="页面加载出错，已保留其他功能可用。刷新后可继续操作。"
            detail={this.state.error.message}
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }
    return this.props.children;
  }
}

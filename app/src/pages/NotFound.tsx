import { Link } from 'react-router-dom';
import { EmptyState } from '../components/ui';

export function NotFound() {
  return (
    <div className="page">
      <EmptyState
        icon="404"
        title="这一页不存在"
        desc="可能是链接过期，或者我们还没把这一环接上。"
        action={
          <Link to="/" className="link">
            回到训练台 →
          </Link>
        }
      />
    </div>
  );
}

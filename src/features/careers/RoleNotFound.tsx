import { ButtonLink } from '@/components/ui/Button';
import sys from '@/app/system/System.module.css';

/** E05: a missing or closed role, shown inside the careers layout. */
export function RoleNotFound() {
  return (
    <div className={sys.wrap}>
      <div className={sys.card}>
        <span className={`${sys.code} ${sys.code404}`} aria-hidden>404</span>
        <h1 className={sys.title}>Role not found</h1>
        <p className={sys.text}>This role may have been filled or removed. Browse the roles that are open right now.</p>
        <div className={sys.actions}>
          <ButtonLink to="/jobs">View open roles</ButtonLink>
          <ButtonLink to="/status" variant="secondary">Check application status</ButtonLink>
        </div>
      </div>
    </div>
  );
}

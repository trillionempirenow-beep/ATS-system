import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { Icon, type IconName } from '../icon/Icon';
import { cx } from '@/lib/cx';
import s from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'danger' | 'dangerGhost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  iconRight?: IconName;
  loading?: boolean;
  fullWidth?: boolean;
  children?: ReactNode;
}

type ButtonProps = CommonProps & ButtonHTMLAttributes<HTMLButtonElement>;

function classes(variant: ButtonVariant, size: ButtonSize, fullWidth?: boolean, className?: string) {
  return cx(s.btn, s[variant], size !== 'md' && s[size], fullWidth && s.full, className);
}

function Content({ icon, iconRight, loading, children, size }: CommonProps & { size: ButtonSize }) {
  const iconSize = size === 'sm' ? 16 : 17;
  return (
    <>
      {loading ? <span className={s.spinner} aria-hidden /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
    </>
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, loading, fullWidth, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classes(variant, size, fullWidth, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      <Content icon={icon} iconRight={iconRight} loading={loading} size={size}>
        {children}
      </Content>
    </button>
  );
});

type ButtonLinkProps = CommonProps & Omit<LinkProps, 'className'> & { className?: string };

export function ButtonLink({ variant = 'primary', size = 'md', icon, iconRight, fullWidth, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={classes(variant, size, fullWidth, className)} {...rest}>
      <Content icon={icon} iconRight={iconRight} size={size}>
        {children}
      </Content>
    </Link>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  label: string;
  size?: 32 | 36 | 40;
  variant?: 'secondary' | 'ghost';
  badge?: number;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, size = 36, variant = 'ghost', badge, active, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      // The house tooltip (global [data-tip]); below the button, since most sit in headers and toolbars.
      data-tip={label}
      data-tip-side="bottom"
      className={cx(s.iconBtn, variant === 'secondary' && s.iconSecondary, active && s.active, className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon name={icon} size={size === 32 ? 16 : 18} />
      {badge ? <span className={s.badge}>{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
});

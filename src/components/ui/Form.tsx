import {
  cloneElement, forwardRef, isValidElement, useId, useRef, useState,
  type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { Icon, type IconName } from '../icon/Icon';
import { cx } from '@/lib/cx';
import { Button } from './Button';
import s from './Form.module.css';

export const formStyles = s;

interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  required?: boolean;
  optional?: boolean;
  aside?: ReactNode;
  className?: string;
  children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
}

/** Label, hint and error for one control; wires id, aria-invalid and aria-describedby. */
export function Field({ label, hint, error, required, optional, aside, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: children.props.id ?? id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined,
      })
    : children;
  return (
    <div className={cx(s.field, className)}>
      <div className={s.labelRow}>
        <label className={s.label} htmlFor={children.props.id ?? id}>
          {label}
          {required ? <span className={s.req} aria-hidden>*</span> : null}
          {optional ? <span className={s.optional}>optional</span> : null}
        </label>
        {aside}
      </div>
      {control}
      {hint && !error ? <span id={hintId} className={s.hint}>{hint}</span> : null}
      {error ? (
        <span id={errId} className={s.error} role="alert">
          <Icon name="alert" size={14} />
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: IconName;
  trailing?: ReactNode;
  inputSize?: 'sm' | 'md';
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput({ icon, trailing, inputSize = 'md', className, ...rest }, ref) {
  const input = <input ref={ref} className={cx(s.control, inputSize === 'sm' && s.controlSm, className)} {...rest} />;
  if (!icon && !trailing) return input;
  return (
    <span className={cx(s.withIcon, icon && s.hasLead, Boolean(trailing) && s.withTrail)}>
      {icon ? <Icon name={icon} size={17} className={s.leadIcon} /> : null}
      {input}
      {trailing ? <span className={s.trail}>{trailing}</span> : null}
    </span>
  );
});

export const PasswordInput = forwardRef<HTMLInputElement, Omit<TextInputProps, 'type' | 'trailing'>>(function PasswordInput(props, ref) {
  const [shown, setShown] = useState(false);
  return (
    <TextInput
      ref={ref}
      type={shown ? 'text' : 'password'}
      icon="lock"
      {...props}
      trailing={
        <button type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}
          style={{ width: 36, height: 32, border: 0, background: 'none', color: 'var(--text3)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6 }}>
          <Icon name={shown ? 'eyeoff' : 'eye'} size={17} />
        </button>
      }
    />
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: Array<{ value: string | number; label: string }>;
  placeholder?: string;
  inputSize?: 'sm' | 'md';
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ options, placeholder, inputSize = 'md', className, children, ...rest }, ref) {
  return (
    <span className={s.selectWrap}>
      <select ref={ref} className={cx(s.control, s.select, inputSize === 'sm' && s.controlSm, className)} {...rest}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        {children}
      </select>
      <Icon name="chevron" size={16} className={s.selectCaret} />
    </span>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  showCount?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, showCount, maxLength, rows = 4, onChange, ...rest }, ref) {
  const [count, setCount] = useState(String(rest.defaultValue ?? rest.value ?? '').length);
  return (
    <>
      <textarea
        ref={ref}
        rows={rows}
        maxLength={maxLength}
        className={cx(s.control, s.textarea, className)}
        onChange={(e) => { setCount(e.target.value.length); onChange?.(e); }}
        {...rest}
      />
      {showCount && maxLength ? <span className={s.counter}>{count} / {maxLength}</span> : null}
    </>
  );
});

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode;
  description?: ReactNode;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ label, description, className, ...rest }, ref) {
  return (
    <label className={cx(s.check, className)}>
      <input ref={ref} type="checkbox" {...rest} />
      <span className={s.checkText}>
        <span>{label}</span>
        {description ? <span className={s.checkDesc}>{description}</span> : null}
      </span>
    </label>
  );
});

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={s.toggleRow}>
      <span className={s.checkText}>
        <span id={`${id}-l`} style={{ fontWeight: 600 }}>{label}</span>
        {description ? <span className={s.checkDesc}>{description}</span> : null}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={`${id}-l`} disabled={disabled} className={s.toggle} onClick={() => onChange(!checked)} />
    </div>
  );
}

export function SegmentedControl<T extends string>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className={s.segmented} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className={s.segment} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

interface DropzoneProps {
  accept: string;
  hint: string;
  title?: string;
  error?: boolean;
  disabled?: boolean;
  onFile: (file: File) => void;
}

export function Dropzone({ accept, hint, title = 'Drop a file here or browse', error, disabled, onFile }: DropzoneProps) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      className={cx(s.dropzone, over && s.dropzoneOver, error && s.dropzoneError)}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); input.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !disabled) onFile(f); }}
    >
      <span className={s.dropIcon}><Icon name="upload" size={20} /></span>
      <span className={s.dropTitle}>{title}</span>
      <span className={s.dropHint}>{hint}</span>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </div>
  );
}

export function FileRow({ name, sub, progress, onRemove, actions }: { name: string; sub?: ReactNode; progress?: number | null; onRemove?: () => void; actions?: ReactNode }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const kind = ext === 'pdf' ? s.filePdf : ['doc', 'docx'].includes(ext) ? s.fileDoc : s.fileImg;
  return (
    <div className={s.fileRow}>
      <span className={cx(s.fileIcon, kind)}>{ext.toUpperCase().slice(0, 4) || 'FILE'}</span>
      <span className={s.fileMeta}>
        <span className={s.fileName} title={name}>{name}</span>
        {sub ? <span className={s.fileSub}>{sub}</span> : null}
        {typeof progress === 'number' ? <span className={s.progress}><span className={s.progressBar} style={{ width: `${progress}%` }} /></span> : null}
      </span>
      {actions}
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`} style={{ border: 0, background: 'none', color: 'var(--text3)', padding: 6, borderRadius: 6, display: 'inline-flex' }}>
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** A secondary button that opens the file picker (for photos and single files). */
export function FilePickButton({ accept, label, icon = 'upload', onFile, size = 'sm' }: { accept: string; label: string; icon?: IconName; onFile: (f: File) => void; size?: 'sm' | 'md' }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="secondary" size={size} icon={icon} onClick={() => input.current?.click()}>{label}</Button>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
    </>
  );
}

import { Icon, type IconName } from '@/components/icon/Icon';
import { Button, ButtonLink } from '@/components/ui/Button';
import { Field, Select, SegmentedControl, Toggle } from '@/components/ui/Form';
import { Card, CardHeader } from '@/components/ui/Surface';
import { useAuth } from '@/app/providers/AuthProvider';
import { useNavigate } from 'react-router-dom';
import { useTheme, type ThemePreference } from '@/app/providers/ThemeProvider';
import { usePreferences, type Density, type StartPage, type TimeFormat } from '@/app/providers/PreferencesProvider';
import { cx } from '@/lib/cx';
import { formatTime } from '@/lib/format';
import s from './Settings.module.css';

const THEMES: Array<{ value: ThemePreference; label: string; icon: IconName; hint: string }> = [
  { value: 'light', label: 'Light', icon: 'sun', hint: 'Bright and crisp' },
  { value: 'dark', label: 'Dark', icon: 'moon', hint: 'Easy on the eyes' },
  { value: 'system', label: 'Match system', icon: 'overview', hint: 'Follows your device' },
];

const START_PAGES: Array<{ value: StartPage; label: string }> = [
  { value: 'overview', label: 'Overview' },
  { value: 'pipeline', label: 'Hiring pipeline' },
  { value: 'candidates', label: 'Candidates' },
  { value: 'interviews', label: 'Interviews' },
];

/** A tiny drawing of the app in a theme, so the choice is something you can see. */
function Drawing({ dark }: { dark?: boolean }) {
  return (
    <span className={cx(s.swatch, dark && s.swatchDark)} aria-hidden>
      <span className={s.swSide} />
      <span className={s.swMain}>
        <span className={s.swBar} />
        <span className={s.swCard} />
        <span className={s.swCard} />
      </span>
    </span>
  );
}

function ThemeSwatch({ mode }: { mode: ThemePreference }) {
  if (mode !== 'system') return <Drawing dark={mode === 'dark'} />;
  // Half light, half dark: the same drawing twice, the second clipped to the right half.
  return (
    <span className={s.swatchPair} aria-hidden>
      <Drawing />
      <span className={s.swatchHalf}><Drawing dark /></span>
    </span>
  );
}

export function PreferencesTab() {
  const { preference, setPreference } = useTheme();
  const { prefs, setPref, reset, isDefault } = usePreferences();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const staff = user?.role === 'admin' || user?.role === 'recruiter' || user?.role === 'hiring_manager';
  const sample = new Date().toISOString();

  return (
    <div className={s.layout}>
      <div className={s.col}>
        <Card>
          <CardHeader title="Appearance" subtitle="Applies to the whole workspace, on this device." />
          <div className={s.themeGrid} role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={preference === t.value}
                className={cx(s.themeCard, preference === t.value && s.themeCardOn)}
                onClick={() => setPreference(t.value)}
              >
                <ThemeSwatch mode={t.value} />
                <span className={s.themeText}>
                  <span className={s.themeName}><Icon name={t.icon} size={14} />{t.label}</span>
                  <span className={s.themeHint}>{t.hint}</span>
                </span>
                <span className={s.tick} aria-hidden><Icon name="check" size={12} /></span>
              </button>
            ))}
          </div>

          <div className={s.rows}>
            <div className={s.row}>
              <div className={s.rowText}>
                <strong>Density</strong>
                <span>Compact fits more rows and cards on screen.</span>
              </div>
              <SegmentedControl<Density>
                label="Density"
                value={prefs.density}
                onChange={(v) => setPref('density', v)}
                options={[{ value: 'comfortable', label: 'Comfortable' }, { value: 'compact', label: 'Compact' }]}
              />
            </div>
            <div className={s.row}>
              <div className={s.rowText}>
                <strong>Time format</strong>
                <span>Shown as {formatTime(sample)} right now.</span>
              </div>
              <SegmentedControl<TimeFormat>
                label="Time format"
                value={prefs.timeFormat}
                onChange={(v) => setPref('timeFormat', v)}
                options={[{ value: '12h', label: '12-hour' }, { value: '24h', label: '24-hour' }]}
              />
            </div>
            <div className={s.row}>
              <Toggle
                label="Reduce motion"
                description="Turns off sliding and fading animations. Good for motion sensitivity or slow computers."
                checked={prefs.motion === 'reduce'}
                onChange={(on) => setPref('motion', on ? 'reduce' : 'auto')}
              />
            </div>
          </div>
        </Card>

        {staff ? (
          <Card>
            <CardHeader title="When you sign in" subtitle="Choose the page that opens first." />
            <Field label="Start page" hint="Opens once each time you sign in. The Overview link in the sidebar always goes to the Overview.">
              <Select
                value={prefs.startPage}
                onChange={(e) => setPref('startPage', e.target.value as StartPage)}
                options={START_PAGES}
              />
            </Field>
          </Card>
        ) : null}
      </div>

      <div className={s.col}>
        <Card>
          <CardHeader title="Your account" />
          <div className={s.person}>
            <div className={s.personText}>
              <strong>{user?.name}</strong>
              <span>{user?.email}</span>
              <span>{user?.roleLabel}</span>
            </div>
          </div>
          <div className={s.actions}>
            <ButtonLink to="/app/profile" variant="secondary" icon="user" fullWidth>Edit profile and password</ButtonLink>
            <ButtonLink to="/app/notifications" variant="secondary" icon="bell" fullWidth>Notifications</ButtonLink>
            <Button variant="ghost" icon="signout" fullWidth onClick={async () => { await signOut(); navigate('/login'); }}>Sign out on this device</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Reset" subtitle="Put every preference back to how it started." />
          <Button variant="secondary" disabled={isDefault} onClick={() => { reset(); setPreference('system'); }}>Reset preferences</Button>
          <p className={s.note}>Preferences are saved in this browser for your account only. They do not change anything for your teammates.</p>
        </Card>
      </div>
    </div>
  );
}

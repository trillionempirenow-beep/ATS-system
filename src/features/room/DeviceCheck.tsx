import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/Button';
import { Avatar, Badge } from '@/components/ui/Display';
import { Field, Select } from '@/components/ui/Form';
import { Notice } from '@/components/ui/Feedback';
import type { LocalMedia } from './call/useLocalMedia';
import s from './Room.module.css';

/** Live input level 0–1 from the microphone, for the little meter under the preview. */
function useMicLevel(stream: MediaStream | null, active: boolean): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track || !active || typeof AudioContext === 'undefined') { setLevel(0); return undefined; }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(new MediaStream([track])).connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      setLevel(Math.min(1, peak / 64));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); void ctx.close(); };
  }, [stream, active]);
  return level;
}

export function VideoPreview({ stream, name, off }: { stream: MediaStream | null; name: string; off: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  const showVideo = Boolean(stream?.getVideoTracks().length) && !off;
  return (
    <div className={s.preview}>
      <video ref={ref} autoPlay playsInline muted className={s.previewVideo} hidden={!showVideo} />
      {!showVideo ? <div className={s.previewEmpty}><Avatar name={name} size={72} /></div> : null}
    </div>
  );
}

interface Props {
  name: string;
  media: LocalMedia;
  context: ReactNode;
  assistNotice?: boolean;
  joinLabel: string;
  joining?: boolean;
  onJoin: (withDevices: boolean) => void;
  onBack: () => void;
}

/** Camera and microphone check before entering the room. Joining without devices is always possible. */
export function DeviceCheck({ name, media, context, assistNotice, joinLabel, joining, onJoin, onBack }: Props) {
  const level = useMicLevel(media.stream, media.micOn);
  const first = name.split(/\s+/)[0] ?? name;
  const blocked = media.access === 'blocked' || media.access === 'unavailable';

  return (
    <div className={s.check}>
      <div className={s.checkMedia}>
        <VideoPreview stream={media.stream} name={name} off={!media.camOn} />
        {media.access === 'granted' ? (
          <div className={s.previewBar}>
            <button type="button" className={s.previewBtn} data-off={!media.micOn || undefined} onClick={media.toggleMic} aria-pressed={!media.micOn} aria-label={media.micOn ? 'Mute microphone' : 'Unmute microphone'}>
              <Icon name={media.micOn ? 'mic' : 'micoff'} size={18} />
            </button>
            <button type="button" className={s.previewBtn} data-off={!media.camOn || undefined} onClick={media.toggleCam} aria-pressed={!media.camOn} aria-label={media.camOn ? 'Turn camera off' : 'Turn camera on'}>
              <Icon name={media.camOn ? 'video' : 'camoff'} size={18} />
            </button>
            <span className={s.meter} aria-hidden="true"><span style={{ transform: `scaleX(${level})` }} /></span>
          </div>
        ) : (
          <div className={s.previewHint}>{media.access === 'requesting' ? 'Waiting for your browser…' : 'Your camera turns on after you allow access.'}</div>
        )}
      </div>

      <div className={s.checkSide}>
        <div>
          <h1 className={s.checkTitle}>Ready to join, {first}?</h1>
          <p className={s.checkText}>
            {media.access === 'granted' ? 'Everything looks good. Join when you are ready.'
              : blocked ? 'We cannot see your camera or microphone. You can still join and turn them on later.'
                : 'Grant camera and microphone access, then join when ready.'}
          </p>
        </div>
        {context}
        {media.error ? <Notice tone={media.access === 'granted' ? 'warning' : 'danger'} title={media.access === 'blocked' ? 'Access is blocked' : undefined}>{media.error}</Notice> : null}
        {media.access === 'granted' ? (
          <div className={s.devices}>
            {media.cameras.length ? (
              <Field label="Camera"><Select value={media.cameraId} onChange={(e) => void media.selectCamera(e.target.value)} options={media.cameras.map((d) => ({ value: d.id, label: d.label }))} /></Field>
            ) : null}
            {media.microphones.length ? (
              <Field label="Microphone"><Select value={media.microphoneId} onChange={(e) => void media.selectMicrophone(e.target.value)} options={media.microphones.map((d) => ({ value: d.id, label: d.label }))} /></Field>
            ) : null}
          </div>
        ) : null}
        {assistNotice ? (
          <div className={s.assistNotice}>
            <Icon name="sparkle" size={18} />
            <div><strong>Acme Assist takes notes</strong><span>The hiring team uses it in this interview. A notice stays in the room while it is on.</span></div>
          </div>
        ) : null}
        <div className={s.checkActions}>
          {media.access === 'granted' ? (
            <Button size="lg" icon="video" loading={joining} onClick={() => onJoin(true)}>{joinLabel}</Button>
          ) : blocked ? (
            <>
              <Button size="lg" onClick={() => void media.request()}>Try again</Button>
              <Button size="lg" variant="secondary" loading={joining} onClick={() => onJoin(false)}>Join without them</Button>
            </>
          ) : (
            <>
              <Button size="lg" icon="video" loading={media.access === 'requesting'} onClick={() => void media.request()}>Enable camera and mic</Button>
              <Button size="lg" variant="secondary" loading={joining} onClick={() => onJoin(false)}>Join without them</Button>
            </>
          )}
          <Button variant="ghost" onClick={onBack}>Back</Button>
        </div>
        {media.access === 'granted' ? <Badge tone="success" icon="checkcircle" size="sm">Camera and microphone ready</Badge> : null}
      </div>
    </div>
  );
}

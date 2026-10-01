import { useCallback, useEffect, useRef, useState } from 'react';

export type MediaAccess = 'idle' | 'requesting' | 'granted' | 'blocked' | 'unavailable';

export interface DeviceOption { id: string; label: string }

export interface LocalMedia {
  access: MediaAccess;
  /** Camera + microphone. Null until access is granted, or when joining without devices. */
  stream: MediaStream | null;
  screen: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  cameras: DeviceOption[];
  microphones: DeviceOption[];
  cameraId: string;
  microphoneId: string;
  error: string | null;
  request: () => Promise<void>;
  selectCamera: (id: string) => Promise<void>;
  selectMicrophone: (id: string) => Promise<void>;
  toggleMic: () => void;
  toggleCam: () => void;
  startScreen: () => Promise<MediaStream | null>;
  stopScreen: () => void;
  stopAll: () => void;
}

function describe(e: unknown): { access: MediaAccess; message: string } {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { access: 'blocked', message: 'Camera and microphone are blocked. Allow access in your browser’s site settings, then try again.' };
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return { access: 'unavailable', message: 'No camera or microphone was found. Connect one, or join without them.' };
  if (name === 'NotReadableError') return { access: 'unavailable', message: 'Your camera or microphone is being used by another app. Close it and try again.' };
  return { access: 'unavailable', message: 'Your camera and microphone could not be started.' };
}

async function listDevices(): Promise<{ cameras: DeviceOption[]; microphones: DeviceOption[] }> {
  const all = await navigator.mediaDevices.enumerateDevices();
  const map = (kind: MediaDeviceKind, fallback: string) => all.filter((d) => d.kind === kind && d.deviceId)
    .map((d, i) => ({ id: d.deviceId, label: d.label || `${fallback} ${i + 1}` }));
  return { cameras: map('videoinput', 'Camera'), microphones: map('audioinput', 'Microphone') };
}

export function useLocalMedia(): LocalMedia {
  const [access, setAccess] = useState<MediaAccess>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [cameras, setCameras] = useState<DeviceOption[]>([]);
  const [microphones, setMicrophones] = useState<DeviceOption[]>([]);
  const [cameraId, setCameraId] = useState('');
  const [microphoneId, setMicrophoneId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const screenRef = useRef<MediaStream | null>(null);
  const flags = useRef({ micOn: true, camOn: true });

  const replaceStream = useCallback((next: MediaStream | null) => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = next;
    if (next) {
      next.getAudioTracks().forEach((t) => { t.enabled = flags.current.micOn; });
      next.getVideoTracks().forEach((t) => { t.enabled = flags.current.camOn; });
    }
    setStream(next);
  }, []);

  const open = useCallback(async (constraints: MediaStreamConstraints) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setAccess('unavailable');
      setError('This browser cannot use a camera or microphone. Try a current version of Chrome, Edge, Firefox or Safari.');
      return;
    }
    setAccess('requesting');
    setError(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia(constraints);
      replaceStream(next);
      setAccess('granted');
      const devices = await listDevices();
      setCameras(devices.cameras);
      setMicrophones(devices.microphones);
      setCameraId(next.getVideoTracks()[0]?.getSettings().deviceId ?? devices.cameras[0]?.id ?? '');
      setMicrophoneId(next.getAudioTracks()[0]?.getSettings().deviceId ?? devices.microphones[0]?.id ?? '');
    } catch (e) {
      // A missing camera should not cost the microphone: retry audio-only once.
      if (constraints.video && e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: constraints.audio ?? true });
          replaceStream(audioOnly);
          setAccess('granted');
          setCamOn(false);
          flags.current.camOn = false;
          setError('No camera was found, so you will join with audio only.');
          const devices = await listDevices();
          setMicrophones(devices.microphones);
          return;
        } catch { /* fall through to the original error */ }
      }
      const d = describe(e);
      setAccess(d.access);
      setError(d.message);
    }
  }, [replaceStream]);

  const request = useCallback(() => open({ audio: true, video: { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24, max: 30 } } }), [open]);

  const selectCamera = useCallback(async (id: string) => {
    setCameraId(id);
    await open({ audio: microphoneId ? { deviceId: { exact: microphoneId } } : true, video: { deviceId: { exact: id }, width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24, max: 30 } } });
  }, [open, microphoneId]);

  const selectMicrophone = useCallback(async (id: string) => {
    setMicrophoneId(id);
    await open({ audio: { deviceId: { exact: id } }, video: cameraId ? { deviceId: { exact: cameraId }, width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24, max: 30 } } : true });
  }, [open, cameraId]);

  const toggleMic = useCallback(() => {
    flags.current.micOn = !flags.current.micOn;
    streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = flags.current.micOn; });
    setMicOn(flags.current.micOn);
  }, []);

  const toggleCam = useCallback(() => {
    flags.current.camOn = !flags.current.camOn;
    streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = flags.current.camOn; });
    setCamOn(flags.current.camOn);
  }, []);

  const stopScreen = useCallback(() => {
    screenRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current = null;
    setScreen(null);
  }, []);

  const startScreen = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('Screen sharing is not supported in this browser.');
      return null;
    }
    try {
      const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      display.getVideoTracks()[0]?.addEventListener('ended', () => stopScreen());
      screenRef.current = display;
      setScreen(display);
      return display;
    } catch {
      return null;
    }
  }, [stopScreen]);

  const stopAll = useCallback(() => {
    replaceStream(null);
    stopScreen();
  }, [replaceStream, stopScreen]);

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    screenRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  return {
    access, stream, screen, micOn, camOn, cameras, microphones, cameraId, microphoneId, error,
    request, selectCamera, selectMicrophone, toggleMic, toggleCam, startScreen, stopScreen, stopAll,
  };
}

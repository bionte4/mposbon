/**
 * Short kitchen ding via Web Audio (no asset file).
 * Browsers may block until a user gesture — call unlock() from a click once.
 */

let ctx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Call from a user gesture (Kitchen mute toggle / first tap) to unlock autoplay. */
export async function unlockKitchenChime(): Promise<void> {
  const audio = getCtx();
  if (!audio) return;
  if (audio.state === 'suspended') {
    try {
      await audio.resume();
    } catch {
      return;
    }
  }
  unlocked = true;
}

export function playKitchenChime(): void {
  const audio = getCtx();
  if (!audio || audio.state !== 'running') {
    // Best-effort resume; may still fail without gesture.
    void audio?.resume().then(() => {
      unlocked = audio.state === 'running';
      if (unlocked) beep(audio);
    });
    return;
  }
  beep(audio);
}

function beep(audio: AudioContext): void {
  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.setValueAtTime(1175, now + 0.08);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}

// iPhones only allow sound that starts from a tap. MARCUS's first line plays seconds after the
// Start tap, so during that tap we "unlock" one audio player by playing a tiny silent clip
// through it; every costar line then reuses that same, already-unlocked player.

// A valid 0.05s silent WAV file, as a data: address (so it plays instantly, with no download).
export function silentWavDataUri(): string {
  const rate = 8000;
  const samples = rate / 20; // 0.05s
  const bytes = new Uint8Array(44 + samples * 2); // 16-bit mono; samples stay 0 (silence)
  const view = new DataView(bytes.buffer);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true); // format chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes per second
  view.setUint16(32, 2, true); // bytes per sample
  view.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(binary)}`;
}

// Call during a tap: plays silence through the player so later clips are allowed to play.
export function unlockAudio(player: HTMLAudioElement): void {
  player.src = silentWavDataUri();
  void player.play().catch(() => {
    // Already unlocked, or the browser doesn't need it (desktop): nothing to do.
  });
}

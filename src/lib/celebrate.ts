// Confetti + a little chime, no dependencies — fired when an email is classified
// as interview/offer. Pure DOM/WebAudio.

function chime() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.start(t); o.stop(t + 0.33);
    });
    setTimeout(() => ctx.close(), 1600);
  } catch { /* audio blocked — fine */ }
}

function confetti() {
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999';
  cv.width = innerWidth; cv.height = innerHeight;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d')!;
  const colors = ['#5b8cff', '#34c759', '#ffd166', '#ff6b6b', '#c77dff', '#4cc9f0'];
  const P = Array.from({ length: 160 }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.3,
    vx: (Math.random() - 0.5) * 6, vy: 3 + Math.random() * 5,
    s: 4 + Math.random() * 6, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const start = performance.now();
  function frame(t: number) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    for (const p of P) {
      p.x += p.vx; p.y += p.vy; p.vy += 0.06; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
    }
    if (t - start < 2800) requestAnimationFrame(frame); else cv.remove();
  }
  requestAnimationFrame(frame);
}

export function celebrate() { confetti(); chime(); }

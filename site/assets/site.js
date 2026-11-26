// Shared by every page: theme toggle, copy buttons, and the page-wide motion, all of it run by GSAP.
// The stored theme is a per-viewer convenience only.
(function () {
  const root = document.documentElement;
  try { const t = localStorage.getItem('quiesco-theme'); if (t) root.dataset.theme = t; } catch {}

  const gsap = window.gsap;
  if (gsap) {
    if (window.ScrollToPlugin) gsap.registerPlugin(window.ScrollToPlugin); // ScrollTrigger/Smoother: registered by the page, after <body>
    gsap.defaults({ overwrite: 'auto' });
    // Motion with reduced motion asked for: none. The tweens are reverted and the vars fall back to 1.
    gsap.matchMedia().add('(prefers-reduced-motion: no-preference)', () => {
      // Every `.dot.running` reads --pulse, so dots created later breathe in step with no extra work.
      gsap.fromTo(root, { '--pulse': 1 }, { '--pulse': 0.35, duration: 0.8, ease: 'sine.inOut', repeat: -1, yoyo: true });
      // The terminal caret reads --blink: on half a second, off half a second.
      gsap.fromTo(root, { '--blink': 1 }, { '--blink': 0, duration: 0.5, ease: 'steps(1)', repeat: -1, yoyo: true });
    });
  }
  window.QMOTION = {
    reduce: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-toggle');
    if (!btn) return;
    const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('quiesco-theme', root.dataset.theme); } catch {}
  });

  // In-page anchors scroll with GSAP (jump straight there with reduced motion).
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href*="#"]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || url.pathname !== location.pathname || url.search !== location.search || !url.hash) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    history.pushState(null, '', url.hash);
    // Land below the header, which is fixed (home) or sticky (benchmark).
    const off = document.querySelector('.site-header')?.offsetHeight || 0;
    if (window.QSMOOTHER) { window.QSMOOTHER.scrollTo(target, true, `top ${off}px`); return; }
    if (!gsap || !window.ScrollToPlugin || window.QMOTION.reduce()) { window.scrollTo(0, target.getBoundingClientRect().top + scrollY - off); return; }
    gsap.to(window, { scrollTo: { y: target, offsetY: off, autoKill: true }, duration: 0.6, ease: 'power2.out' });
  });

  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    try { await navigator.clipboard.writeText(btn.dataset.copy); } catch { return; }
    const label = btn.querySelector('.copy-label');
    if (!label) return;
    if (btn._copyReset) btn._copyReset.kill(); else btn._copyOld = label.textContent;
    label.textContent = 'Copied';
    const restore = () => { label.textContent = btn._copyOld; btn._copyReset = null; };
    if (gsap) btn._copyReset = gsap.delayedCall(1.4, restore);
    else setTimeout(restore, 1400);
  });
})();

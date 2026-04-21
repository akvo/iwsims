import { useCallback, useEffect } from "react";

const useHomeParallax = (rootRef) => {
  const setupParallax = useCallback(() => {
    const root = rootRef.current;
    if (!root) {
      return () => {};
    }

    const reducedMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const glowA = root.querySelector(".hero-shell .glow-a");
    const glowB = root.querySelector(".hero-shell .glow-b");
    const glowC = root.querySelector(".hero-shell .glow-c");
    const grid = root.querySelector(".hero-shell .hero-grid-lines");
    const waves = root.querySelector(".hero-shell .waves");
    const ripples = root.querySelector(".hero-shell .ripples");
    const visual = root.querySelector(".hero-visual");
    const visualImg = root.querySelector(".hero-visual img");
    const eyebrow = root.querySelector(".hero-shell .eyebrow");
    const title = root.querySelector(".hero-title");
    const sub = root.querySelector(".hero-sub");
    const cta = root.querySelector(".cta-row");

    let heroRaf = null;
    const onHeroScroll = () => {
      if (heroRaf) {
        return;
      }
      heroRaf = window.requestAnimationFrame(() => {
        heroRaf = null;
        const y = window.scrollY || 0;
        const vh = window.innerHeight;
        const p = Math.min(y / Math.max(vh, 1), 1.2);

        if (glowA) {
          glowA.style.transform = `translate3d(${p * 40}px, ${p * -90}px, 0)`;
        }
        if (glowB) {
          glowB.style.transform = `translate3d(${p * -30}px, ${p * 70}px, 0)`;
        }
        if (glowC) {
          glowC.style.transform = `translate3d(${p * 20}px, ${p * -40}px, 0)`;
        }
        if (grid) {
          grid.style.transform = `translate3d(0, ${p * -30}px, 0)`;
        }
        if (waves) {
          waves.style.transform = `translate3d(0, ${p * 60}px, 0)`;
        }
        if (ripples) {
          ripples.style.transform = `translate3d(0, calc(-40% + ${
            p * 40
          }px), 0)`;
        }
        if (visual) {
          visual.style.transform = `translate3d(0, ${p * -70}px, 0)`;
        }
        if (visualImg) {
          visualImg.style.transform = `scale(${1 + p * 0.08}) translate3d(0, ${
            p * 10
          }px, 0)`;
        }

        const fade = Math.max(0, 1 - p * 1.1);
        if (eyebrow) {
          eyebrow.style.opacity = fade;
        }
        if (title) {
          title.style.opacity = fade;
          title.style.transform = `translate3d(0, ${p * -20}px, 0)`;
        }
        if (sub) {
          sub.style.opacity = fade;
          sub.style.transform = `translate3d(0, ${p * -14}px, 0)`;
        }
        if (cta) {
          cta.style.opacity = fade;
          cta.style.transform = `translate3d(0, ${p * -10}px, 0)`;
        }
      });
    };

    const reveals = root.querySelectorAll(".reveal");
    const checkReveals = () => {
      const vh = window.innerHeight;
      reveals.forEach((el) => {
        if (el.classList.contains("in")) {
          return;
        }
        const r = el.getBoundingClientRect();
        if (r.top < vh * 0.92 && r.bottom > 0) {
          el.classList.add("in");
        }
      });
    };

    let io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io.unobserve(e.target);
            }
          });
        },
        { threshold: 0, rootMargin: "0px 0px -8% 0px" }
      );
      reveals.forEach((el) => io.observe(el));
    }

    const parallaxImgs = root.querySelectorAll(
      ".mandate-media img, .role-media img"
    );
    const applyImgParallax = () => {
      const vh = window.innerHeight;
      parallaxImgs.forEach((img) => {
        const r = img.getBoundingClientRect();
        const pct = (r.top + r.height / 2 - vh / 2) / vh;
        const t = Math.max(-1, Math.min(1, pct)) * -14;
        img.style.transform = `translate3d(0, ${t}px, 0) scale(1.04)`;
      });
    };
    let imgRaf = null;
    const onImgScroll = () => {
      if (imgRaf) {
        return;
      }
      imgRaf = window.requestAnimationFrame(() => {
        imgRaf = null;
        applyImgParallax();
      });
    };

    const initialTimeout1 = window.setTimeout(checkReveals, 100);
    const initialTimeout2 = window.setTimeout(checkReveals, 600);

    if (!reducedMotion) {
      window.addEventListener("scroll", onHeroScroll, { passive: true });
      window.addEventListener("scroll", onImgScroll, { passive: true });
      onHeroScroll();
      applyImgParallax();
    }
    window.addEventListener("scroll", checkReveals, { passive: true });
    window.addEventListener("load", checkReveals);
    checkReveals();

    return () => {
      window.removeEventListener("scroll", onHeroScroll);
      window.removeEventListener("scroll", onImgScroll);
      window.removeEventListener("scroll", checkReveals);
      window.removeEventListener("load", checkReveals);
      window.clearTimeout(initialTimeout1);
      window.clearTimeout(initialTimeout2);
      if (heroRaf) {
        window.cancelAnimationFrame(heroRaf);
      }
      if (imgRaf) {
        window.cancelAnimationFrame(imgRaf);
      }
      if (io) {
        io.disconnect();
      }
    };
  }, [rootRef]);

  useEffect(setupParallax, [setupParallax]);
};

export default useHomeParallax;

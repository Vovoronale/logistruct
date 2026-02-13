const canvas = document.getElementById("bg-canvas");
const ctx = canvas ? canvas.getContext("2d") : null;
const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)");

const profileConfig = {
  high: { particleCount: 86, linkDistance: 138, speed: 0.36, fps: 60 },
  medium: { particleCount: 60, linkDistance: 126, speed: 0.26, fps: 50 },
  low: { particleCount: 36, linkDistance: 108, speed: 0.16, fps: 35 },
  reduced: { particleCount: 16, linkDistance: 80, speed: 0.04, fps: 12 },
};

function getMotionProfile() {
  if (prefersReduced.matches) return "reduced";
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  if (cores >= 8 && memory >= 8) return "high";
  if (cores >= 6 && memory >= 4) return "medium";
  return "low";
}

let profile = getMotionProfile();
let particles = [];
let lastTime = 0;

function resizeCanvas() {
  if (!canvas || !ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function createParticles() {
  if (!canvas) return;
  const cfg = profileConfig[profile];
  particles = Array.from({ length: cfg.particleCount }, () => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * cfg.speed,
    vy: (Math.random() - 0.5) * cfg.speed,
    radius: Math.random() * 1.8 + 0.6,
  }));
}

function updateParticles(dt) {
  const scale = dt / 16.6;
  for (const p of particles) {
    p.x += p.vx * scale;
    p.y += p.vy * scale;
    if (p.x < 0 || p.x > window.innerWidth) p.vx *= -1;
    if (p.y < 0 || p.y > window.innerHeight) p.vy *= -1;
  }
}

function drawParticles() {
  if (!ctx || !canvas) return;
  const cfg = profileConfig[profile];

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  const gradient = ctx.createLinearGradient(0, 0, window.innerWidth, window.innerHeight);
  gradient.addColorStop(0, "rgba(43, 210, 187, 0.12)");
  gradient.addColorStop(1, "rgba(255, 207, 102, 0.08)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);

  for (let i = 0; i < particles.length; i += 1) {
    const a = particles[i];
    ctx.beginPath();
    ctx.fillStyle = "rgba(178, 227, 240, 0.7)";
    ctx.arc(a.x, a.y, a.radius, 0, Math.PI * 2);
    ctx.fill();

    for (let j = i + 1; j < particles.length; j += 1) {
      const b = particles[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      if (dist < cfg.linkDistance) {
        const alpha = (1 - dist / cfg.linkDistance) * 0.28;
        ctx.beginPath();
        ctx.strokeStyle = `rgba(99, 183, 210, ${alpha.toFixed(3)})`;
        ctx.lineWidth = 1;
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }
}

function tick(now) {
  const cfg = profileConfig[profile];
  const frameDelta = now - lastTime;
  const minFrame = 1000 / cfg.fps;
  if (frameDelta >= minFrame) {
    updateParticles(frameDelta);
    drawParticles();
    lastTime = now;
  }
  requestAnimationFrame(tick);
}

function setupBackgroundEngine() {
  if (!canvas || !ctx) return;
  resizeCanvas();
  createParticles();
  requestAnimationFrame(tick);
}

function setActiveProject(projectId) {
  const cards = document.querySelectorAll(".project-card[data-project]");
  const nodes = document.querySelectorAll("#story-map .node[data-project]");
  const routes = document.querySelectorAll("#story-map .route[data-route]");

  cards.forEach((card) => {
    card.classList.toggle("is-active", card.dataset.project === projectId);
  });
  nodes.forEach((node) => {
    node.classList.toggle("is-active", node.dataset.project === projectId);
  });
  routes.forEach((route) => {
    const pair = route.dataset.route || "";
    route.classList.toggle("is-active", pair.includes(projectId));
  });
}

function setupMapInteractions() {
  const cards = document.querySelectorAll(".project-card[data-project]");
  cards.forEach((card) => {
    const activate = () => setActiveProject(card.dataset.project || "");
    card.addEventListener("mouseenter", activate);
    card.addEventListener("focus", activate);
    card.addEventListener("click", activate);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        activate();
      }
    });
  });
}

function animateCounters() {
  const metrics = document.querySelectorAll(".metric-value[data-count]");
  if (!metrics.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = Number(el.dataset.count || 0);
        const start = performance.now();
        const duration = prefersReduced.matches ? 10 : 1400;

        function step(ts) {
          const progress = Math.min(1, (ts - start) / duration);
          const value = Math.round(target * progress);
          el.textContent = String(value);
          if (progress < 1) requestAnimationFrame(step);
        }

        requestAnimationFrame(step);
        observer.unobserve(el);
      });
    },
    { threshold: 0.4 }
  );

  metrics.forEach((metric) => observer.observe(metric));
}

function bindMotionPreference() {
  const handler = () => {
    profile = getMotionProfile();
    createParticles();
  };
  prefersReduced.addEventListener("change", handler);
  window.addEventListener("resize", () => {
    resizeCanvas();
    createParticles();
  });
}

function setYear() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());
}

setupBackgroundEngine();
setupMapInteractions();
animateCounters();
bindMotionPreference();
setYear();

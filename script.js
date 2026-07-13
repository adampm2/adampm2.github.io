document.getElementById('year').textContent = new Date().getFullYear();

// --- Dark mode toggle ---
// (Theme is already applied by the inline script in <head>, before paint,
// to avoid a flash of the wrong theme. This just wires up the button and
// keeps its icon/label in sync.)
(function () {
  const root = document.documentElement;
  const toggle = document.getElementById('themeToggle');
  if (!toggle) return;

  function syncButton(theme) {
    toggle.textContent = theme === 'dark' ? '☀️' : '🌙';
    toggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  syncButton(root.getAttribute('data-theme') || 'light');

  toggle.addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('theme', next);
    syncButton(next);
  });
})();

const toggle = document.getElementById('menuToggle');
const links = document.getElementById('navLinks');

toggle.addEventListener('click', () => {
  const isOpen = links.classList.toggle('open');
  toggle.setAttribute('aria-expanded', isOpen);
});

links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
  links.classList.remove('open');
  toggle.setAttribute('aria-expanded', 'false');
}));

// --- Technician headshot (Cloudinary) ---
(function () {
  const cloudName = "qyki4kpw";
  const tag = "Headshot";

  const avatarImg = document.getElementById("techAvatar");
  if (!avatarImg) return; // avatar not on this page

  fetch(`https://res.cloudinary.com/${cloudName}/image/list/${tag}.json`)
    .then(res => res.json())
    .then(data => {
      const resource = (data.resources || [])[0];
      if (!resource) return; // no headshot tagged yet — gradient placeholder stays visible

      const ext = resource.format || "jpg";
      const transforms = ext === "gif"
        ? "w_400,h_400,c_fill,g_face"
        : "f_auto,q_auto,w_400,h_400,c_fill,g_face";
      avatarImg.src = `https://res.cloudinary.com/${cloudName}/image/upload/${transforms}/${resource.public_id}.${ext}`;
      avatarImg.hidden = false;
    })
    .catch(() => {
      // fetch failed — gradient placeholder stays visible, no error shown to visitors
    });
})();

// --- Filterable gallery section (Cloudinary, by category tag) ---
(function () {
  const cloudName = "qyki4kpw";
  const categories = ["red", "nude", "gold", "dark"]; // must match data-filter values on chips

  const gridEl = document.getElementById("galleryGrid");
  const statusEl = document.getElementById("galleryStatus");
  const emptyEl = document.getElementById("galleryEmpty");
  const filterEls = document.querySelectorAll("#filters .filter-chip");

  if (!gridEl) return; // section not on this page

  const categoryLabels = {
    red: "wine and red nail design",
    nude: "nude and rose nail design",
    gold: "gold and chrome nail design",
    dark: "dark and moody nail design"
  };

  function buildUrl(resource) {
    const ext = resource.format || "jpg";
    const transforms = ext === "gif"
      ? "q_auto,w_500,h_650,c_fill,g_auto"
      : "f_auto,q_auto,w_500,h_650,c_fill,g_auto";
    return `https://res.cloudinary.com/${cloudName}/image/upload/${transforms}/${resource.public_id}.${ext}`;
  }

  function fetchCategory(cat) {
    return fetch(`https://res.cloudinary.com/${cloudName}/image/list/${cat}.json`)
      .then(res => res.json())
      .then(data => (data.resources || []).map(r => ({ ...r, category: cat })))
      .catch(() => []); // one bad/missing tag shouldn't break the whole gallery
  }

  Promise.all(categories.map(fetchCategory))
    .then(results => {
      const allPhotos = results.flat();

      if (!allPhotos.length) {
        statusEl.textContent = "No photos yet — check back soon.";
        return;
      }

      gridEl.innerHTML = ""; // clear "Loading…" status

      allPhotos.forEach(resource => {
        const fig = document.createElement("figure");
        fig.className = "gallery-photo";
        fig.dataset.cat = resource.category;
        const altText = categoryLabels[resource.category] || "nail art design";
        fig.innerHTML = `<img src="${buildUrl(resource)}" alt="${altText}" loading="lazy" width="500" height="650">`;
        gridEl.appendChild(fig);
      });


      wireFilters();
    })
    .catch(() => {
      statusEl.textContent = "Gallery unavailable right now.";
    });

  function wireFilters() {
    filterEls.forEach(chip => {
      chip.addEventListener("click", () => {
        filterEls.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        const filter = chip.dataset.filter;
        let visibleCount = 0;
        gridEl.querySelectorAll(".gallery-photo").forEach(p => {
          const matches = filter === "all" || p.dataset.cat === filter;
          p.style.display = matches ? "" : "none";
          if (matches) visibleCount++;
        });
        emptyEl.hidden = visibleCount !== 0;
      });
    });
  }
})();

// --- Hero carousel (Cloudinary) ---
(function () {
  const cloudName = "qyki4kpw";
  const tag = "gallery";
  const rotateMs = 4000; // time between auto-advances
  const PRELOAD_WINDOW = 10; // how many upcoming photos to keep warmed in cache

  const imgEl = document.getElementById("carouselImg");
  const countEl = document.getElementById("carouselCount");
  const prevBtn = document.getElementById("carouselPrev");
  const nextBtn = document.getElementById("carouselNext");
  const carouselEl = document.getElementById("heroCarousel");

  if (!imgEl) return; // carousel not on this page

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let images = [];
  let urls = [];
  let current = 0;
  let timer = null;
  const preloaded = new Set(); // indices already warmed into cache

  // Build a delivery URL using each resource's OWN format.
  // (Hardcoding .jpg breaks animated GIFs by flattening them to one frame.)
  function buildUrl(resource) {
    const ext = resource.format || "jpg";
    const transforms = ext === "gif"
      ? "q_auto,w_800,h_1000,c_fill,g_auto"   // no f_auto on gifs, keeps animation
      : "f_auto,q_auto,w_800,h_1000,c_fill,g_auto";
    return `https://res.cloudinary.com/${cloudName}/image/upload/${transforms}/${resource.public_id}.${ext}`;
  }

  // Warm the browser's own image cache for just the next PRELOAD_WINDOW
  // photos ahead of `current`, wrapping around the gallery. Keeps memory/
  // bandwidth bounded no matter how large the gallery grows, instead of
  // fetching every photo up front.
  // (Images can't be stored in cookies — cookies are tiny, text-only, and
  // meant for things like session data, not binary files. This achieves
  // the same "load ahead of time" goal the right way.)
  function preloadWindow(fromIndex) {
    if (!urls.length) return;
    const count = Math.min(PRELOAD_WINDOW, urls.length);
    for (let i = 0; i < count; i++) {
      const idx = (fromIndex + i) % urls.length;
      if (preloaded.has(idx)) continue;
      preloaded.add(idx);
      const preloadImg = new Image();
      preloadImg.src = urls[idx];
    }
  }

  function showImage(index) {
    if (!urls.length) return;
    current = (index + urls.length) % urls.length;
    imgEl.src = urls[current];
    countEl.textContent = `${current + 1} / ${urls.length}`;
    preloadWindow(current); // slide the warm window forward as we advance
  }

  function startAutoplay() {
    if (prefersReducedMotion || urls.length < 2) return;
    stopAutoplay();
    timer = setInterval(() => showImage(current + 1), rotateMs);
  }

  function stopAutoplay() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  fetch(`https://res.cloudinary.com/${cloudName}/image/list/${tag}.json`)
    .then(res => res.json())
    .then(data => {
      images = data.resources || [];
      if (!images.length) {
        countEl.textContent = "No photos yet";
        return;
      }
      urls = images.map(buildUrl);
      showImage(0); // shows first photo and warms the initial window
      startAutoplay();
    })
    .catch(() => {
      countEl.textContent = "Gallery unavailable";
    });

  prevBtn.addEventListener("click", () => { showImage(current - 1); startAutoplay(); });
  nextBtn.addEventListener("click", () => { showImage(current + 1); startAutoplay(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { showImage(current - 1); startAutoplay(); }
    if (e.key === "ArrowRight") { showImage(current + 1); startAutoplay(); }
  });

  // Pause on hover/focus so people can actually study a design
  carouselEl.addEventListener("mouseenter", stopAutoplay);
  carouselEl.addEventListener("mouseleave", startAutoplay);
  carouselEl.addEventListener("focusin", stopAutoplay);
  carouselEl.addEventListener("focusout", startAutoplay);
})();

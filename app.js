/* ============================================================
   Hairport Barbering — app.js
   ------------------------------------------------------------
   EDIT THIS CONFIG with the shop's real details, then redeploy.
   ============================================================ */
const CONFIG = {
  phone: "+44 20 0000 0000",          // shop phone (display)
  phoneTel: "+442000000000",          // shop phone (tel: / wa.me — digits only, with country code)
  whatsapp: "442000000000",           // WhatsApp number (digits only, country code, no +)
  mapsUrl: "https://maps.app.goo.gl/xR8uXkm8Qkkx2niM9",
  // Optional online-booking link (Booksy/Fresha/etc). If set, "Book" buttons go here.
  bookingUrl: "",
  // Opening hours — [open, close] in 24h, or null for closed. Index 0 = Sunday.
  hours: [
    null,            // Sun
    ["09:00","18:00"], // Mon
    ["09:00","18:00"], // Tue
    ["09:00","18:00"], // Wed
    ["09:00","19:00"], // Thu
    ["09:00","19:00"], // Fri
    ["08:30","18:00"], // Sat
  ],
};

(function () {
  "use strict";
  const $ = (s, ctx = document) => ctx.querySelector(s);
  const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Wire up contact details from CONFIG ---------- */
  function applyConfig() {
    const tel = "tel:" + CONFIG.phoneTel.replace(/\s/g, "");
    $$("#phoneLink, #footerPhone, #barCall").forEach((a) => (a.href = tel));
    const wa = "https://wa.me/" + CONFIG.whatsapp.replace(/\D/g, "");
    if ($("#waLink")) $("#waLink").href = wa;
    if ($("#directionsLink")) $("#directionsLink").href = CONFIG.mapsUrl;

    // Re-route booking buttons to an external system if provided
    if (CONFIG.bookingUrl) {
      $$('a[href="#book"]').forEach((a) => {
        a.href = CONFIG.bookingUrl;
        a.target = "_blank";
        a.rel = "noopener";
      });
    }
    $("#year").textContent = new Date().getFullYear();
  }

  /* ---------- Header state + scroll progress ---------- */
  const header = $("#siteHeader");
  const progress = $("#scrollProgress");
  const bookBar = $("#bookBar");
  function onScroll() {
    const y = window.scrollY;
    header.classList.toggle("scrolled", y > 12);
    const h = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (h > 0 ? (y / h) * 100 : 0) + "%";
    bookBar.classList.toggle("show", y > 600);
  }
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!ticking) {
      requestAnimationFrame(() => { onScroll(); ticking = false; });
      ticking = true;
    }
  }, { passive: true });
  onScroll();

  /* ---------- Mobile menu ---------- */
  const toggle = $("#navToggle");
  const menu = $("#mobileMenu");
  function setMenu(open) {
    document.body.classList.toggle("menu-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    menu.setAttribute("aria-hidden", String(!open));
  }
  toggle.addEventListener("click", () => setMenu(!document.body.classList.contains("menu-open")));
  $$("#mobileMenu a").forEach((a) => a.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  /* ---------- Scroll reveal ---------- */
  function initReveal() {
    const els = $$("[data-reveal]");
    if (reduceMotion || !("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- Animated number counters ---------- */
  function animateCount(el) {
    const target = parseFloat(el.dataset.count);
    const decimals = parseInt(el.dataset.decimals || "0", 10);
    const suffix = el.dataset.suffix || "";
    if (reduceMotion) { el.textContent = format(target); return; }
    const dur = 1400, start = performance.now();
    function format(v) {
      let n = decimals ? v.toFixed(decimals) : Math.round(v).toLocaleString("en-GB");
      return n + suffix;
    }
    function frame(now) {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = format(target * eased);
      if (p < 1) requestAnimationFrame(frame);
      else el.textContent = format(target);
    }
    requestAnimationFrame(frame);
  }
  function initCounters() {
    const els = $$("[data-count]");
    if (!("IntersectionObserver" in window)) { els.forEach(animateCount); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { animateCount(e.target); io.unobserve(e.target); }
      });
    }, { threshold: 0.6 });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- Opening hours table (today highlighted) ---------- */
  function initHours() {
    const tbody = $("#hoursTable tbody");
    if (!tbody) return;
    const names = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    const today = new Date().getDay();
    const rows = [1,2,3,4,5,6,0].map((d) => {
      const h = CONFIG.hours[d];
      const val = h ? `${h[0]} – ${h[1]}` : `<span class="closed">Closed</span>`;
      const cls = d === today ? ' class="today"' : "";
      return `<tr${cls}><td>${names[d]}</td><td>${val}</td></tr>`;
    });
    tbody.innerHTML = rows.join("");
  }

  /* ---------- Gallery: self-contained SVG art tiles ---------- */
  function initGallery() {
    const grid = $("#galleryGrid");
    if (!grid) return;
    const tiles = [
      { label: "Skin Fade",   c1: "#1c1c24", c2: "#f5a623", style: "fade" },
      { label: "Beard Trim",  c1: "#16161c", c2: "#2b6cff", style: "lines" },
      { label: "Classic Cut", c1: "#201a12", c2: "#f5a623", style: "scissor" },
      { label: "Hot Towel",   c1: "#1a1216", c2: "#e23b3b", style: "rings" },
      { label: "Hair Design", c1: "#14181c", c2: "#fbbf24", style: "pattern" },
      { label: "Kids Cut",    c1: "#181820", c2: "#2b6cff", style: "lines" },
      { label: "Line Up",     c1: "#1c1c24", c2: "#f5a623", style: "pattern" },
      { label: "The Finish",  c1: "#16161c", c2: "#fbbf24", style: "rings" },
    ];
    const art = (t, i) => {
      const g = `g${i}`;
      let inner = "";
      if (t.style === "fade")
        inner = `<rect width="100" height="100" fill="url(#${g})"/>`;
      else if (t.style === "lines")
        inner = [...Array(7)].map((_, k) => `<rect x="${8+k*13}" y="14" width="5" height="72" rx="2.5" fill="${t.c2}" opacity="${0.25+k*0.1}"/>`).join("");
      else if (t.style === "scissor")
        inner = `<circle cx="34" cy="62" r="11" fill="none" stroke="${t.c2}" stroke-width="4"/><circle cx="66" cy="62" r="11" fill="none" stroke="${t.c2}" stroke-width="4"/><path d="M40 56 86 22M60 56 14 22" stroke="${t.c2}" stroke-width="4" stroke-linecap="round"/>`;
      else if (t.style === "rings")
        inner = [...Array(5)].map((_, k) => `<circle cx="50" cy="50" r="${10+k*9}" fill="none" stroke="${t.c2}" stroke-width="2.5" opacity="${0.7-k*0.12}"/>`).join("");
      else
        inner = [...Array(6)].map((_, k) => `<path d="M${10+k*14} 14 Q${4+k*14} 50 ${10+k*14} 86" fill="none" stroke="${t.c2}" stroke-width="3" opacity="${0.3+k*0.1}"/>`).join("");
      return `
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${t.label}">
          <defs>
            <linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="${t.c1}"/>
              <stop offset="1" stop-color="${t.c2}" stop-opacity="0.55"/>
            </linearGradient>
          </defs>
          <rect width="100" height="100" fill="${t.c1}"/>
          ${inner}
        </svg>`;
    };
    grid.innerHTML = tiles
      .map((t, i) => `<figure class="gallery-tile reveal" data-reveal style="--d:${i*50}ms">${art(t, i)}<figcaption>${t.label}</figcaption></figure>`)
      .join("");
  }

  /* ---------- Booking form (client-side validation) ---------- */
  function initForm() {
    const form = $("#bookForm");
    if (!form) return;
    const status = $("#formStatus");

    const validators = {
      "bf-name": (v) => v.trim().length >= 2 || "Please enter your name",
      "bf-phone": (v) => /[0-9]{7,}/.test(v.replace(/\D/g, "")) || "Enter a valid phone number",
      "bf-service": (v) => v !== "" || "Please choose a service",
    };

    function validateField(id) {
      const input = $("#" + id);
      const field = input.closest(".field");
      const msg = field.querySelector(".err");
      const res = validators[id](input.value);
      const ok = res === true;
      field.classList.toggle("invalid", !ok);
      msg.textContent = ok ? "" : res;
      return ok;
    }

    Object.keys(validators).forEach((id) => {
      $("#" + id).addEventListener("blur", () => validateField(id));
      $("#" + id).addEventListener("input", () => {
        if ($("#" + id).closest(".field").classList.contains("invalid")) validateField(id);
      });
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      // If an external booking system is configured, send them there instead.
      if (CONFIG.bookingUrl) { window.open(CONFIG.bookingUrl, "_blank", "noopener"); return; }

      const ids = Object.keys(validators);
      let firstInvalid = null;
      ids.forEach((id) => { if (!validateField(id) && !firstInvalid) firstInvalid = id; });
      if (firstInvalid) { $("#" + firstInvalid).focus(); return; }

      // No backend in this static build: hand off to the phone's SMS/WhatsApp
      // so the booking request actually reaches the shop.
      const name = $("#bf-name").value.trim();
      const phone = $("#bf-phone").value.trim();
      const service = $("#bf-service").value;
      const when = $("#bf-when").value.trim();
      const text = `Hi Hairport, I'd like to book.%0AName: ${name}%0APhone: ${phone}%0AService: ${service}` + (when ? `%0APreferred: ${when}` : "");

      status.textContent = "Opening WhatsApp to send your request…";
      status.classList.add("ok");
      setTimeout(() => {
        window.location.href = `https://wa.me/${CONFIG.whatsapp.replace(/\D/g, "")}?text=${text}`;
      }, 600);
      form.reset();
    });
  }

  /* ---------- Smooth-scroll offset for sticky header ---------- */
  function initAnchors() {
    $$('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const id = a.getAttribute("href");
        if (id.length < 2) return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        const top = target.getBoundingClientRect().top + window.scrollY -
          (parseInt(getComputedStyle(document.documentElement).getPropertyValue("--header-h")) || 70) - 8;
        window.scrollTo({ top, behavior: reduceMotion ? "auto" : "smooth" });
        history.pushState(null, "", id);
      });
    });
  }

  /* ---------- Init ---------- */
  applyConfig();
  initHours();
  initGallery();
  initReveal();
  initCounters();
  initForm();
  initAnchors();

  /* ---------- Service worker (PWA) ---------- */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
})();

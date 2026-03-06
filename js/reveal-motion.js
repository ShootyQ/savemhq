const DEFAULT_SELECTOR = [
  ".section",
  ".hero-surface",
  ".project-grid > *",
  ".split-grid > *",
  ".auth-grid > *",
  ".footer-wrap",
].join(", ");

let revealObserver = null;

const applyVisible = (element) => {
  element.classList.add("is-visible");
};

const applyRevealMeta = (elements) => {
  elements.forEach((element, index) => {
    if (element.dataset.revealReady === "1") {
      return;
    }
    element.dataset.revealReady = "1";
    element.style.setProperty("--reveal-order", String(index % 8));
    element.classList.add("reveal-item");
  });
};

const connectObserver = (elements) => {
  if (!revealObserver) {
    elements.forEach((element) => applyVisible(element));
    return;
  }

  elements.forEach((element) => {
    if (element.classList.contains("is-visible")) {
      return;
    }
    revealObserver.observe(element);
  });
};

export const refreshRevealMotion = ({ scope = document, selector = DEFAULT_SELECTOR } = {}) => {
  const elements = Array.from(scope.querySelectorAll(selector));
  if (!elements.length) {
    return;
  }

  applyRevealMeta(elements);
  connectObserver(elements);
};

export const initRevealMotion = ({ selector = DEFAULT_SELECTOR } = {}) => {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  document.body.classList.add("reveal-enabled");

  if ("IntersectionObserver" in window) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          applyVisible(entry.target);
          revealObserver.unobserve(entry.target);
        });
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -8% 0px",
      }
    );
  }

  refreshRevealMotion({ selector });
};

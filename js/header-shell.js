const isOpenClass = "is-open";

export const initHeaderShell = () => {
  const menuToggle = document.getElementById("header-menu-toggle");
  const headerPanel = document.getElementById("header-mobile-panel");

  if (!menuToggle || !headerPanel) {
    return;
  }

  const setOpen = (isOpen) => {
    headerPanel.classList.toggle(isOpenClass, isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    menuToggle.textContent = isOpen ? "Close" : "Menu";
  };

  setOpen(false);

  menuToggle.addEventListener("click", () => {
    const shouldOpen = !headerPanel.classList.contains(isOpenClass);
    setOpen(shouldOpen);
  });

  headerPanel.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest("a") || target.closest("button.btn")) {
      setOpen(false);
    }
  });

  const mediaQuery = window.matchMedia("(min-width: 701px)");
  mediaQuery.addEventListener("change", (event) => {
    if (event.matches) {
      setOpen(false);
    }
  });
};

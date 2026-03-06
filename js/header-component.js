const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const navMarkup = (links, currentPath) =>
  links
    .map((link) => {
      const href = String(link.href || "#");
      const label = String(link.label || "Link");
      const isCurrent = href !== "#" && href.replace(/^\.\//, "") === currentPath;
      return `<li><a class="${isCurrent ? "nav-link-current" : ""}" href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`;
    })
    .join("");

export const mountSiteHeader = ({
  rootId = "site-header-root",
  brandHref = "index.html",
  navLinks = [],
} = {}) => {
  const root = document.getElementById(rootId);
  if (!root) {
    return;
  }

  const currentPath = window.location.pathname.split("/").pop() || "index.html";
  root.innerHTML = `
    <header class="site-header">
      <div class="container nav-wrap">
        <a class="brand" href="${escapeHtml(brandHref)}" aria-label="SavemHQ home">SavemHQ</a>
        <button id="header-menu-toggle" class="menu-toggle" type="button" aria-controls="header-mobile-panel" aria-expanded="false">Menu</button>
        <div id="header-mobile-panel" class="header-panel">
          <nav aria-label="Primary">
            <ul class="nav-list">
              ${navMarkup(navLinks, currentPath)}
            </ul>
          </nav>
          <div class="header-auth" aria-live="polite">
            <span id="header-auth-status" class="small-note">Signed out</span>
            <a id="add-plates-link" class="btn btn-secondary hidden" href="plate-entry.html">Add Plates</a>
            <a id="header-admin-link" class="btn btn-secondary hidden" href="admin.html">Admin</a>
            <button id="header-sign-in" class="btn btn-primary" type="button">Google Login</button>
            <button id="header-sign-out" class="btn btn-secondary hidden" type="button">Sign Out</button>
          </div>
        </div>
      </div>
    </header>
  `;
};

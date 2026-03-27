import {
  collection,
  getDocs,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "./auth-shared.js";
import {
  getEventTypeMeta,
  getSubjectMeta,
  ROAD_TRIP_ID,
  ROAD_TRIP_ROUTE_POINTS,
  ROAD_TRIP_TITLE,
} from "./road-trip-shared.js";
import { getPhotoProofChallengeMeta } from "./road-trip-games-shared.js";

const DEFAULT_ITEMS_PER_PAGE = 10;
const BOOK_FILE_NAME = "carlsons-road-trip-book.pdf";

const elements = {
  form: document.getElementById("road-trip-book-form"),
  titleInput: document.getElementById("book-title-input"),
  itemsPerPageSelect: document.getElementById("book-items-per-page"),
  includePhotoProofInput: document.getElementById("book-include-photo-proof"),
  autoPrintInput: document.getElementById("book-auto-print"),
  status: document.getElementById("book-status"),
  root: document.getElementById("road-trip-book-root"),
  printButton: document.getElementById("book-print-pdf"),
  downloadButton: document.getElementById("book-download-pdf"),
};

let activeBuildToken = 0;

const routeStops = [...new Set(
  ROAD_TRIP_ROUTE_POINTS
    .filter((point) => point.stop)
    .map((point) => String(point.name || "").trim())
    .filter(Boolean)
)];

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");

const parseQueryBoolean = (value) => ["1", "true", "yes"].includes(String(value || "").trim().toLowerCase());

const unique = (items) => items.filter((item, index) => items.indexOf(item) === index);

const normalizeRoadTripEvent = (eventDoc) => {
  const data = eventDoc.data();
  const createdAt = data.createdAt?.toDate?.() || null;
  const subjectMeta = getSubjectMeta(data.subject, data.subjectLabel);
  const eventMeta = getEventTypeMeta(data.eventType);
  const photoUrls = Array.isArray(data.photoUrls)
    ? data.photoUrls.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const fallbackPhotoUrl = String(data.photoUrl || "").trim();
  const normalizedPhotoUrls = photoUrls.length ? photoUrls : (fallbackPhotoUrl ? [fallbackPhotoUrl] : []);
  const metaParts = [
    String(data.personLabel || "").trim(),
    String(subjectMeta.label || "").trim(),
    String(data.routeLeg || "").trim(),
  ].filter(Boolean);

  return {
    id: eventDoc.id,
    sortTime: createdAt?.getTime?.() || 0,
    createdAt,
    kind: "moment",
    kicker: eventMeta.label,
    title: subjectMeta.label || eventMeta.label,
    subtitle: String(data.personLabel || "").trim(),
    caption: String(data.content || "").trim(),
    meta: unique(metaParts),
    photos: normalizedPhotoUrls.slice(0, 3),
    pageLabel: createdAt ? dateTimeFormatter.format(createdAt) : "Undated",
  };
};

const normalizePhotoProofEntry = (entryDoc) => {
  const data = entryDoc.data();
  const createdAt = data.createdAt?.toDate?.() || null;
  const challengeMeta = getPhotoProofChallengeMeta(data.challengeId);
  const caption = String(data.caption || "").trim();
  const kicker = "Photo Proof";
  const title = challengeMeta?.label || String(data.challengeLabel || "Photo Challenge").trim() || "Photo Challenge";
  const subtitle = String(data.uploaderLabel || "").trim();
  const meta = [subtitle, title].filter(Boolean);

  return {
    id: entryDoc.id,
    sortTime: createdAt?.getTime?.() || 0,
    createdAt,
    kind: "photo-proof",
    kicker,
    title,
    subtitle,
    caption: caption || "Challenge upload",
    meta: unique(meta),
    photos: [String(data.photoUrl || "").trim()].filter(Boolean),
    pageLabel: createdAt ? dateTimeFormatter.format(createdAt) : "Undated",
  };
};

const chunkItems = (items, size) => {
  const chunks = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
};

const formatDate = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? dateFormatter.format(value) : "-");

const collectHeroPhoto = (items) => items.find((item) => item.photos.length)?.photos[0] || "";

const createCoverPage = ({ bookTitle, items, itemsPerPage }) => {
  const firstDate = items[0]?.createdAt || null;
  const lastDate = items[items.length - 1]?.createdAt || null;
  const photoCount = items.reduce((total, item) => total + item.photos.length, 0);
  const pageEstimate = Math.max(1, Math.ceil(items.length / itemsPerPage) + 1);
  const heroPhoto = collectHeroPhoto(items);

  return `
    <article class="book-page book-cover">
      <section>
        <p class="book-toolbar-kicker">Road Trip Book</p>
        <h1 class="book-cover-title">${escapeHtml(bookTitle || ROAD_TRIP_TITLE)}</h1>
        <p class="book-cover-subtitle">
          A compact scrapbook built automatically from the live road-trip timeline, kept in timestamp order with small photos, challenge uploads, and the best quick captions.
        </p>
        <div class="book-cover-meta">
          <div class="book-cover-stat-grid">
            <div class="book-cover-stat">
              <span class="book-cover-route">Timeline entries</span>
              <strong>${items.length}</strong>
            </div>
            <div class="book-cover-stat">
              <span class="book-cover-route">Photos used</span>
              <strong>${photoCount}</strong>
            </div>
            <div class="book-cover-stat">
              <span class="book-cover-route">Date range</span>
              <strong>${escapeHtml(`${formatDate(firstDate)} - ${formatDate(lastDate)}`)}</strong>
            </div>
            <div class="book-cover-stat">
              <span class="book-cover-route">Estimated pages</span>
              <strong>${pageEstimate}</strong>
            </div>
          </div>
          <div>
            <p class="book-cover-route">Route</p>
            <div class="book-route-list">
              ${routeStops.map((stop) => `<span class="book-chip">${escapeHtml(stop)}</span>`).join("")}
            </div>
          </div>
          <p class="book-cover-note">
            Default layout is ${itemsPerPage} entries per page. If the book feels too dense, switch to 8. If it still feels too long, switch to 12.
          </p>
        </div>
      </section>
      <aside>
        ${heroPhoto ? `<div class="book-cover-photo"><img src="${escapeHtml(heroPhoto)}" alt="Road trip cover collage" crossorigin="anonymous" referrerpolicy="no-referrer" /></div>` : ""}
      </aside>
      <div class="book-footer">Cover</div>
    </article>
  `;
};

const createEntryCard = (item, indexOffset) => {
  const photoMarkup = item.photos.length
    ? `
      <div class="book-entry-photos">
        ${item.photos.map((photoUrl, photoIndex) => `
          <figure class="book-entry-photo">
            <img
              src="${escapeHtml(photoUrl)}"
              alt="${escapeHtml(`${item.title} photo ${photoIndex + 1}`)}"
              loading="lazy"
              crossorigin="anonymous"
              referrerpolicy="no-referrer"
            />
          </figure>
        `).join("")}
      </div>
    `
    : "";

  return `
    <article class="book-entry-card">
      <div class="book-entry-topline">
        <span class="book-entry-kicker">${escapeHtml(item.kicker)}</span>
        <span>${escapeHtml(item.pageLabel)}</span>
      </div>
      <div>
        <h3 class="book-entry-title">${escapeHtml(`${indexOffset}. ${item.title}`)}</h3>
        ${item.subtitle ? `<p class="book-entry-meta">${escapeHtml(item.subtitle)}</p>` : ""}
      </div>
      ${photoMarkup}
      <p class="book-entry-caption">${escapeHtml(item.caption || item.title)}</p>
      ${item.meta.length ? `<p class="book-entry-meta">${escapeHtml(item.meta.join(" • "))}</p>` : ""}
    </article>
  `;
};

const pageGridTemplate = (itemsPerPage) => {
  const columns = itemsPerPage >= 12 ? 3 : 2;
  const rows = Math.ceil(itemsPerPage / columns);

  return `grid-template-columns: repeat(${columns}, minmax(0, 1fr)); grid-template-rows: repeat(${rows}, minmax(0, 1fr));`;
};

const createContentPage = ({ pageIndex, pageItems, itemsPerPage, totalPages }) => `
  <article class="book-page">
    <header class="book-page-header">
      <div>
        <p class="book-toolbar-kicker">Road Trip Timeline</p>
        <h2 class="book-page-title">Page ${pageIndex} of ${totalPages}</h2>
      </div>
      <p class="book-page-count">${escapeHtml(`${pageItems[0]?.pageLabel || ""} ${pageItems.length ? "->" : ""} ${pageItems[pageItems.length - 1]?.pageLabel || ""}`)}</p>
    </header>
    <section class="book-page-grid" style="${pageGridTemplate(itemsPerPage)}">
      ${pageItems.map((item, itemIndex) => createEntryCard(item, ((pageIndex - 2) * itemsPerPage) + itemIndex + 1)).join("")}
    </section>
    <div class="book-footer">${pageIndex}</div>
  </article>
`;

const waitForImages = async (root) => {
  const imageElements = Array.from(root.querySelectorAll("img"));

  await Promise.all(imageElements.map((image) => new Promise((resolve) => {
    if (image.complete) {
      resolve();
      return;
    }

    const finish = () => resolve();
    image.addEventListener("load", finish, { once: true });
    image.addEventListener("error", finish, { once: true });
  })));
};

const setStatus = (message) => {
  if (elements.status) {
    elements.status.textContent = message;
  }
};

const readControls = () => ({
  bookTitle: String(elements.titleInput?.value || ROAD_TRIP_TITLE).trim() || ROAD_TRIP_TITLE,
  itemsPerPage: Math.max(1, Number.parseInt(String(elements.itemsPerPageSelect?.value || DEFAULT_ITEMS_PER_PAGE), 10) || DEFAULT_ITEMS_PER_PAGE),
  includePhotoProof: Boolean(elements.includePhotoProofInput?.checked),
  autoPrint: Boolean(elements.autoPrintInput?.checked),
});

const fetchRoadTripEvents = async () => {
  const snapshot = await getDocs(query(collection(db, "roadTrips", ROAD_TRIP_ID, "events"), orderBy("createdAt", "asc")));
  return snapshot.docs.map(normalizeRoadTripEvent);
};

const fetchPhotoProofEntries = async () => {
  const snapshot = await getDocs(query(collection(db, "roadTrips", ROAD_TRIP_ID, "photoProofEntries"), orderBy("createdAt", "asc")));
  return snapshot.docs.map(normalizePhotoProofEntry);
};

const buildTimelineItems = async ({ includePhotoProof }) => {
  const [events, photoProofEntries] = await Promise.all([
    fetchRoadTripEvents(),
    includePhotoProof ? fetchPhotoProofEntries() : Promise.resolve([]),
  ]);

  return [...events, ...photoProofEntries]
    .sort((left, right) => {
      if (left.sortTime === right.sortTime) {
        return left.id.localeCompare(right.id);
      }

      return left.sortTime - right.sortTime;
    });
};

const renderBook = ({ bookTitle, items, itemsPerPage }) => {
  if (!items.length) {
    elements.root.innerHTML = `
      <article class="book-toolbar-card book-empty-state">
        No road-trip entries were found for this export.
      </article>
    `;
    return { totalPages: 0 };
  }

  const pages = chunkItems(items, itemsPerPage);
  const totalPages = pages.length + 1;
  const pageMarkup = [createCoverPage({ bookTitle, items, itemsPerPage })]
    .concat(pages.map((pageItems, pageIndex) => createContentPage({
      pageIndex: pageIndex + 2,
      pageItems,
      itemsPerPage,
      totalPages,
    })));

  elements.root.innerHTML = pageMarkup.join("");

  return { totalPages };
};

const downloadPdf = async () => {
  if (!window.html2pdf) {
    setStatus("PDF library still loading. Try again in a second, or use Print / Save PDF.");
    return;
  }

  setStatus("Building PDF file...");
  await waitForImages(elements.root);

  await window.html2pdf()
    .set({
      filename: BOOK_FILE_NAME,
      margin: 0,
      pagebreak: { mode: ["css", "legacy"] },
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        backgroundColor: "#f4ecdf",
      },
      jsPDF: {
        unit: "in",
        format: "letter",
        orientation: "landscape",
      },
    })
    .from(elements.root)
    .save();

  setStatus(`Downloaded ${BOOK_FILE_NAME}.`);
};

const buildBook = async ({ triggerPrint = false, triggerDownload = false } = {}) => {
  activeBuildToken += 1;
  const buildToken = activeBuildToken;
  activeBuildToken = buildToken;
  const controls = readControls();

  setStatus("Loading trip entries...");

  try {
    const items = await buildTimelineItems({ includePhotoProof: controls.includePhotoProof });

    if (activeBuildToken !== buildToken) {
      return;
    }

    const { totalPages } = renderBook({
      bookTitle: controls.bookTitle,
      items,
      itemsPerPage: controls.itemsPerPage,
    });

    await waitForImages(elements.root);

    if (activeBuildToken !== buildToken) {
      return;
    }

    setStatus(`Built ${items.length} entries into ${totalPages} pages.`);

    if (triggerDownload) {
      await downloadPdf();
      return;
    }

    if (triggerPrint || controls.autoPrint) {
      window.setTimeout(() => {
        window.print();
      }, 100);
    }
  } catch (error) {
    const errorMessage = error && typeof error === "object" && "message" in error ? String(error.message) : "unknown error";
    elements.root.innerHTML = `
      <article class="book-toolbar-card book-empty-state">
        Could not build the road trip book. ${escapeHtml(errorMessage)}
      </article>
    `;
    setStatus(`Could not build the book (${errorMessage}).`);
  }
};

const applyQueryDefaults = () => {
  const params = new URLSearchParams(window.location.search);
  const itemsPerPage = Number.parseInt(String(params.get("items") || ""), 10);
  const title = String(params.get("title") || "").trim();

  if (Number.isFinite(itemsPerPage) && [8, 10, 12].includes(itemsPerPage)) {
    elements.itemsPerPageSelect.value = String(itemsPerPage);
  }

  if (title) {
    elements.titleInput.value = title;
  }

  if (params.has("photoProof")) {
    elements.includePhotoProofInput.checked = parseQueryBoolean(params.get("photoProof"));
  }

  if (params.has("autoprint")) {
    elements.autoPrintInput.checked = parseQueryBoolean(params.get("autoprint"));
  }

  return {
    autoPrint: parseQueryBoolean(params.get("autoprint")),
    autoDownload: parseQueryBoolean(params.get("autodownload")),
  };
};

const init = () => {
  const queryDefaults = applyQueryDefaults();

  elements.form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await buildBook();
  });

  elements.printButton?.addEventListener("click", async () => {
    await buildBook({ triggerPrint: true });
  });

  elements.downloadButton?.addEventListener("click", async () => {
    await buildBook({ triggerDownload: true });
  });

  buildBook({
    triggerPrint: queryDefaults.autoPrint,
    triggerDownload: queryDefaults.autoDownload,
  });
};

init();
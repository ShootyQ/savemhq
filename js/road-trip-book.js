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

const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
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

const formatShortDate = (value) => (value instanceof Date && !Number.isNaN(value.getTime()) ? shortDateFormatter.format(value) : "Undated");

const themeForMomentType = (eventType = "") => {
  const normalized = String(eventType || "").trim().toLowerCase();

  if (normalized === "kid-said") {
    return "quote";
  }

  if (normalized === "song") {
    return "song";
  }

  return "activity";
};

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
    theme: themeForMomentType(data.eventType),
    kicker: eventMeta.label,
    title: subjectMeta.label || eventMeta.label,
    subtitle: String(data.personLabel || "").trim(),
    caption: String(data.content || "").trim(),
    meta: unique(metaParts),
    photos: normalizedPhotoUrls.slice(0, 3),
    dateOnlyLabel: formatShortDate(createdAt),
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
    theme: "photo-proof",
    kicker,
    title,
    subtitle,
    caption: caption || "Challenge upload",
    meta: unique(meta),
    photos: [String(data.photoUrl || "").trim()].filter(Boolean),
    dateOnlyLabel: formatShortDate(createdAt),
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

const collectCoverPhotos = (items, count = 3) => unique(
  items.flatMap((item) => item.photos || []).filter(Boolean)
).slice(0, count);

const pickCoverQuote = (items) => items.find((item) => item.caption && item.caption.length >= 18)?.caption || "The good stuff was already in the timeline. This just gives it a proper home.";

const pageVariantForIndex = (pageIndex, itemsPerPage) => {
  const dense = itemsPerPage >= 12;

  if (dense) {
    return ["variant-journal", "variant-film", "variant-feature"][pageIndex % 3];
  }

  return ["variant-feature", "variant-journal", "variant-film", "variant-mosaic"][pageIndex % 4];
};

const summarizePageItems = (pageItems) => {
  const counts = pageItems.reduce((accumulator, item) => {
    const key = String(item.kicker || "Moment").trim();
    accumulator.set(key, (accumulator.get(key) || 0) + 1);
    return accumulator;
  }, new Map());

  const topLabels = [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 2)
    .map(([label]) => label);

  return topLabels.length ? `${topLabels.join(" + ")} in sequence` : "Chronological trip moments";
};

const pageDateRangeLabel = (pageItems) => {
  const start = pageItems[0]?.createdAt || null;
  const end = pageItems[pageItems.length - 1]?.createdAt || null;

  if (!start && !end) {
    return "Undated";
  }

  if (formatShortDate(start) === formatShortDate(end)) {
    return formatShortDate(start);
  }

  return `${formatShortDate(start)} -> ${formatShortDate(end)}`;
};

const pageTitleForItems = (pageItems) => {
  const featuredItem = pageItems.find((item) => item.photos.length) || pageItems[0];
  return featuredItem ? featuredItem.title : "Road Trip Timeline";
};

const pageDekForItems = (pageItems) => {
  const featuredItem = pageItems.find((item) => item.caption) || pageItems[0];
  return featuredItem ? featuredItem.caption : "Snapshots, one-liners, and stop-by-stop moments from the road.";
};

const pageToneForItems = (pageItems) => {
  const counts = pageItems.reduce((accumulator, item) => {
    const key = String(item.theme || "activity");
    accumulator.set(key, (accumulator.get(key) || 0) + 1);
    return accumulator;
  }, new Map());

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || "activity";
};

const splitPageItems = (pageItems) => {
  const featuredIndex = Math.max(0, pageItems.findIndex((item) => item.photos.length));
  const featuredItem = pageItems[featuredIndex] || pageItems[0] || null;
  const remainder = pageItems.filter((_, index) => index !== featuredIndex);
  const quoteItem = remainder.find((item) => !item.photos.length && item.caption);
  const visualItems = remainder.filter((item) => item !== quoteItem && item.photos.length);
  const noteItems = remainder.filter((item) => item !== quoteItem && !item.photos.length);
  const mixedItems = remainder.filter((item) => item !== quoteItem && !visualItems.includes(item) && !noteItems.includes(item));

  return {
    featuredItem,
    quoteItem,
    visualItems,
    noteItems,
    mixedItems,
    remainder,
  };
};

const createQuoteBand = (item, indexOffset) => {
  if (!item) {
    return "";
  }

  return `
    <aside class="book-quote-band theme-${escapeHtml(item.theme || "activity")}">
      <div class="book-quote-band-mark">${indexOffset}</div>
      <div class="book-quote-band-copy">
        <p class="book-quote-band-kicker">${escapeHtml(item.kicker)}</p>
        <blockquote>${escapeHtml(item.caption || item.title)}</blockquote>
        <p class="book-quote-band-meta">${escapeHtml([item.subtitle, item.dateOnlyLabel].filter(Boolean).join(" • "))}</p>
      </div>
    </aside>
  `;
};

const createCoverPage = ({ bookTitle, items, itemsPerPage }) => {
  const firstDate = items[0]?.createdAt || null;
  const lastDate = items[items.length - 1]?.createdAt || null;
  const photoCount = items.reduce((total, item) => total + item.photos.length, 0);
  const pageEstimate = Math.max(1, Math.ceil(items.length / itemsPerPage) + 1);
  const heroPhoto = collectHeroPhoto(items);
  const coverPhotos = collectCoverPhotos(items, 3);
  const coverQuote = pickCoverQuote(items);

  return `
    <article class="book-page book-cover">
      <section class="book-cover-copy">
        <div>
          <p class="book-toolbar-kicker">Road Trip Book</p>
        <h1 class="book-cover-title">${escapeHtml(bookTitle || ROAD_TRIP_TITLE)}</h1>
        <p class="book-cover-subtitle">
          A compact scrapbook built automatically from the live road-trip timeline, kept in timestamp order with small photos, challenge uploads, and the best quick captions.
        </p>
        </div>
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
          <div class="book-cover-quote">
            <p>${escapeHtml(coverQuote)}</p>
          </div>
        </div>
      </section>
      <aside class="book-cover-photo-stack">
        <div class="book-cover-photo-grid">
          ${heroPhoto ? `<div class="book-cover-photo"><img src="${escapeHtml(heroPhoto)}" alt="Road trip cover collage" crossorigin="anonymous" referrerpolicy="no-referrer" /></div>` : ""}
          <div class="book-cover-photo-column">
            ${coverPhotos.slice(1).map((photoUrl, photoIndex) => `
              <div class="book-cover-photo-small">
                <img src="${escapeHtml(photoUrl)}" alt="Road trip detail ${photoIndex + 1}" crossorigin="anonymous" referrerpolicy="no-referrer" />
              </div>
            `).join("")}
          </div>
        </div>
      </aside>
      <div class="book-footer">Cover</div>
    </article>
  `;
};

const createEntryCard = (item, indexOffset, { cardRole = "standard", styleVariant = "standard" } = {}) => {
  const classNames = [
    "book-entry-card",
    `theme-${String(item.theme || "activity")}`,
    item.photos.length ? `has-${Math.min(item.photos.length, 3)}-photos` : "is-text-only",
    `style-${styleVariant}`,
  ];

  if (cardRole === "featured") {
    classNames.push("is-featured");
  }

  if (cardRole === "secondary") {
    classNames.push("is-secondary");
  }

  const photoMarkup = item.photos.length
    ? `
      <div class="book-entry-photos photo-count-${Math.min(item.photos.length, 3)}">
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

  const tagMarkup = item.meta.length
    ? `
      <div class="book-entry-tags">
        ${item.meta.slice(0, 3).map((tag) => `<span class="book-entry-tag">${escapeHtml(tag)}</span>`).join("")}
      </div>
    `
    : "";

  return `
    <article class="${classNames.join(" ")}">
      <div class="book-entry-topline">
        <span class="book-entry-topline-left">
          <span class="book-entry-pill">${indexOffset}</span>
          <span class="book-entry-kicker">${escapeHtml(item.kicker)}</span>
        </span>
        <span>${escapeHtml(item.pageLabel)}</span>
      </div>
      <div class="book-entry-copy">
        <h3 class="book-entry-title">${escapeHtml(item.title)}</h3>
        ${item.subtitle ? `<p class="book-entry-meta">${escapeHtml(item.subtitle)}</p>` : ""}
        <p class="book-entry-caption">${escapeHtml(item.caption || item.title)}</p>
      </div>
      ${photoMarkup}
      ${tagMarkup}
    </article>
  `;
};

const pageGridTemplate = (itemsPerPage) => {
  const columns = itemsPerPage >= 12 ? 3 : 2;
  const rows = Math.ceil(itemsPerPage / columns);

  return `grid-template-columns: repeat(${columns}, minmax(0, 1fr)); grid-template-rows: repeat(${rows}, minmax(0, 1fr));`;
};

const createFeatureLayout = ({ pageItems, pageIndex, itemsPerPage }) => {
  const { featuredItem, quoteItem, visualItems, noteItems, mixedItems } = splitPageItems(pageItems);
  const supportingVisuals = [...visualItems, ...mixedItems].slice(0, 2);
  const supportNotes = [...noteItems, ...visualItems.slice(2), ...mixedItems.slice(2)].slice(0, Math.max(2, itemsPerPage - 3));

  return `
    <section class="book-spread book-spread-feature">
      <div class="book-spread-main">
        ${featuredItem ? createEntryCard(featuredItem, ((pageIndex - 2) * itemsPerPage) + 1, { cardRole: "featured", styleVariant: "hero" }) : ""}
      </div>
      <aside class="book-spread-side">
        ${supportingVisuals.map((item, index) => createEntryCard(item, ((pageIndex - 2) * itemsPerPage) + index + 2, { cardRole: "secondary", styleVariant: "panel" })).join("")}
      </aside>
      ${quoteItem ? createQuoteBand(quoteItem, ((pageIndex - 2) * itemsPerPage) + pageItems.indexOf(quoteItem) + 1) : ""}
      <div class="book-spread-strip">
        ${supportNotes.map((item) => createEntryCard(item, ((pageIndex - 2) * itemsPerPage) + pageItems.indexOf(item) + 1, { styleVariant: "mini" })).join("")}
      </div>
    </section>
  `;
};

const createJournalLayout = ({ pageItems, pageIndex, itemsPerPage }) => {
  const { featuredItem, quoteItem, visualItems, noteItems, mixedItems } = splitPageItems(pageItems);
  const noteColumnItems = [...visualItems.slice(0, 1), ...noteItems, ...mixedItems].slice(0, itemsPerPage - 1);

  return `
    <section class="book-spread book-spread-journal">
      <div class="book-journal-main">
        ${featuredItem ? createEntryCard(featuredItem, ((pageIndex - 2) * itemsPerPage) + 1, { cardRole: "featured", styleVariant: "essay" }) : ""}
        ${quoteItem ? createQuoteBand(quoteItem, ((pageIndex - 2) * itemsPerPage) + pageItems.indexOf(quoteItem) + 1) : ""}
      </div>
      <aside class="book-journal-notes">
        ${noteColumnItems.map((item) => createEntryCard(item, ((pageIndex - 2) * itemsPerPage) + pageItems.indexOf(item) + 1, { styleVariant: "compact" })).join("")}
      </aside>
    </section>
  `;
};

const createFilmLayout = ({ pageItems, pageIndex, itemsPerPage }) => {
  const { featuredItem, quoteItem, visualItems, noteItems, mixedItems } = splitPageItems(pageItems);
  const topRowItems = [featuredItem, ...visualItems.slice(0, 2)].filter(Boolean).slice(0, 3);
  const bottomItems = [...noteItems, ...mixedItems, ...visualItems.slice(2)].slice(0, itemsPerPage - topRowItems.length);

  return `
    <section class="book-spread book-spread-film">
      <div class="book-film-top">
        ${topRowItems.map((item, index) => createEntryCard(item, ((pageIndex - 2) * itemsPerPage) + pageItems.indexOf(item) + 1, {
          cardRole: index === 0 ? "featured" : "secondary",
          styleVariant: index === 0 ? "wide" : "panel",
        })).join("")}
      </div>
      ${quoteItem ? createQuoteBand(quoteItem, ((pageIndex - 2) * itemsPerPage) + pageItems.indexOf(quoteItem) + 1) : ""}
      <div class="book-film-bottom">
        ${bottomItems.map((item) => createEntryCard(item, ((pageIndex - 2) * itemsPerPage) + pageItems.indexOf(item) + 1, { styleVariant: "mini" })).join("")}
      </div>
    </section>
  `;
};

const createMosaicLayout = ({ pageItems, pageIndex, itemsPerPage }) => {
  const orderedItems = [...pageItems];

  return `
    <section class="book-spread book-spread-mosaic">
      ${orderedItems.slice(0, Math.min(orderedItems.length, 6)).map((item, index) => createEntryCard(item, ((pageIndex - 2) * itemsPerPage) + pageItems.indexOf(item) + 1, {
        cardRole: index === 0 ? "featured" : (index < 3 ? "secondary" : "standard"),
        styleVariant: index === 0 ? "hero" : (index < 3 ? "panel" : "compact"),
      })).join("")}
      ${orderedItems.slice(6).map((item) => createEntryCard(item, ((pageIndex - 2) * itemsPerPage) + pageItems.indexOf(item) + 1, { styleVariant: "mini" })).join("")}
    </section>
  `;
};

const createContentPage = ({ pageIndex, pageItems, itemsPerPage, totalPages }) => {
  const variant = pageVariantForIndex(pageIndex, itemsPerPage);
  const tone = pageToneForItems(pageItems);
  const pageTitle = pageTitleForItems(pageItems);
  const pageDek = pageDekForItems(pageItems);
  const pageSummary = summarizePageItems(pageItems);
  const dateRangeLabel = pageDateRangeLabel(pageItems);

  const spreadMarkup = variant === "variant-feature"
    ? createFeatureLayout({ pageItems, pageIndex, itemsPerPage })
    : variant === "variant-journal"
      ? createJournalLayout({ pageItems, pageIndex, itemsPerPage })
      : variant === "variant-film"
        ? createFilmLayout({ pageItems, pageIndex, itemsPerPage })
        : createMosaicLayout({ pageItems, pageIndex, itemsPerPage });

  return `
  <article class="book-page ${variant} density-${itemsPerPage} tone-${tone}">
    <header class="book-page-header">
      <div class="book-page-title-wrap">
        <p class="book-page-pretitle">Road Trip Timeline • Page ${pageIndex} of ${totalPages}</p>
        <h2 class="book-page-title">${escapeHtml(pageTitle)}</h2>
        <div class="book-page-dek">${escapeHtml(pageDek)}</div>
      </div>
      <div>
        <p class="book-page-count">${escapeHtml(dateRangeLabel)}</p>
        <p class="book-page-summary">${escapeHtml(pageSummary)}</p>
      </div>
    </header>
    ${spreadMarkup}
    <div class="book-footer">${pageIndex}</div>
  </article>
`;
};

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
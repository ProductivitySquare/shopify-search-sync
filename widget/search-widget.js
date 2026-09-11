/**
 * HabitatVita instant search widget
 * -----------------------------------------------------------------
 * Self-contained, no build step, no framework. Queries Algolia directly
 * from the browser using a SEARCH-ONLY key (never the admin key — that
 * one must stay server-side only, inside the sync-service).
 *
 * Usage: drop this file as a theme asset (assets/hv-search-widget.js)
 * and add near the end of theme.liquid, before </body>:
 *
 *   <script
 *     src="{{ 'hv-search-widget.js' | asset_url }}"
 *     defer
 *     data-algolia-app-id="NTC7X15L5E"
 *     data-algolia-search-key="YOUR_SEARCH_ONLY_KEY"
 *     data-index="products"
 *     data-trigger-selector="#hv-search-trigger"
 *   ></script>
 *
 * Then anywhere in your theme, add a trigger element:
 *   <button id="hv-search-trigger" aria-label="Search">Search</button>
 *
 * Clicking it opens the overlay. See widget/theme-snippet.liquid for
 * a copy-pasteable example that mirrors this file's expected markup.
 */
(function () {
  "use strict";

  var scriptTag = document.currentScript;
  var config = {
    appId: scriptTag.dataset.algoliaAppId,
    searchKey: scriptTag.dataset.algoliaSearchKey,
    index: scriptTag.dataset.index || "products",
    triggerSelector: scriptTag.dataset.triggerSelector || "#hv-search-trigger",
    minChars: 2,
    debounceMs: 120,
    maxResults: 8,
  };

  if (!config.appId || !config.searchKey) {
    console.error(
      "[hv-search] Missing data-algolia-app-id or data-algolia-search-key on the script tag."
    );
    return;
  }

  var STYLE_ID = "hv-search-style";
  var CSS =
    "@import url('https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;600;700&display=swap');" +
    ".hv-search-overlay{position:fixed;inset:0;background:rgba(49,54,70,.55);z-index:9999;display:none;align-items:flex-start;justify-content:center;padding:8vh 16px}" +
    ".hv-search-overlay.hv-open{display:flex}" +
    ".hv-search-panel{background:#fff;width:100%;max-width:720px;border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden;font-family:'Comfortaa',sans-serif}" +
    ".hv-search-input-row{display:flex;align-items:center;border-bottom:1px solid #e7e7ea;padding:14px 18px;gap:10px}" +
    ".hv-search-input-row input{flex:1;border:none;outline:none;font-size:16px;font-family:inherit;color:#313646}" +
    ".hv-search-input-row svg{flex:none;color:#0080c6}" +
    ".hv-search-close{cursor:pointer;color:#313646;opacity:.6;border:none;background:none;font-size:18px;line-height:1}" +
    ".hv-search-close:hover{opacity:1}" +
    ".hv-search-results{max-height:60vh;overflow-y:auto;padding:8px}" +
    ".hv-search-item{display:flex;align-items:center;gap:12px;padding:10px 10px;border-radius:8px;text-decoration:none;color:inherit}" +
    ".hv-search-item:hover{background:#f4f6f8}" +
    ".hv-search-item img{width:48px;height:48px;object-fit:cover;border-radius:6px;background:#eee;flex:none}" +
    ".hv-search-item-title{font-size:14px;color:#313646;font-weight:600;margin:0 0 2px}" +
    ".hv-search-item-price{font-size:13px;color:#0080c6;font-weight:700}" +
    ".hv-search-empty,.hv-search-hint{padding:24px 18px;color:#818699;font-size:14px;text-align:center}" +
    ".hv-search-loading{padding:24px 18px;text-align:center;color:#818699;font-size:14px}";

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function formatPrice(price, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "EUR",
      }).format(price);
    } catch (e) {
      return price + " " + (currency || "");
    }
  }

  function buildOverlay() {
    var input = el("input", {
      type: "text",
      placeholder: "Search products...",
      autocomplete: "off",
    });
    var closeBtn = el("button", { class: "hv-search-close", type: "button" }, [
      "✕",
    ]);
    var resultsBox = el("div", { class: "hv-search-results" });
    resultsBox.appendChild(
      el("div", { class: "hv-search-hint" }, ["Start typing to search products"])
    );

    var searchIcon =
      '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    var iconWrap = el("span", {});
    iconWrap.innerHTML = searchIcon;

    var inputRow = el("div", { class: "hv-search-input-row" }, [
      iconWrap,
      input,
      closeBtn,
    ]);
    var panel = el("div", { class: "hv-search-panel" }, [inputRow, resultsBox]);
    var overlay = el("div", { class: "hv-search-overlay" }, [panel]);

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    var debounceTimer = null;
    input.addEventListener("input", function () {
      var q = input.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < config.minChars) {
        renderHint(resultsBox);
        return;
      }
      renderLoading(resultsBox);
      debounceTimer = setTimeout(function () {
        runSearch(q, resultsBox);
      }, config.debounceMs);
    });

    document.body.appendChild(overlay);

    function open() {
      // A pending debounce/fetch from a *previous* time the overlay was
      // open can otherwise land after reopen and paint stale results
      // over an input the user sees as empty.
      clearTimeout(debounceTimer);
      if (activeController) activeController.abort();
      overlay.classList.add("hv-open");
      input.value = "";
      renderHint(resultsBox);
      setTimeout(function () {
        input.focus();
      }, 30);
    }
    function close() {
      clearTimeout(debounceTimer);
      if (activeController) activeController.abort();
      overlay.classList.remove("hv-open");
    }

    return { open: open, close: close };
  }

  function renderHint(box) {
    box.innerHTML = "";
    box.appendChild(
      el("div", { class: "hv-search-hint" }, ["Start typing to search products"])
    );
  }

  function renderLoading(box) {
    box.innerHTML = "";
    box.appendChild(el("div", { class: "hv-search-loading" }, ["Searching..."]));
  }

  function renderEmpty(box) {
    box.innerHTML = "";
    box.appendChild(el("div", { class: "hv-search-empty" }, ["No products found"]));
  }

  function renderResults(box, hits) {
    box.innerHTML = "";
    if (!hits.length) {
      renderEmpty(box);
      return;
    }
    hits.forEach(function (hit) {
      var img = el("img", {
        src: hit.imageUrl || "",
        alt: hit.title,
        loading: "lazy",
      });
      var text = el("div", {}, [
        el("p", { class: "hv-search-item-title" }, [hit.title]),
        el("span", { class: "hv-search-item-price" }, [
          formatPrice(hit.price, hit.currency),
        ]),
      ]);
      var item = el("a", { class: "hv-search-item", href: hit.url }, [img, text]);
      box.appendChild(item);
    });
  }

  var activeController = null;
  function runSearch(query, box) {
    if (activeController) activeController.abort();
    activeController = new AbortController();

    // Algolia's dedicated search-only DSN endpoint. Query params go inside
    // a URL-encoded `params` string per Algolia's REST API convention.
    var url =
      "https://" +
      config.appId +
      "-dsn.algolia.net/1/indexes/" +
      encodeURIComponent(config.index) +
      "/query";

    var params =
      "hitsPerPage=" +
      config.maxResults +
      "&filters=" +
      encodeURIComponent("available:true");

    fetch(url, {
      method: "POST",
      signal: activeController.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Algolia-Application-Id": config.appId,
        "X-Algolia-API-Key": config.searchKey,
      },
      body: JSON.stringify({ query: query, params: params }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error("Search request failed: " + res.status);
        return res.json();
      })
      .then(function (data) {
        renderResults(box, data.hits || []);
      })
      .catch(function (err) {
        if (err.name === "AbortError") return;
        console.error("[hv-search]", err);
        box.innerHTML = "";
        box.appendChild(
          el("div", { class: "hv-search-empty" }, ["Search is temporarily unavailable"])
        );
      });
  }

  function init() {
    injectStyle();
    var overlayCtl = buildOverlay();
    var triggers = document.querySelectorAll(config.triggerSelector);
    triggers.forEach(function (trigger) {
      trigger.addEventListener("click", function (e) {
        e.preventDefault();
        overlayCtl.open();
      });
    });
    window.HVSearch = { open: overlayCtl.open, close: overlayCtl.close };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

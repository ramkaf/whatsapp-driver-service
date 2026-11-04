(function () {
  "use strict";

  const MIN_SCALE = 0.25;
  const MAX_SCALE = 8;
  const ZOOM_STEP = 1.2;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatScale(scale) {
    return `${Math.round(scale * 100)}%`;
  }

  function createButton(label, iconClass, className) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `uml-viewer__button ${className || ""}`.trim();
    button.setAttribute("aria-label", label);
    button.title = label;
    const icon = document.createElement("i");
    icon.className = `fa-solid ${iconClass}`;
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    return button;
  }

  function initViewer(image) {
    if (image.dataset.umlViewer === "true") return;
    image.dataset.umlViewer = "true";

    const wrapper = document.createElement("div");
    wrapper.className = "uml-viewer";
    wrapper.setAttribute("data-uml-viewer", "true");

    const toolbar = document.createElement("div");
    toolbar.className = "uml-viewer__toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "ابزارهای نمودار");

    const zoomOut = createButton("کوچک‌نمایی", "fa-magnifying-glass-minus", "uml-viewer__button--icon");
    const zoomLabel = document.createElement("span");
    zoomLabel.className = "uml-viewer__scale";
    zoomLabel.setAttribute("aria-live", "polite");
    const zoomIn = createButton("بزرگ‌نمایی", "fa-magnifying-glass-plus", "uml-viewer__button--icon");
    const fit = createButton("تنظیم اندازه نمودار", "fa-expand", "uml-viewer__button--icon");
    const reset = createButton("بازنشانی نمودار", "fa-rotate-left", "uml-viewer__button--icon");
    const fullscreen = createButton(
      "نمایش تمام‌صفحه",
      "fa-up-right-and-down-left-from-center",
      "uml-viewer__button--icon uml-viewer__fullscreen",
    );

    toolbar.append(zoomOut, zoomLabel, zoomIn, fit, reset, fullscreen);

    const viewport = document.createElement("div");
    viewport.className = "uml-viewer__viewport";
    viewport.setAttribute("role", "application");
    viewport.setAttribute("aria-label", "برای جابه‌جایی نمودار بکشید و برای زوم، چرخ ماوس را حرکت دهید");

    const state = {
      scale: 1,
      x: 0,
      y: 0,
      baseWidth: 0,
      baseHeight: 0,
      pointers: new Map(),
      pinchDistance: 0,
      pinchScale: 1,
    };

    function updateTransform() {
      image.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
      zoomLabel.textContent = formatScale(state.scale);
    }

    function setScale(nextScale, centerX, centerY) {
      const previousScale = state.scale;
      const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);

      if (centerX !== undefined && centerY !== undefined) {
        state.x = centerX - (centerX - state.x) * (scale / previousScale);
        state.y = centerY - (centerY - state.y) * (scale / previousScale);
      }

      state.scale = scale;
      updateTransform();
    }

    function fitToViewport() {
      if (!state.baseWidth || !state.baseHeight) return;

      const availableWidth = Math.max(viewport.clientWidth - 24, 1);
      const availableHeight = Math.max(viewport.clientHeight - 24, 1);
      state.scale = clamp(
        Math.min(1, availableWidth / state.baseWidth, availableHeight / state.baseHeight),
        MIN_SCALE,
        1,
      );
      state.x = Math.max((viewport.clientWidth - state.baseWidth * state.scale) / 2, 0);
      state.y = Math.max((viewport.clientHeight - state.baseHeight * state.scale) / 2, 0);
      updateTransform();
    }

    function resetView() {
      state.scale = 1;
      state.x = 0;
      state.y = 0;
      updateTransform();
    }

    function zoomAtPoint(factor, clientX, clientY) {
      const rect = viewport.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      setScale(state.scale * factor, x, y);
    }

    function updateImageSize() {
      state.baseWidth = image.naturalWidth || image.width;
      state.baseHeight = image.naturalHeight || image.height;
      image.style.width = `${state.baseWidth}px`;
      image.style.height = `${state.baseHeight}px`;
      fitToViewport();
    }

    zoomIn.addEventListener("click", () => setScale(state.scale * ZOOM_STEP));
    zoomOut.addEventListener("click", () => setScale(state.scale / ZOOM_STEP));
    fit.addEventListener("click", fitToViewport);
    reset.addEventListener("click", resetView);
    fullscreen.addEventListener("click", () => {
      if (document.fullscreenElement === wrapper) {
        document.exitFullscreen();
      } else if (wrapper.requestFullscreen) {
        wrapper.requestFullscreen();
      }
    });

    viewport.addEventListener("wheel", (event) => {
      event.preventDefault();
      zoomAtPoint(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, event.clientX, event.clientY);
    }, { passive: false });

    viewport.addEventListener("pointerdown", (event) => {
      viewport.setPointerCapture(event.pointerId);
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (state.pointers.size === 2) {
        const points = [...state.pointers.values()];
        state.pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        state.pinchScale = state.scale;
      }
    });

    viewport.addEventListener("pointermove", (event) => {
      if (!state.pointers.has(event.pointerId)) return;

      const previous = state.pointers.get(event.pointerId);
      state.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (state.pointers.size === 2) {
        const points = [...state.pointers.values()];
        const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        if (state.pinchDistance) {
          const rect = viewport.getBoundingClientRect();
          const centerX = (points[0].x + points[1].x) / 2 - rect.left;
          const centerY = (points[0].y + points[1].y) / 2 - rect.top;
          setScale(state.pinchScale * (distance / state.pinchDistance), centerX, centerY);
        }
        return;
      }

      state.x += event.clientX - previous.x;
      state.y += event.clientY - previous.y;
      updateTransform();
    });

    function releasePointer(event) {
      state.pointers.delete(event.pointerId);
      if (state.pointers.size < 2) state.pinchDistance = 0;
    }

    viewport.addEventListener("pointerup", releasePointer);
    viewport.addEventListener("pointercancel", releasePointer);
    viewport.addEventListener("dblclick", (event) => zoomAtPoint(state.scale > 1 ? 1 / ZOOM_STEP : ZOOM_STEP, event.clientX, event.clientY));
    image.addEventListener("dragstart", (event) => event.preventDefault());
    image.addEventListener("load", updateImageSize, { once: true });
    document.addEventListener("fullscreenchange", () => {
      const isFullscreen = document.fullscreenElement === wrapper;
      fullscreen.querySelector("i").className = `fa-solid ${isFullscreen ? "fa-compress" : "fa-up-right-and-down-left-from-center"}`;
      fullscreen.setAttribute("aria-label", isFullscreen ? "خروج از تمام‌صفحه" : "نمایش تمام‌صفحه");
      fullscreen.title = isFullscreen ? "خروج از تمام‌صفحه" : "نمایش تمام‌صفحه";
      if (isFullscreen) requestAnimationFrame(fitToViewport);
    });

    const parent = image.parentElement;
    const isImageOnlyParagraph = parent
      && parent.tagName === "P"
      && parent.children.length === 1
      && parent.textContent.trim() === "";

    if (isImageOnlyParagraph) {
      parent.replaceWith(wrapper);
    } else {
      image.replaceWith(wrapper);
    }

    wrapper.append(toolbar, viewport);
    viewport.append(image);

    if (image.complete) updateImageSize();
  }

  function initialize() {
    document.querySelectorAll("img.uml").forEach(initViewer);
  }

  if (window.document$ && typeof window.document$.subscribe === "function") {
    window.document$.subscribe(initialize);
  } else {
    document.addEventListener("DOMContentLoaded", initialize);
  }
})();

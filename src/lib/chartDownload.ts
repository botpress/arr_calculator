function sanitizeFilename(value: string) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "chart";
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function svgDimensions(svg: SVGSVGElement) {
  const viewBox = svg.viewBox?.baseVal;
  const widthAttr = Number(svg.getAttribute("width") || "");
  const heightAttr = Number(svg.getAttribute("height") || "");
  const width = (viewBox?.width && Number.isFinite(viewBox.width) ? viewBox.width : 0) || widthAttr || svg.clientWidth || 1200;
  const height = (viewBox?.height && Number.isFinite(viewBox.height) ? viewBox.height : 0) || heightAttr || svg.clientHeight || 700;
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

function resolveChartBackground(svg: SVGSVGElement) {
  let current: Element | null = svg;
  while (current) {
    const bg = window.getComputedStyle(current).backgroundColor;
    if (bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") {
      return bg;
    }
    current = current.parentElement;
  }
  return "#f8f7f4";
}

function ensureRootMetadata(clone: SVGSVGElement, width: number, height: number) {
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  if (!clone.getAttribute("viewBox")) {
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }
}

function prependBackgroundRect(clone: SVGSVGElement, width: number, height: number, fill: string) {
  const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bgRect.setAttribute("x", "0");
  bgRect.setAttribute("y", "0");
  bgRect.setAttribute("width", String(width));
  bgRect.setAttribute("height", String(height));
  bgRect.setAttribute("fill", fill);
  bgRect.setAttribute("pointer-events", "none");
  clone.insertBefore(bgRect, clone.firstChild);
}

function applyNativeTooltips(clone: SVGSVGElement) {
  const elements = clone.querySelectorAll<SVGElement>("[data-tooltip]");
  for (const element of elements) {
    const raw = element.getAttribute("data-tooltip");
    const tooltip = String(raw || "").trim();
    if (!tooltip) continue;
    if (element.querySelector("title")) continue;
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = tooltip;
    element.prepend(title);
  }
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadSvgAsPng(svg: SVGSVGElement, filenamePrefix: string) {
  const { width, height } = svgDimensions(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  ensureRootMetadata(clone, width, height);
  prependBackgroundRect(clone, width, height, resolveChartBackground(svg));
  applyNativeTooltips(clone);

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  triggerDownload(`${sanitizeFilename(filenamePrefix)}-${timestamp()}.svg`, svgBlob);
}

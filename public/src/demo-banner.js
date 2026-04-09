const VIDEO_URL = "https://www.youtube.com/watch?v=14Lr4sbx_LU";
let bannerRegion = null;

function dismissBanner(region) {
  region.remove();
  if (bannerRegion === region) {
    bannerRegion = null;
  }
}

function updateBannerOffset() {
  if (!bannerRegion) return;

  const topbar = document.querySelector(".topbar");
  if (!topbar) return;

  const nextTop = Math.ceil(topbar.getBoundingClientRect().bottom + 12);
  bannerRegion.style.setProperty("--demo-banner-top", `${nextTop}px`);
}

function createBanner() {
  const region = document.createElement("div");
  region.className = "demo-banner-region";

  const banner = document.createElement("div");
  banner.className = "demo-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const text = document.createElement("div");
  text.className = "demo-banner__text";
  text.append("See Insight in action. ");

  const link = document.createElement("a");
  link.className = "demo-banner__link";
  link.href = VIDEO_URL;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "Watch the demo";
  text.append(link);

  const closeButton = document.createElement("button");
  closeButton.className = "demo-banner__close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Dismiss demo video banner");
  closeButton.textContent = "x";
  closeButton.addEventListener("click", () => dismissBanner(region));

  banner.append(text, closeButton);
  region.append(banner);
  document.body.append(region);
  bannerRegion = region;
  updateBannerOffset();
}

createBanner();
window.addEventListener("resize", updateBannerOffset);
window.addEventListener("topbar:ready", updateBannerOffset);

import { examples } from "./examples";

interface Example {
  title: string;
  path: string;
}

class IdetikNavigation {
  private navigation_: HTMLElement;
  private navTitle_: HTMLElement;
  private toggle_: HTMLButtonElement;
  private close_: HTMLButtonElement;
  private examplesList_: HTMLElement;
  private iframe_: HTMLIFrameElement;
  private examples_: Example[] = examples.map(({ id, title }) => ({
    title,
    path: `${id}/`,
  }));

  constructor() {
    this.navigation_ = document.getElementById("idetik-navigation")!;
    this.navTitle_ = document.getElementById("nav-title")!;
    this.toggle_ = document.getElementById("nav-toggle")! as HTMLButtonElement;
    this.close_ = document.getElementById("nav-close")! as HTMLButtonElement;
    this.examplesList_ = document.getElementById("examples-list")!;
    this.iframe_ = document.getElementById(
      "example-frame"
    )! as HTMLIFrameElement;

    this.initializeEventListeners();
    this.renderExamples();
    this.handleRouteChange();
  }

  private initializeEventListeners(): void {
    this.toggle_.addEventListener("click", () => this.openMenu());
    this.close_.addEventListener("click", () => this.closeMenu());

    document.addEventListener("click", (e) => {
      if (!this.navigation_.contains(e.target as Node)) {
        this.closeMenu();
      }
    });

    window.addEventListener("hashchange", () => this.handleRouteChange());
  }

  private renderExamples(): void {
    if (this.examples_.length === 0) {
      this.examplesList_.innerHTML =
        '<div class="nav-empty">No examples found</div>';
      return;
    }

    this.examplesList_.innerHTML = this.examples_
      .map(
        (example) => `
        <div class="nav-item" data-path="${example.path}">
          <div class="nav-title">${example.title}</div>
        </div>
      `
      )
      .join("");

    this.examplesList_.querySelectorAll(".nav-item").forEach((item) => {
      item.addEventListener("click", () => {
        const path = (item as HTMLElement).dataset.path!;
        this.navigateToExample(path);
        this.closeMenu();
      });
    });
  }

  private navigateToExample(path: string): void {
    window.location.hash = "#" + path;
  }

  private handleRouteChange(): void {
    const hash = window.location.hash.slice(1);
    if (hash) {
      this.loadExample(hash);
    } else {
      // Load first example by default
      if (this.examples_.length > 0) {
        this.navigateToExample(this.examples_[0].path);
      } else {
        this.iframe_.src = "about:blank";
      }
    }
  }

  private loadExample(path: string): void {
    const container = this.iframe_.parentElement!;
    const oldIframe = this.iframe_;
    const validExample = this.examples_.find((ex) => ex.path === path);
    const safePath = validExample
      ? validExample.path
      : this.examples_[0]?.path || "about:blank";

    // replace iframe instead of changing src to avoid history pollution
    const newIframe = document.createElement("iframe");
    newIframe.id = "example-frame";
    newIframe.src = safePath;
    newIframe.style.width = "100%";
    newIframe.style.height = "100%";
    newIframe.style.border = "none";
    newIframe.style.background = "white";

    container.replaceChild(newIframe, oldIframe);
    this.iframe_ = newIframe;

    this.examplesList_.querySelectorAll(".nav-item").forEach((item) => {
      item.classList.toggle(
        "active",
        (item as HTMLElement).dataset.path === safePath
      );
    });

    if (validExample) {
      document.title = `${validExample.title} - Idetik Examples`;
      this.navTitle_.textContent = document.title;
    }
  }

  private openMenu(): void {
    this.navigation_.classList.add("open");
  }

  private closeMenu(): void {
    this.navigation_.classList.remove("open");
  }
}

// Initialize navigation when DOM is ready, but only if navigation elements exist
function initializeNavigationIfPresent() {
  const navigationElement = document.getElementById("idetik-navigation");
  if (navigationElement) {
    new IdetikNavigation();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeNavigationIfPresent);
} else {
  initializeNavigationIfPresent();
}

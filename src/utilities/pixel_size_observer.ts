import { Logger } from "./logger";

// Observes changes to the pixel size of HTML elements, including changes due to
// window/device pixel ratio changes.
export class PixelSizeObserver {
  private elements_: HTMLElement[];
  private resizeObserver_?: ResizeObserver;
  private mediaQuery_?: MediaQueryList;
  private onMediaQueryChange_?: () => void;
  private onChange_: () => void;

  constructor(elements: ReadonlyArray<HTMLElement> = [], onChange: () => void) {
    this.elements_ = [...elements];
    this.onChange_ = onChange;
  }

  public connect() {
    if (this.resizeObserver_) {
      Logger.warn(
        "PixelSizeObserver",
        "Attempted to connect already connected observer"
      );
      return;
    }

    this.resizeObserver_ = new ResizeObserver(() => {
      this.onChange_();
    });

    for (const element of this.elements_) {
      this.resizeObserver_.observe(element);
    }

    this.startDevicePixelRatioObserver();
  }

  private startDevicePixelRatioObserver() {
    // this media query needs to be updated after a change is detected, so we use a one-time
    // event listener that re-registers itself with the new value
    // https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio#monitoring_screen_resolution_or_zoom_level_changes
    this.mediaQuery_ = matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`
    );
    this.onMediaQueryChange_ = () => {
      this.onChange_();
      this.startDevicePixelRatioObserver();
    };
    this.mediaQuery_.addEventListener("change", this.onMediaQueryChange_, {
      once: true,
    });
  }

  public disconnect() {
    if (!this.resizeObserver_) {
      Logger.warn(
        "PixelSizeObserver",
        "Attempted to disconnect already disconnected observer"
      );
      return;
    }
    this.resizeObserver_.disconnect();
    this.resizeObserver_ = undefined;
    if (this.mediaQuery_ && this.onMediaQueryChange_) {
      this.mediaQuery_.removeEventListener("change", this.onMediaQueryChange_);
    }
    this.mediaQuery_ = undefined;
    this.onMediaQueryChange_ = undefined;
  }

  public observe(element: HTMLElement) {
    if (this.elements_.includes(element)) {
      Logger.warn("PixelSizeObserver", "Element already being observed");
      return;
    }
    this.elements_.push(element);
    if (this.resizeObserver_) {
      this.resizeObserver_.observe(element);
    }
  }

  public unobserve(element: HTMLElement) {
    const index = this.elements_.indexOf(element);
    if (index === -1) {
      Logger.warn("PixelSizeObserver", "Element not being observed");
      return;
    }
    this.elements_.splice(index, 1);
    if (this.resizeObserver_) {
      this.resizeObserver_.unobserve(element);
    }
  }
}

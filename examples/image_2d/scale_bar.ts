import { Idetik, OrthographicCamera } from "@idetik/core";

type ScaleBarProps = {
  boxDiv: HTMLDivElement;
  textDiv: HTMLDivElement;
  lineDiv: HTMLDivElement;
  unit?: string;
};

export class ScaleBar {
  private boxDiv_: HTMLDivElement;
  private textDiv_: HTMLDivElement;
  private lineDiv_: HTMLDivElement;
  private unit_: string;

  constructor(props: ScaleBarProps) {
    this.boxDiv_ = props.boxDiv;
    this.textDiv_ = props.textDiv;
    this.lineDiv_ = props.lineDiv;
    this.unit_ = props.unit ?? "";
  }

  public update(idetik: Idetik, _timestamp?: DOMHighResTimeStamp): void {
    const viewport = idetik.viewports[0];
    const camera = viewport.camera;

    const isOrthographic = camera.type === "OrthographicCamera";
    this.boxDiv_.style.display = isOrthographic ? "" : "none";
    if (!isOrthographic) return;

    const orthoCamera = camera as OrthographicCamera;

    const cameraWidthWorld =
      orthoCamera.transform.scale[0] * orthoCamera.viewportSize[0];
    const unitPerCanvasPixel = cameraWidthWorld / idetik.canvas.clientWidth;

    // The use of clientWidth assumes that the lineDiv has no padding,
    // which is true in this example. If similar code is used elsewhere,
    // the lack of padding should be asserted and or enforced.
    const lineWidthWorld = this.lineDiv_.clientWidth * unitPerCanvasPixel;

    this.textDiv_.textContent = `${lineWidthWorld.toFixed(2)} ${this.unit_}`;
  }
}

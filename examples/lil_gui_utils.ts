import { SliceCoordinates } from "@idetik/core";
import { Controller, GUI } from "lil-gui";

type DimensionSliderProps = {
  gui: GUI;
  sliceCoords: SliceCoordinates;
  dimensionName: "x" | "y" | "z" | "t";
  minValue: number;
  maxValue: number;
  stepValue: number;
  playback?: {
    maxRateHz?: number;
    stride?: number;
    onRateChange?: (rateHz: number) => void;
  };
};

export function addDimensionSlider(props: DimensionSliderProps) {
  const controller = props.gui
    .add(
      props.sliceCoords,
      props.dimensionName,
      props.minValue,
      props.maxValue,
      props.stepValue
    )
    .name(`${props.dimensionName}-coord`);

  if (props.playback) {
    const playbackController = new PlaybackController({
      controller,
      start: props.minValue,
      stop: props.maxValue,
      step: props.stepValue * (props.playback.stride ?? 1),
    });
    const maxRateHz = props.playback.maxRateHz ?? 30;
    props.gui
      .add(playbackController, "rateHz", 0, maxRateHz, 1)
      .name(`${props.dimensionName}-playback rate (Hz)`)
      .onChange((rateHz: number) => {
        props.playback?.onRateChange?.(rateHz);
      });
  }
}

type PlaybackControllerProps = {
  controller: Controller;
  start: number;
  stop: number;
  step: number;
};

class PlaybackController {
  private readonly controller_: Controller;
  private readonly start_: number;
  private readonly stop_: number;
  private readonly step_: number;
  private rateHz_: number;
  private intervalId_?: number;

  constructor(props: PlaybackControllerProps) {
    this.controller_ = props.controller;
    this.rateHz_ = 0;
    this.start_ = props.start;
    this.stop_ = props.stop;
    this.step_ = props.step;
  }

  public get rateHz(): number {
    return this.rateHz_;
  }

  public set rateHz(rateHz: number) {
    if (rateHz < 0) {
      throw new Error(`Rate must be non-negative: ${rateHz}`);
    }
    if (rateHz !== this.rateHz_) {
      this.pause();
      this.rateHz_ = rateHz;
    }
    if (this.rateHz_ === 0) return;
    const intervalMs = 1000 / rateHz;
    this.intervalId_ = window.setInterval(() => {
      this.incrementTime();
    }, intervalMs);
  }

  private pause() {
    if (this.intervalId_ === undefined) return;
    window.clearInterval(this.intervalId_);
    this.intervalId_ = undefined;
  }

  private incrementTime = () => {
    const newValue = this.controller_.getValue() + this.step_;
    if (newValue <= this.stop_) {
      this.controller_.setValue(newValue);
    } else {
      this.controller_.setValue(this.start_);
    }
  };
}

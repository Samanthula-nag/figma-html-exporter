/** Serial, debounced sync; edits arriving during a run schedule one more run. */
export class LiveSync {
  private timer?: ReturnType<typeof setTimeout>;
  private enabled = true;
  private generation = 0;
  constructor(
    private busy: () => boolean,
    private refresh: (current: () => boolean) => Promise<void>,
    private delay = 650,
  ) {}
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    this.generation++;
    clearTimeout(this.timer);
    if (enabled) this.changed();
  }
  changed() {
    if (!this.enabled) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), this.delay);
  }
  private async run() {
    if (!this.enabled) return;
    if (this.busy()) {
      this.changed();
      return;
    }
    const generation = this.generation;
    await this.refresh(() => this.enabled && generation === this.generation);
  }
  stop() {
    this.enabled = false;
    this.generation++;
    clearTimeout(this.timer);
  }
}

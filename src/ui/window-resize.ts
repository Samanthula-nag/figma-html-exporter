import { windowSize, WINDOW_LIMITS } from "../plugin/window-controls";
export function installWindowResize(send: (message: unknown) => void) {
  const old = document.getElementById("window-resize")!;
  let active = false,
    sequence = 0;
  const handles: HTMLButtonElement[] = [];
  const directions = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  const names = [
    "top",
    "bottom",
    "right",
    "left",
    "top right",
    "top left",
    "bottom right",
    "bottom left",
  ];
  const style = document.createElement("style");
  style.textContent = `
    .window-edge, #window-resize.window-edge { position:fixed; z-index:1001; margin:0; padding:0; border:0; border-radius:0; background:transparent; color:#496dcc; touch-action:none; user-select:none; min-width:0; min-height:0; }
    .window-edge span { opacity:0; pointer-events:none; position:absolute; font:14px Arial; background:#eef2ff; border-radius:4px; transition:opacity .12s; }
    .window-edge:hover span, .window-edge:focus-visible span { opacity:.85; }
    .window-edge:focus-visible { outline:2px solid #496dcc; outline-offset:-2px; }
    .window-edge[data-direction=n], .window-edge[data-direction=s] { left:16px; right:16px; height:5px; width:auto; cursor:ns-resize; }
    .window-edge[data-direction=n] { top:0; bottom:auto; }
    .window-edge[data-direction=s] { bottom:0; top:auto; }
    .window-edge[data-direction=n] span { top:0; left:50%; }
    .window-edge[data-direction=s] span { bottom:0; left:50%; }
    .window-edge[data-direction=e], .window-edge[data-direction=w] { top:16px; bottom:16px; width:5px; height:auto; cursor:ew-resize; }
    .window-edge[data-direction=e] { right:0; left:auto; }
    .window-edge[data-direction=w] { left:0; right:auto; }
    .window-edge[data-direction=e] span { right:0; top:50%; }
    .window-edge[data-direction=w] span { left:0; top:50%; }
    .window-edge[data-direction=ne], .window-edge[data-direction=nw], #window-resize.window-edge, .window-edge[data-direction=sw] { width:14px; height:14px; }
    .window-edge[data-direction=ne] { top:0; right:0; cursor:nesw-resize; }
    .window-edge[data-direction=nw] { top:0; left:0; cursor:nwse-resize; }
    #window-resize.window-edge { bottom:0; right:0; cursor:nwse-resize; }
    .window-edge[data-direction=sw] { bottom:0; left:0; cursor:nesw-resize; }
    .window-edge[data-direction=ne] span, .window-edge[data-direction=nw] span, .window-edge[data-direction=se] span, .window-edge[data-direction=sw] span { inset:0; }
    #window-move { margin-left:auto; flex-shrink:0; cursor:move; touch-action:none; padding:3px 8px; background:transparent; color:inherit; border-color:#607089; }
  `;
  document.head.append(style);
  const move = document.createElement("button");
  move.id = "window-move";
  move.textContent = "✥";
  move.hidden = true;
  move.title = "Drag to move plugin window";
  move.setAttribute("aria-label", "Move plugin window");
  document.querySelector("header")!.append(move);
  function attach(handle: HTMLButtonElement, direction: string) {
    handle.onpointerdown = (event) => {
      if (event.button !== 0 || active) return;
      event.preventDefault();
      active = true;
      const id = ++sequence,
        x = event.screenX,
        y = event.screenY,
        width = innerWidth,
        height = innerHeight;
      const moving = direction === "move",
        west = direction.includes("w"),
        north = direction.includes("n");
      const shield = document.createElement("div");
      shield.id = "window-gesture-shield";
      shield.style.cssText = `position:fixed;inset:0;z-index:2147483647;touch-action:none;user-select:none;cursor:${getComputedStyle(handle).cursor}`;
      document.body.append(shield);
      handle.setPointerCapture(event.pointerId);
      send({ type: "window-gesture-start", id, width, height });
      let latest = { width, height, dx: 0, dy: 0 },
        raf = 0;
      const emit = () => {
        raf = 0;
        send({
          type: "window-gesture-update",
          id,
          ...latest,
          west,
          north,
          move: moving,
        });
      };
      const update = (e: PointerEvent) => {
        if (e.pointerId !== event.pointerId) return;
        const dx = e.screenX - x,
          dy = e.screenY - y;
        const maxWidth = Math.max(
          WINDOW_LIMITS.minWidth,
          Math.min(
            WINDOW_LIMITS.maxWidth,
            screen.availWidth || WINDOW_LIMITS.maxWidth,
          ),
        );
        const maxHeight = Math.max(
          WINDOW_LIMITS.minHeight,
          Math.min(WINDOW_LIMITS.maxHeight, (screen.availHeight || 1680) - 80),
        );
        const size = windowSize(
          moving || !(direction.includes("e") || west)
            ? width
            : Math.min(
                maxWidth,
                width + (direction.includes("e") ? dx : west ? -dx : 0),
              ),
          moving || !(direction.includes("s") || north)
            ? height
            : Math.min(
                maxHeight,
                height + (direction.includes("s") ? dy : north ? -dy : 0),
              ),
        );
        latest = { ...size, dx, dy };
        if (!raf) raf = requestAnimationFrame(emit);
      };
      const stop = (e?: PointerEvent) => {
        if (e && e.pointerId !== event.pointerId) return;
        if (!active) return;
        if (e?.type === "pointerup") update(e);
        if (raf) {
          cancelAnimationFrame(raf);
          emit();
        }
        active = false;
        handle.removeEventListener("pointermove", update);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        handle.removeEventListener("lostpointercapture", stop);
        window.removeEventListener("blur", blur);
        if (handle.hasPointerCapture(event.pointerId))
          handle.releasePointerCapture(event.pointerId);
        shield.remove();
        send({ type: "window-gesture-end", id });
      };
      const blur = () => stop();
      handle.addEventListener("pointermove", update);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
      handle.addEventListener("lostpointercapture", stop);
      window.addEventListener("blur", blur);
    };
    handle.onkeydown = (e) => {
      if (!e.key.startsWith("Arrow") || direction === "move") return;
      e.preventDefault();
      const step = e.shiftKey ? 100 : 20;
      const dx =
        e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
      const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
      const west = direction.includes("w"),
        north = direction.includes("n");
      const size = windowSize(
        innerWidth + (direction.includes("e") ? dx : west ? -dx : 0),
        innerHeight + (direction.includes("s") ? dy : north ? -dy : 0),
      );
      const id = ++sequence;
      send({
        type: "window-gesture-start",
        id,
        width: innerWidth,
        height: innerHeight,
      });
      send({ type: "window-gesture-update", id, ...size, dx, dy, west, north });
      send({ type: "window-gesture-end", id });
    };
  }
  directions.forEach((direction, i) => {
    const handle =
      direction === "se"
        ? (old as HTMLButtonElement)
        : document.createElement("button");
    handle.className = "window-edge";
    handle.dataset.direction = direction;
    handle.title = `Resize ${names[i]} · drag or use arrow keys`;
    handle.setAttribute("aria-label", `Resize window ${names[i]}`);
    handle.innerHTML = `<span aria-hidden="true">${direction.length === 1 ? ("ew".includes(direction) ? "↔" : "↕") : ["nw", "se"].includes(direction) ? "⤡" : "⤢"}</span>`;
    if (direction !== "se") document.body.append(handle);
    handles.push(handle);
    attach(handle, direction);
  });
  attach(move, "move");
  window.addEventListener("message", (event) => {
    const message = event.data?.pluginMessage;
    if (message?.type === "pong" && message.windowControls) {
      handles.forEach(
        (handle) => (handle.hidden = !message.windowControls.resize),
      );
      move.hidden = !message.windowControls.move;
    }
    if (message?.type === "window-control-error") {
      move.hidden = true;
      document.getElementById("status")!.textContent =
        "Window control unavailable: " + message.message;
    }
  });
}

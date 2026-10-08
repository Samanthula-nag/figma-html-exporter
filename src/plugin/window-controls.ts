export const WINDOW_LIMITS = {
  minWidth: 640,
  minHeight: 420,
  maxWidth: 2560,
  maxHeight: 1600,
};
export function windowSize(width: number, height: number) {
  return {
    width: Math.round(
      Math.max(WINDOW_LIMITS.minWidth, Math.min(WINDOW_LIMITS.maxWidth, width)),
    ),
    height: Math.round(
      Math.max(
        WINDOW_LIMITS.minHeight,
        Math.min(WINDOW_LIMITS.maxHeight, height),
      ),
    ),
  };
}
export function createWindowControls(api: UIAPI, zoom: () => number) {
  let gesture:
    | {
        id: number;
        width: number;
        height: number;
        position?: Vector;
        zoom: number;
      }
    | undefined;
  const capabilities = () => {
    let move = false;
    if (
      typeof api.reposition === "function" &&
      typeof api.getPosition === "function"
    ) {
      try {
        const p = api.getPosition().canvasSpace;
        move = Number.isFinite(p.x) && Number.isFinite(p.y);
      } catch {
        /* No movable outer UI in this host. */
      }
    }
    return { resize: typeof api.resize === "function", move };
  };
  const handle = (message: any): boolean => {
    if (
      !message ||
      ![
        "window-gesture-start",
        "window-gesture-update",
        "window-gesture-end",
      ].includes(message.type)
    )
      return false;
    if (!Number.isSafeInteger(message.id)) return true;
    if (message.type === "window-gesture-start") {
      if (![message.width, message.height].every(Number.isFinite)) return true;
      let position: Vector | undefined;
      try {
        if (capabilities().move) position = api.getPosition().canvasSpace;
      } catch {
        /* Host may not expose a position. */
      }
      gesture = {
        id: message.id,
        width: message.width,
        height: message.height,
        position,
        zoom: zoom() || 1,
      };
    } else if (gesture && gesture.id === message.id) {
      if (message.type === "window-gesture-end") {
        gesture = undefined;
        return true;
      }
      if (
        ![message.width, message.height, message.dx, message.dy].every(
          Number.isFinite,
        )
      )
        return true;
      const size = windowSize(message.width, message.height);
      try {
        if (!message.move && capabilities().resize)
          api.resize(size.width, size.height);
        if (gesture.position && capabilities().move) {
          const dx = message.move
            ? message.dx
            : message.west
              ? gesture.width - size.width
              : 0;
          const dy = message.move
            ? message.dy
            : message.north
              ? gesture.height - size.height
              : 0;
          if (dx || dy || message.move || message.west || message.north)
            api.reposition(
              gesture.position.x + dx / gesture.zoom,
              gesture.position.y + dy / gesture.zoom,
            );
        }
      } catch (error) {
        api.postMessage({
          type: "window-control-error",
          message: String(error),
        });
      }
    }
    return true;
  };
  return { handle, capabilities };
}

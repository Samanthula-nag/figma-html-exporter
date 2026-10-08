export interface EditorConfig {
  token: string;
  layers: Record<string, string>;
  selectedId?: string;
  selectedIds?: string[];
  prototype?: boolean;
  viewOnly?: boolean;
  focusCanvas?: boolean;
  textIds?: string[];
  rootClass?: string;
  scrollX?: number;
  scrollY?: number;
}
/** This function is serialized into an opaque-origin iframe. Keep it self-contained. */
export function editorRuntime(config: EditorConfig) {
  let selected: HTMLElement | null = null;
  let selection: HTMLElement[] = [];
  let space = false;
  addEventListener("keydown", (event) => {
    if (event.code === "Space" && !config.prototype) {
      event.preventDefault();
      space = true;
    }
  });
  addEventListener("keyup", (event) => {
    if (event.code === "Space") space = false;
  });
  addEventListener("blur", () => {
    space = false;
  });
  const handle = document.createElement("button");
  handle.textContent = "↘";
  handle.title = "Drag to resize";
  handle.style.cssText =
    "position:fixed;z-index:2147483647;width:18px;height:18px;padding:0;border:1px solid white;background:#365eea;color:white;cursor:nwse-resize;display:none;";
  document.body.appendChild(handle);
  const rotationHandle = handle.cloneNode(true) as HTMLButtonElement;
  rotationHandle.textContent = "↻";
  rotationHandle.title = "Drag to rotate; Shift snaps to 15 degrees";
  rotationHandle.style.cursor = "grab";
  rotationHandle.style.borderRadius = "50%";
  document.body.appendChild(rotationHandle);
  const idOf = (element: HTMLElement) =>
    Array.from(element.classList)
      .map((name) => config.layers[name])
      .find(Boolean);
  const send = (type: string, extra: Record<string, unknown> = {}) =>
    parent.postMessage(
      {
        exporterEditor: true,
        token: config.token,
        type,
        id: selected ? idOf(selected) : undefined,
        ids: selection.map(idOf),
        scrollX,
        scrollY,
        ...extra,
      },
      "*",
    );
  addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      send("zoom", {
        delta:
          event.deltaY *
          (event.deltaMode === 1
            ? 16
            : event.deltaMode === 2
              ? innerHeight
              : 1),
        x: event.clientX,
        y: event.clientY,
      });
    },
    { passive: false },
  );
  function placeHandle() {
    if (!selected) return;
    const rect = selected.getBoundingClientRect();
    handle.style.left = `${rect.right - 9}px`;
    handle.style.top = `${rect.bottom - 9}px`;
    rotationHandle.style.left = `${rect.left + rect.width / 2 - 9}px`;
    rotationHandle.style.top = `${rect.top - 28}px`;
  }
  addEventListener("message", (event) => {
    if (
      event.source === parent &&
      event.data?.token === config.token &&
      event.data?.type === "capture-viewport"
    )
      send("viewport");
  });
  addEventListener("message", (event) => {
    if (
      event.source !== parent ||
      event.data?.token !== config.token ||
      event.data?.type !== "set-viewport"
    )
      return;
    if (Number.isFinite(event.data.x) && Number.isFinite(event.data.y)) {
      scrollTo(event.data.x, event.data.y);
      send("viewport");
    }
  });
  // Track ordinary wheel/scrollbar scrolling, including view-only previews.
  addEventListener("scroll", () => send("viewport"), { passive: true });
  addEventListener("load", () => {
    scrollTo(config.scrollX ?? 0, config.scrollY ?? 0);
    send("viewport");
  });
  if (config.viewOnly) {
    handle.remove();
    rotationHandle.remove();
    return;
  }
  function selectMany(elements: HTMLElement[], user = true) {
    selection.forEach((element) => {
      element.style.outline = "";
    });
    selection = [...new Set(elements)];
    selected = selection[selection.length - 1] ?? null;
    selection.forEach((element) => {
      element.style.outline = "2px solid #365eea";
    });
    handle.style.display = selection.length === 1 ? "block" : "none";
    rotationHandle.style.display = selection.length === 1 ? "block" : "none";
    placeHandle();
    send("select", {
      user,
      width: selected?.offsetWidth,
      height: selected?.offsetHeight,
    });
  }
  if (config.prototype) {
    handle.remove();
    rotationHandle.remove();
    document.addEventListener("click", (event) => {
      const target = (event.target as HTMLElement).closest(
        "a, [data-history-back]",
      );
      if (!target) return;
      event.preventDefault();
      send(target.hasAttribute("data-history-back") ? "back" : "navigate", {
        href: target.getAttribute("href"),
      });
    });
    return;
  }
  rotationHandle.onpointerdown = (event) => {
    if (event.button !== 0 || !selected) return;
    event.preventDefault();
    event.stopPropagation();
    const target = selected,
      original = target.style.rotate,
      box = target.getBoundingClientRect();
    const cx = box.left + box.width / 2,
      cy = box.top + box.height / 2;
    const initial = Math.atan2(event.clientY - cy, event.clientX - cx);
    const base = parseFloat(getComputedStyle(target).rotate) || 0;
    let angle = base;
    send("editing-start");
    rotationHandle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => {
      const delta = Math.atan2(e.clientY - cy, e.clientX - cx) - initial;
      angle =
        base + (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
      angle = e.shiftKey
        ? Math.round(angle / 15) * 15
        : Math.round(angle * 10) / 10;
      target.style.rotate = angle + "deg";
      placeHandle();
    };
    const end = (e: PointerEvent) => {
      rotationHandle.removeEventListener("pointermove", move);
      rotationHandle.removeEventListener("pointerup", end);
      rotationHandle.removeEventListener("pointercancel", end);
      if (rotationHandle.hasPointerCapture(event.pointerId))
        rotationHandle.releasePointerCapture(event.pointerId);
      if (e.type === "pointercancel") target.style.rotate = original;
      else if (angle !== base) send("rotate", { angle });
      placeHandle();
    };
    rotationHandle.addEventListener("pointermove", move);
    rotationHandle.addEventListener("pointerup", end);
    rotationHandle.addEventListener("pointercancel", end);
  };
  document.addEventListener("dblclick", (event) => {
    let element = event.target as HTMLElement | null;
    while (element && !config.textIds?.includes(idOf(element) ?? ""))
      element = element.parentElement;
    if (!element) return;
    event.preventDefault();
    selectMany([element]);
    send("text-colour", { color: getComputedStyle(element).color });
  });
  document.addEventListener("dragover", (event) => {
    if (
      event.dataTransfer?.types.includes(
        "application/x-exporter-figma-selection",
      )
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  });
  document.addEventListener("drop", (event) => {
    const data = event.dataTransfer?.getData(
      "application/x-exporter-figma-selection",
    );
    if (!data) return;
    event.preventDefault();
    try {
      const ids = JSON.parse(data);
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string"))
        return;
      const root = config.rootClass
        ? document.querySelector<HTMLElement>("." + config.rootClass)
        : null;
      const rect = root?.getBoundingClientRect();
      send("import-drop", {
        ids,
        x: Math.max(0, event.clientX - (rect?.left ?? 0)),
        y: Math.max(0, event.clientY - (rect?.top ?? 0)),
      });
    } catch {
      /* Ignore unrelated drops. */
    }
  });
  addEventListener("message", (event) => {
    if (event.source !== parent || event.data?.token !== config.token) return;
    const ids: string[] = event.data.ids;
    if (!Array.isArray(ids)) return;
    if (
      event.data.type === "import-at" &&
      Number.isFinite(event.data.x) &&
      Number.isFinite(event.data.y)
    ) {
      const root = config.rootClass
        ? document.querySelector<HTMLElement>("." + config.rootClass)
        : null;
      const rect = root?.getBoundingClientRect();
      send("import-drop", {
        ids,
        x: Math.max(0, event.data.x - (rect?.left ?? 0)),
        y: Math.max(0, event.data.y - (rect?.top ?? 0)),
      });
      return;
    }
    if (event.data.type !== "select-layers") return;
    selectMany(
      Object.entries(config.layers)
        .filter(([, id]) => ids.includes(id))
        .map(([name]) => document.querySelector<HTMLElement>("." + name))
        .filter((element): element is HTMLElement => !!element),
      false,
    );
  });
  document.addEventListener(
    "click",
    (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target === rotationHandle) return;
      if (event.button === 1 || (event.button === 0 && space)) {
        event.preventDefault();
        const target = document.documentElement;
        let x = event.screenX,
          y = event.clientY;
        target.setPointerCapture(event.pointerId);
        const pan = (e: PointerEvent) => {
          scrollBy(0, y - e.clientY);
          send("pan", { dx: x - e.screenX });
          x = e.screenX;
          y = e.clientY;
        };
        const end = () => {
          target.removeEventListener("pointermove", pan);
          target.removeEventListener("pointerup", end);
          target.removeEventListener("pointercancel", end);
          if (target.hasPointerCapture(event.pointerId))
            target.releasePointerCapture(event.pointerId);
        };
        target.addEventListener("pointermove", pan);
        target.addEventListener("pointerup", end);
        target.addEventListener("pointercancel", end);
        return;
      }
      if (event.button !== 0) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const target = document.documentElement,
          x = event.clientX,
          y = event.clientY;
        const box = document.createElement("div");
        box.style.cssText =
          "position:fixed;pointer-events:none;border:1px solid #365eea;background:#365eea22;z-index:2147483646";
        document.body.appendChild(box);
        target.setPointerCapture(event.pointerId);
        let left = x,
          top = y,
          right = x,
          bottom = y;
        const move = (e: PointerEvent) => {
          left = Math.min(x, e.clientX);
          right = Math.max(x, e.clientX);
          top = Math.min(y, e.clientY);
          bottom = Math.max(y, e.clientY);
          Object.assign(box.style, {
            left: left + "px",
            top: top + "px",
            width: right - left + "px",
            height: bottom - top + "px",
          });
        };
        const end = (e: PointerEvent) => {
          target.removeEventListener("pointermove", move);
          target.removeEventListener("pointerup", end);
          target.removeEventListener("pointercancel", end);
          if (target.hasPointerCapture(event.pointerId))
            target.releasePointerCapture(event.pointerId);
          box.remove();
          if (e.type === "pointercancel") return;
          const found = Object.keys(config.layers)
            .map((name) => document.querySelector<HTMLElement>("." + name))
            .filter((element): element is HTMLElement => {
              if (!element) return false;
              const rect = element.getBoundingClientRect();
              return (
                rect.width > 0 &&
                rect.height > 0 &&
                rect.left >= left &&
                rect.right <= right &&
                rect.top >= top &&
                rect.bottom <= bottom
              );
            });
          selectMany(event.shiftKey ? [...selection, ...found] : found);
        };
        target.addEventListener("pointermove", move);
        target.addEventListener("pointerup", end);
        target.addEventListener("pointercancel", end);
        return;
      }
      const resizing = event.target === handle;
      let element = event.target as HTMLElement | null;
      if (!resizing) {
        // Keep a selected group when dragging one of its children. Alt-click
        // drills into the child; the layer list can select any nested layer.
        if (!event.shiftKey && !event.altKey)
          element = selection.find((item) => item.contains(element)) ?? element;
        while (element && !idOf(element)) element = element.parentElement;
        if (!element) return;
        if (event.shiftKey) {
          event.preventDefault();
          selectMany(
            selection.includes(element)
              ? selection.filter((item) => item !== element)
              : [...selection, element],
          );
          return;
        }
        if (!selection.includes(element)) selectMany([element]);
      }
      if (!selected) return;
      event.preventDefault();
      event.stopPropagation();
      const target = selected,
        rect = { width: target.offsetWidth, height: target.offsetHeight };
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      const startX = event.clientX + scrollX,
        startY = event.clientY + scrollY;
      const moving = selection
        .filter(
          (item) =>
            !selection.some(
              (parent) => parent !== item && parent.contains(item),
            ),
        )
        .map((item) => ({
          item,
          original: item.style.cssText,
          translation: getComputedStyle(item)
            .translate.split(/\s+/)
            .map(parseFloat),
        }));
      const original = target.style.cssText;
      let dx = 0,
        dy = 0;

      const move = (e: PointerEvent) => {
        if (!target.hasPointerCapture(event.pointerId)) {
          send("editing-start");
          target.setPointerCapture(event.pointerId);
        }
        dx = e.clientX + scrollX - startX;
        dy = e.clientY + scrollY - startY;
        if (e.shiftKey) {
          if (resizing) {
            const factor =
              Math.abs(dx / rect.width) >= Math.abs(dy / rect.height)
                ? 1 + dx / rect.width
                : 1 + dy / rect.height;
            const scale = Math.max(
              1 / Math.max(1, rect.width),
              1 / Math.max(1, rect.height),
              factor,
            );
            dx = rect.width * (scale - 1);
            dy = rect.height * (scale - 1);
          } else if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (resizing) {
          target.style.width = `${Math.max(1, rect.width + dx)}px`;
          target.style.height = `${Math.max(1, rect.height + dy)}px`;
          target.style.minWidth = "0";
          target.style.minHeight = "0";
          target.style.maxWidth = "none";
          target.style.maxHeight = "none";
        } else
          moving.forEach(({ item, translation }) => {
            item.style.translate = `${(translation[0] || 0) + dx}px ${(translation[1] || 0) + dy}px`;
          });
        placeHandle();
      };
      const finish = (e: PointerEvent) => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", finish);
        document.removeEventListener("pointercancel", cancel);
        if (target.hasPointerCapture(e.pointerId))
          target.releasePointerCapture(e.pointerId);
        if (Math.abs(dx) + Math.abs(dy) < 1) return;
        send(
          resizing ? "resize" : "move",
          resizing
            ? {
                width: Math.max(1, rect.width + dx),
                height: Math.max(1, rect.height + dy),
              }
            : { dx, dy },
        );
      };
      const cancel = (e: PointerEvent) => {
        dx = dy = 0;
        target.style.cssText = original;
        moving.forEach(({ item, original }) => {
          item.style.cssText = original;
        });
        finish(e);
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", finish);
      document.addEventListener("pointercancel", cancel);
    },
    true,
  );
  addEventListener("scroll", placeHandle);
  addEventListener("resize", placeHandle);
  addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
      event.preventDefault();
      send("duplicate");
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      ["[", "]", "{", "}"].includes(event.key)
    ) {
      event.preventDefault();
      send(["]", "}"].includes(event.key) ? "front" : "back");
      return;
    }
    if (
      !config.prototype &&
      !config.viewOnly &&
      ["Delete", "Backspace"].includes(event.key)
    ) {
      event.preventDefault();
      send("delete");
      return;
    }
    if (
      (event.ctrlKey || event.metaKey) &&
      ["z", "y"].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      send(event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo");
      return;
    }
    if (
      !selected ||
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
    )
      return;
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    send("move", {
      dx:
        event.key === "ArrowLeft"
          ? -amount
          : event.key === "ArrowRight"
            ? amount
            : 0,
      dy:
        event.key === "ArrowUp"
          ? -amount
          : event.key === "ArrowDown"
            ? amount
            : 0,
    });
  });
  {
    const ids =
      config.selectedIds ?? (config.selectedId ? [config.selectedId] : []);
    const elements = Object.entries(config.layers)
      .filter(([, id]) => ids.includes(id))
      .map(([name]) => document.querySelector<HTMLElement>("." + name))
      .filter((element): element is HTMLElement => !!element);
    selectMany(elements, false);
  }
  addEventListener("load", () => {
    scrollTo(config.scrollX ?? 0, config.scrollY ?? 0);
    placeHandle();
    if (config.focusCanvas && selected) {
      selected.tabIndex = -1;
      selected.focus({ preventScroll: true });
    }
  });
}

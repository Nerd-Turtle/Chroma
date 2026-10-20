import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type ActiveTooltip = { target: Element; text: string };

function getTooltipTarget(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest("[data-tooltip]") : null;
}

const Tooltip = () => {
  const [activeTooltip, setActiveTooltip] = useState<ActiveTooltip | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  useEffect(() => {
    let hoveredTarget: Element | null = null;
    let focusedTarget: Element | null = null;

    function updateTooltip() {
      const target = hoveredTarget ?? focusedTarget;
      const text = target?.isConnected ? target.getAttribute("data-tooltip") : null;
      setActiveTooltip((current) => {
        if (!target || !text) return null;
        return current?.target === target && current.text === text ? current : { target, text };
      });
    }

    function handlePointerOver(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const target = getTooltipTarget(event.target);
      if (target === getTooltipTarget(event.relatedTarget)) return;
      hoveredTarget = target;
      updateTooltip();
    }

    function handlePointerOut(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const target = getTooltipTarget(event.relatedTarget);
      if (target === getTooltipTarget(event.target)) return;
      hoveredTarget = target;
      updateTooltip();
    }

    function handleFocusIn(event: FocusEvent) {
      const target = getTooltipTarget(event.target);
      focusedTarget = target?.matches(":focus-visible") ? target : null;
      updateTooltip();
    }

    function handleFocusOut() {
      focusedTarget = null;
      updateTooltip();
    }

    function dismissTooltip() {
      hoveredTarget = null;
      focusedTarget = null;
      setActiveTooltip(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismissTooltip();
    }

    // Capture pointer events so disabled buttons can still explain their state.
    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", handlePointerOut, true);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("pointerdown", dismissTooltip, true);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", dismissTooltip, true);
    window.addEventListener("resize", dismissTooltip);

    // Refresh descriptions or dismiss tooltips when React updates/removes a control.
    const observer = new MutationObserver(updateTooltip);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-tooltip"] });

    return () => {
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", handlePointerOut, true);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("pointerdown", dismissTooltip, true);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", dismissTooltip, true);
      window.removeEventListener("resize", dismissTooltip);
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!activeTooltip || !tooltip) return;

    const { target } = activeTooltip;
    const anchor = target.getBoundingClientRect();
    const { width, height } = tooltip.getBoundingClientRect();
    const padding = 8;
    const gap = 6;
    const left = Math.max(padding, Math.min(anchor.left + (anchor.width - width) / 2, window.innerWidth - width - padding));
    const top = anchor.bottom + gap + height <= window.innerHeight - padding
      ? anchor.bottom + gap
      : Math.max(padding, anchor.top - height - gap);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    const descriptions = target.getAttribute("aria-describedby")?.split(/\s+/).filter(Boolean) ?? [];
    target.setAttribute("aria-describedby", [...descriptions, tooltipId].join(" "));
    return () => {
      const remaining = target.getAttribute("aria-describedby")?.split(/\s+/).filter((id) => id && id !== tooltipId) ?? [];
      if (remaining.length) target.setAttribute("aria-describedby", remaining.join(" "));
      else target.removeAttribute("aria-describedby");
    };
  }, [activeTooltip, tooltipId]);

  // A portal keeps tooltips outside the overflow and opacity of tables/drawers.
  return activeTooltip ? createPortal(
    <div key={activeTooltip.text} ref={tooltipRef} id={tooltipId} className="tooltip" role="tooltip">
      {activeTooltip.text}
    </div>,
    document.body,
  ) : null;
};

export default Tooltip;

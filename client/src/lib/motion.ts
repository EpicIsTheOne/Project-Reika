import type { CSSProperties } from "react";

type MotionStyle = CSSProperties & {
  "--motion-delay"?: string;
  "--motion-distance"?: string;
};

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function pageMotionClass(className: string) {
  return cx("motion-page", className);
}

export function motionDelay(index = 0, stepMs = 46, baseMs = 0): MotionStyle {
  return {
    "--motion-delay": `${baseMs + Math.max(0, index) * stepMs}ms`
  };
}

export function motionDistance(distance: number): MotionStyle {
  return {
    "--motion-distance": `${distance}px`
  };
}

"use client";

import { RunPanel } from "./RunPanel";
import { AnnotationQueue } from "./_queue/AnnotationQueue";

export function ReviewHome() {
  return (
    <div className="space-y-6">
      <AnnotationQueue />
      <RunPanel />
    </div>
  );
}

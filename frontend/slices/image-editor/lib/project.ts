import { useCallback } from "react";
import { saveAs } from "@/features/os-shell";
import type Konva from "konva";
import type { Doc } from "./types";
import {
  parseImageEditorProject,
  readBoundedProjectFile,
  readBoundedProjectResponse,
  validateImageEditorProject,
  type ValidatedProject,
} from "./project-validation";

export type Project = ValidatedProject;
export { readBoundedProjectFile, readBoundedProjectResponse };

export function buildProject(doc: Doc, canvases: Map<string, HTMLCanvasElement>): Project {
  const paint: Record<string, string> = {};
  for (const layer of doc.layers) {
    if (layer.kind !== "paint") continue;
    const canvas = canvases.get(layer.id);
    if (canvas) paint[layer.id] = canvas.toDataURL("image/png");
  }
  return validateImageEditorProject({ v: 1, doc, paint });
}

export function restorePaint(
  project: Project,
  canvasFor: (id: string, w: number, h: number) => HTMLCanvasElement,
  redraw: () => void,
) {
  const safe = validateImageEditorProject(project);
  for (const [id, url] of Object.entries(safe.paint)) {
    const canvas = canvasFor(id, safe.doc.width, safe.doc.height);
    const ctx = canvas.getContext("2d");
    const image = new window.Image();
    image.onload = () => {
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      ctx?.drawImage(image, 0, 0);
      redraw();
    };
    image.src = url;
  }
  redraw();
}

export function downloadProject(project: Project, name = "project") {
  const safe = validateImageEditorProject(project);
  const blob = new Blob([JSON.stringify(safe)], { type: "application/json" });
  saveAs(URL.createObjectURL(blob), `${name}.ie.json`);
}

export function parseProject(text: string): Project | null {
  try { return parseImageEditorProject(text); }
  catch { return null; }
}

const KEY = "image-editor:autosave:v1";
export function saveAutosave(project: Project) {
  try {
    const safe = validateImageEditorProject(project);
    localStorage.setItem(KEY, JSON.stringify(safe));
  } catch {
    // Invalid/oversized projects and localStorage quota failures are both fail-closed.
  }
}
export function loadAutosave(): Project | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? parseProject(text) : null;
  } catch {
    return null;
  }
}

export function useProjectIO(deps: {
  doc: Doc;
  canvases: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  canvasFor: (id: string, w: number, h: number) => HTMLCanvasElement;
  setDoc: (d: Doc) => void;
  setSelected: (id: string | null) => void;
  stageRef: React.MutableRefObject<Konva.Stage | null>;
}) {
  const { doc, canvases, canvasFor, setDoc, setSelected, stageRef } = deps;
  const exportProject = useCallback(() => buildProject(doc, canvases.current), [doc, canvases]);
  const loadProject = useCallback((project: Project) => {
    const safe = validateImageEditorProject(project);
    setDoc(safe.doc);
    setSelected(safe.doc.layers.at(-1)?.id ?? null);
    restorePaint(safe, canvasFor, () => stageRef.current?.draw());
  }, [setDoc, setSelected, canvasFor, stageRef]);
  return { exportProject, loadProject };
}

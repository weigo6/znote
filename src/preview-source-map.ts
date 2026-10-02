import type { RenderResult, SourceLocation } from "./types";

const sourceLocations = new WeakMap<Element, SourceLocation>();
type LocationSlot = { path: number[]; location: SourceLocation };
const locationSlots = new WeakMap<Node, LocationSlot[]>();
export const sourceLocation = (element: Element) => sourceLocations.get(element);

function entriesFor(result: RenderResult) {
  return result.sourceMap?.version === 1 && result.sourceMap.offsetEncoding === "utf-16"
    ? new Map(result.sourceMap.entries.map(entry => [entry.id, entry])) : new Map<string, SourceLocation>();
}

export function updateSourceLocations(container: HTMLElement, result: RenderResult) {
  const entries = entriesFor(result);
  for (const block of container.childNodes) {
    const slots = (locationSlots.get(block) || []).map(slot => ({ ...slot, location: entries.get(slot.location.id) || slot.location }));
    for (const slot of slots) {
      let node: Node | undefined = block;
      for (const index of slot.path) node = node?.childNodes[index];
      if (node?.nodeType === 1) sourceLocations.set(node as Element, slot.location);
    }
    locationSlots.set(block, slots);
  }
}

export function bindLocations(root: HTMLElement, result: RenderResult) {
  const entries = entriesFor(result);
  for (const block of root.childNodes) {
    const slots: LocationSlot[] = [];
    const walk = (node: Node, path: number[]) => {
      if (node.nodeType !== 1) return;
      const element = node as Element;
      const id = element.getAttribute("data-zn-node");
      element.removeAttribute("data-zn-node");
      const location = id === null ? undefined : entries.get(id);
      if (location && location.kind === element.tagName.toLowerCase()) {
        sourceLocations.set(element, location);
        slots.push({ path, location });
      }
      Array.from(node.childNodes).forEach((child, index) => walk(child, [...path, index]));
    };
    walk(block, []);
    locationSlots.set(block, slots);
  }
}

export function refreshLocations(previous: Node, fresh: Node) {
  for (const slot of locationSlots.get(previous) || []) {
    let node: Node | undefined = previous;
    for (const index of slot.path) node = node?.childNodes[index];
    if (node?.nodeType === 1) sourceLocations.delete(node as Element);
  }
  const slots = locationSlots.get(fresh) || [];
  for (const slot of slots) {
    let node: Node | undefined = previous;
    for (const index of slot.path) node = node?.childNodes[index];
    if (node?.nodeType === 1 && (node as Element).tagName.toLowerCase() === slot.location.kind)
      sourceLocations.set(node as Element, slot.location);
  }
  locationSlots.set(previous, slots);
}


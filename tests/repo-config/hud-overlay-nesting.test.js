// Repo-meta test: enforces the DOM-overlay / HUD stacking convention across
// every web app in this repo.
//
// Why this test matters: under the WebXR DOM Overlay feature, only the subtree
// of the element passed as `domOverlay.root` is composited over the camera feed
// during an `immersive-ar` session — the rest of the page is hidden. The
// framework binds that root to the *same element passed to `initAR(container)`*
// (see `buildSessionOptions` in
// GpsPlusSlamJs_AppFramework/src/ar/webxr-session.ts). Therefore every HUD /
// overlay node an app wants visible in AR MUST be a DOM descendant of the
// element it hands to `initAR`. If an app authors its overlay as a *sibling* of
// that container, the HUD silently disappears the moment AR starts — and that
// failure only shows up on real AR hardware, never in CI. This static guard is
// the only thing that catches the regression before the field.
//
// A new app added to this repo should be appended to APP_OVERLAY_CONTRACTS so
// it inherits the same protection. See
// GpsPlusSlamJs_Docs/docs/2026-06-05-cross-app-alignment-smoothing-hud-stacking-and-recorder-setup-ux-user-feedback.md
// (Finding 3 / Decision D3) and the AppFramework README "DOM-Overlay / HUD
// stacking convention".
//
// Coverage limits: this checks the *authored* DOM in index.html, not the live
// rendered DOM after the app boots. It assumes apps do not reparent their
// overlay out of the container at runtime (none do). It cannot verify the
// element id strings actually match what each app passes to `initAR` /
// `getElementById` — that linkage is asserted indirectly by each app's own
// unit/e2e suite.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The DOM-overlay contract for each app: the `containerId` is the element the
 * app passes to `initAR()` (which becomes `domOverlay.root`); every id in
 * `overlayIds` is an overlay/HUD node that must be nested inside it so it stays
 * visible once the AR session starts.
 */
const APP_OVERLAY_CONTRACTS = [
  {
    name: 'RecorderApp',
    htmlPath: 'GpsPlusSlamJs_RecorderApp/index.html',
    containerId: 'app',
    overlayIds: ['hud'],
  },
  {
    name: 'AnchorStarter',
    htmlPath: 'GpsPlusSlamJs_AnchorStarter/index.html',
    containerId: 'app',
    overlayIds: ['overlay'],
  },
  {
    name: 'MinimalExample',
    htmlPath: 'GpsPlusSlamJs_MinimalExample/index.html',
    containerId: 'ar-root',
    overlayIds: ['status', 'enter-ar'],
  },
  {
    name: 'QrTrackingDemo',
    htmlPath: 'GpsPlusSlamJs_QrTrackingDemo/index.html',
    containerId: 'app',
    overlayIds: ['overlay'],
  },
];

/**
 * Locate an element's opening tag by id. Returns the tag name and the
 * `[start, end)` character range of the opening tag itself.
 *
 * @param {string} html
 * @param {string} id
 * @returns {{ tagName: string, openStart: number, openEnd: number }}
 */
function findOpenTagById(html, id) {
  // Match `<tag ... id="theId" ...>` capturing the tag name. The id attribute
  // may appear anywhere among the attributes.
  const re = new RegExp(
    `<([a-zA-Z][\\w-]*)\\b[^>]*\\bid\\s*=\\s*["']${id}["'][^>]*>`,
  );
  const match = re.exec(html);
  if (!match) {
    throw new Error(`No element with id="${id}" found`);
  }
  return {
    tagName: match[1].toLowerCase(),
    openStart: match.index,
    openEnd: match.index + match[0].length,
  };
}

/**
 * Given an opening tag of `tagName` at/after `searchFrom`, find the character
 * index of its matching close tag by balancing nested same-name tags. Returns
 * the index of the `</tagName>` that closes the element opened at the start.
 *
 * Robust for hand-authored markup: only same-name tags affect the balance, so
 * a `<div id="container">` ignores `<section>`, `<button>`, void elements, etc.
 *
 * @param {string} html
 * @param {string} tagName lowercased tag name of the container
 * @param {number} afterOpenIndex character index just past the container's open tag
 * @returns {number} index of the matching close tag
 */
function findMatchingCloseIndex(html, tagName, afterOpenIndex) {
  const re = new RegExp(`<(/?)${tagName}\\b[^>]*?>`, 'gi');
  re.lastIndex = afterOpenIndex;
  let depth = 1;
  let match;
  while ((match = re.exec(html)) !== null) {
    const isClose = match[1] === '/';
    depth += isClose ? -1 : 1;
    if (depth === 0) {
      return match.index;
    }
  }
  throw new Error(`Unbalanced <${tagName}> — no matching close tag found`);
}

describe('DOM-overlay / HUD stacking convention', () => {
  for (const contract of APP_OVERLAY_CONTRACTS) {
    describe(contract.name, () => {
      const html = readFileSync(resolve(repoRoot, contract.htmlPath), 'utf8');
      const container = findOpenTagById(html, contract.containerId);
      const containerClose = findMatchingCloseIndex(
        html,
        container.tagName,
        container.openEnd,
      );

      for (const overlayId of contract.overlayIds) {
        it(`#${overlayId} is nested inside the #${contract.containerId} initAR container`, () => {
          const overlay = findOpenTagById(html, overlayId);
          // The overlay's opening tag must start *inside* the container's
          // inner range: after the container opens and before it closes.
          expect(overlay.openStart).toBeGreaterThan(container.openEnd);
          expect(overlay.openStart).toBeLessThan(containerClose);
        });
      }
    });
  }
});

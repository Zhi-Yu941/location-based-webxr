/**
 * Why these tests matter: the parkour-hop egg (catalog №2) ties to the
 * "jump-and-run parkour" copy line — clicking the dot-person makes it hop.
 * It MUST be a purely additive offset (position.y + yaw spin) that the
 * controller layers on top of the freshly placed walk pose, and it must
 * never touch `walk.t` or the story timeline (scrub-path independence).
 * `parkourOffset` is the PURE computation — no mutation — so re-placing
 * the person each frame can never accumulate.
 */
import { describe, expect, it } from "vitest";
import { buildDotPerson } from "./dot-person";
import { parkourOffset, triggerParkourHop } from "./parkour";

describe("parkour hop egg", () => {
  it("returns a rising offset mid-hop and an idle zero offset before/after", () => {
    const person = buildDotPerson();
    // Nothing before a trigger.
    expect(parkourOffset(person, 0)).toEqual({ y: 0, spin: 0, active: false });

    triggerParkourHop(person, 1000);
    const mid = parkourOffset(person, 1300); // airborne
    expect(mid.active).toBe(true);
    expect(mid.y).toBeGreaterThan(0.4);

    // After the whole hop: idle zero offset again, and it self-clears.
    expect(parkourOffset(person, 2000)).toEqual({
      y: 0,
      spin: 0,
      active: false,
    });
  });

  it("spins the person during the airborne beat", () => {
    const person = buildDotPerson();
    triggerParkourHop(person, 0);
    expect(Math.abs(parkourOffset(person, 300).spin)).toBeGreaterThan(0.3);
  });

  it("is a PURE function of the clock: same time → same offset, no mutation", () => {
    const person = buildDotPerson();
    triggerParkourHop(person, 0);
    const before = person.position.clone();
    const a = parkourOffset(person, 250);
    const b = parkourOffset(person, 250);
    expect(a).toEqual(b);
    // The person transform is never touched by the offset computation.
    expect(person.position.equals(before)).toBe(true);
  });

  it("ignores a re-trigger while a hop is already running", () => {
    const person = buildDotPerson();
    triggerParkourHop(person, 0);
    const mid = parkourOffset(person, 300);
    triggerParkourHop(person, 300); // ignored — no restart
    expect(parkourOffset(person, 300)).toEqual(mid);
  });

  it("can hop again after the previous hop fully finished", () => {
    const person = buildDotPerson();
    triggerParkourHop(person, 0);
    expect(parkourOffset(person, 5000).active).toBe(false); // finished
    triggerParkourHop(person, 5000);
    expect(parkourOffset(person, 5300).active).toBe(true); // new hop runs
  });
});

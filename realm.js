// realm.js — where the Himalayas are, and the bits other modules need to know
// about them (kept free of imports so terrain.js / water.js / wildlife.js can
// all use it without import cycles).
//
// The range is built ~15 km out from the city (HIM), far past the camera's
// reach from anywhere in town, so the two are never drawn together: you only
// get there through the gateway on Swayambhu's north shore (himalaya.js), and
// the mountains are only built — and only switched on — while you're there.
// Coordinates inside the range are "local": u east, v north of HIM, with base
// camp at CAMP.

export const HIM = { x: -12000, z: 12000, ext: 7300, walk: 2950 };   // (walk: you can climb all the big peaks)
export const CAMP = { u: 0, v: -700, r: 75 };          // base camp (safe: nothing hunts you inside it)
export const REALM = { on: false };                   // set by main.js while you're up there

let hFn = null;
// himalaya.js hands over its height function (local u, v → metres) once built
export function setHimHeight(fn) {
  hFn = fn;
}
// is world point (x, z) inside the range's box?
export const inHimBox = (x, z) => x > HIM.x - HIM.ext && x < HIM.x + HIM.ext && z > HIM.z - HIM.ext && z < HIM.z + HIM.ext;
// ground height there (world coordinates)
export const himH = (x, z) => (hFn ? hFn(x - HIM.x, z - HIM.z) : 0);
// world ↔ local
export const toWorld = (u, v) => [HIM.x + u, HIM.z + v];
export const toLocal = (x, z) => [x - HIM.x, z - HIM.z];

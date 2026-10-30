/**
 * Where tabs lives on its host: '' at the root (tabs.mo-tion.at, the laptop), '/tabs' under
 * jam.geyser.at/tabs next to beats and time. Set by BASE_PATH at build time (next.config.mjs
 * also makes it next's basePath). next's router and <Link> add it by themselves; plain links,
 * fetch, the websocket and alphaTab's assets go through at().
 */
export const BASE = (process.env.BASE_PATH || '').replace(/\/+$/, '');

/** an app path ("/library", "/api/config") as the browser has to ask for it */
export const at = (path: string) => `${BASE}${path}`;

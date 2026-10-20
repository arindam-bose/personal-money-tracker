import { readFileSync } from "node:fs";
import { IDBFactory } from "fake-indexeddb";
import { closeDb } from "../src/db";
import type { YearFile } from "../src/types";

export function loadJson(path: string): YearFile {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8")) as YearFile;
}

export const sample = (): YearFile => loadJson("./fixtures/sample-2026.json");

/** Start each test with an empty database. */
export async function freshDb(): Promise<void> {
  await closeDb();
  globalThis.indexedDB = new IDBFactory();
}

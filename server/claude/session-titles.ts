import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";

function titlesPath(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, ".config", "opzero-claude", "session-titles.json");
}

export async function loadSessionTitles(): Promise<Record<string, string>> {
  const file = Bun.file(titlesPath());
  if (!(await file.exists())) return {};
  try {
    return (await file.json()) as Record<string, string>;
  } catch {
    return {};
  }
}

export async function saveSessionTitle(
  id: string,
  title: string,
): Promise<void> {
  const path = titlesPath();
  await mkdir(join(path, ".."), { recursive: true });
  const existing = await loadSessionTitles();
  existing[id] = title;
  await Bun.write(path, JSON.stringify(existing, null, 2) + "\n");
}

export async function getSessionTitle(
  id: string,
): Promise<string | undefined> {
  const titles = await loadSessionTitles();
  return titles[id];
}

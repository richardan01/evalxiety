/**
 * How this copy of Evalxiety was started: `npx evalxiety` (the npm package: your files in ~/Evalxiety, settings in
 * settings.env) or a clone of the repository (`npm run dev`, settings in .env.local). Messages name the commands and
 * files that apply. runWords is client-safe; launcher() reads the server's environment.
 */
export type Launcher = "npx" | "repo";

export const launcher = (): Launcher => (process.env.EVALXIETY_LAUNCHER === "npx" ? "npx" : "repo");

export function runWords(l: Launcher) {
  return l === "npx"
    ? { start: "npx evalxiety", exampleAgent: "npx evalxiety example-agent", settingsFile: "settings.env in your Evalxiety folder" }
    : { start: "npm run dev", exampleAgent: "npm run example-agent --", settingsFile: ".env.local" };
}

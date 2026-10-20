import {spawn} from "node:child_process";

/** Opens a local board URL in the default browser. Errors are ignored; the URL is always http://127.0.0.1:<port>/... */
export function openUrl(url: string): void {
  try {
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], {detached: true, stdio: "ignore", windowsHide: true})
        : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], {detached: true, stdio: "ignore"});
    child.on("error", () => {});
    child.unref();
  } catch {
    // no browser available
  }
}

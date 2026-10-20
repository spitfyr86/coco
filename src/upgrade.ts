// Temporary, local handover from the original single-session UI to saved sessions.
// Never stage screenshots, repository contents, or extracted reference bodies.
export const upgradeKey = "coco.session.upgrade.v1";
export function stageSession(value: unknown) {
  const text = JSON.stringify(value)
    .replace(/sk-[A-Za-z0-9_-]{16,}/g, "[redacted]")
    .replace(
      /((?:api[_-]?key|password|secret|access[_-]?token)\s*[=:]\s*[\\"']?)[^\s\\"',;}]+/gi,
      "$1[redacted]",
    );
  localStorage.setItem(upgradeKey, text);
  if (localStorage.getItem(upgradeKey) !== text)
    throw new Error("Session staging failed.");
}

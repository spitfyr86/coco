import type { Milestone, ProgressCheckpoint } from "./types";
const labels = {
  not_started: "Not started",
  in_progress: "In progress",
  needs_verification: "Needs verification",
  complete: "Complete",
};
export default function ProgressVisual({
  items,
  history,
  expanded = false,
}: {
  items: Milestone[];
  history: ProgressCheckpoint[];
  expanded?: boolean;
}) {
  if (!items.length)
    return (
      <div className="progress-visual">
        <progress
          aria-label="Goal progress"
          aria-valuetext="Not assessed yet"
        />
      </div>
    );
  const complete = items.filter((m) => m.done).length;
  return (
    <div className={`progress-visual ${expanded ? "expanded" : ""}`}>
      <progress
        aria-label="Goal progress"
        max={items.length}
        value={complete}
      />
      <div
        className="checkpoint-plan"
        role="list"
        aria-label="Milestone statuses"
      >
        {items.map((m, i) => (
          <span
            role="listitem"
            key={m.id}
            className={`checkpoint-node ${m.status ?? (m.done ? "complete" : "not_started")}`}
            title={`${i + 1}. ${m.title}: ${labels[m.status] ?? (m.done ? "Complete" : "Not started")}`}
            aria-label={`${m.title}: ${labels[m.status] ?? (m.done ? "Complete" : "Not started")}`}
          >
            {i + 1}
          </span>
        ))}
      </div>
      {expanded && (
        <>
          <p className="field-note">
            {complete} of {items.length} complete ·{" "}
            {Math.round((100 * complete) / items.length)}%
          </p>
          <div className="progress-legend">
            {Object.entries(labels).map(([status, label]) => (
              <span key={status}>
                <i className={status} />
                {label}
              </span>
            ))}
          </div>
          {history.length > 0 && (
            <ol
              className="checkpoint-history"
              aria-label="Checkpoint progress history"
            >
              {history.slice(-6).map((p, i) => {
                const count = p.after.filter((m) => m.done).length;
                return (
                  <li
                    key={`${p.checkpoint}-${i}`}
                    className={p.undone ? "undone" : ""}
                  >
                    <span>
                      {p.checkpoint
                        ? `Checkpoint ${p.checkpoint}`
                        : "Session plan"}
                      {p.undone ? " · Undone" : ""}
                    </span>
                    <progress
                      aria-label={`Checkpoint ${p.checkpoint} completion`}
                      value={count}
                      max={Math.max(p.after.length, 1)}
                    />
                    <span>
                      {count}/{p.after.length}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
    </div>
  );
}

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Milestone, ProgressStatus } from "./types";

function Row({
  item,
  index,
  onChange,
  onRemove,
  disabled,
}: {
  item: Milestone;
  index: number;
  onChange: (item: Milestone) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [title, setTitle] = useState(item.title);
  return (
    <li className={`milestone-row ${item.done ? "complete" : ""}`}>
      <input
        disabled={disabled}
        type="checkbox"
        aria-label={`Complete ${item.title}`}
        checked={item.done}
        onChange={(e) =>
          onChange({
            ...item,
            done: e.target.checked,
            status: e.target.checked ? "complete" : "not_started",
            manual: true,
            reason: "Manually corrected",
            evidence: "",
            checkpoint: null,
          })
        }
      />
      <input
        disabled={disabled}
        aria-label={`Milestone ${index + 1} title`}
        value={title}
        maxLength={200}
        onChange={(e) => {
          setTitle(e.target.value);
          if (e.target.value.trim())
            onChange({
              ...item,
              title: e.target.value.trim(),
              status: "not_started",
              done: false,
              manual: false,
              reason: "",
              evidence: "",
              checkpoint: null,
            });
        }}
        onBlur={() => {
          if (title.trim() && title.trim() !== item.title)
            onChange({
              ...item,
              title: title.trim(),
              status: "not_started",
              done: false,
              manual: false,
              reason: "",
              evidence: "",
              checkpoint: null,
            });
          else setTitle(item.title);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      />
      <button
        type="button"
        className="icon-button"
        aria-label={`Remove ${item.title}`}
        onClick={onRemove}
        disabled={disabled}
      >
        <Trash2 size={15} />
      </button>
      <div className="milestone-assessment">
        <select
          disabled={disabled}
          aria-label={`Status for ${item.title}`}
          value={item.status ?? (item.done ? "complete" : "not_started")}
          onChange={(e) =>
            onChange({
              ...item,
              status: e.target.value as ProgressStatus,
              done: e.target.value === "complete",
              manual: true,
              reason: "Manually corrected",
              evidence: "",
              checkpoint: null,
            })
          }
        >
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="needs_verification">Needs verification</option>
          <option value="complete">Complete</option>
        </select>
        {item.manual && (
          <button
            type="button"
            className="button secondary"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...item,
                manual: false,
                reason: "",
                evidence: "",
                checkpoint: null,
              })
            }
          >
            Allow AI updates
          </button>
        )}
        {item.reason && (
          <details>
            <summary>
              {item.manual
                ? "Manual status"
                : item.checkpoint
                  ? `Checkpoint ${item.checkpoint} assessment`
                  : "Session plan assessment"}
            </summary>
            <p>{item.reason}</p>
            {item.evidence && <p>{item.evidence}</p>}
          </details>
        )}
      </div>
    </li>
  );
}
export default function Milestones({
  items,
  onChange,
  disabled = false,
  allowAdd = true,
}: {
  items: Milestone[];
  onChange: (items: Milestone[]) => void;
  disabled?: boolean;
  allowAdd?: boolean;
}) {
  const [title, setTitle] = useState("");
  return (
    <>
      <p className="field-note">
        Checkpoints follow the session plan. You can correct their status;
        manual corrections are protected from AI updates.
      </p>
      {items.length > 0 && (
        <ol className="milestones-list">
          {items.map((item, index) => (
            <Row
              key={item.id}
              disabled={disabled}
              item={item}
              index={index}
              onChange={(next) =>
                onChange(items.map((m) => (m.id === item.id ? next : m)))
              }
              onRemove={() => onChange(items.filter((m) => m.id !== item.id))}
            />
          ))}
        </ol>
      )}
      {allowAdd && (
        <form
          className="milestone-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && items.length < 20) {
              onChange([
                ...items,
                {
                  id: crypto.randomUUID(),
                  title: title.trim(),
                  done: false,
                  status: "not_started",
                  manual: false,
                  reason: "",
                  evidence: "",
                  checkpoint: null,
                },
              ]);
              setTitle("");
            }
          }}
        >
          <label className="field-label" htmlFor="new-milestone">
            Next milestone
          </label>
          <div className="milestone-add-row">
            <input
              id="new-milestone"
              value={title}
              maxLength={200}
              placeholder="For example, verify the fix with a focused test"
              onChange={(e) => setTitle(e.target.value)}
              disabled={disabled || items.length >= 20}
            />
            <button
              type="submit"
              className="button secondary"
              disabled={disabled || !title.trim() || items.length >= 20}
            >
              <Plus size={15} />
              Add
            </button>
          </div>
          {items.length >= 20 && (
            <p className="field-note">
              This plan has reached its 20-milestone limit.
            </p>
          )}
        </form>
      )}
    </>
  );
}

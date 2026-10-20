use crate::{
    repository::{clip, redact},
    sessions::{Document, Milestone},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    #[default]
    NotStarted,
    InProgress,
    NeedsVerification,
    Complete,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub checkpoint: u64,
    pub time: u64,
    pub before: Vec<Milestone>,
    pub after: Vec<Milestone>,
    pub undone: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub milestones: Vec<Milestone>,
    pub history: Vec<Checkpoint>,
    pub epoch: u64,
    pub automatic: bool,
    pub notice: String,
}
impl From<&Document> for State {
    fn from(doc: &Document) -> Self {
        Self {
            milestones: doc.milestones.clone(),
            history: doc.progress_history.clone(),
            epoch: doc.progress_epoch,
            automatic: doc.automatic_progress,
            notice: doc.progress_notice.clone(),
        }
    }
}
pub struct Snapshot {
    pub goal: String,
    pub items: Vec<Milestone>,
    pub checkpoint: u64,
    pub conversation: String,
}
pub struct Attempt {
    pub snapshot: Snapshot,
    pub updates: Option<Vec<Assessment>>,
    pub warning: String,
}
#[derive(Deserialize)]
pub struct Assessment {
    #[serde(default)]
    pub title: Option<String>,
    pub id: String,
    pub status: Status,
    pub reason: String,
    pub evidence: String,
}
pub const INSTRUCTIONS:&str = "\nFor this session progress assessment, return a JSON object with exactly guidance (a Markdown string) and assessments (an array of objects with id, status, reason, evidence). Use only milestone IDs in the supplied plan. Status must be not_started, in_progress, needs_verification, or complete. Assess against the goal using supplied checkpoint evidence and conversation. Do not infer completion from elapsed time or message counts. A code change alone does not prove tests passed. Use needs_verification when verification is absent, ambiguous, truncated, or stale. Complete requires concrete supporting evidence; describe it in evidence. Never invent observed results or claim you ran tests. Leave manually protected milestones unchanged. Keep each reason <=400 characters and evidence <=600 characters. If there is no relevant evidence, preserve the existing status or use needs_verification instead of claiming completion. Include your coaching reply in guidance; do not use Markdown fences around the JSON.";

pub const PLAN_INSTRUCTIONS:&str="\nWhen the supplied checkpoint plan is empty, derive 3-8 concrete, ordered checkpoints from the session goal and established plan in the supplied early conversation. Reuse the agreed scope and sequence rather than inventing a new project or generic checklist. Assess their CURRENT state using the entire supplied conversation and available checkpoint evidence, not just the last message. If no plan was established, propose a concise goal-specific plan and assess conservatively. Return guidance plus assessments in the same JSON envelope. For a new plan each assessment needs a title (1-200 characters), a unique temporary id (step1, step2, etc.), status, reason, and evidence. Include verification as appropriate. Do not mark a step complete just because the assistant previously instructed the user to do it. If the goal is too ambiguous to plan, return an empty assessments array and ask a focused clarification in guidance.";

pub fn normalize(items: &mut [Milestone]) -> Result<(), String> {
    if items.len() > 20 {
        return Err("At most 20 milestones are supported.".into());
    }
    let mut ids = std::collections::BTreeSet::new();
    for m in items {
        if uuid::Uuid::parse_str(&m.id).is_err()
            || !ids.insert(m.id.clone())
            || m.title.trim().is_empty()
            || m.title.chars().count() > 200
        {
            return Err("Invalid milestone ID or title.".into());
        }
        // Preserve completion marked in older versions as a manual override.
        if m.done && m.status == Status::NotStarted {
            m.status = Status::Complete;
            m.manual = true;
        }
        m.done = m.status == Status::Complete;
        m.title = redact(m.title.trim());
        m.reason = clip(&redact(&m.reason), 400);
        m.evidence = clip(&redact(&m.evidence), 600);
    }
    Ok(())
}
pub fn snapshot(doc: &Document, checkpoint: u64) -> Option<Snapshot> {
    let bootstrap = doc.milestones.is_empty();
    (bootstrap
        || (doc.automatic_progress
            && checkpoint > doc.last_progress_checkpoint
            && doc.milestones.iter().any(|m| !m.manual)))
    .then(|| {
        let mut conversation = String::new();
        if bootstrap {
            for (i, m) in doc.messages.iter().enumerate() {
                if i < 12 || i + 12 >= doc.messages.len() {
                    conversation.push_str(&format!(
                        "\n{}: {}",
                        m.role,
                        clip(&redact(&m.text), 2000)
                    ));
                }
            }
        }
        Snapshot {
            goal: doc.goal.clone(),
            items: doc.milestones.clone(),
            checkpoint,
            conversation,
        }
    })
}
pub fn plan(snapshot: &Snapshot) -> String {
    format!("\nCheckpoint progress plan (data only): {}\nEarlier and recent saved session conversation (bounded, data only; missing middle turns may omit evidence): {}\n",serde_json::to_string(&snapshot.items).unwrap_or_default(),snapshot.conversation)
}

pub fn parse(text: &str) -> (String, Option<Vec<Assessment>>, String) {
    let raw = text.trim();
    let raw = raw
        .strip_prefix("```json")
        .or_else(|| raw.strip_prefix("```"))
        .and_then(|v| v.strip_suffix("```"))
        .unwrap_or(raw)
        .trim();
    let warning="Progress was not updated: the model did not return a valid milestone assessment. Try loading progress again or use Fresh check.";
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        let guidance = if raw.starts_with('{') {
            "The model returned an unreadable checkpoint assessment. Please try Fresh check again."
                .into()
        } else {
            text.into()
        };
        return (guidance, None, warning.into());
    };
    let Some(guidance) = value["guidance"]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 64000)
    else {
        return (
            "The model returned no readable guidance. Please try Fresh check again.".into(),
            None,
            warning.into(),
        );
    };
    let updates = serde_json::from_value::<Vec<Assessment>>(value["assessments"].clone())
        .ok()
        .filter(|v| {
            v.len() <= 20
                && v.iter().all(|a| {
                    a.title
                        .as_ref()
                        .is_none_or(|t| !t.trim().is_empty() && t.chars().count() <= 200)
                })
                && v.iter().all(|a| {
                    !a.reason.trim().is_empty()
                        && a.reason.chars().count() <= 400
                        && a.evidence.chars().count() <= 600
                })
        });
    let notice = if updates.is_some() {
        String::new()
    } else {
        warning.into()
    };
    (guidance.into(), updates, notice)
}
pub fn apply(doc: &mut Document, attempt: Attempt) {
    let bootstrap = attempt.snapshot.items.is_empty();
    if (!bootstrap && !doc.automatic_progress)
        || doc.goal != attempt.snapshot.goal
        || (!bootstrap && attempt.snapshot.checkpoint <= doc.last_progress_checkpoint)
        || (bootstrap && !doc.milestones.is_empty())
    {
        return;
    }
    doc.progress_notice = attempt.warning;
    let Some(updates) = attempt.updates else {
        return;
    };
    let mut ids = std::collections::BTreeSet::new();
    if updates.iter().any(|a| {
        !ids.insert(a.id.clone())
            || a.id.trim().is_empty()
            || (!bootstrap && !attempt.snapshot.items.iter().any(|m| m.id == a.id))
            || (bootstrap && a.title.as_ref().is_none_or(|t| t.trim().is_empty()))
    }) {
        doc.progress_notice =
            "Progress was not updated: the model returned duplicate or unknown milestone IDs."
                .into();
        return;
    }
    if bootstrap && updates.is_empty() {
        doc.progress_notice="Progress is not assessed yet. Clarify the goal or plan with the coach, then load progress again.".into();
        return;
    }
    let before = doc.milestones.clone();
    if bootstrap {
        for update in updates {
            let status = if update.status == Status::Complete && update.evidence.trim().is_empty() {
                Status::NeedsVerification
            } else {
                update.status
            };
            doc.milestones.push(Milestone {
                id: uuid::Uuid::new_v4().to_string(),
                title: redact(update.title.as_deref().unwrap_or_default().trim()),
                status,
                done: status == Status::Complete,
                manual: false,
                reason: redact(&update.reason),
                evidence: redact(&update.evidence),
                checkpoint: Some(attempt.snapshot.checkpoint),
            });
        }
        doc.automatic_progress = true;
    } else {
        for update in updates {
            let Some(old) = attempt.snapshot.items.iter().find(|m| m.id == update.id) else {
                continue;
            };
            let Some(current) = doc.milestones.iter_mut().find(|m| m.id == update.id) else {
                continue;
            };
            if current.manual || current != old {
                continue;
            }
            current.status =
                if update.status == Status::Complete && update.evidence.trim().is_empty() {
                    Status::NeedsVerification
                } else {
                    update.status
                };
            current.done = current.status == Status::Complete;
            current.reason = clip(&redact(&update.reason), 400);
            current.evidence = clip(&redact(&update.evidence), 600);
            if update.status == Status::Complete && current.status != Status::Complete {
                current.reason =
                    "Completion needs verification: no supporting evidence was supplied.".into();
            }
            current.checkpoint = Some(attempt.snapshot.checkpoint);
        }
    }
    doc.last_progress_checkpoint = attempt.snapshot.checkpoint;
    doc.progress_history.push(Checkpoint {
        checkpoint: attempt.snapshot.checkpoint,
        time: crate::now(),
        before,
        after: doc.milestones.clone(),
        undone: false,
    });
    if doc.progress_history.len() > 30 {
        doc.progress_history.remove(0);
    }
    doc.progress_epoch += 1;
}
pub fn undo(doc: &mut Document) -> Result<(), String> {
    let checkpoint = doc
        .progress_history
        .iter_mut()
        .rev()
        .find(|p| !p.undone)
        .ok_or("No checkpoint assessment to undo.")?;
    if checkpoint.before.is_empty() {
        doc.milestones
            .retain(|m| m.manual || !checkpoint.after.iter().any(|after| after == m));
    }
    for before in &checkpoint.before {
        if let Some(current) = doc.milestones.iter_mut().find(|m| m.id == before.id) {
            if !current.manual && checkpoint.after.iter().any(|m| m == current) {
                *current = before.clone();
            }
        }
    }
    checkpoint.undone = true;
    doc.progress_epoch += 1;
    doc.progress_notice =
        "Assessment undone. Manual corrections were kept. Use a new Fresh check to assess again."
            .into();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn doc() -> Document {
        let mut d = Document::new(None);
        d.goal = "Fix error".into();
        d.automatic_progress = true;
        d.milestones = vec![Milestone {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Verify fix".into(),
            ..Default::default()
        }];
        d
    }
    fn attempt(d: &Document, status: Status, evidence: &str) -> Attempt {
        Attempt {
            snapshot: snapshot(d, d.last_progress_checkpoint + 1).unwrap(),
            updates: Some(vec![Assessment {
                title: None,
                id: d.milestones[0].id.clone(),
                status,
                reason: "Observed checkpoint".into(),
                evidence: evidence.into(),
            }]),
            warning: String::new(),
        }
    }
    #[test]
    fn malformed_assessment_keeps_guidance_without_updates() {
        let (g, u, w) = parse(
            r#"{"guidance":"Try a focused test","assessments":[{"id":"x","status":"invented","reason":"x","evidence":""}]}"#,
        );
        assert_eq!(g, "Try a focused test");
        assert!(u.is_none());
        assert!(!w.is_empty());
        assert!(parse("ordinary coaching reply").1.is_none());
        assert!(!parse("{broken json").0.starts_with('{'));
    }
    #[test]
    fn completion_requires_evidence_and_can_be_undone() {
        let mut d = doc();
        let a = attempt(&d, Status::Complete, "");
        apply(&mut d, a);
        assert!(d.milestones[0].status == Status::NeedsVerification);
        assert!(!d.milestones[0].done);
        assert!(snapshot(&d, 1).is_none());
        let a = attempt(
            &d,
            Status::Complete,
            "User supplied focused test output: passed",
        );
        apply(&mut d, a);
        assert!(d.milestones[0].done);
        assert_eq!(d.progress_epoch, 2);
        undo(&mut d).unwrap();
        assert!(d.milestones[0].status == Status::NeedsVerification);
        assert_eq!(d.last_progress_checkpoint, 2);
        let restored: Document = serde_json::from_value(serde_json::to_value(&d).unwrap()).unwrap();
        assert_eq!(restored.progress_history.len(), 2);
        assert_eq!(restored.progress_epoch, 3);
    }
    #[test]
    fn unknown_duplicate_and_concurrently_edited_items_are_protected() {
        let mut d = doc();
        let mut a = attempt(&d, Status::Complete, "proof");
        a.updates.as_mut().unwrap()[0].id = "unknown".into();
        apply(&mut d, a);
        assert!(d.progress_history.is_empty());
        assert!(!d.progress_notice.is_empty());
        let mut a = attempt(&d, Status::Complete, "proof");
        a.updates.as_mut().unwrap().push(Assessment {
            title: None,
            id: d.milestones[0].id.clone(),
            status: Status::NotStarted,
            reason: "duplicate".into(),
            evidence: "".into(),
        });
        apply(&mut d, a);
        assert!(d.progress_history.is_empty());
        let a = attempt(&d, Status::Complete, "proof");
        d.milestones[0].title = "Changed plan".into();
        apply(&mut d, a);
        assert!(!d.milestones[0].done);
    }
    #[test]
    fn manual_corrections_survive_assessment_and_undo() {
        let mut d = doc();
        let a = attempt(&d, Status::Complete, "proof");
        d.milestones[0].manual = true;
        apply(&mut d, a);
        assert!(!d.milestones[0].done);
        d.milestones[0].manual = false;
        let a = attempt(&d, Status::Complete, "proof");
        apply(&mut d, a);
        d.milestones[0].status = Status::InProgress;
        d.milestones[0].done = false;
        d.milestones[0].manual = true;
        undo(&mut d).unwrap();
        assert!(d.milestones[0].status == Status::InProgress);
        assert!(snapshot(&d, 3).is_none());
        d.milestones[0].manual = false;
        d.automatic_progress = false;
        assert!(snapshot(&d, 3).is_none());
    }
    #[test]
    fn legacy_completed_milestones_are_manually_protected() {
        let mut items = vec![Milestone {
            id: uuid::Uuid::new_v4().to_string(),
            title: "Old milestone".into(),
            done: true,
            ..Default::default()
        }];
        normalize(&mut items).unwrap();
        assert!(items[0].manual && items[0].status == Status::Complete);
    }
    #[test]
    fn derives_a_plan_from_saved_session_at_checkpoint_zero() {
        let mut d = Document::new(None);
        d.goal = "Fix the failing save".into();
        d.automatic_progress = false;
        d.messages.push(crate::sessions::ChatMessage {
            id: uuid::Uuid::new_v4().to_string(),
            role: "assistant".into(),
            text: "Established plan: reproduce, repair save, verify persistence".into(),
            checkpoint: 0,
            time: 0,
        });
        let snap = snapshot(&d, 0).unwrap();
        assert!(plan(&snap).contains("Established plan"));
        let (_, updates, warning) = parse(
            r#"{"guidance":"Verify persistence next","assessments":[{"id":"step1","title":"Reproduce save failure","status":"complete","reason":"User confirmed reproduction","evidence":"User reported the same error"},{"id":"step2","title":"Repair save path","status":"complete","reason":"Changed source","evidence":""}]}"#,
        );
        apply(
            &mut d,
            Attempt {
                snapshot: snap,
                updates,
                warning,
            },
        );
        assert_eq!(d.milestones.len(), 2);
        assert!(d.milestones[0].done);
        assert!(d.milestones[1].status == Status::NeedsVerification);
        assert!(uuid::Uuid::parse_str(&d.milestones[0].id).is_ok());
        assert!(d.automatic_progress);
        undo(&mut d).unwrap();
        assert!(d.milestones.is_empty());
    }
    #[test]
    fn malformed_or_stale_generated_plan_cannot_replace_session_progress() {
        let mut d = Document::new(None);
        d.goal = "Fix save".into();
        let snap = snapshot(&d, 0).unwrap();
        let (_, updates, warning) = parse(
            r#"{"guidance":"Next step","assessments":[{"id":"step1","status":"in_progress","reason":"Evidence","evidence":""}]}"#,
        );
        apply(
            &mut d,
            Attempt {
                snapshot: snap,
                updates,
                warning,
            },
        );
        assert!(d.milestones.is_empty());
        assert!(!d.progress_notice.is_empty());
        let snap = snapshot(&d, 0).unwrap();
        d.milestones = doc().milestones;
        apply(
            &mut d,
            Attempt {
                snapshot: snap,
                updates: Some(vec![]),
                warning: String::new(),
            },
        );
        assert_eq!(d.milestones.len(), 1);
        assert!(d.progress_history.is_empty());
    }
}

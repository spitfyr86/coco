use crate::{
    repository::{clip, redact},
    sessions::Milestone,
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

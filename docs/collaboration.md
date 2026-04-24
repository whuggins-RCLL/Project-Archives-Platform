# Collaboration Operations: Deadlines & Shared Files

This document defines how this project uses Google Calendar and Google Drive for team coordination.

## 1) Shared Google Calendar for Deadlines

Create a dedicated team calendar named `Project Archives - Deadlines` and share it with all contributors.

### Calendar standards

- **Event title format**: `[Type] Project - Deliverable`
  - Example: `[Milestone] Public Dashboard - v1 Release`
- **Required description fields**:
  - Project owner
  - Deliverables/checklist
  - Links to relevant GitHub issues/PRs
  - Link to the matching Google Drive folder
- **Color convention**:
  - Red: hard deadline
  - Yellow: review/checkpoint
  - Blue: planning or coordination

### Reminder policy

- Default reminders: **7 days** and **1 day** before due date.
- For critical launches or compliance deadlines: add a same-day reminder.

### Ownership rule

Every milestone deadline must have:

1. A named owner
2. A linked issue/PR (if code related)
3. A linked Google Drive folder where deliverables are stored

## 2) Shared Google Drive Folder Levels

Use a Google Workspace **Shared Drive** (not a personal Drive folder) as the project file system.

### Top-level structure

```text
Project Archives/
  00_Admin/
  01_Planning/
  02_Design/
  03_Development/
  04_Testing/
  05_Deliverables/
  06_Archive/
```

### Project-level structure (example)

```text
03_Development/
  Project-A/
    01_Requirements/
    02_Source-Exports/
    03_Docs/
    04_Assets/
```

### File naming convention

Use sortable names:

`YYYY-MM-DD_Project_DocumentType_vNN`

Example:

`2026-04-24_ProjectA_Requirements_v03`

### Permissions model

- Shared Drive Managers: leads/admins only
- Content managers/contributors: active project team
- Viewers/commenters: stakeholders as needed

Prefer folder-level permissions over individual file exceptions to reduce access drift.

## 3) Linking Calendar and Drive

For each deadline event in Google Calendar:

- Include the Google Drive folder URL in the event description.
- Include the GitHub issue/PR URL (when applicable).
- Confirm owner and expected outputs in the event notes.

This keeps code in GitHub and project artifacts in Drive, while preserving a single source of truth for each.

## 4) Weekly Maintenance Routine

Once per week:

1. Review next 2–4 weeks of deadlines in the shared calendar.
2. Verify each upcoming deadline has an owner and Drive link.
3. Move completed files/folders into `06_Archive`.
4. Update event notes to reflect status changes.

## 5) Optional Automation

If you want automated deadline syncing later, use Google Apps Script, Zapier, or Make:

- Trigger: GitHub issue created/updated with `deadline` label
- Action: Create or update a Google Calendar event

Start manually first; automate after conventions are stable.

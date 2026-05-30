# Agent workflow

This repository uses a PR-first automation workflow.

## Goals

- Keep `main` protected.
- Avoid direct pushes to `main`.
- Run CI on every pull request.
- Allow routine safe PRs to auto-merge after CI passes.
- Keep automated work reviewable.
- Let GitHub Actions own branch, commit, pull request, CI, and auto-merge automation.

## Standard flow

1. Open GitHub Actions.
2. Run `Agent Task PR`.
3. Enter a task title and task body.
4. Choose a branch prefix.
5. Choose a change mode.
6. The workflow creates a branch.
7. The workflow applies the requested change.
8. The workflow commits and pushes the branch.
9. The workflow opens a pull request to `main`.
10. CI runs automatically.
11. If CI passes and the branch is allowed, auto-merge is enabled.

## Change modes

### `task_file`

Creates a task file under `.github/agent-tasks/`.

Use this when the requested work should be documented for a human or future coding agent before implementation.

### `readme_note`

Adds the task body as a blockquote note under the main README title.

Use this for safe documentation-only test changes, for example:

```text
This repository follows a PR-first workflow for automated and human-reviewed changes.

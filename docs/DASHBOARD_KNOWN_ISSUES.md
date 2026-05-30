# Dashboard Known Issues and V3 Backlog

| Area | Issue | Impact | Priority | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- |
| Settings | Save can look successful while effective value stays unchanged | Operator loses trust in dashboard | P0 | Show draft, saved override, effective value, source, and save state | Partially implemented |
| Settings | Full refresh can overwrite local drafts | Users lose unsaved work | P0 | Split refresh calls and avoid overwriting dirty fields | Partially implemented |
| Secrets | Secrets can appear missing even when configured via Worker Secret/env | False launch blockers and confusion | P0 | Show secret source: env, D1 override, missing | Implemented in summary/UI |
| Environment | Dashboard did not clearly show DB/environment | Risk of operating on wrong D1 database | P0 | Environment/DB banner | Implemented |
| Category topology | Category/topic/language relationships were hidden | Multi-category operations become confusing | P0 | Category selector, health table, output matrix | Implemented initial version |
| Prompt Studio | Prompt editing was prompt-ID first, not route/output first | Operators cannot know what prompt affects live workflow | P1 | Route/output context selector and active prompt map | Partially implemented |
| Prompt runs | Real workflow runs are not fully visible in Prompt Studio | AI/debug cycle requires logs or manual inspection | P1 | Backend run logging with raw/parsed/final/fallback fields | Pending |
| Publishing | Publishing settings mix manual, scheduler, quota, cron, timing | Operator cannot predict why items publish or stay pending | P1 | Split sections and route timing summary | Partially implemented |
| Media | Media jobs lack workflow traceability | Debugging GitHub media processing is hard | P1 | Add workflow run links/status/retry when backend supports them | UI scaffold improved, backend pending |
| Staging | Test reset required manual D1 SQL | Risky and slow staging workflow | P1 | Staging-only reset endpoint and UI | Implemented |
| Dedupe | Duplicate skips are not visible | Re-testing old links is confusing | P2 | Dedupe lookup and reset-by-URL | Endpoint scaffold partial, full UI pending |

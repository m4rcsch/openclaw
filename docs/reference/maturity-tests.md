---
summary: "How OpenClaw maturity tests connect release requirements to QA evidence, reruns, ownership, and troubleshooting"
read_when:
  - Understanding Stable or LTS release proof requirements
  - Adding or updating QA scorecard coverage
  - Mapping a product requirement to runnable OpenClaw QA evidence
title: "Maturity tests"
---

Maturity tests are the executable proof layer for the OpenClaw maturity scorecard. They connect product surfaces such as Gateway startup, provider behavior, channels, plugins, installation, upgrade, security, and docs to runnable QA evidence that this repo can explain, rerun, and troubleshoot.

`taxonomy.yaml` is the landed maturity snapshot: it defines scorecard surfaces, categories, maturity levels, and the LTS slice. `docs/maturity-scores.yaml` is the landed score snapshot: it records the current rollups, category scores, and LTS support status for that taxonomy. The RFC 0007 executable layer sits on top of those files by joining each requirement to coverage IDs, `smoke-ci` or `release` profile membership, runnable lanes, evidence summaries, scorecard reports, and release gates.

The authoritative requirement-to-test mapping is follow-up executable work owned by @kevinlin-openai. That mapping extends the landed maturity snapshot. A category appearing in `taxonomy.yaml` or the LTS support slice becomes release-blocking only when the executable mapping marks it blocking and maps it to runnable evidence.

## What OpenClaw owns

OpenClaw owns the executable side of maturity proof:

- `taxonomy.yaml` as the landed maturity surface/category/level snapshot
- `docs/maturity-scores.yaml` as the landed score and LTS status snapshot
- executable profile membership, QA scenario metadata, coverage IDs, docs refs, and code refs
- summary artifacts from `qa suite`, live transport lanes, Docker/package lanes, Control UI runs, TUI lanes, and release workflows
- rerun commands and troubleshooting paths for release-blocking requirements
- scorecard reports that join taxonomy rows to fresh evidence

## Mapping shape

Each executable mapping row should be small enough that a maintainer can answer five questions without reading a full design note:

| Field            | Purpose                                                                                                                         |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Taxonomy ref     | `taxonomy.yaml` surface and category, plus a stable executable category ID when needed for QA joins.                            |
| Score snapshot   | The matching `docs/maturity-scores.yaml` score and LTS status used by reports.                                                  |
| Requirement      | Plain-language behavior that must hold for the category's claimed maturity level or support promise.                            |
| Blocking rule    | Whether the row blocks a release gate, is advisory, is part of an LTS support slice, or requires human review before promotion. |
| Evidence mapping | Profile membership, runnable coverage IDs, scenarios, lanes, artifact names, freshness rule, and required live proof.           |
| Troubleshooting  | First rerun command, likely failure owner, and the docs/code refs to inspect.                                                   |

Do not add a release-blocking row without a machine-readable evidence mapping. If the mapping is not ready, keep the row advisory or mark the missing mapping explicitly so the scorecard report shows a gap instead of implying coverage.

## Evidence profiles

Profiles are the named executable selectors for runnable evidence sets. A profile maps landed maturity surfaces and categories to the lanes that prove them. `--surface` and `--category` style filters narrow a selected profile; they are not a separate source of truth. CI should read profile membership from the executable mapping layer instead of maintaining another list in workflow YAML.

The profile set is `smoke-ci` and `release`. Use `smoke-ci` for deterministic PR or merge proof with no live external services. Use `release` for full Stable/LTS proof, including live upstream or release-artifact proof where the claim depends on a real upstream or package. Non-blocking evidence can appear as advisory report rows, but advisory is not a profile.

## Evidence summary fields

QA evidence should be joinable without parsing logs. Summary entries should carry these fields when the lane can provide them:

- scenario ID and coverage IDs
- scorecard surface and category IDs
- profile
- taxonomy version or source ref and score snapshot ref
- provider ID, model live mode, and provider fixture or auth profile
- channel ID or non-channel surface ID
- channel live mode
- runner substrate such as `host`, `docker`, `crabbox`, a release workflow, or an `openclaw/multipass` SDK-backed local channel shim
- package source, OpenClaw ref, OS, Node version, and artifact paths
- status, failure class, failure reason, and timing fields

Keep raw prompts, transcripts, credentials, and secret-bearing logs out of published scorecard artifacts. Link redacted reports or artifact manifests when more detail is needed.

## Finding existing coverage

Start with the coverage inventory when a requirement needs a runnable mapping:

```bash
pnpm openclaw qa coverage --match <surface-or-coverage-id>
pnpm openclaw qa coverage --json --match <surface-or-coverage-id>
```

The inventory searches scenario IDs, titles, surfaces, coverage IDs, docs refs, code refs, plugins, and provider requirements. Use it to find candidate scenarios, then choose the right substrate for the requirement:

| Requirement type                                              | First proof to look for                                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| User-flow scenario with synthetic channel behavior            | `pnpm openclaw qa suite --scenario <id>`                                                                           |
| `openclaw/multipass` SDK-backed local channel behavior        | Taxonomy-mapped QA or plugin lane for the local channel shim; not Canonical Multipass VM execution.                |
| Matrix live transport behavior                                | Matrix QA lane named by the taxonomy row; see [Matrix QA](/concepts/qa-matrix).                                    |
| Telegram, Discord, Slack, or WhatsApp live transport behavior | `pnpm openclaw qa <channel>`                                                                                       |
| Package install, upgrade, or Docker release path              | Docker/package lanes in [Testing](/help/testing) and [Full release validation](/reference/full-release-validation) |
| Normal source e2e behavior                                    | `pnpm test:e2e` or the focused Vitest target named by the coverage row                                             |

The executable mapping should store the profile and runnable lane, not just a prose description. If the command depends on release artifacts or live credentials, name that prerequisite in the row.

## Updating the executable mapping

When adding or changing executable maturity evidence:

1. Start from the matching `taxonomy.yaml` surface and category.
2. Check the current `docs/maturity-scores.yaml` score and LTS status.
3. Choose `smoke-ci` or `release` profile membership, or leave the row advisory and non-blocking.
4. Map it to one or more coverage IDs and runnable lanes.
5. Add docs refs and code refs near the scenario or taxonomy row.
6. Add the rerun command and expected artifact path.
7. Record missing live proof or package proof as an explicit gap.

Avoid copying process-only checklists into docs. The docs explain the contract and maintenance path; `taxonomy.yaml` and `docs/maturity-scores.yaml` hold the landed maturity snapshots, while the executable mapping holds the machine-readable join to QA evidence.

## Troubleshooting a scorecard gap

When a row is missing, stale, or failing:

1. Confirm the row is still part of the current taxonomy.
2. Run `pnpm openclaw qa coverage --match <requirement-id>` to find current scenarios and code refs.
3. Rerun the smallest mapped lane and inspect its summary artifact.
4. Check whether the failure is product behavior, runner setup, live upstream outage, missing credentials, package artifact mismatch, or stale mapping.
5. If no lane exists, keep the row non-blocking or make the scorecard report the missing evidence explicitly.

Release-blocking live upstream failures should fail loudly. Waivers need a human release-owner decision and a preserved summary explaining why the failure is likely upstream rather than OpenClaw behavior.

## Related docs

- [QA overview](/concepts/qa-e2e-automation)
- [Testing](/help/testing)
- [Full release validation](/reference/full-release-validation)
- [Matrix QA](/concepts/qa-matrix)
- [QA channel](/channels/qa-channel)

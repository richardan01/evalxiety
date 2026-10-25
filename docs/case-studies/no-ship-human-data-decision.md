# Product decision case study: why Evalxiety said No ship

**Status:** Portfolio case study of a synthetic experiment, not a production release decision.  
**Focus:** Human evaluation, label quality, critical failures, and safe release decisions.  
**Evidence:** [Experiment and result summary](../../README.md), [experiment records](../../data/experiments), [human annotations](../../data/annotations.json), [gold records](../../data/gold.json).

## Problem and user

Teams building task-oriented agents need a way to decide whether a changed agent is safer to deploy, rather than relying on an attractive aggregate pass rate. The example persona is a product owner of a merchant-pricing assistant, working with finance and compliance reviewers. This is a hypothetical workflow using synthetic business policies; it has **not** been validated as a real customer need.

## Decision and alternatives

The product decision was to make critical approval violations block release, even when aggregate results improve.

| Option | Benefit | Trade-off | Decision |
| --- | --- | --- | --- |
| Ship based on overall pass rate | Simple, fast decision | Hides rare critical failures | Rejected |
| Use an uncalibrated LLM judge as arbiter | Covers subjective issues | Unvalidated agreement with people | Rejected as a gate |
| Combine deterministic checks, independent human review, and critical release gates | Inspectable release reasoning | Additional labeling cost; limited test coverage | Prototype direction |

This is a product-policy choice, not evidence that the current checks generalize to production.

## Evidence and outcome

On the same **20 synthetic locked cases**, the baseline passed all four code checks on **9/20** and the corrected version on **18/20**. Policy-date correctness improved from **9/20 to 20/20** and margin-floor adherence from **15/20 to 20/20**. Mandatory approvals improved from **12/20 to 18/20**, but case **C13** regressed by skipping CFO sign-off and **C07** continued to fail. The prototype therefore gave a **No ship** verdict.

Four corrected cases were held out. Four held-out cases cannot establish generalization. The experimental AI judge has only **three human labels** and must not be described as calibrated. These are code-check pass counts on a synthetic fixture, not external-user impact, production reliability, or measured business value.

## Human-data workflow to build next

1. **Sampling:** Separate discovery, development, and locked evaluation cases; document the sampling frame and intentionally cover historical-policy dates, borderline margins, missing evidence, exceptions, and approval escalation. Keep examples linked to scenario IDs and versioned source snapshots.
2. **Label specification:** Write an annotation guide with decision-date policy resolution, the correct margin check, required sign-offs, allowed abstentions, and examples of ambiguity. Capture *answer + rationale + cited policy version*, not just PASS/FAIL.
3. **Independent labeling:** Use at least two reviewers for a stratified subset, blinded to model version and automated scores. Measure agreement separately by class. Resolve disagreements through a documented adjudicator and maintain a disagreement log; do not let the model silently define its own gold labels.
4. **Quality checks:** Track label provenance, missing policy context, reviewer agreement, disagreement reasons, class balance, and label changes over time. Validate judge thresholds against independent human labels with uncertainty intervals; expand human labels until estimates are useful for the release decision.
5. **Release review:** Pre-register critical fail conditions. Keep critical approval failures as zero-tolerance in the test suite; note that zero observed failures alone cannot prove zero real-world risk. Report per-slice regressions, cost, latency, false pass/false block errors, and coverage gaps. Escalate to a responsible human owner.

## Proposed next experiment (not yet completed)

Expand with independently reviewed cases selected across policy versions and high-risk failure modes; retain a locked held-out sample. Compare baseline and candidate on matched cases and manually inspect every critical regression. Ask a target user to try the reporting and adjudication workflow. Publish counts, intervals, disagreements, costs, and *what the evidence cannot establish*.

## Product-management learning

An aggregate win can conceal a regression that changes the launch decision. A usable human-data platform must support more than collecting labels: it must make *who labeled what, against which policy, with which disagreements, and for which decision* auditable.

**Open questions:** Who owns final label adjudication? What review latency is acceptable? How are ambiguous policy versions represented? What sample size yields a useful bound for critical misses? No answer to these is yet validated with real users.

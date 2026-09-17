# Requirements Intelligence Compiler Evaluation Report

## Run Identity & Provenance

- **Run ID:** `EVAL-98f41c4c-b71c-4815-96e4-efd13d95c4ba`
- **Executed At:** `2026-09-17T03:09:02.376Z`
- **Corpus Version:** `v1.0`
- **Corpus Identity Digest:** `d8e88802236b678b70823be834cdc5c532526cabb6935dc266a524513627f09b`
- **Candidate Git SHA:** _Unavailable_ (Candidate SHA was not provided via options or CANDIDATE_SHA environment variable)
- **Provider Mode:** `fixture-replay`
- **Compiler Version:** `1.0.0`
- **Prompt Version:** `1.0.0`
- **Runtime:** Node v25.8.1 (linux x64)

## Execution Summary

- **Total Manifest Fixtures:** 14
- **Completed Fixtures:** 14
- **Failed Fixtures:** 0
- **Total Elapsed Duration:** 62ms (14 contributing fixtures, 0 unavailable)
- **Total Token Usage:** 2800 tokens (14 contributing fixtures, 0 unavailable)

### Measured Provider & Model Execution Metadata

| Fixture                                          |   Status    |     Provider     |        Model        | Duration | Tokens |
| :----------------------------------------------- | :---------: | :--------------: | :-----------------: | :------: | :----: |
| `approval-threshold-contradiction-basic`         | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `approval-threshold-contradiction-cross-source`  | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `missing-authorization-basic`                    | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `missing-authorization-role-gap`                 | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `incomplete-state-transition-basic`              | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `missing-failure-recovery-basic`                 | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `temporal-ambiguity-basic`                       | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `undefined-cardinality-basic`                    | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `unsupported-assumption-basic`                   | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `superseded-source-revision`                     | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `source-authority-conflict`                      | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `false-positive-near-conflict-scoped-thresholds` | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `false-positive-near-conflict-paraphrase`        | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |
| `canonical-messy-discovery-package`              | `completed` | `fixture-replay` | `fixture-replay-v1` |   5ms    |  200   |

## Defect Finding Quality by Category

| Defect Category                     | TP  | FP  | FN  | Precision | Recall | F1 Score |
| :---------------------------------- | :-: | :-: | :-: | :-------: | :----: | :------: |
| `contradictory-approval-thresholds` |  3  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `missing-actors-authorization`      |  3  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `incomplete-state-transitions`      |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `missing-failure-recovery`          |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `temporal-ambiguity`                |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `undefined-cardinality`             |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `unsupported-assumptions`           |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `superseded-source-or-requirement`  |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `source-authority-conflict`         |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `false-positive-near-conflict`      |  0  |  0  |  0  |    N/A    |  N/A   |   N/A    |

## Requirement Extraction Quality by Category

| Requirement Category | TP  | FP  | FN  | Precision | Recall | F1 Score |
| :------------------- | :-: | :-: | :-: | :-------: | :----: | :------: |
| `actors-permissions` |  4  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `business-rule`      | 16  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `lifecycle-state`    |  3  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `data-constraint`    |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `integration`        |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `failure-behavior`   |  0  |  0  |  0  |    N/A    |  N/A   |   N/A    |
| `exception`          |  2  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |
| `nfr`                |  4  |  0  |  0  |  100.0%   | 100.0% |  100.0%  |

## Category-Specific Misses (False Negatives)

No false negatives observed across evaluated fixtures.

## False-Positive Hotspots

No false positives observed across evaluated fixtures.

## Semantic Review Diagnostics (Statement Pattern Warnings)

> [!NOTE]
> Statement pattern mismatches are qualitative review diagnostics for structurally matched requirements; they do not alter structural TP/FP/FN scores.

- Fixture `approval-threshold-contradiction-basic`: Requirement `REQ-APP-01` (`business-rule`) did not match pattern `.*up to and including \$50,000 may be authorized.*without Department Vice President approval.*`:
  - Statement: "Statement for REQ-APP-01"
- Fixture `approval-threshold-contradiction-basic`: Requirement `REQ-APP-02` (`business-rule`) did not match pattern `.*greater than \$25,000.*Vice President.*`:
  - Statement: "Statement for REQ-APP-02"
- Fixture `approval-threshold-contradiction-cross-source`: Requirement `REQ-FIN-01` (`business-rule`) did not match pattern `.*exceeding \$10,000.*CFO.*`:
  - Statement: "Statement for REQ-FIN-01"
- Fixture `approval-threshold-contradiction-cross-source`: Requirement `REQ-OPS-01` (`business-rule`) did not match pattern `.*up to \$50,000.*without CFO review.*`:
  - Statement: "Statement for REQ-OPS-01"
- Fixture `missing-authorization-basic`: Requirement `REQ-PURGE-01` (`business-rule`) did not match pattern `.*permanently removes all databases.*`:
  - Statement: "Statement for REQ-PURGE-01"
- Fixture `missing-authorization-role-gap`: Requirement `REQ-MFA-OVERRIDE` (`actors-permissions`) did not match pattern `.*Tier 1 Support Agents may override customer MFA credentials.*`:
  - Statement: "Statement for REQ-MFA-OVERRIDE"
- Fixture `missing-authorization-role-gap`: Requirement `REQ-SEC-SIGNOFF` (`actors-permissions`) did not match pattern `.*secondary approval from an Information Security Officer.*`:
  - Statement: "Statement for REQ-SEC-SIGNOFF"
- Fixture `incomplete-state-transition-basic`: Requirement `REQ-ORDER-STATE-01` (`lifecycle-state`) did not match pattern `.*Order lifecycle states are defined as.*`:
  - Statement: "Statement for REQ-ORDER-STATE-01"
- Fixture `incomplete-state-transition-basic`: Requirement `REQ-ORDER-STATE-02` (`lifecycle-state`) did not match pattern `.*FULFILLING transitions to SHIPPED.*`:
  - Statement: "Statement for REQ-ORDER-STATE-02"
- Fixture `missing-failure-recovery-basic`: Requirement `REQ-WEBHOOK-01` (`integration`) did not match pattern `.*dispatches an HTTP POST webhook containing payment details.*`:
  - Statement: "Statement for REQ-WEBHOOK-01"
- Fixture `temporal-ambiguity-basic`: Requirement `REQ-LEDGER-01` (`business-rule`) did not match pattern `.*reconciliation worker runs periodically throughout the day.*`:
  - Statement: "Statement for REQ-LEDGER-01"
- Fixture `undefined-cardinality-basic`: Requirement `REQ-CARD-01` (`data-constraint`) did not match pattern `.*attach multiple billing profiles.*multiple authorized corporate credit cards.*`:
  - Statement: "Statement for REQ-CARD-01"
- Fixture `unsupported-assumption-basic`: Requirement `REQ-ASSUME-01` (`nfr`) did not match pattern `.*operates with 100% network uptime.*responds synchronously within 50 milliseconds.*`:
  - Statement: "Statement for REQ-ASSUME-01"
- Fixture `superseded-source-revision`: Requirement `REQ-DISC-CURRENT` (`business-rule`) did not match pattern `.*discretionary customer pricing discounts of up to 15%.*`:
  - Statement: "Statement for REQ-DISC-CURRENT"
- Fixture `source-authority-conflict`: Requirement `REQ-INTERVIEW-PRACTICE` (`exception`) did not match pattern `.*unencrypted consumer USB flash drives.*`:
  - Statement: "Statement for REQ-INTERVIEW-PRACTICE"
- Fixture `source-authority-conflict`: Requirement `REQ-POLICY-RULE` (`business-rule`) did not match pattern `.*unencrypted removable storage devices be connected.*strictly prohibited.*`:
  - Statement: "Statement for REQ-POLICY-RULE"
- Fixture `false-positive-near-conflict-scoped-thresholds`: Requirement `REQ-PERDIEM-DOM` (`business-rule`) did not match pattern `.*domestic travel.*maximum per diem of \$75 USD.*`:
  - Statement: "Statement for REQ-PERDIEM-DOM"
- Fixture `false-positive-near-conflict-scoped-thresholds`: Requirement `REQ-PERDIEM-INT` (`business-rule`) did not match pattern `.*international travel.*maximum per diem of \$150 USD.*`:
  - Statement: "Statement for REQ-PERDIEM-INT"
- Fixture `false-positive-near-conflict-paraphrase`: Requirement `REQ-MFA-ONBOARD` (`actors-permissions`) did not match pattern `.*enrollment in multi-factor authentication within 48 hours.*`:
  - Statement: "Statement for REQ-MFA-ONBOARD"
- Fixture `false-positive-near-conflict-paraphrase`: Requirement `REQ-MFA-SEC` (`actors-permissions`) did not match pattern `.*multi-factor authentication registration must be completed no later than 48 hours.*`:
  - Statement: "Statement for REQ-MFA-SEC"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-THRESH-1` (`business-rule`) did not match pattern `.*exceeding \$50,000 require CEO sign-off.*`:
  - Statement: "Statement for REQ-MESSY-THRESH-1"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-THRESH-2` (`business-rule`) did not match pattern `.*up to \$100,000 may be authorized.*without CEO sign-off.*`:
  - Statement: "Statement for REQ-MESSY-THRESH-2"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-AUTH-01` (`business-rule`) did not match pattern `.*Any console operator may execute.*Emergency Factory Shutdown.*`:
  - Statement: "Statement for REQ-MESSY-AUTH-01"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-STATE-01` (`lifecycle-state`) did not match pattern `.*lifecycle states are defined as QUEUED, PROCESSING, and COMPLETED.*`:
  - Statement: "Statement for REQ-MESSY-STATE-01"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-ALERT-01` (`integration`) did not match pattern `.*dispatched via external telco gateway HTTP POST endpoint.*`:
  - Statement: "Statement for REQ-MESSY-ALERT-01"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-TIME-01` (`business-rule`) did not match pattern `.*executes periodically whenever host memory usage appears low.*`:
  - Statement: "Statement for REQ-MESSY-TIME-01"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-CARD-01` (`data-constraint`) did not match pattern `.*attach multiple data retention tags and multiple regulatory classifications.*`:
  - Statement: "Statement for REQ-MESSY-CARD-01"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-ASSUME-01` (`nfr`) did not match pattern `.*infinite queries per second with 0% dropped connections.*`:
  - Statement: "Statement for REQ-MESSY-ASSUME-01"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-SUPER-R2` (`business-rule`) did not match pattern `.*contractor access duration is capped at 30 days.*`:
  - Statement: "Statement for REQ-MESSY-SUPER-R2"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-SRE-CHAT` (`exception`) did not match pattern `.*share production root database credentials across the team via a private messaging channel.*`:
  - Statement: "Statement for REQ-MESSY-SRE-CHAT"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-SEC-POLICY` (`business-rule`) did not match pattern `.*Production root credentials must be stored exclusively in the centralized HSM-backed Secrets Manager.*`:
  - Statement: "Statement for REQ-MESSY-SEC-POLICY"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-SLA-SILVER` (`nfr`) did not match pattern `.*Silver Support tier customers receive initial incident response within 24 business hours.*`:
  - Statement: "Statement for REQ-MESSY-SLA-SILVER"
- Fixture `canonical-messy-discovery-package`: Requirement `REQ-MESSY-SLA-GOLD` (`nfr`) did not match pattern `.*Gold Support tier customers receive initial incident response within 4 business hours.*`:
  - Statement: "Statement for REQ-MESSY-SLA-GOLD"

## Empirical Baseline Notice

> [!NOTE]
> This report reflects empirical versioned corpus evaluation. No arbitrary production promotion threshold (such as 90% or 95%) is enforced by this runner. Phase 1 candidate approval requires authoritative human review via `docs/phase-1-report-template.md`.

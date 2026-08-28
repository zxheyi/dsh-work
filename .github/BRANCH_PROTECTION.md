# Main branch protection contract

Status: ready to apply after the Contract workflow is present on GitHub

GitHub branch protection is repository state and cannot be enforced by checked-in Markdown alone. Apply the following rules to `main` after `.github/workflows/contract.yml` has run once on the remote repository.

## Required settings now

- Require a pull request before merging.
- Required approving reviews: `0` while the project has one active maintainer.
- Require conversation resolution before merging.
- Require status checks to pass before merging.
- Required status check: `contract`.
- Require branches to be up to date before merging.
- Block force pushes.
- Block branch deletion.
- Apply rules to administrators so the repository contract is not silently bypassed.

When a second active maintainer can provide timely reviews, raise required approving reviews to `1` and dismiss stale approvals after new commits.

## Bootstrap order

1. Merge or push the Phase 0 contract so the `Contract / contract` check exists remotely.
2. Confirm the check completes successfully on `main`.
3. Open GitHub repository Settings → Rules → Rulesets or Branches.
4. Create a rule targeting the default branch `main` with the settings above.
5. Open a documentation-only test pull request and confirm direct push, unresolved conversations, and a failed `contract` check cannot merge.
6. Record the ruleset URL or screenshot in the Phase 0 pull request.

## Future required checks

Add checks only after their workflow names are stable and they pass on `main`:

- headless product `check`;
- upstream compatibility;
- Windows package smoke;
- macOS package smoke;
- security or dependency review where applicable.

Never require a conditional check that can remain pending for documentation-only changes. Classify the change inside a conclusive workflow instead.

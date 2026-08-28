# Main branch protection contract

Status: versioned configuration; remote state must be verified independently

GitHub branch protection is repository state and cannot be enforced by checked-in Markdown alone. [`.github/branch-protection.json`](branch-protection.json) is the reproducible configuration for `main`; the GitHub API response is the authority for the currently enforced state.

## Required settings now

- Require a pull request before merging.
- Required approving reviews: `0` while the project has one active maintainer.
- Require conversation resolution before merging.
- Require status checks to pass before merging.
- Required status checks: `contract` and `pull-request-contract`.
- Require branches to be up to date before merging.
- Block force pushes.
- Block branch deletion.
- Apply rules to administrators so the repository contract is not silently bypassed.

When a second active maintainer can provide timely reviews, raise required approving reviews to `1` and dismiss stale approvals after new commits.

## Bootstrap order

1. Confirm `Contract / contract` and `Contract / pull-request-contract` complete on a pull request.
2. Apply the checked-in configuration with an administrator token:

   ```bash
   gh api --method PUT \
     --input .github/branch-protection.json \
     repos/zxheyi/dsh-work/branches/main/protection
   ```

3. Read the protection endpoint back and compare required checks and enforcement fields with the JSON file.
4. Confirm a direct update to `main` is rejected and a pull request with a failed required check cannot merge.
5. Record the API response, rejected push, pull request, and CI links in the delivery evidence.

## Future required checks

Add checks only after their workflow names are stable and they pass on `main`:

- headless product `check`;
- upstream compatibility;
- Windows package smoke;
- macOS package smoke;
- security or dependency review where applicable.

Never require a conditional check that can remain pending for documentation-only changes. Classify the change inside a conclusive workflow instead.

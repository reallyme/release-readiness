<!-- SPDX-FileCopyrightText: 2026 ReallyMe Technologies Limited -->
<!-- SPDX-License-Identifier: MIT OR Apache-2.0 -->

# Repository privacy

Local instructions and developer state must stay out of Git and published
packages. Every repository using release-readiness must track a root
`.gitignore` containing these literal, unanchored rules:

```gitignore
AGENTS.md
.claude/
.codex/
.local/
.build/
```

These rules apply throughout the repository. Root-only forms such as
`/AGENTS.md` do not satisfy the policy. The guard also rejects case variants
of these local-only names and does not permit negations to make them public.

The remaining ignore rules use Git's own nested-pattern and negation
semantics. A deliberate exception such as `!.env.example` is allowed. Any
tracked path that is effectively ignored is rejected, even if it was tracked
before the rule existed or was added with `git add -f`. Untrack those files
while preserving local copies, then review the staged removal. Adding an
ignore rule alone does not stop tracking an existing file.

## Local checks and hooks

The checker reads the complete staged index, including staged `.gitignore`
contents at every depth. Unstaged changes, `.git/info/exclude`, and developer
or global ignore settings cannot weaken the checked policy. Partial-commit
indexes supplied by Git are respected. Symlink ignore files and unresolved
index conflicts fail closed. File contents are never copied into diagnostics.

Stage policy changes before running the checker:

```sh
git add .gitignore
node .release-readiness/scripts/repository-privacy.mjs --staged
node .release-readiness/scripts/repository-privacy.mjs --install-hooks
```

Install hooks after obtaining the reviewed, pinned release-readiness checkout.
The installer adds local `pre-commit` and `pre-push` hooks. It refuses to replace
existing hooks or an existing `core.hooksPath` configuration. Integrate the
same commands into the existing hook manager in that case. Give `--pre-push`
the original Git hook standard input and propagate its nonzero exit status.
Reinstall hooks if the pinned checkout moves to a different local path.

The commit hook checks the exact index. The push hook checks each outgoing
commit, including commits that introduced a private file and then removed it
before the tip. Each historical tree is checked against its own ignore rules
and the outgoing tip's current rules. A new branch or tag checks its reachable
history. Deletions send no file content and are skipped. An unknown remote
baseline or a history exceeding the bounded automatic check requires a
separate local history audit rather than silently passing.

For this repository, `npm run privacy:install-hooks` installs the same hooks.

## CI and release qualification

Every pinned runner invocation checks privacy before running the repository's
checker, rendering CI, validating workflows, or qualifying a release. This
applies to private repositories as well as public repositories. The existing
required policy lane provides the CI gate; no additional build job is needed.
This repository also runs an explicit early privacy step in its CI workflow.

Configure repository rules to require `Required CI` and prevent unreviewed
updates to protected branches. Local hooks can be bypassed or disabled, and
CI runs after GitHub has received a push. These controls do not make an
unrestricted remote push impossible or remove previously published objects.
Server-side restrictions and access controls remain necessary for that
boundary. Existing clones, forks, tags, PR refs, caches, and published packages
need a separate incident assessment if private content was exposed.

## Publication checks

Git ignore rules govern source tracking, not the contents of legitimate build
outputs. GitHub Actions builds the reviewed commit and publishes the intended
npm package, Maven publication, or Swift distribution. Generated `dist` files,
JARs, AARs, and XCFrameworks are permitted release contents even when their
build paths are ignored by Git. The `.build` workspace itself stays out of
Git and release payloads. See the [GitHub build and publish guidance](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs) and [Swift build-output guidance](https://docs.swift.org/latest/documentation/swiftlinux/building/).

Publication checks instead reject local instructions, developer state, Git
metadata, `.env` files (apart from `.env.example`), and `.secrets` directories.
They also cover untracked files that a package builder might accidentally
include. Every artifact upload in a declared package preflight or
publish workflow must immediately follow this check:

```yaml
- name: Verify publication privacy
  shell: bash
  env:
    PUBLICATION_PATH: ${{ runner.temp }}/publication
  run: node .release-readiness/scripts/repository-privacy.mjs --artifact "$PUBLICATION_PATH"
- name: Upload package
  uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9
  with:
    name: prepared-package
    path: ${{ runner.temp }}/publication
    if-no-files-found: error
```

Use the same file, staging directory, or newline-separated literal file list
in `PUBLICATION_PATH` and the following upload's `path`. Swift can keep its
existing ZIP-and-checksum file list using `|` blocks for both values. Glob
upload specifications need an explicit staging directory. Both steps must be blocking and unconditional.
The job needs the pinned release-readiness checkout, Node, and Python 3 before
this step. The verified CI receipt upload follows the same rule, using its
existing receipt file path.

The checker inventories the actual file, staging tree, ZIP, JAR, AAR, crate,
or tar archive. It also inspects nested supported archives within bounded
size, depth, entry-count, and execution limits. It does not extract files.
Archive traversal, duplicate entries, invalid paths, external symlinks, and
unreadable or unsupported payloads fail closed. Internal framework symlinks
are checked without following them outside the publication.

For npm tarballs and crate archives whose source files are under one wrapper
directory, append `--strip-components 1` to the check command. Both original
and stripped paths are checked so stripping cannot hide a private name.
The local build-output directory itself is not a published entry. A product
built under `.build/` or `target/` can be staged and published; those workspace
paths and their caches must not be bundled. Package manifests and staging
steps define the intended distribution contents.

This repository's `prepack` also checks npm's actual packlist, including
untracked files selected by npm. It uses `--ignore-scripts` for the internal
packlist query to avoid recursively invoking `prepack`.

Source checks enforce every effective Git ignore rule. Publication checks
enforce the private-path exclusions described above. They do not identify
private content copied into an otherwise permitted filename, replace secret scanning, or
undo an earlier release. Rotate exposed credentials immediately rather than
relying on history cleanup. Any history rewrite, remote ref replacement, or
PR change needs a separate, explicitly approved remediation plan.

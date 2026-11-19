---
name: check-package-contents
description: List exactly which files a typemaid package would upload to npm, and check its package.json after packing. Use before a release, after changing "files", "exports" or the build, or when a package seems to be missing a file.
---

# Check what a package would upload

Pack with Bun (it replaces `workspace:*` with real versions, as a release does) and list the tarball:

```bash
bun run build
mkdir -p /tmp/typemaid-pack
bun pm pack --destination /tmp/typemaid-pack                                 # typemaid (repository root)
(cd packages/view && bun pm pack --destination /tmp/typemaid-pack)          # or postgres, libsql
for t in /tmp/typemaid-pack/*.tgz; do echo "== $t"; tar -tzf "$t"; done
```

Expected: `package.json`, `README.md`, `LICENSE.md` and `dist/` only (`@typemaid/view` also has `THIRD-PARTY-NOTICES.md`). Nothing from `src/`, `test/`, `examples/`, `docs/`, `website/` or any `.env` file.

Check the packed `package.json`:

```bash
tar -xzOf /tmp/typemaid-pack/typemaid-*.tgz package/package.json | grep -n '"version"\|workspace:\|peerDependencies' -A3
```

- No `workspace:` left anywhere.
- The version is the same in all four packages, and each package's peer dependency on the others is that exact version.

Then run the full package checks:

```bash
bun run lint:pkg   # publint + are-the-types-wrong
bun run smoke      # installs the packed tarballs into an empty project and uses every entry point
```

# @typemaid/view

A local page that draws your [typemaid](https://typemaid.pages.dev/docs/) workflows and shows what each step reads and writes.

```bash
npm install -D @typemaid/view
```

```bash
npx typemaid view flows
```

Or from code:

```ts
import { view } from '@typemaid/view';

const viewer = await view('./flows', { open: true });
console.log(viewer.url);
await viewer.close();
```

It needs `typemaid` of the same version installed next to it. The page is served on this computer only, is read-only, and loads nothing from the internet.

Licence: FSL-1.1-MIT (see `LICENSE.md`). The page includes third-party code under its own licences; see `THIRD-PARTY-NOTICES.md`.

Handle a list of emails one item at a time: classify each, archive spam, draft replies to the rest, then send one summary. It shows a for-each block, a decision inside it, and collecting the results.

## The diagram

```mermaid file=examples/emails/emails.mmd
```

- The `each` subgraph has the `foreach` class, and its title `for email in emails` names the list and the item.
- Steps inside the block see the current item as `email`.
- After the block, the per-item results are in `each`, in the same order as `emails`.

## The steps

```ts file=examples/emails/tools.ts
```

## Run it

```ts
import { run } from 'typemaid';
import * as tools from './tools.ts';

const result = await run('./emails.mmd', tools);
// output.each:
// [
//   { isSpam: false, action: 'replied', draft: 'Thanks for "Invoice question"' },
//   { isSpam: true,  action: 'archived' },
//   { isSpam: false, action: 'replied', draft: 'Thanks for "Meeting notes"' }
// ]
// output.summary: '2 replied, 1 archived'
```

## Good to know

- Items run a few at a time (5 by default). Change it with `run(…, { limits: { concurrency: 2 } })`.
- The block is saved as a whole: if the process dies halfway, the whole block runs again on resume.
- Human steps are not allowed inside a for-each block yet.

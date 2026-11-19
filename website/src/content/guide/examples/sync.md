Fetch items page by page and keep a running total, and also accept items pushed by a webhook. It shows a loop driven by a field, and two entry points into one flow.

## The diagram

```mermaid file=examples/sync/sync.mmd
```

- `fetch` and `webhook` are both marked `:::start`. `fetch` is written first, so it is the default.
- `more` is a decision on the boolean field `more`. The loop back to `fetch` runs at most 10 times.

## The steps

```ts file=examples/sync/tools.ts
```

## Run it

```ts
import { run } from 'typemaid';
import * as tools from './tools.ts';

// Default entry point: fetches three pages and adds them up.
await run('./sync.mmd', tools);
// output: { page: 3, total: 15, more: false, … }

// Webhook entry point: process the pushed items once.
await run('./sync.mmd', tools, { items: [10, 20] }, { start: 'webhook' });
// output: { total: 30, more: false, … }
```

Each entry point is checked for its own inputs: the webhook path needs `items`, the default one does not.

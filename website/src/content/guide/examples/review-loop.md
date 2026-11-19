Draft, score, and redraft until the score is good enough. It shows a loop with a cap, and later writes replacing earlier ones. No model is needed: the score rises with each draft.

## The diagram

```mermaid file=examples/review-loop/review-loop.mmd
```

The arrow from `good` back to `draft` is taken when the condition is false, at most 5 times. Every loop needs a `max`, so a run cannot loop forever.

## The steps

```ts file=examples/review-loop/tools.ts
```

## Run it

```ts
import { run } from 'typemaid';
import * as tools from './tools.ts';

const result = await run('./review-loop.mmd', tools, { topic: 'Mermaid' });
// { status: 'completed',
//   output: { topic: 'Mermaid', version: 3, text: 'Mermaid: draft 3', score: 9, published: true } }
```

Drafts 1 and 2 score 3 and 6, so the loop runs twice more; draft 3 scores 9 and is published. Each pass replaces `version`, `text` and `score`.

## In real life

Swap `draft` and `review` for [agent steps](/docs/concepts/steps/#agents): one model writes, another scores against your rules. The diagram does not change.

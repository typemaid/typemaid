// The one list of docs pages. It drives the sidebar, the routes, prev/next links,
// page descriptions and the tests. Add a page here and in src/content (or docs/).

export type Source =
  /** A file in the repository's docs/ folder (kept unchanged). */
  | { collection: 'docs'; id: string }
  /** A page written for the site, in website/src/content/guide. */
  | { collection: 'guide'; id: string }
  /** README.md or CONTRIBUTING.md at the repository root. */
  | { collection: 'reference'; id: string };

export interface DocPage {
  /** Route under /docs/. '' is /docs/ itself. */
  slug: string;
  title: string;
  /** For search results and link previews. 50 to 160 characters. */
  description: string;
  source: Source;
}

export interface Section {
  title: string;
  pages: DocPage[];
}

export const SITE = 'https://typemaid.pages.dev';

export const sections: Section[] = [
  {
    title: 'Start here',
    pages: [
      {
        slug: '',
        title: 'Introduction',
        description: 'What typemaid is: draw a workflow as a Mermaid flowchart, write each step as a typed function, and run it with pauses, retries and saved runs.',
        source: { collection: 'guide', id: 'introduction' },
      },
      {
        slug: 'installation',
        title: 'Installation',
        description: 'Install typemaid and Zod, pick optional packages for models, stores and the viewer, and check which runtimes are supported.',
        source: { collection: 'guide', id: 'installation' },
      },
      {
        slug: 'getting-started',
        title: 'Quickstart',
        description: 'Install typemaid, write a Mermaid flow and its typed steps, run it, check it for mistakes and view it in the browser.',
        source: { collection: 'docs', id: 'getting-started' },
      },
    ],
  },
  {
    title: 'AI workflows',
    pages: [
      {
        slug: 'models',
        title: 'Models and providers',
        description: 'Call AI models from typemaid agent steps and tools with the Vercel AI SDK, and choose the provider package you need.',
        source: { collection: 'docs', id: 'models' },
      },
      {
        slug: 'examples/research-writer',
        title: 'AI workflow example',
        description: 'A full AI workflow: agents plan and write a post, searches run in parallel, an AI judge scores it in a loop, and an editor approves.',
        source: { collection: 'guide', id: 'examples/research-writer' },
      },
      {
        slug: 'examples/summarize',
        title: 'Summarize with a model',
        description: 'A typemaid workflow with an AI agent step that summarizes text into bullet points, with a fake model for tests.',
        source: { collection: 'guide', id: 'examples/summarize' },
      },
      {
        slug: 'api/ai',
        title: 'defineAI()',
        description: 'API reference for defineAI() from typemaid/ai: choose a model once, then use ai.agent, ai.ask and ai.text.',
        source: { collection: 'guide', id: 'api/ai' },
      },
    ],
  },
  {
    title: 'Core concepts',
    pages: [
      {
        slug: 'concepts/diagrams',
        title: 'Diagrams',
        description: 'How a Mermaid flowchart becomes a typemaid workflow: node names, labels, start and end markers, and what the diagram may contain.',
        source: { collection: 'guide', id: 'concepts/diagrams' },
      },
      {
        slug: 'concepts/steps',
        title: 'Steps',
        description: 'The three kinds of step in typemaid: tools that run your code, agents that ask a model, and human steps that wait for a person.',
        source: { collection: 'guide', id: 'concepts/steps' },
      },
      {
        slug: 'concepts/data-flow',
        title: 'Data flow',
        description: 'How data moves between typemaid steps: one shared set of fields, inputs picked by name, outputs merged in, checked before anything runs.',
        source: { collection: 'guide', id: 'concepts/data-flow' },
      },
      {
        slug: 'concepts/control-flow',
        title: 'Control flow',
        description: 'Decisions, conditions, loops with a cap, parallel branches, for-each blocks and several entry points in a typemaid diagram.',
        source: { collection: 'guide', id: 'concepts/control-flow' },
      },
      {
        slug: 'concepts/runs',
        title: 'Runs and results',
        description: 'What run() returns: completed, paused or failed results, run IDs, the output fields, events, cancelling and run limits.',
        source: { collection: 'guide', id: 'concepts/runs' },
      },
      {
        slug: 'concepts/how-it-works',
        title: 'How it works',
        description: 'The ideas behind typemaid: a compiled graph with capped loops, end-to-end types, deterministic routing, durable runs and one writer per run.',
        source: { collection: 'guide', id: 'concepts/how-it-works' },
      },
    ],
  },
  {
    title: 'Guides',
    pages: [
      {
        slug: 'guides/pausing',
        title: 'Pausing and resuming',
        description: 'Pause a typemaid run for a person, save it, and resume it later with their answer, even from another process.',
        source: { collection: 'guide', id: 'guides/pausing' },
      },
      {
        slug: 'durability',
        title: 'Durability',
        description: 'What typemaid saves during a workflow run, when it saves it, and what happens after a crash, a pause or a restart.',
        source: { collection: 'docs', id: 'durability' },
      },
      {
        slug: 'retries',
        title: 'Retries and time limits',
        description: 'Retry failed workflow steps, set timeouts, cap loops and limit run length in typemaid.',
        source: { collection: 'docs', id: 'retries' },
      },
      {
        slug: 'stores',
        title: 'Stores',
        description: 'Keep typemaid workflow runs in memory, SQLite, Postgres or libSQL and Turso, or write your own store.',
        source: { collection: 'docs', id: 'stores' },
      },
      {
        slug: 'guides/testing',
        title: 'Testing workflows',
        description: 'Test typemaid workflows without a real model or real waits: fake agent answers, in-memory stores and instant retries.',
        source: { collection: 'guide', id: 'guides/testing' },
      },
      {
        slug: 'guides/checking',
        title: 'Checking and errors',
        description: 'Find mistakes in typemaid diagrams before they run, with file, line and a suggested fix, from the CLI or from code.',
        source: { collection: 'guide', id: 'guides/checking' },
      },
      {
        slug: 'guides/viewer',
        title: 'Workflow viewer',
        description: 'Open a local, read-only page that draws your typemaid workflows, lists their steps and shows problems as you edit.',
        source: { collection: 'guide', id: 'guides/viewer' },
      },
    ],
  },
  {
    title: 'Examples',
    pages: [
      {
        slug: 'examples/hello',
        title: 'Hello world',
        description: 'The smallest typemaid workflow: two typed steps in a row, run from code and from the command line.',
        source: { collection: 'guide', id: 'examples/hello' },
      },
      {
        slug: 'examples/support-triage',
        title: 'Support triage',
        description: 'A typemaid support-ticket workflow that classifies tickets and pauses urgent ones for a manager to approve or reject.',
        source: { collection: 'guide', id: 'examples/support-triage' },
      },
      {
        slug: 'examples/review-loop',
        title: 'Review loop',
        description: 'A typemaid workflow that drafts, scores and redrafts until the score is good enough, with a cap on how many times it loops.',
        source: { collection: 'guide', id: 'examples/review-loop' },
      },
      {
        slug: 'examples/email-inbox',
        title: 'Email inbox (for-each)',
        description: 'A typemaid workflow that handles a list of emails one item at a time in a for-each block, then reports on all of them.',
        source: { collection: 'guide', id: 'examples/email-inbox' },
      },
      {
        slug: 'examples/sync',
        title: 'Paged sync (entry points)',
        description: 'A typemaid workflow with two entry points: a paged sync loop and a webhook that feeds items into the same steps.',
        source: { collection: 'guide', id: 'examples/sync' },
      },
    ],
  },
  {
    title: 'API reference',
    pages: [
      {
        slug: 'api/run',
        title: 'run()',
        description: 'API reference for run(): start a typemaid workflow with tools and input, and get a completed, paused or failed result.',
        source: { collection: 'guide', id: 'api/run' },
      },
      {
        slug: 'api/resume',
        title: 'resume()',
        description: 'API reference for resume(): answer a paused typemaid run, retry a failed one, or continue one whose process died.',
        source: { collection: 'guide', id: 'api/resume' },
      },
      {
        slug: 'api/steps',
        title: 'tool(), agent(), human()',
        description: 'API reference for the typemaid step helpers tool(), agent() and human(), and the context every tool receives.',
        source: { collection: 'guide', id: 'api/steps' },
      },
      {
        slug: 'api/compile',
        title: 'compile() and check()',
        description: 'API reference for compile() and check(): turn Mermaid text into a typemaid flow, or list its problems without throwing.',
        source: { collection: 'guide', id: 'api/compile' },
      },
      {
        slug: 'api/stores',
        title: 'Store APIs',
        description: 'API reference for typemaid stores: memoryStore, sqliteStore, postgresStore, libsqlStore and the Store interface.',
        source: { collection: 'guide', id: 'api/stores' },
      },
      {
        slug: 'api/cli',
        title: 'CLI and view()',
        description: 'API reference for the typemaid command line (check, run, resume, view) and the view() function from @typemaid/view.',
        source: { collection: 'guide', id: 'api/cli' },
      },
    ],
  },
  {
    title: 'More',
    pages: [
      {
        slug: 'faq',
        title: 'FAQ',
        description: 'Short answers to common questions about typemaid: runtimes, AI models, pausing for people, storage and limits.',
        source: { collection: 'docs', id: 'faq' },
      },
      {
        slug: 'contributing',
        title: 'Contributing',
        description: 'Set up the typemaid repository, find your way around the code, test a change and send a pull request.',
        source: { collection: 'reference', id: 'contributing' },
      },
      {
        slug: 'diagram-reference',
        title: 'Full reference (README)',
        description: 'The full typemaid README: diagram syntax, step kinds, conditions, loops, parallel branches, for-each blocks and the viewer.',
        source: { collection: 'reference', id: 'readme' },
      },
    ],
  },
];

export const pages: DocPage[] = sections.flatMap((s) => s.pages);

export const routeOf = (page: DocPage): string => (page.slug ? `/docs/${page.slug}/` : '/docs/');

/** The plain Markdown copy of a page, for AI agents and the "Copy page" button. */
export const markdownRouteOf = (page: DocPage): string => (page.slug ? `/docs/${page.slug}.md` : '/docs/index.md');

/** The file a page is written in, relative to the repository root. */
export function sourcePathOf(page: DocPage): string {
  const { collection, id } = page.source;
  if (collection === 'docs') return `docs/${id}.md`;
  if (collection === 'guide') return `website/src/content/guide/${id}.md`;
  return `${id.toUpperCase()}.md`;
}

export function sectionOf(page: DocPage): Section {
  return sections.find((s) => s.pages.includes(page))!;
}

/** The page before and after this one, in sidebar order. */
export function neighbours(page: DocPage): { prev?: DocPage; next?: DocPage } {
  const i = pages.indexOf(page);
  return { prev: pages[i - 1], next: pages[i + 1] };
}

/** Old routes from the first version of the site, moved under /docs/. */
export const redirects: Record<string, string> = {
  '/getting-started/': '/docs/getting-started/',
  '/durability/': '/docs/durability/',
  '/retries/': '/docs/retries/',
  '/stores/': '/docs/stores/',
  '/models/': '/docs/models/',
  '/faq/': '/docs/faq/',
  '/reference/': '/docs/diagram-reference/',
};

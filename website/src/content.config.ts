import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

// Pages from the repository's docs/ folder, read as they are.
const docs = defineCollection({
  loader: glob({ pattern: '*.md', base: '../docs' }),
});

// Pages written for the site: introduction, concepts, guides, examples, API reference.
const guide = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guide' }),
});

// Pages from the repository root: the README (the full reference) and CONTRIBUTING.md.
const reference = defineCollection({
  loader: glob({ pattern: '{README,CONTRIBUTING}.md', base: '..' }),
});

export const collections = { docs, guide, reference };

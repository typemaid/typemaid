/**
 * The only place the product name, CLI name and file extensions are written.
 * Renaming the project is an edit to this file plus package.json.
 * Stored runs and diagnostics never contain these values.
 */
export const BRAND = {
  name: 'typemaid',
  cli: 'typemaid',
  extensions: ['.mmd', '.mermaid'],
  toolsFiles: ['tools.ts', 'tools.mts', 'tools.js', 'tools.mjs'],
  symbolKey: 'typemaid.node',
  /** The separate package that holds the workflow viewer. */
  viewPackage: '@typemaid/view',
} as const;

/** Kept equal to the version in package.json by a test. */
export const VERSION = '0.27.1';

/** Format of a stored run. Bump when the stored shape changes. */
export const RUN_FORMAT = 1;
/** Version of the diagram dialect. Bump when an existing file would change meaning. */
export const DIALECT = 1;

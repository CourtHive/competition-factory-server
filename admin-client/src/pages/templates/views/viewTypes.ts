/**
 * Shared types for Templates page sub-views (topologies, compositions,
 * tieFormats). Each view exports `mount<Foo>View(host, provider)` returning
 * a `ViewMount` with a destructor so the page orchestrator can cleanly
 * tear down on tab switch.
 */

export interface ViewMount {
  destroy(): void;
}

export interface CatalogItem {
  id: string;
  name: string;
  description?: string | null;
  source: 'builtin' | 'user';
}

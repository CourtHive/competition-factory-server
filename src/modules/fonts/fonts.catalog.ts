/**
 * Font catalog — the single source of truth for fonts CourtHive apps can embed
 * in generated PDFs (via pdf-factory). Served to clients by FontsController at
 * `GET /fonts`; the actual TrueType binaries are served from `GET /fonts/files/:filename`.
 *
 * jsPDF's built-in `helvetica` is WinAnsi/Latin-1 only, so the embeddable fonts
 * here add Central-European (Latin-2) coverage for Czech, Croatian, Polish,
 * Hungarian, etc. Each style is a separate file (jsPDF embeds styles independently).
 */

export interface FontStyleFiles {
  normal: string;
  bold?: string;
  italic?: string;
  bolditalic?: string;
}

export interface FontCatalogEntry {
  /** Stable id stored in provider config / user settings, e.g. 'dejavu-sans'. */
  id: string;
  label: string;
  /** Language codes the font covers well (informational, drives the picker). */
  languages: string[];
  /** True for jsPDF built-ins (no embedding; Latin-1 only). */
  builtin?: boolean;
  /** Asset filenames per style (absent for built-ins). */
  files?: FontStyleFiles;
}

const CENTRAL_EUROPEAN_LANGUAGES = ['en', 'cs', 'sk', 'pl', 'hu', 'hr', 'sl', 'ro', 'de', 'fr', 'es', 'it', 'tr'];

export const FONT_CATALOG: FontCatalogEntry[] = [
  { id: 'helvetica', label: 'Helvetica (built-in)', languages: ['en'], builtin: true },
  {
    id: 'dejavu-sans',
    label: 'DejaVu Sans',
    languages: CENTRAL_EUROPEAN_LANGUAGES,
    files: { normal: 'DejaVuSans.ttf', bold: 'DejaVuSans-Bold.ttf' },
  },
  {
    id: 'liberation-sans',
    label: 'Liberation Sans',
    languages: CENTRAL_EUROPEAN_LANGUAGES,
    files: { normal: 'LiberationSans-Regular.ttf', bold: 'LiberationSans-Bold.ttf' },
  },
];

/** Allowlist of servable asset filenames (guards the binary endpoint). */
export const FONT_ASSET_FILES: ReadonlySet<string> = new Set(
  FONT_CATALOG.flatMap((font) =>
    font.files ? Object.values(font.files).filter((file): file is string => Boolean(file)) : [],
  ),
);

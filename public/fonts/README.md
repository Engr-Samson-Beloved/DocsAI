# Embedded PDF fonts

`Tinos` (Regular / Bold / Italic / BoldItalic), from
<https://github.com/google/fonts/tree/main/ofl/tinos>, licensed under the
Apache License 2.0.

## Why these files are in the repo

Tinos is metric-compatible with Times New Roman: the same advance widths, so a
document laid out for Times New Roman paginates identically. Unlike Times New
Roman it is redistributable, so it can be **embedded** in the PDFs this app
generates.

The exporter previously asked `@react-pdf/renderer` for `Times-Roman` and
`Times-Bold`. Those are the PDF standard-14 font *aliases* — names every reader
is required to resolve locally. They cannot be embedded by definition, so
`pdffonts` reported `emb: no` on every face and the document rendered with
whatever the reader substituted. On a machine without Times New Roman that is a
different document.

`src/utils/reactPdf.tsx` registers these files and **fails the export** if they
cannot be fetched, rather than silently falling back to a substitute.

## Replacing them

Any metric-compatible serif works (Liberation Serif is the other common
choice). Keep the four faces and the filenames, or update `FONT_FILES` in
`src/utils/reactPdf.tsx` to match.

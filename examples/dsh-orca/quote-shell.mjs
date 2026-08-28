/**
 * quoteShell — escape one value for inclusion in a POSIX shell single-quoted
 * string. Used by every code path that builds a command line the host shell
 * will parse (Orca `--command` and DSH worker `--tmp-root` etc.). A single
 * place for the escape pattern so the outer (Orca terminal) and inner (DSH
 * bash) shell boundaries cannot drift.
 *
 * The escape is the canonical POSIX form: wrap in `'…'` and replace every
 * embedded `'` with the four-character sequence `'\''` (close, escaped quote,
 * reopen). Nothing inside single quotes is expanded by the shell — no
 * variable substitution, command substitution, history expansion, or
 * metacharacter processing.
 */
export function quoteShell(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

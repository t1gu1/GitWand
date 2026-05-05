#!/usr/bin/env node

/**
 * GitWand CLI — point d'entrée binaire.
 *
 * Le shebang + ce fichier sont ce que `package.json.bin.gitwand` pointe
 * (`dist/index.js`). Toute la logique est déléguée à `cli.ts` (parser
 * + dispatcher) et aux sous-modules (`commands/*`, `ui`, `git`, …).
 *
 * Ce wrapper a une seule responsabilité : rattraper les erreurs qui
 * auraient échappé aux commandes et garantir un `exit(2)` propre, afin
 * qu'un job CI distingue les cas normaux (0 = tout résolu, 1 = conflits
 * restants) du cas crash interne du CLI.
 *
 * Usage :
 *   gitwand resolve [files...]       Auto-resolve trivial conflicts
 *   gitwand status                   Show conflict status for the repo
 *   gitwand --help                   Show help
 *
 * CI mode :
 *   gitwand resolve --ci             JSON output + exit code 1 if conflicts remain
 *
 * @example
 *   npx gitwand resolve
 *   npx gitwand resolve src/app.ts src/config.ts
 *   npx gitwand resolve --ci --dry-run
 */

import { main } from "./cli.js";
import { c } from "./ui.js";

main().catch((err) => {
  console.error(`${c.red}Fatal: ${err instanceof Error ? err.message : String(err)}${c.reset}`);
  process.exit(2);
});

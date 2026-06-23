/**
 * GitWand VS Code Extension
 *
 * Features:
 * - Diagnostics inline (warnings sur chaque conflit avec type + résolvabilité)
 * - CodeLens au-dessus de chaque conflit (action rapide)
 * - Status bar avec compteur de conflits
 * - Commandes resolveFile et resolveAll
 */

import * as vscode from "vscode";
import {
  resolve,
  parseConflictMarkers,
  classifyConflict,
  type ConflictType,
  type Confidence,
  type ConfidenceScore,
} from "@gitwand/core";

// ─── Constants ──────────────────────────────────────────────────
const MARKER_OURS = /^<{7}\s/;
const DIAGNOSTIC_SOURCE = "GitWand";
const WAND = "\u2728";

// ─── Shared state ───────────────────────────────────────────────
let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;

// ─── Helpers ────────────────────────────────────────────────────

const VALID_CONFIDENCE: readonly Confidence[] = ["certain", "high", "medium", "low"];
const CONFIDENCE_RANK: Record<Confidence, number> = { certain: 4, high: 3, medium: 2, low: 1 };

function getConfig() {
  const config = vscode.workspace.getConfiguration("gitwand");
  const raw = config.get<string>("minConfidence", "high");
  const minConfidence: Confidence = (VALID_CONFIDENCE as readonly string[]).includes(raw)
    ? (raw as Confidence)
    : "high";
  return {
    resolveWhitespace: config.get<boolean>("resolveWhitespace", true),
    minConfidence,
  };
}

function isResolvableHunk(
  classification: { type: ConflictType; confidence: ConfidenceScore },
  minConfidence: Confidence,
): boolean {
  if (classification.type === "complex") return false;
  return (CONFIDENCE_RANK[classification.confidence.label] ?? 0) >= CONFIDENCE_RANK[minConfidence];
}

/** Labels lisibles pour chaque type de conflit */
const TYPE_LABELS: Record<ConflictType, string> = {
  same_change: "Same change on both sides",
  one_side_change: "Only one side changed",
  delete_no_change: "Deleted by one side",
  whitespace_only: "Whitespace difference only",
  non_overlapping: "Non-overlapping changes",
  generated_file: "Auto-generated file (lockfile, build output…)",
  value_only_change: "Only volatile values differ (hashes, versions…)",
  reorder_only: "Same lines, different order (pure reordering)",
  insertion_at_boundary: "Pure insertions on both sides, base intact",
  complex: "Complex conflict",
  llm_proposed: "LLM-proposed resolution (experimental)",
  refactoring_aware_merge: "Refactoring-aware merge (experimental)",
};

/** Icônes par type */
const TYPE_ICONS: Record<ConflictType, string> = {
  same_change: "\u2713",
  one_side_change: "\u2713",
  delete_no_change: "\u2713",
  whitespace_only: "\u2713",
  non_overlapping: "\u2713",
  generated_file: "\u2713",
  value_only_change: "\u2713",
  reorder_only: "\u2713",
  insertion_at_boundary: "\u2713",
  complex: "\u2717",
  llm_proposed: "\u2713",
  refactoring_aware_merge: "\u2713",
};

// ─── Diagnostics Provider ───────────────────────────────────────

function updateDiagnostics(document: vscode.TextDocument) {
  if (document.uri.scheme !== "file") {
    return;
  }

  const content = document.getText();
  const { segments } = parseConflictMarkers(content);

  const diagnostics: vscode.Diagnostic[] = [];
  let lineOffset = 0;

  for (const segment of segments) {
    if (segment.type === "text") {
      lineOffset += segment.lines.length;
    } else {
      const conflict = segment.conflict;
      const classification = classifyConflict(conflict);
      const config = getConfig();
      const isResolvable = isResolvableHunk(classification, config.minConfidence);

      // Trouver la ligne du marqueur <<<<<<< dans le document
      const startLine = findMarkerLine(document, lineOffset);
      if (startLine === -1) {
        lineOffset +=
          conflict.oursLines.length +
          conflict.baseLines.length +
          conflict.theirsLines.length +
          4; // markers
        continue;
      }

      // Trouver la ligne du marqueur >>>>>>>
      const endLine = findEndMarkerLine(document, startLine);
      const range = new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);

      const severity = isResolvable
        ? vscode.DiagnosticSeverity.Information
        : vscode.DiagnosticSeverity.Warning;

      const icon = TYPE_ICONS[classification.type];
      const label = TYPE_LABELS[classification.type];
      const message = isResolvable
        ? `${icon} GitWand can auto-resolve: ${label}`
        : `${icon} Manual resolution needed: ${label}`;

      const diagnostic = new vscode.Diagnostic(range, message, severity);
      diagnostic.source = DIAGNOSTIC_SOURCE;
      diagnostic.code = classification.type;
      diagnostics.push(diagnostic);

      lineOffset = endLine + 1;
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
  updateStatusBar();
}

function findMarkerLine(
  document: vscode.TextDocument,
  fromLine: number,
): number {
  for (let i = fromLine; i < document.lineCount; i++) {
    if (MARKER_OURS.test(document.lineAt(i).text)) {
      return i;
    }
  }
  return -1;
}

function findEndMarkerLine(
  document: vscode.TextDocument,
  fromLine: number,
): number {
  for (let i = fromLine + 1; i < document.lineCount; i++) {
    if (/^>{7}\s/.test(document.lineAt(i).text)) {
      return i;
    }
  }
  return fromLine;
}

// ─── CodeLens Provider ──────────────────────────────────────────

class GitWandCodeLensProvider implements vscode.CodeLensProvider {
  private _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  refresh() {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const content = document.getText();
    const { segments } = parseConflictMarkers(content);
    const lenses: vscode.CodeLens[] = [];

    let lineOffset = 0;

    for (const segment of segments) {
      if (segment.type === "text") {
        lineOffset += segment.lines.length;
      } else {
        const conflict = segment.conflict;
        const classification = classifyConflict(conflict);
        const config = getConfig();
        const isResolvable = isResolvableHunk(classification, config.minConfidence);

        const markerLine = findMarkerLine(document, lineOffset);
        if (markerLine === -1) {
          lineOffset +=
            conflict.oursLines.length +
            conflict.baseLines.length +
            conflict.theirsLines.length +
            4;
          continue;
        }

        const endLine = findEndMarkerLine(document, markerLine);
        const range = new vscode.Range(markerLine, 0, markerLine, 0);

        if (isResolvable) {
          // Lens : résoudre ce conflit
          lenses.push(
            new vscode.CodeLens(range, {
              title: `${WAND} Resolve (${TYPE_LABELS[classification.type]})`,
              command: "gitwand.resolveFile",
              tooltip: classification.explanation,
            }),
          );
        } else {
          // Lens informatif
          lenses.push(
            new vscode.CodeLens(range, {
              title: `\u26A0 ${TYPE_LABELS[classification.type]} — manual resolution needed`,
              command: "",
              tooltip: classification.explanation,
            }),
          );
        }

        lineOffset = endLine + 1;
      }
    }

    return lenses;
  }
}

// ─── Status Bar ─────────────────────────────────────────────────

function updateStatusBar() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    statusBarItem.hide();
    return;
  }

  const diagnostics = diagnosticCollection.get(editor.document.uri);
  if (!diagnostics || diagnostics.length === 0) {
    statusBarItem.hide();
    return;
  }

  const total = diagnostics.length;
  const resolvable = diagnostics.filter(
    (d) => d.severity === vscode.DiagnosticSeverity.Information,
  ).length;

  statusBarItem.text = `${WAND} ${resolvable}/${total} resolvable`;
  statusBarItem.tooltip = `GitWand: ${resolvable} conflict(s) can be auto-resolved out of ${total}. Click to resolve.`;
  statusBarItem.command = "gitwand.resolveFile";
  statusBarItem.show();
}

// ─── Commands ───────────────────────────────────────────────────

async function cmdResolveFile() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active file.");
    return;
  }

  const document = editor.document;
  const content = document.getText();
  const config = getConfig();

  const result = resolve(content, document.fileName, {
    resolveWhitespace: config.resolveWhitespace,
    minConfidence: config.minConfidence,
  });

  if (result.stats.totalConflicts === 0) {
    vscode.window.showInformationMessage("No conflicts in this file.");
    return;
  }

  if (result.stats.autoResolved === 0) {
    vscode.window.showWarningMessage(
      `${result.stats.totalConflicts} conflict(s) found, none auto-resolvable.`,
    );
    return;
  }

  if (!result.mergedContent) return;

  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(content.length),
  );

  await editor.edit((editBuilder) => {
    editBuilder.replace(fullRange, result.mergedContent!);
  });

  if (!result.validation.isValid) {
    const reasons: string[] = [];
    if (result.validation.hasResidualMarkers) reasons.push("residual conflict markers");
    if (result.validation.syntaxError) reasons.push(result.validation.syntaxError);
    else if ((result.validation.parseTreeErrors ?? 0) > 0)
      reasons.push(`${result.validation.parseTreeErrors} parse error(s)`);
    vscode.window.showWarningMessage(
      `${WAND} GitWand: ${result.stats.autoResolved} conflict(s) resolved — validation issues: ${reasons.join("; ")}. Review before committing.`,
    );
  } else {
    vscode.window.showInformationMessage(
      `${WAND} GitWand: ${result.stats.autoResolved}/${result.stats.totalConflicts} conflict(s) auto-resolved.`,
    );
  }
}

async function cmdResolveAll() {
  const config = getConfig();
  const CONFLICT_RE = /^<{7} /m;
  const MAX_FILE_SIZE = 2 * 1024 * 1024; // skip files > 2 MB

  const allUris = await vscode.workspace.findFiles(
    "**/*",
    "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**}",
  );

  const workspaceEdit = new vscode.WorkspaceEdit();
  let totalResolved = 0;
  let totalConflicts = 0;
  let filesResolved = 0;
  let filesWithValidationIssues = 0;

  for (const uri of allUris) {
    let content: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.length > MAX_FILE_SIZE) continue;
      content = Buffer.from(bytes).toString("utf8");
    } catch {
      continue;
    }

    if (!CONFLICT_RE.test(content)) continue;

    const result = resolve(content, uri.fsPath, {
      resolveWhitespace: config.resolveWhitespace,
      minConfidence: config.minConfidence,
    });

    if (result.stats.totalConflicts === 0) continue;
    totalConflicts += result.stats.totalConflicts;

    if (result.stats.autoResolved > 0 && result.mergedContent) {
      if (result.validation.hasResidualMarkers) {
        filesWithValidationIssues++;
      } else {
        const doc = await vscode.workspace.openTextDocument(uri);
        const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(content.length));
        workspaceEdit.replace(uri, fullRange, result.mergedContent);
        totalResolved += result.stats.autoResolved;
        filesResolved++;
        if (!result.validation.isValid) filesWithValidationIssues++;
      }
    }
  }

  if (totalConflicts === 0) {
    vscode.window.showInformationMessage(`${WAND} GitWand: No conflicted files in workspace.`);
    return;
  }

  if (totalResolved === 0) {
    vscode.window.showWarningMessage(
      `${WAND} GitWand: ${totalConflicts} conflict(s) found, none auto-resolvable.`,
    );
    return;
  }

  await vscode.workspace.applyEdit(workspaceEdit);

  if (filesWithValidationIssues > 0) {
    vscode.window.showWarningMessage(
      `${WAND} GitWand: ${totalResolved}/${totalConflicts} conflict(s) resolved — ${filesWithValidationIssues} file(s) have validation issues. Review before committing.`,
    );
  } else {
    vscode.window.showInformationMessage(
      `${WAND} GitWand: ${totalResolved}/${totalConflicts} conflict(s) resolved across ${filesResolved} file(s).`,
    );
  }
}

async function cmdStatus() {
  const config = getConfig();
  const CONFLICT_RE = /^<{7} /m;
  const MAX_FILE_SIZE = 2 * 1024 * 1024;

  const allUris = await vscode.workspace.findFiles(
    "**/*",
    "{**/node_modules/**,**/.git/**,**/dist/**,**/build/**}",
  );

  const fileStats: Array<{ name: string; total: number; resolvable: number }> = [];

  for (const uri of allUris) {
    let content: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.length > MAX_FILE_SIZE) continue;
      content = Buffer.from(bytes).toString("utf8");
    } catch {
      continue;
    }

    if (!CONFLICT_RE.test(content)) continue;

    const { segments } = parseConflictMarkers(content);
    const conflicts = segments.filter((s) => s.type === "conflict");
    if (conflicts.length === 0) continue;

    let resolvable = 0;
    for (const seg of conflicts) {
      const classification = classifyConflict(seg.conflict);
      if (isResolvableHunk(classification, config.minConfidence)) resolvable++;
    }

    fileStats.push({
      name: vscode.workspace.asRelativePath(uri),
      total: conflicts.length,
      resolvable,
    });
  }

  if (fileStats.length === 0) {
    vscode.window.showInformationMessage(
      `${WAND} GitWand: No conflicted files in workspace.`,
    );
    return;
  }

  // Build a readable report
  const totalConflicts = fileStats.reduce((sum, f) => sum + f.total, 0);
  const totalResolvable = fileStats.reduce((sum, f) => sum + f.resolvable, 0);

  const lines = fileStats.map((f) => {
    const icon = f.resolvable === f.total ? "\u2713" : f.resolvable > 0 ? "\u25D0" : "\u25CB";
    return `${icon} ${f.name} — ${f.resolvable}/${f.total} resolvable`;
  });

  const header = `${WAND} GitWand Status: ${totalResolvable}/${totalConflicts} conflict(s) auto-resolvable across ${fileStats.length} file(s)`;

  // Show in an output channel for a nicer view
  const channel = vscode.window.createOutputChannel("GitWand");
  channel.clear();
  channel.appendLine(header);
  channel.appendLine("");
  for (const line of lines) {
    channel.appendLine(`  ${line}`);
  }
  channel.appendLine("");
  if (totalResolvable > 0) {
    channel.appendLine(
      `Run "GitWand: Resolve All Trivial Conflicts" to auto-resolve.`,
    );
  }
  channel.show(true);
}

// ─── Activation ─────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
  // Diagnostics
  diagnosticCollection =
    vscode.languages.createDiagnosticCollection("gitwand");
  context.subscriptions.push(diagnosticCollection);

  // Status bar (priorité basse, à droite)
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50,
  );
  context.subscriptions.push(statusBarItem);

  // CodeLens
  const codeLensProvider = new GitWandCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, codeLensProvider),
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("gitwand.resolveFile", cmdResolveFile),
    vscode.commands.registerCommand("gitwand.resolveAll", cmdResolveAll),
    vscode.commands.registerCommand("gitwand.status", cmdStatus),
  );

  // Mettre à jour les diagnostics quand un fichier change ou est ouvert
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      updateDiagnostics(e.document);
      codeLensProvider.refresh();
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      updateDiagnostics(doc);
    }),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        updateDiagnostics(editor.document);
      }
      updateStatusBar();
    }),
  );

  // Analyser les fichiers déjà ouverts
  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor.document);
  }
}

export function deactivate() {
  diagnosticCollection?.dispose();
  statusBarItem?.dispose();
}

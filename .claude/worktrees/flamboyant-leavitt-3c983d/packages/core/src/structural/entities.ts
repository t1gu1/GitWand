/**
 * Top-level entity extraction from a tree-sitter AST.
 *
 * An "entity" is a top-level declaration in a TypeScript/TSX file:
 * import, export, function, class, interface, type alias, variable declaration,
 * or ambient declaration (declare …).
 *
 * Each entity carries:
 *   - `signature`  — stable key for 3-way matching (based on name/kind)
 *   - `text`       — exact source slice (used in the merged output)
 *   - byte offsets — for gap-preserving reconstruction
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EntityKind =
  | "import"
  | "export"
  | "function"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "declare"
  | "expression"
  | "other";

export interface TopLevelEntity {
  /** Stable key used for 3-way entity matching */
  signature: string;
  /** Entity kind */
  kind: EntityKind;
  /** Exact source text of this entity */
  text: string;
  /** Start byte index in the source string */
  startByte: number;
  /** End byte index in the source string */
  endByte: number;
  /** Start row (0-indexed) in the source */
  startLine: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Find the first named child with the given field name, or fall back to type search. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fieldOrType(node: any, fieldName: string, typeName: string): any | undefined {
  return node.childForFieldName?.(fieldName) ?? findChildByType(node, typeName);
}

/** Find the first direct child with the given type. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findChildByType(node: any, typeName: string): any | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child.type === typeName) return child;
  }
  return undefined;
}

/**
 * Derive a stable signature and kind for a top-level tree-sitter node.
 *
 * Signatures are intentionally simple (kind:name) so that a renamed entity
 * is treated as delete+add rather than a mysterious match. Conservative, correct.
 *
 * Covers: TypeScript/TSX/JS/JSX, Python, Go, Rust.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeSignature(node: any, source: string): { sig: string; kind: EntityKind } {
  const type: string = node.type;

  // ╔══════════════════════════════════════════════════════╗
  // ║  TypeScript / JavaScript (shared grammar base)       ║
  // ╚══════════════════════════════════════════════════════╝

  // ── import_statement ─────────────────────────────────────
  if (type === "import_statement") {
    const sourceNode = fieldOrType(node, "source", "string");
    const mod = sourceNode
      ? source.slice(sourceNode.startIndex, sourceNode.endIndex)
      : String(node.startIndex);
    return { sig: `import:${mod}`, kind: "import" };
  }

  // ── export_statement ─────────────────────────────────────
  if (type === "export_statement") {
    const decl = node.childForFieldName?.("declaration");
    if (decl) {
      const inner = nodeSignature(decl, source);
      return { sig: `export:${inner.sig}`, kind: "export" };
    }
    const preview = source
      .slice(node.startIndex, Math.min(node.startIndex + 60, node.endIndex))
      .replace(/\s+/g, " ")
      .trim();
    return { sig: `export:${preview}`, kind: "export" };
  }

  // ── function_declaration / generator_function_declaration ─
  if (type === "function_declaration" || type === "generator_function_declaration") {
    const name = fieldOrType(node, "name", "identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anonymous";
    return { sig: `function:${nameText}`, kind: "function" };
  }

  // ── class_declaration / abstract_class_declaration ────────
  if (type === "class_declaration" || type === "abstract_class_declaration") {
    const name = fieldOrType(node, "name", "type_identifier") ?? fieldOrType(node, "name", "identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anonymous";
    return { sig: `class:${nameText}`, kind: "class" };
  }

  // ── interface_declaration ─────────────────────────────────
  if (type === "interface_declaration") {
    const name = fieldOrType(node, "name", "type_identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anon";
    return { sig: `interface:${nameText}`, kind: "interface" };
  }

  // ── type_alias_declaration ────────────────────────────────
  if (type === "type_alias_declaration") {
    const name = fieldOrType(node, "name", "type_identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anon";
    return { sig: `type:${nameText}`, kind: "type" };
  }

  // ── lexical_declaration (const / let) ─────────────────────
  // ── variable_declaration (var) ────────────────────────────
  if (type === "lexical_declaration" || type === "variable_declaration") {
    const names: string[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "variable_declarator") {
        const nameNode = child.childForFieldName?.("name");
        if (nameNode) names.push(source.slice(nameNode.startIndex, nameNode.endIndex));
      }
    }
    return { sig: `var:${names.join(",")}`, kind: "variable" };
  }

  // ── ambient_declaration (declare …) ──────────────────────
  if (type === "ambient_declaration") {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type !== "declare") {
        const inner = nodeSignature(child, source);
        return { sig: `declare:${inner.sig}`, kind: "declare" };
      }
    }
    return { sig: `declare:${node.startIndex}`, kind: "declare" };
  }

  // ── expression_statement ──────────────────────────────────
  if (type === "expression_statement") {
    const preview = source
      .slice(node.startIndex, Math.min(node.startIndex + 50, node.endIndex))
      .replace(/\s+/g, " ")
      .trim();
    return { sig: `expr:${preview}`, kind: "expression" };
  }

  // ╔══════════════════════════════════════════════════════╗
  // ║  Python                                              ║
  // ╚══════════════════════════════════════════════════════╝

  // ── function_definition ───────────────────────────────────
  if (type === "function_definition") {
    const name = fieldOrType(node, "name", "identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anonymous";
    return { sig: `function:${nameText}`, kind: "function" };
  }

  // ── class_definition ──────────────────────────────────────
  if (type === "class_definition") {
    const name = fieldOrType(node, "name", "identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anonymous";
    return { sig: `class:${nameText}`, kind: "class" };
  }

  // ── decorated_definition (wraps function_definition / class_definition) ──
  if (type === "decorated_definition") {
    // Find the wrapped definition
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === "function_definition" || child.type === "class_definition") {
        const inner = nodeSignature(child, source);
        return { sig: `decorated:${inner.sig}`, kind: inner.kind };
      }
    }
    return { sig: `decorated:${node.startIndex}`, kind: "other" };
  }

  // ── import_statement (Python) — already handled above (same name) ──
  // ── import_from_statement (Python) ────────────────────────
  if (type === "import_from_statement") {
    const modNode = node.childForFieldName?.("module_name") ?? findChildByType(node, "dotted_name");
    const mod = modNode ? source.slice(modNode.startIndex, modNode.endIndex) : String(node.startIndex);
    return { sig: `import_from:${mod}`, kind: "import" };
  }

  // ╔══════════════════════════════════════════════════════╗
  // ║  Go                                                  ║
  // ╚══════════════════════════════════════════════════════╝

  // ── function_declaration (Go) ─────────────────────────────
  // Note: Go also has function_declaration but the name field is "name" with type "identifier"
  // Already handled above by the JS function_declaration case.

  // ── method_declaration (Go) ───────────────────────────────
  if (type === "method_declaration") {
    const name = fieldOrType(node, "name", "field_identifier") ?? fieldOrType(node, "name", "identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anonymous";
    const receiver = node.childForFieldName?.("receiver");
    const receiverText = receiver ? source.slice(receiver.startIndex, receiver.endIndex).replace(/\s+/g, " ").trim() : "";
    return { sig: `method:${receiverText}:${nameText}`, kind: "function" };
  }

  // ── type_declaration (Go) ─────────────────────────────────
  if (type === "type_declaration") {
    // Contains type_spec children
    const spec = findChildByType(node, "type_spec");
    if (spec) {
      const name = fieldOrType(spec, "name", "type_identifier");
      const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anon";
      return { sig: `type:${nameText}`, kind: "type" };
    }
    return { sig: `type:${node.startIndex}`, kind: "type" };
  }

  // ── var_declaration (Go) ───────────────────────────────────
  if (type === "var_declaration") {
    const spec = findChildByType(node, "var_spec");
    if (spec) {
      const name = findChildByType(spec, "identifier");
      const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anon";
      return { sig: `var:${nameText}`, kind: "variable" };
    }
    return { sig: `var:${node.startIndex}`, kind: "variable" };
  }

  // ── import_declaration (Go) ───────────────────────────────
  if (type === "import_declaration") {
    const preview = source
      .slice(node.startIndex, Math.min(node.startIndex + 60, node.endIndex))
      .replace(/\s+/g, " ")
      .trim();
    return { sig: `import:${preview}`, kind: "import" };
  }

  // ╔══════════════════════════════════════════════════════╗
  // ║  Rust                                                ║
  // ╚══════════════════════════════════════════════════════╝

  // ── function_item (Rust) ──────────────────────────────────
  if (type === "function_item") {
    const name = fieldOrType(node, "name", "identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anonymous";
    return { sig: `function:${nameText}`, kind: "function" };
  }

  // ── struct_item (Rust) ────────────────────────────────────
  if (type === "struct_item") {
    const name = fieldOrType(node, "name", "type_identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anon";
    return { sig: `struct:${nameText}`, kind: "class" };
  }

  // ── enum_item (Rust) ──────────────────────────────────────
  if (type === "enum_item") {
    const name = fieldOrType(node, "name", "type_identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anon";
    return { sig: `enum:${nameText}`, kind: "type" };
  }

  // ── trait_item (Rust) ─────────────────────────────────────
  if (type === "trait_item") {
    const name = fieldOrType(node, "name", "type_identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anon";
    return { sig: `trait:${nameText}`, kind: "interface" };
  }

  // ── impl_item (Rust) ──────────────────────────────────────
  if (type === "impl_item") {
    // impl Foo or impl Bar for Foo
    const traitNode = node.childForFieldName?.("trait");
    const typeNode = node.childForFieldName?.("type");
    const typeText = typeNode
      ? source.slice(typeNode.startIndex, typeNode.endIndex).replace(/\s+/g, " ").trim()
      : String(node.startIndex);
    const traitText = traitNode
      ? source.slice(traitNode.startIndex, traitNode.endIndex).replace(/\s+/g, " ").trim()
      : null;
    const sig = traitText ? `impl:${traitText} for ${typeText}` : `impl:${typeText}`;
    return { sig, kind: "class" };
  }

  // ── mod_item (Rust) ───────────────────────────────────────
  if (type === "mod_item") {
    const name = fieldOrType(node, "name", "identifier");
    const nameText = name ? source.slice(name.startIndex, name.endIndex) : "__anon";
    return { sig: `mod:${nameText}`, kind: "declare" };
  }

  // ── use_declaration (Rust) ────────────────────────────────
  if (type === "use_declaration") {
    const preview = source
      .slice(node.startIndex, Math.min(node.startIndex + 60, node.endIndex))
      .replace(/\s+/g, " ")
      .trim();
    return { sig: `use:${preview}`, kind: "import" };
  }

  // ── attribute_item / inner_attribute_item (Rust — top-level attributes) ──
  if (type === "attribute_item" || type === "inner_attribute_item") {
    const preview = source
      .slice(node.startIndex, Math.min(node.startIndex + 40, node.endIndex))
      .replace(/\s+/g, " ")
      .trim();
    return { sig: `attr:${preview}`, kind: "other" };
  }

  // ╔══════════════════════════════════════════════════════╗
  // ║  Fallback                                            ║
  // ╚══════════════════════════════════════════════════════╝

  return { sig: `${type}:${node.startIndex}`, kind: "other" };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract top-level entities from a parsed tree-sitter tree.
 *
 * Skips unnamed tokens (punctuation, keywords) and ERROR nodes.
 *
 * @param tree   - Parsed tree-sitter tree
 * @param source - Source code (as passed to `parser.parse()`)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractEntities(tree: any, source: string): TopLevelEntity[] {
  const entities: TopLevelEntity[] = [];
  const root = tree.rootNode;

  for (let i = 0; i < root.childCount; i++) {
    const node = root.child(i);
    // Skip unnamed tokens (semicolons, whitespace nodes) and parse errors
    if (!node.isNamed || node.type === "ERROR") continue;

    const { sig, kind } = nodeSignature(node, source);

    entities.push({
      signature: sig,
      kind,
      text: source.slice(node.startIndex, node.endIndex),
      startByte: node.startIndex,
      endByte: node.endIndex,
      startLine: node.startPosition.row,
    });
  }

  return entities;
}

/**
 * Return `true` if the tree contains at least one ERROR node.
 *
 * A tree with ERROR nodes has parse failures and should not be used
 * for structural merge (we fall back to the hunk-based resolver).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hasParseErrors(tree: any): boolean {
  function walk(node: any): boolean {
    if (node.type === "ERROR") return true;
    for (let i = 0; i < node.childCount; i++) {
      if (walk(node.child(i))) return true;
    }
    return false;
  }
  return walk(tree.rootNode);
}

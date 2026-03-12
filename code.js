figma.showUI(__html__, { width: 420, height: 620, title: "Is it ready for dev?" });

figma.ui.onmessage = async (msg) => {
  if (msg.type === "run-audit") {
    const results = runAudit();
    figma.ui.postMessage({ type: "audit-results", results });
  }
  if (msg.type === "focus-node") {
    const node = figma.getNodeById(msg.id);
    if (node) {
      figma.currentPage.selection = [node];
      figma.viewport.scrollAndZoomIntoView([node]);
    }
  }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_NAME_RE =
  /^(Frame|Rectangle|Ellipse|Polygon|Star|Vector|Line|Arrow|Text|Group|Component|Instance|Image|Section|Slice)(\s+\d+)?$/i;

function isDefaultName(name) {
  return DEFAULT_NAME_RE.test(name.trim());
}

function rgbToHex({ r, g, b }) {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.round(v * 255).toString(16).padStart(2, "0"))
      .join("")
  );
}

function getPath(node) {
  const parts = [];
  let n = node.parent;
  while (n && n.type !== "PAGE" && n.type !== "DOCUMENT") {
    parts.unshift(n.name);
    n = n.parent;
  }
  return parts.length ? parts.join(" › ") : "Page root";
}

function trunc(str, len = 38) {
  if (!str) return "";
  return str.length > len ? str.slice(0, len) + "…" : str;
}

// ── Audit ─────────────────────────────────────────────────────────────────────

function runAudit() {
  const page = figma.currentPage;

  const checks = {
    naming: {
      label: "Layer Naming",
      description: "Layers still using default Figma names",
      icon: "tag",
      issues: [],
    },
    autoLayout: {
      label: "Auto Layout",
      description: "Frames with 2+ children not using Auto Layout",
      icon: "layout",
      issues: [],
    },
    colors: {
      label: "Color Variables",
      description: "Solid fills or strokes not bound to a variable",
      icon: "palette",
      issues: [],
    },
    textStyles: {
      label: "Text Styles",
      description: "Text layers not using a text style",
      icon: "type",
      issues: [],
    },
    hidden: {
      label: "Hidden Layers",
      description: "Layers that are invisible — may be forgotten",
      icon: "eye-off",
      issues: [],
    },
    empty: {
      label: "Empty Containers",
      description: "Frames or groups with no children",
      icon: "box",
      issues: [],
    },
  };

  let totalNodes = 0;

  function walk(node, depth) {
    totalNodes++;

    // ── 1. Naming ───────────────────────────────────────────────────────────
    if (isDefaultName(node.name)) {
      checks.naming.issues.push({
        id: node.id,
        label: `${node.type}: "${node.name}"`,
        path: getPath(node),
      });
    }

    // ── 2. Auto Layout ──────────────────────────────────────────────────────
    if (
      (node.type === "FRAME" || node.type === "COMPONENT") &&
      node.layoutMode === "NONE" &&
      "children" in node &&
      node.children.length >= 2
    ) {
      checks.autoLayout.issues.push({
        id: node.id,
        label: `"${trunc(node.name)}" — ${node.children.length} children`,
        path: getPath(node),
      });
    }

    // ── 3. Raw Color Fills ──────────────────────────────────────────────────
    if ("fills" in node && Array.isArray(node.fills)) {
      node.fills.forEach((fill, i) => {
        if (fill.type === "SOLID" && fill.visible !== false) {
          const bound = node.boundVariables && node.boundVariables.fills && node.boundVariables.fills[i];
          if (!bound) {
            checks.colors.issues.push({
              id: node.id,
              label: `"${trunc(node.name)}" fill: ${rgbToHex(fill.color)}`,
              path: getPath(node),
            });
          }
        }
      });
    }

    // ── 3b. Raw Color Strokes ───────────────────────────────────────────────
    if ("strokes" in node && Array.isArray(node.strokes)) {
      node.strokes.forEach((stroke, i) => {
        if (
          stroke.type === "SOLID" &&
          stroke.visible !== false &&
          (node.strokeWeight || 0) > 0
        ) {
          const bound = node.boundVariables && node.boundVariables.strokes && node.boundVariables.strokes[i];
          if (!bound) {
            checks.colors.issues.push({
              id: node.id,
              label: `"${trunc(node.name)}" stroke: ${rgbToHex(stroke.color)}`,
              path: getPath(node),
            });
          }
        }
      });
    }

    // ── 4. Text Styles ──────────────────────────────────────────────────────
    if (node.type === "TEXT" && !node.textStyleId) {
      checks.textStyles.issues.push({
        id: node.id,
        label: `"${trunc(node.characters || node.name, 42)}"`,
        path: getPath(node),
      });
    }

    // ── 5. Hidden Layers ────────────────────────────────────────────────────
    if (depth <= 4 && node.visible === false) {
      checks.hidden.issues.push({
        id: node.id,
        label: `${node.type}: "${trunc(node.name)}"`,
        path: getPath(node),
      });
    }

    // ── 6. Empty Containers ─────────────────────────────────────────────────
    if (
      (node.type === "FRAME" || node.type === "GROUP") &&
      "children" in node &&
      node.children.length === 0
    ) {
      checks.empty.issues.push({
        id: node.id,
        label: `${node.type}: "${trunc(node.name)}"`,
        path: getPath(node),
      });
    }

    // ── Recurse ─────────────────────────────────────────────────────────────
    if ("children" in node && node.children) {
      node.children.forEach(function(child) { walk(child, depth + 1); });
    }
  }

  page.children.forEach((n) => walk(n, 0));

  const totalIssues = Object.values(checks).reduce(
    (s, c) => s + c.issues.length,
    0
  );

  // Score: start at 100, deduct per issue relative to node count
  const penalty = Math.min(totalIssues / Math.max(totalNodes, 1), 1);
  const score = Math.max(0, Math.round(100 - penalty * 200));

  return { checks, totalNodes, totalIssues, score };
}
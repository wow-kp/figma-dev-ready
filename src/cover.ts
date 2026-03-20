// Cover page generation
import { getAuditPages } from './utils';

export async function generateCover(info) {
  // Find the cover page
  var coverPage = null;
  for (var i = 0; i < figma.root.children.length; i++) {
    if (figma.root.children[i].name.toLowerCase().indexOf("cover") !== -1) {
      coverPage = figma.root.children[i]; break;
    }
  }
  if (!coverPage) {
    coverPage = figma.createPage();
    coverPage.name = "_Cover";
    try { (coverPage as any).devStatus = null; } catch(e) {}
    figma.root.insertChild(0, coverPage);
  }

  // Load fonts we'll use
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });

  // Remove existing cover frame if regenerating
  var existing = coverPage.children.filter(function(n) { return n.name === "Cover"; });
  existing.forEach(function(n) { try { n.remove(); } catch(e) {} });

  // Status colours
  var STATUS_COLORS = {
    "In Progress":       { bg: { r:0.988, g:0.886, b:0.686 }, text: { r:0.541, g:0.361, b:0.000 } },
    "Ready for Review":  { bg: { r:0.537, g:0.706, b:0.980 }, text: { r:0.067, g:0.251, b:0.620 } },
    "Dev Ready":         { bg: { r:0.651, g:0.890, b:0.631 }, text: { r:0.067, g:0.392, b:0.114 } },
  };
  var statusCol = STATUS_COLORS[info.status] || STATUS_COLORS["In Progress"];

  var W = 1440, H = 960;
  var frame = figma.createFrame();
  frame.name = "cover";
  frame.resize(W, H);
  frame.fills = [{ type: "SOLID", color: { r: 0.067, g: 0.067, b: 0.094 } }];
  coverPage.appendChild(frame);

  // Accent bar (left edge)
  var accent = figma.createRectangle();
  accent.name = "accent-bar";
  accent.resize(6, H);
  accent.x = 0; accent.y = 0;
  accent.fills = [{ type: "SOLID", color: { r: 0.537, g: 0.706, b: 0.980 } }];
  frame.appendChild(accent);

  // Logo placeholder
  var logoFrame = figma.createFrame();
  logoFrame.name = "logo-placeholder";
  logoFrame.resize(80, 80);
  logoFrame.x = 80; logoFrame.y = 80;
  logoFrame.cornerRadius = 16;
  logoFrame.fills = [{ type: "SOLID", color: { r: 0.537, g: 0.706, b: 0.980 }, opacity: 0.15 }];
  logoFrame.strokes = [{ type: "SOLID", color: { r: 0.537, g: 0.706, b: 0.980 }, opacity: 0.4 }];
  logoFrame.strokeWeight = 1.5;
  frame.appendChild(logoFrame);

  var logoLabel = figma.createText();
  logoLabel.fontName = { family: "Inter", style: "Medium" };
  logoLabel.fontSize = 11;
  logoLabel.characters = "Logo";
  logoLabel.fills = [{ type: "SOLID", color: { r: 0.537, g: 0.706, b: 0.980 }, opacity: 0.6 }];
  logoLabel.x = logoFrame.x + (logoFrame.width - logoLabel.width) / 2;
  logoLabel.y = logoFrame.y + (logoFrame.height - logoLabel.height) / 2;
  frame.appendChild(logoLabel);

  // Project name
  var projectText = figma.createText();
  projectText.name = "project-name";
  projectText.fontName = { family: "Inter", style: "Bold" };
  projectText.fontSize = 72;
  projectText.characters = info.project;
  projectText.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
  projectText.x = 80;
  projectText.y = 220;
  frame.appendChild(projectText);

  // Divider line
  var divider = figma.createRectangle();
  divider.name = "divider";
  divider.resize(W - 160, 1);
  divider.x = 80;
  divider.y = projectText.y + projectText.height + 32;
  divider.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.08 }];
  frame.appendChild(divider);

  // Meta row: version, date, designers
  var metaY = divider.y + 36;
  var metaItems = [
    { label: "Version",      value: info.version   },
    { label: "Last Updated", value: info.date       },
    { label: "Designer(s)",  value: info.designers  },
  ];
  var metaX = 80;
  metaItems.forEach(function(item) {
    var lbl = figma.createText();
    lbl.fontName = { family: "Inter", style: "Regular" };
    lbl.fontSize = 12;
    lbl.characters = item.label.toUpperCase();
    lbl.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.35 }];
    lbl.letterSpacing = { unit: "PIXELS", value: 1.2 };
    lbl.x = metaX; lbl.y = metaY;
    frame.appendChild(lbl);

    var val = figma.createText();
    val.fontName = { family: "Inter", style: "Semi Bold" };
    val.fontSize = 20;
    val.characters = item.value;
    val.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 0.85 }];
    val.x = metaX; val.y = metaY + 22;
    frame.appendChild(val);

    metaX += 280;
  });

  // Status badge
  var badgeW = 200, badgeH = 44, badgeX = W - 80 - badgeW, badgeY = metaY;

  var badgeBg = figma.createRectangle();
  badgeBg.name = "status-badge-bg";
  badgeBg.resize(badgeW, badgeH);
  badgeBg.x = badgeX; badgeBg.y = badgeY;
  badgeBg.cornerRadius = 22;
  badgeBg.fills = [{ type: "SOLID", color: statusCol.bg }];
  frame.appendChild(badgeBg);

  var badgeText = figma.createText();
  badgeText.fontName = { family: "Inter", style: "Bold" };
  badgeText.fontSize = 14;
  badgeText.characters = info.status;
  badgeText.fills = [{ type: "SOLID", color: statusCol.text }];
  badgeText.x = badgeX + (badgeW - badgeText.width) / 2;
  badgeText.y = badgeY + (badgeH - badgeText.height) / 2;
  frame.appendChild(badgeText);

  // Navigate to cover page and zoom to frame
  await figma.setCurrentPageAsync(coverPage);
  figma.viewport.scrollAndZoomIntoView([frame]);
}

export async function updateCoverStatus(msg) {
  try {
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    var STATUS_COLORS = {
      "In Progress":       { bg: { r:0.988, g:0.886, b:0.686 }, text: { r:0.541, g:0.361, b:0.000 } },
      "Ready for Review":  { bg: { r:0.537, g:0.706, b:0.980 }, text: { r:0.067, g:0.251, b:0.620 } },
      "Dev Ready":         { bg: { r:0.651, g:0.890, b:0.631 }, text: { r:0.067, g:0.392, b:0.114 } },
    };
    var statusCol = STATUS_COLORS[msg.status] || STATUS_COLORS["In Progress"];
    var coverPage = figma.root.children.filter(function(p) {
      return p.name.replace(/[^a-zA-Z]/g, "").toLowerCase().indexOf("cover") !== -1;
    })[0];
    if (coverPage) {
      var coverFrame = coverPage.children.filter(function(n) { return n.name === "Cover"; })[0];
      if (coverFrame) {
        var badgeBg = null, badgeText = null;
        coverFrame.children.forEach(function(n) {
          if (n.name === "status-badge-bg") badgeBg = n;
          if (n.type === "TEXT" && n.characters && STATUS_COLORS[n.characters]) badgeText = n;
        });
        // Find badge text by checking all text nodes if not found by content
        if (!badgeText) {
          coverFrame.children.forEach(function(n) {
            if (n.type === "TEXT" && n.y === (badgeBg ? badgeBg.y + (badgeBg.height - n.height) / 2 : -1)) badgeText = n;
          });
        }
        if (badgeBg) {
          badgeBg.fills = [{ type: "SOLID", color: statusCol.bg }];
        }
        if (badgeText) {
          badgeText.characters = msg.status;
          badgeText.fills = [{ type: "SOLID", color: statusCol.text }];
          if (badgeBg) {
            badgeText.x = badgeBg.x + (badgeBg.width - badgeText.width) / 2;
          }
        }
      }
    }
    // Set Figma's built-in dev status on Desktop & Mobile top-level frames
    var auditPages = getAuditPages();
    var devStatus = msg.status === "Dev Ready" ? { type: "READY_FOR_DEV" } : null;
    auditPages.forEach(function(pg) {
      pg.children.forEach(function(frame) {
        if (frame.type !== "FRAME" && frame.type !== "SECTION") return;
        try { frame.devStatus = devStatus; } catch(e) {}
      });
    });
  } catch(e) {}
  figma.ui.postMessage({ type: "cover-status-updated", status: msg.status });
}

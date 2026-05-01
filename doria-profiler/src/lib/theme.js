// Palette commune
export const BG = "#0A1422";
export const PANEL = "#0F1B2D";
export const PANEL_2 = "#13243A";
export const BORDER = "rgba(255,255,255,0.08)";
export const MUTED = "#94A3B8";
export const TEXT = "#E5E7EB";
export const GOLD = "#D4AF37";
export const TEAL = "#22D3EE";
export const ACCENT = "#A855F7";
export const POS = "#10B981";
export const NEG = "#EF4444";
export const NEUTRAL = "#F59E0B";

export const CAT_COLORS = [
  "#22D3EE", "#A855F7", "#F59E0B", "#10B981",
  "#EF4444", "#3B82F6", "#EC4899", "#84CC16",
  "#F97316", "#06B6D4", "#8B5CF6", "#14B8A6",
  "#FACC15", "#F43F5E",
];

export const panelStyle = {
  background: PANEL,
  border: `1px solid ${BORDER}`,
  borderRadius: 12,
  padding: 16,
};

export const buttonPrimary = {
  background: GOLD,
  color: "#0A1422",
  border: "none",
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export const buttonSecondary = {
  background: "transparent",
  color: TEXT,
  border: `1px solid ${BORDER}`,
  borderRadius: 8,
  padding: "10px 16px",
  fontSize: 13,
  cursor: "pointer",
};

export const inputStyle = {
  background: PANEL_2,
  border: `1px solid ${BORDER}`,
  color: TEXT,
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  outline: "none",
  width: "100%",
};

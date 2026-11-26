const productionSetup = "https://erp.momoshop.mn/?setup=1";
const localSetup = "http://localhost:4173/?setup=1";

// Only a server-side setting selects the destination of an emailed session.
export function inviteRedirectUrl(configured = productionSetup) {
  if (configured !== productionSetup && configured !== localSetup) {
    throw new Error("Unsupported invitation callback");
  }
  return configured;
}

export function isValidStartDate(value) {
  if (value == null || value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) {
    return false;
  }
  const date = new Date(value + "T00:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

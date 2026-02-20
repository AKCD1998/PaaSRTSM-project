export function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return date.toLocaleString();
}

export function formatNumber(value) {
  if (value == null || value === "") {
    return "-";
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return String(value);
  }
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function titleize(value) {
  if (!value) {
    return "-";
  }
  return String(value).replace(/_/g, " ");
}

export function stableFormToken(payload) {
  return JSON.stringify(payload);
}

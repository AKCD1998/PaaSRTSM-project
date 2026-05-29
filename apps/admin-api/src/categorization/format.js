"use strict";

function formatDisplayCategory(shelf_no, clean_category) {
  if (!clean_category || !String(clean_category).trim()) return null;
  const cat = String(clean_category).trim();
  if (shelf_no != null && shelf_no !== "" && Number.isFinite(Number(shelf_no))) {
    return `${shelf_no}${cat}`;
  }
  return cat;
}

module.exports = { formatDisplayCategory };

"use strict";

// Seed July 2026 (กรกฎาคม 2569) focus products, sourced directly from
// "โฟกัสปี69.xlsx" sheet "005 สินค้าโฟกัส 07-69".
// Run: node scripts/seed_focus_products_2026_07.js
//
// Sold-qty progress is never hardcoded here — it's always computed live by
// the API from ada.sales_lines/sales_headers, and auto-freezes once date_to
// (2026-07-31) has passed. Only the target definitions are seeded.
//
// Two line items in the source sheet bundle two product codes under one
// shared target (a customer buying either flavor/variant counts toward the
// same number). The current schema is one product per focus row, so only the
// first code of each pair is seeded; the paired code is recorded in `note`
// for a human to reconcile until multi-product targets are supported:
//   - store_manager #1: IC-002462 (paired with IC-005185, target 4)
//   - store_manager #5: IC-004754 (paired with IC-004755, target 20)

const BASE_URL = "https://paasrtsm-project.onrender.com";
const ADMIN_USER = "admin@scgroup1989.com";
const ADMIN_PASS = "S123123c";

const DATE_FROM = "2026-07-01";
const DATE_TO = "2026-07-31";
const FOUR_BRANCHES = ["001", "003", "004", "005"];
const BRANCH_005 = ["005"];

const FOCUS_PRODUCTS = [
  // ── group_manager: branch 005's own contribution to a company-wide target;
  // same target_qty applies independently to each of the 4 branches ──────────
  { focusType: "group_manager", productCode: "IC-004615", targetQty: 3, branchCodes: FOUR_BRANCHES, note: "สามัญ ลูทีน่า วิซ 380 มก. 30 แคปซูล" },
  { focusType: "group_manager", productCode: "IC-004601", targetQty: 20, branchCodes: FOUR_BRANCHES, note: "สามัญ โพรโพลิซ เอ็กซ์ ชนิดเม็ดอม กลิ่นน้ำผึ้งมะนาว 8 เม็ด" },
  { focusType: "group_manager", productCode: "IC-005116", targetQty: 3, branchCodes: FOUR_BRANCHES, note: "ปกติ ซี 1000 มก. 100 เม็ด" },
  { focusType: "group_manager", productCode: "IC-002371", targetQty: 6, branchCodes: FOUR_BRANCHES, note: "ปกติ โวลโคลแนค สเปรย์ 60 มล." },
  { focusType: "group_manager", productCode: "IC-000700", targetQty: 3, branchCodes: FOUR_BRANCHES, note: "สามัญ ไวโอทรัม มัลติวิตามิน พลัส 30 เม็ด" },

  // ── salesperson: one combined target summed across the 4 branches ─────────
  { focusType: "salesperson", productCode: "IC-005834", targetQty: 10, branchCodes: FOUR_BRANCHES, assignedPersonName: "กนกรดา มันทะเสน", note: "สามัญ สวิสเซ โพรไบโอติก+กัมมี่ 45 เม็ด" },
  { focusType: "salesperson", productCode: "IC-005465", targetQty: 16, branchCodes: FOUR_BRANCHES, assignedPersonName: "ภิรมย์พร เกิดผล", note: "สามัญ ยาน้ำแก้ไอ ไอเฮิร์บ โอทีซี 100 มล." },
  { focusType: "salesperson", productCode: "IC-005482", targetQty: 6, branchCodes: FOUR_BRANCHES, assignedPersonName: "กุลกัญญา เทพรัตนวิชัย", note: "สามัญ คีลาแม็ก 100 มก. 30 เม็ด" },
  { focusType: "salesperson", productCode: "IC-001829", targetQty: 10, branchCodes: FOUR_BRANCHES, assignedPersonName: "อภิสรา พันธเสน", note: "สามัญ ไพลวาน่า ครีม 35 กรัม" },
  { focusType: "salesperson", productCode: "630020294", targetQty: 90, branchCodes: FOUR_BRANCHES, assignedPersonName: "นิศารัตน์ พรมดี", note: "ปกติ แนทเทียร์ 10 มล." },
  { focusType: "salesperson", productCode: "IC-005631", targetQty: 24, branchCodes: FOUR_BRANCHES, assignedPersonName: "ศศิชา หนูเปีย", note: "สามัญ ยาดมลูกกลิ้ง แบล็คอินเฮเลอร์ 5 มล." },
  { focusType: "salesperson", productCode: "IC-000563", targetQty: 120, branchCodes: FOUR_BRANCHES, assignedPersonName: "ศิริลักษณ์ อุ่นประเสริฐ", note: "สามัญ ออพ ไอซ์ ยาล้างตา 110 มล." },

  // ── store_manager: branch 005 only ─────────────────────────────────────
  { focusType: "store_manager", productCode: "IC-002462", targetQty: 4, branchCodes: BRANCH_005, note: "สามัญ โพลาร์ สเปรย์ กลิ่นยูคาลิปตัส 280 มล. (เป้าร่วมกับ IC-005185 กลิ่นอินโนเซนส์ — ยังไม่รองรับ multi-product ในระบบ)" },
  { focusType: "store_manager", productCode: "IC-005455", targetQty: 2, branchCodes: BRANCH_005, note: "สามัญ พีเอ็กซ์ เมลา เซเวน ครีม เจล 10 กรัม" },
  { focusType: "store_manager", productCode: "IC-004885", targetQty: 2, branchCodes: BRANCH_005, note: "ปกติ เอเลวิต วิตามินรวมและเกลือแร่ 30 เม็ด" },
  { focusType: "store_manager", productCode: "IC-000167", targetQty: 10, branchCodes: BRANCH_005, note: "ปกติ ไฮซี 500 มก. 15 เม็ด" },
  { focusType: "store_manager", productCode: "IC-004754", targetQty: 20, branchCodes: BRANCH_005, note: "สามัญ วิคส์ วาโปดรอป รสน้ำผึ้งมะนาว 8 เม็ด (เป้าร่วมกับ IC-004755 รสส้ม — ยังไม่รองรับ multi-product ในระบบ)" },
  { focusType: "store_manager", productCode: "IC-004853", targetQty: 2, branchCodes: BRANCH_005, note: "สามัญ เซราวี มอยซ์เจอไรซิ่ง โลชั่น 236 มล." },
  { focusType: "store_manager", productCode: "IC-003404", targetQty: 2, branchCodes: BRANCH_005, note: "สามัญ เพียวริก้าส์ พลัส แอดวานส์ ดร้าก้อน บลัด ซี แอนด์ อี สการ์ เจล 9 กรัม" },
  { focusType: "store_manager", productCode: "IC-001359", targetQty: 3, branchCodes: BRANCH_005, note: "สามัญ ซิงก์พลัส 60 เม็ด" },

  // ── pharmacist: branch 005 only ────────────────────────────────────────
  { focusType: "pharmacist", productCode: "IC-003557", targetQty: 5, branchCodes: BRANCH_005, note: "เภสัช กลูโคซา 1500 มก. รสมะนาว 30 ซอง" },
  { focusType: "pharmacist", productCode: "IC-005003", targetQty: 30, branchCodes: BRANCH_005, note: "เภสัช แมนคลามีน 1000 มก. 10 เม็ด" },
  { focusType: "pharmacist", productCode: "IC-003550", targetQty: 30, branchCodes: BRANCH_005, note: "เภสัช เลโวเซติน 5 มก. 10 เม็ด" },
  { focusType: "pharmacist", productCode: "IC-000646", targetQty: 60, branchCodes: BRANCH_005, note: "เภสัช โซลูเฟน 400 มก. 10 เม็ด" },
  { focusType: "pharmacist", productCode: "IC-000418", targetQty: 12, branchCodes: BRANCH_005, note: "เภสัช ไลบาลิน 75 มก. 7 แคป" },
  { focusType: "pharmacist", productCode: "IC-004930", targetQty: 5, branchCodes: BRANCH_005, note: "เภสัช เน็กซ์เทลลิส 3 มก./15มก. 28 เม็ด" },
];

async function login() {
  const res = await fetch(`${BASE_URL}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}`);
  const data = await res.json();
  const cookie = res.headers.get("set-cookie");
  return { csrfToken: data.csrf_token, cookie };
}

async function createFocusProduct(item, { csrfToken, cookie }) {
  const res = await fetch(`${BASE_URL}/api/admin/focus-products`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
      "Cookie": cookie,
    },
    body: JSON.stringify({
      productCode: item.productCode,
      focusType: item.focusType,
      targetQty: item.targetQty,
      dateFrom: DATE_FROM,
      dateTo: DATE_TO,
      branchCodes: item.branchCodes,
      assignedPersonName: item.assignedPersonName || null,
      note: item.note || null,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function run() {
  console.log("Logging in...");
  const auth = await login();
  console.log("Login OK\n");

  let ok = 0;
  let fail = 0;
  for (const item of FOCUS_PRODUCTS) {
    try {
      const result = await createFocusProduct(item, auth);
      console.log(`✔  [${item.focusType}] ${item.productCode} target=${item.targetQty}${item.assignedPersonName ? ` (${item.assignedPersonName})` : ""} → id ${result.focusProduct.id}`);
      ok++;
    } catch (err) {
      console.error(`✖  [${item.focusType}] ${item.productCode} — ${err.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} created, ${fail} failed`);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

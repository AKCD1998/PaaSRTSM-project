"use strict";

// Seed branch staff roster for SC Drug Store mobile PDA enrollment.
// Run: node scripts/seed_branch_staff.js

const BASE_URL = "https://paasrtsm-project.onrender.com";
const ADMIN_USER = "admin@scgroup1989.com";
const ADMIN_PASS = "S123123c";

const STAFF = [
  // ─── 000 สำนักงานใหญ่ ───────────────────────────────────────────
  { branchCode: "000", displayName: "ก้าว · นิภาพร เชยกำเหนิด",    role: "manager", isProbationary: false, note: "ผู้จัดการฝ่ายสนับสนุน" },
  { branchCode: "000", displayName: "เอ · พิมจิตร เสือเล็ก",        role: "manager", isProbationary: false, note: "ผู้จัดการบัญชีและธุรการ" },
  { branchCode: "000", displayName: "ตูน · ภูริทัต ศรีสนิท",        role: "manager", isProbationary: false, note: "ผู้จัดการคลังสินค้าและขนส่ง" },
  { branchCode: "000", displayName: "นิ · ภิรดา คงมณี",             role: "manager", isProbationary: false, note: "พนักงานประจำสำนักงาน" },
  { branchCode: "000", displayName: "โม · จิรัฎฐ์ อธิรัฐนิธิเมธ",  role: "manager", isProbationary: false, note: "พนักงานประจำสำนักงาน" },
  { branchCode: "000", displayName: "พลอย · พลอยไพรินทร์ น้อยรักษา", role: "manager", isProbationary: false, note: "พนักงานประจำสำนักงาน" },
  { branchCode: "000", displayName: "บูม · กิตติชล ตระการเกตุ",      role: "sales",   isProbationary: true,  note: "พนักงานฝึกงานสำนักงาน" },
  { branchCode: "000", displayName: "นนท์ · ณัฐธนนท์ มานะกุล",      role: "sales",   isProbationary: true,  note: "พนักงานฝึกงานสำนักงาน" },
  { branchCode: "000", displayName: "เมย์ · สุภัคนางค์ มิ่งสัมพรางค์", role: "sales", isProbationary: true,  note: "พนักงานฝึกงานสำนักงาน" },
  { branchCode: "000", displayName: "มุก · ธรรมาวัน ช้างศร",         role: "sales",   isProbationary: true,  note: "พนักงานฝึกงานสำนักงาน" },

  // ─── 001 สาขาตลาดแม่กลอง ────────────────────────────────────────
  { branchCode: "001", displayName: "ออม · กมลชนก จันทร์ตรง",        role: "manager", isProbationary: false, note: "รองผู้จัดการสาขา" },
  { branchCode: "001", displayName: "จ๋า · มณีรัตน์ มาลัยมาลย์",     role: "manager", isProbationary: false, note: "เภสัชกรประจำสาขา" },
  { branchCode: "001", displayName: "มายด์ · กนกรดา มันทะเสน",       role: "sales",   isProbationary: false, note: "พนักงานประจำสาขา" },
  { branchCode: "001", displayName: "หนิง · กุลกัญญา เทพรัตนวิชัย",  role: "sales",   isProbationary: true,  note: "พนักงานฝึกงานสาขา" },
  { branchCode: "001", displayName: "โอปอ · สุภาพร ถมยา",            role: "sales",   isProbationary: true,  note: "พนักงานฝึกงานสาขา" },
  { branchCode: "001", displayName: "มายด์ · ศศิชา หนูเปีย",         role: "sales",   isProbationary: true,  note: "พนักงานฝึกงานสาขา" },

  // ─── 003 สาขาช่องลม ─────────────────────────────────────────────
  { branchCode: "003", displayName: "แพร · สุดารัตน์ เวชประเสริฐ",   role: "manager", isProbationary: false, note: "ผู้จัดการสาขา" },
  { branchCode: "003", displayName: "แอมป์ · ศุภิสรา ศิริมงคล",      role: "manager", isProbationary: false, note: "เภสัชกรประจำสาขา" },
  { branchCode: "003", displayName: "ส้ม · กนกกร มณีใส",             role: "sales",   isProbationary: false, note: "พนักงานประจำสาขา" },

  // ─── 004 สาขาตลาดบางน้อย ────────────────────────────────────────
  { branchCode: "004", displayName: "เบ็นซ์ · ชลนิสา ประพิน",        role: "manager", isProbationary: false, note: "ผู้จัดการสาขาเฉพาะกิจ" },
  { branchCode: "004", displayName: "บิว · วรรณพร ฉัตรวิชชานนท์",    role: "manager", isProbationary: false, note: "เภสัชกรประจำสาขา" },
  { branchCode: "004", displayName: "ใบเฟิร์น · ภิรมย์พร เกิดผล",    role: "sales",   isProbationary: false, note: "พนักงานประจำสาขา" },
  { branchCode: "004", displayName: "เมย์ · อภิสรา พันธเสน",          role: "sales",   isProbationary: true,  note: "พนักงานฝึกงานสาขา" },

  // ─── 005 สาขาเอกชัย ─────────────────────────────────────────────
  { branchCode: "005", displayName: "โบว์ · นงลักษณ์ ชูกร",          role: "manager", isProbationary: false, note: "หัวหน้าฝ่าย GH / ผู้จัดการสาขาเฉพาะกิจ" },
  { branchCode: "005", displayName: "บาส · พิมลภัทร เสงี่ยมโคกกรวด", role: "manager", isProbationary: false, note: "ผู้จัดการสาขาเฉพาะกิจ" },
  { branchCode: "005", displayName: "อู๋ · ชวิศ ดิษฐาพร",            role: "manager", isProbationary: false, note: "เภสัชกรปฏิบัติการอาวุโส" },
  { branchCode: "005", displayName: "อิม · นิศารัตน์ พรมดี",          role: "sales",   isProbationary: true,  note: "พนักงานฝึกงานสาขา" },
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

async function createStaff(staff, { csrfToken, cookie }) {
  const res = await fetch(`${BASE_URL}/api/admin/branch-staff`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": csrfToken,
      "Cookie": cookie,
    },
    body: JSON.stringify(staff),
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
  for (const staff of STAFF) {
    try {
      const result = await createStaff(staff, auth);
      console.log(`✔  [${staff.branchCode}] ${staff.displayName} (${staff.role}${staff.isProbationary ? ", ฝึกงาน" : ""}) → staff_id ${result.staff.staffId}`);
      ok++;
    } catch (err) {
      console.error(`✖  [${staff.branchCode}] ${staff.displayName} — ${err.message}`);
      fail++;
    }
  }

  console.log(`\nDone: ${ok} created, ${fail} failed`);
}

run().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

"use strict";

const PHONE_PATTERN = /^0[689]\d{8}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 100;
const MAX_PAGES = 10;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function normalizeThaiMobilePhone(value) {
  if (typeof value !== "string" || value.length > 40) return "";
  const ascii = value.replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50));
  if (!/^[\d+\s()-]+$/.test(ascii)) return "";
  let phone = ascii.replace(/[\s()-]/g, "");
  if (phone.startsWith("+66")) phone = `0${phone.slice(3)}`;
  else if (phone.startsWith("0066")) phone = `0${phone.slice(4)}`;
  return PHONE_PATTERN.test(phone) ? phone : "";
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function readJsonBounded(response) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body || []) {
    bytes += chunk.length;
    if (bytes > MAX_RESPONSE_BYTES) throw httpError(503, "Member service is temporarily unavailable.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(503, "Member service is temporarily unavailable.");
  }
}

function phoneValues(member) {
  return [member?.phone, ...(Array.isArray(member?.phoneNumbers) ? member.phoneNumbers : [])]
    .map((value) => normalizeThaiMobilePhone(String(value || "")))
    .filter(Boolean);
}

function createPreorderMemberDirectory({ config, fetchImpl = global.fetch, timeoutMs = 15000 }) {
  async function searchPage(base, phone, page) {
    const url = new URL("/internal/crm/member-directory", base);
    url.searchParams.set("search", phone);
    url.searchParams.set("page", String(page));
    url.searchParams.set("limit", String(PAGE_SIZE));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { "x-internal-token": config.crmMirrorInternalToken, Accept: "application/json" },
        signal: controller.signal,
        redirect: "error",
        cache: "no-store",
      });
      if (!response.ok) throw httpError(503, "Member service is temporarily unavailable.");
      const body = await readJsonBounded(response);
      if (!Array.isArray(body.members) || !Number.isSafeInteger(Number(body.total)) || Number(body.total) < 0) {
        throw httpError(503, "Member service is temporarily unavailable.");
      }
      return { members: body.members, total: Number(body.total) };
    } catch (error) {
      if (error.statusCode) throw error;
      throw httpError(503, "Member service is temporarily unavailable.");
    } finally {
      clearTimeout(timer);
    }
  }

  async function findByPhone(rawPhone) {
    const phone = normalizeThaiMobilePhone(rawPhone);
    if (!phone) throw httpError(400, "กรุณากรอกเบอร์มือถือไทย 10 หลักให้ถูกต้อง");

    let base;
    try {
      base = new URL(config.crmMirrorBaseUrl || "");
    } catch {
      throw httpError(503, "Member service is temporarily unavailable.");
    }
    const isLocal = base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname);
    if (!config.crmMirrorInternalToken || base.username || base.password || (base.protocol !== "https:" && !isLocal)) {
      throw httpError(503, "Member service is temporarily unavailable.");
    }

    const first = await searchPage(base, phone, 1);
    const pageCount = Math.ceil(first.total / PAGE_SIZE);
    if (pageCount > MAX_PAGES) throw httpError(503, "Member service returned too many matches.");
    const rows = [...first.members];
    for (let page = 2; page <= pageCount; page += 1) {
      const result = await searchPage(base, phone, page);
      rows.push(...result.members);
    }

    const matches = rows
      .filter((member) => member?.isActive === true
        && UUID_PATTERN.test(String(member.id || ""))
        && phoneValues(member).includes(phone))
      .map((member) => ({
        id: String(member.id),
        name: String(member.name || "").trim(),
        memberCode: String(member.memberCode || "").trim() || null,
      }))
      .filter((member) => member.name)
      .sort((a, b) => a.name.localeCompare(b.name, "th") || String(a.memberCode || "").localeCompare(String(b.memberCode || "")) || a.id.localeCompare(b.id));

    return { phone, matches };
  }

  return { findByPhone };
}

module.exports = { createPreorderMemberDirectory, normalizeThaiMobilePhone, UUID_PATTERN };

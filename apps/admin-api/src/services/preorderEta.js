"use strict";
const DEFAULT_SCHEDULES = Object.freeze({ "001": [1,3,5], "003": [1,3,5], "004": [1,3,5], "005": [2,4,6] });
function bangkokDateParts(value) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Bangkok", year:"numeric", month:"2-digit", day:"2-digit" }).formatToParts(new Date(value));
  return Object.fromEntries(parts.map((p) => [p.type,p.value]));
}
function nextDeliveryDate(value, weekdays) {
  const p=bangkokDateParts(value); const cursor=new Date(`${p.year}-${p.month}-${p.day}T12:00:00Z`);
  for(let i=1;i<=7;i+=1){ const d=new Date(cursor); d.setUTCDate(cursor.getUTCDate()+i); const iso=d.getUTCDay()||7; if(weekdays.includes(iso)) return d.toISOString().slice(0,10); }
  return null;
}
function estimateBranchEta({ evidenceAt, branchCode, weekdays }) { return nextDeliveryDate(evidenceAt, weekdays || DEFAULT_SCHEDULES[branchCode] || []); }
module.exports={ DEFAULT_SCHEDULES, nextDeliveryDate, estimateBranchEta };

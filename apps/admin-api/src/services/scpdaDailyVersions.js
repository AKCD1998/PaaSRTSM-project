'use strict';

const { CountError } = require('./scpdaObservationLedger');
const fail = () => { throw new CountError(409, 'APP_UPDATE_REQUIRED', 'อัปเดต SCPDA เป็นรุ่นที่รองรับสำหรับสาขานี้ก่อน'); };

// Explicit rollout compatibility, not an open-ended minimum-version bypass.
// Omitted branches retain the original exact-latest policy.
function versionPolicy(config, branch) {
  if (!config.scpdaDailyVersionPolicyJson) return null;
  let policy;
  try {
    policy = JSON.parse(config.scpdaDailyVersionPolicyJson);
    if (!policy || Array.isArray(policy) || typeof policy !== 'object') throw Error();
    for (const [key, value] of Object.entries(policy)) {
      if (!['004', '005'].includes(key) || !value ||
          !Array.isArray(value.accepted) || !Array.isArray(value.qr) ||
          !value.accepted.length || value.accepted.length > 4 || !value.qr.length ||
          value.accepted.some(v => !Number.isSafeInteger(v) || v < 1) ||
          value.qr.some(v => !value.accepted.includes(v))) throw Error();
    }
  } catch {
    throw new CountError(503, 'DAILY_VERSION_UNCONFIGURED', 'การตั้งค่ารุ่น SCPDA ยังไม่พร้อม');
  }
  return Object.hasOwn(policy, branch) ? policy[branch] : null;
}

function acceptsVersion(config, branch, version, qr = false) {
  const policy = versionPolicy(config, branch);
  return Number.isSafeInteger(version) && (policy
    ? (qr ? policy.qr : policy.accepted).includes(version)
    : version === config.scpdaPwaVersionCode);
}

async function requirePublishedVersion(db, config, branch, version, qr = false) {
  if (!acceptsVersion(config, branch, version, qr)) fail();
  const policy = versionPolicy(config, branch);
  const { rows } = await db.query(policy
    ? "SELECT version_code FROM app_center.releases WHERE app_id='scpda' AND status='published' AND version_code=$1 LIMIT 1"
    : "SELECT version_code FROM app_center.releases WHERE app_id='scpda' AND status='published' ORDER BY version_code DESC LIMIT 1",
  policy ? [version] : []);
  if (rows[0]?.version_code !== version) fail();
  return version;
}

module.exports = { acceptsVersion, requirePublishedVersion, versionPolicy };

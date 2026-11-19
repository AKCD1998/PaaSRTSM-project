'use strict';
const SCOPES=Object.freeze({
 '004-front':Object.freeze({id:'004-front',label:'หน้าร้าน · รวมคลังหน้าร้าน',branchCode:'004',coveredLocations:['front-sales','front-store']}),
 '004-shopee':Object.freeze({id:'004-shopee',label:'Shopee · หลังร้าน',branchCode:'004',coveredLocations:['shopee-store','shopee-packed']})
});
function operatorScope(config,operator){if(!config.featureScpda004Areas)return null;return SCOPES[operator==='01004'?'004-front':operator==='01004SHPEE'?'004-shopee':'']||null;}
function scopeLabel(id){return SCOPES[id]?.label||'ผลนับเดิม · ไม่ระบุพื้นที่';}
module.exports={SCOPES,operatorScope,scopeLabel};

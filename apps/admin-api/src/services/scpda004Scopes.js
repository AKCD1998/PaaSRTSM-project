'use strict';
const {operatorBranch}=require('./scpdaBranches');
const SCOPES=Object.freeze({
 '004-front':Object.freeze({id:'004-front',label:'หน้าร้าน · รวมคลังหน้าร้าน',branchCode:'004',coveredLocations:['front-sales','front-store']}),
 '004-shopee':Object.freeze({id:'004-shopee',label:'Shopee · หลังร้าน',branchCode:'004',coveredLocations:['shopee-store','shopee-packed']})
});
function operatorScope(config,operator){if(!config.featureScpda004Areas||operatorBranch(operator)!=='004')return null;return SCOPES[operator.endsWith('SHPEE')?'004-shopee':'004-front'];}
function scopeLabel(id){return SCOPES[id]?.label||'ผลนับเดิม · ไม่ระบุพื้นที่';}
const canRecordInternalPick=(config,operator)=>!!operatorScope(config,operator)&&['01004','01004SHPEE'].includes(operator);
module.exports={SCOPES,operatorScope,scopeLabel,canRecordInternalPick};
